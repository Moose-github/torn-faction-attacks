import { HOME_FACTION_ID } from "./constants";
import { revokeSessionsForFormerFactionMembers } from "./auth";
import { fetchTornFactionMembers } from "./enemyScouting";
import { Env, TornFactionMember, WarRow } from "./types";
import { boolToInt, json, nowSeconds } from "./utils";

const ACTIVITY_WINDOW_SECONDS = 15 * 60;
const HOME_RETENTION_SECONDS = 30 * 24 * 60 * 60;
const INTERVALS_PER_DAY = 96;
const HOME_HEATMAP_CLEANUP_STATE_NAME = "home_heatmap_cleanup";

type HeatmapWar = Pick<
  WarRow,
  | "id"
  | "name"
  | "practical_start_time"
  | "practical_finish_time"
  | "official_start_time"
  | "official_end_time"
  | "enemy_faction_id"
>;

type HeatmapRow = {
  faction_id: number;
  date: string;
  interval_index: number;
  active_count: number;
  total_count: number;
  sampled_at: number;
};

export type HeatmapSampleMetrics = {
  writeStatements: number;
  changedRows: number;
  homeSampled: boolean;
  enemySampled: boolean;
  revivableUpdateStatements: number;
  revivableChangedRows: number;
  staleHeatmapRowsDeleted: number;
};

type FactionActivitySampleMetrics = {
  sampled: boolean;
  writeStatements: number;
  changedRows: number;
  revivableUpdateStatements: number;
  revivableChangedRows: number;
};

export async function sampleFactionActivityHeatmaps(
  env: Env,
  options: { membersByFaction?: Map<number, TornFactionMember[]> } = {},
): Promise<HeatmapSampleMetrics> {
  const sampledAt = nowSeconds();
  const metrics: HeatmapSampleMetrics = {
    writeStatements: 0,
    changedRows: 0,
    homeSampled: false,
    enemySampled: false,
    revivableUpdateStatements: 0,
    revivableChangedRows: 0,
    staleHeatmapRowsDeleted: 0,
  };
  const homeCleanup = await cleanupHomeHeatmapIfDue(env, sampledAt);
  metrics.writeStatements += homeCleanup.writeStatements;
  metrics.changedRows += homeCleanup.changedRows;
  metrics.staleHeatmapRowsDeleted += homeCleanup.staleRowsDeleted;

  const latestWar = await readLatestHeatmapWar(env);
  const updateRevivableMembers = shouldUpdateRevivableMembers(latestWar, sampledAt);
  addFactionSampleMetrics(
    metrics,
    await sampleFactionActivity(
      env,
      HOME_FACTION_ID,
      sampledAt,
      updateRevivableMembers,
      options.membersByFaction?.get(HOME_FACTION_ID),
    ),
    "home",
  );

  if (
    latestWar?.enemy_faction_id &&
    latestWar.official_end_time === null &&
    latestWar.practical_finish_time === null
  ) {
    const enemyCleanup = await clearReplaceableEnemyHeatmaps(env, latestWar.enemy_faction_id);
    metrics.writeStatements += enemyCleanup.writeStatements;
    metrics.changedRows += enemyCleanup.changedRows;
    metrics.staleHeatmapRowsDeleted += enemyCleanup.changedRows;
    addFactionSampleMetrics(
      metrics,
      await sampleFactionActivity(
        env,
        latestWar.enemy_faction_id,
        sampledAt,
        updateRevivableMembers,
        options.membersByFaction?.get(latestWar.enemy_faction_id),
      ),
      "enemy",
    );
  }

  return metrics;
}

function addFactionSampleMetrics(
  target: HeatmapSampleMetrics,
  sample: FactionActivitySampleMetrics,
  faction: "home" | "enemy",
): void {
  target.writeStatements += sample.writeStatements;
  target.changedRows += sample.changedRows;
  target.revivableUpdateStatements += sample.revivableUpdateStatements;
  target.revivableChangedRows += sample.revivableChangedRows;
  if (faction === "home") {
    target.homeSampled = sample.sampled;
  } else {
    target.enemySampled = sample.sampled;
  }
}

async function clearReplaceableEnemyHeatmaps(
  env: Env,
  nextFactionId: number,
): Promise<{ writeStatements: number; changedRows: number }> {
  const metrics = { writeStatements: 0, changedRows: 0 };
  const cachedFactions = ((await env.DB.prepare(
    `
    SELECT DISTINCT faction_id
    FROM faction_activity_heatmap
    WHERE faction_id != ?
      AND faction_id != ?
    `,
  )
    .bind(nextFactionId, HOME_FACTION_ID)
    .all()).results ?? []) as { faction_id: number }[];

  for (const cachedFaction of cachedFactions) {
    const unfinishedWar = (await env.DB.prepare(
      `
      SELECT id
      FROM wars
      WHERE enemy_faction_id = ?
        AND official_end_time IS NULL
      ORDER BY practical_start_time DESC
      LIMIT 1
      `,
    )
      .bind(cachedFaction.faction_id)
      .first()) as { id: number } | null;

    if (unfinishedWar) {
      continue;
    }

    const result = await env.DB.prepare(
      `
      DELETE FROM faction_activity_heatmap
      WHERE faction_id = ?
      `,
    )
      .bind(cachedFaction.faction_id)
      .run();
    metrics.writeStatements += 1;
    metrics.changedRows += d1Changes(result);
  }

  return metrics;
}

export async function getWarActivityHeatmap(url: URL, env: Env): Promise<Response> {
  const war = await readHeatmapWarFromUrl(url, env);
  if (war instanceof Response) {
    return war;
  }

  const factionIds = [HOME_FACTION_ID];
  if (war.enemy_faction_id !== null) {
    factionIds.push(war.enemy_faction_id);
  }

  const rows = await env.DB.prepare(
    `
    SELECT *
    FROM faction_activity_heatmap
    WHERE faction_id IN (${factionIds.map(() => "?").join(",")})
    ORDER BY date ASC, interval_index ASC, faction_id ASC
    `,
  )
    .bind(...factionIds)
    .all();

  return json({
    ok: true,
    interval_minutes: 15,
    war: {
      id: war.id,
      name: war.name,
      enemy_faction_id: war.enemy_faction_id,
    },
    home_faction_id: HOME_FACTION_ID,
    rows: (rows.results ?? []) as HeatmapRow[],
  });
}

async function sampleFactionActivity(
  env: Env,
  factionId: number,
  sampledAt: number,
  updateRevivable: boolean,
  prefetchedMembers?: TornFactionMember[],
): Promise<FactionActivitySampleMetrics> {
  const metrics: FactionActivitySampleMetrics = {
    sampled: false,
    writeStatements: 0,
    changedRows: 0,
    revivableUpdateStatements: 0,
    revivableChangedRows: 0,
  };
  const bucket = heatmapBucket(sampledAt);
  const existing = await env.DB.prepare(
    `
    SELECT sampled_at
    FROM faction_activity_heatmap
    WHERE faction_id = ?
      AND date = ?
      AND interval_index = ?
    LIMIT 1
    `,
  )
    .bind(factionId, bucket.date, bucket.intervalIndex)
    .first();

  if (existing) {
    return metrics;
  }

  const members = prefetchedMembers ?? await fetchTornFactionMembers(env, factionId);
  const activeCount = countRecentlyActiveMembers(members, sampledAt);
  if (factionId === HOME_FACTION_ID) {
    const revokedSessions = await revokeSessionsForFormerFactionMembers(
      env,
      members.map((member) => member.id),
    );
    if (revokedSessions > 0) {
      console.log(`Revoked ${revokedSessions} auth session(s) for former faction members`);
    }
  }
  if (updateRevivable) {
    const revivableMetrics = await updateCachedRevivableMembers(env, factionId, members);
    metrics.writeStatements += revivableMetrics.writeStatements;
    metrics.changedRows += revivableMetrics.changedRows;
    metrics.revivableUpdateStatements += revivableMetrics.writeStatements;
    metrics.revivableChangedRows += revivableMetrics.changedRows;
  }

  const result = await env.DB.prepare(
    `
    INSERT INTO faction_activity_heatmap (
      faction_id,
      date,
      interval_index,
      active_count,
      total_count,
      sampled_at
    )
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(faction_id, date, interval_index) DO UPDATE SET
      active_count = excluded.active_count,
      total_count = excluded.total_count,
      sampled_at = excluded.sampled_at
    `,
  )
    .bind(factionId, bucket.date, bucket.intervalIndex, activeCount, members.length, sampledAt)
    .run();
  metrics.sampled = true;
  metrics.writeStatements += 1;
  metrics.changedRows += d1Changes(result);

  return metrics;
}

async function updateCachedRevivableMembers(
  env: Env,
  factionId: number,
  members: TornFactionMember[],
): Promise<{ writeStatements: number; changedRows: number }> {
  const tableName =
    factionId === HOME_FACTION_ID ? "home_faction_members" : "enemy_faction_members";
  const revivableMembers = members.filter((member) => typeof member.is_revivable === "boolean");
  if (revivableMembers.length === 0) {
    return { writeStatements: 0, changedRows: 0 };
  }

  const existingValues = await readCachedRevivableValues(env, tableName, factionId);
  const statements = members
    .filter((member) => {
      if (typeof member.is_revivable !== "boolean") {
        return false;
      }

      const nextValue = boolToInt(member.is_revivable);
      return existingValues.get(member.id) !== nextValue;
    })
    .map((member) =>
      env.DB.prepare(
        `
        UPDATE ${tableName}
        SET is_revivable = ?,
            updated_at = unixepoch()
        WHERE faction_id = ?
          AND member_id = ?
        `,
      ).bind(
        boolToInt(member.is_revivable ?? false),
        factionId,
        member.id,
      ),
    );

  if (statements.length === 0) {
    return { writeStatements: 0, changedRows: 0 };
  }

  const results = await env.DB.batch(statements);
  return {
    writeStatements: statements.length,
    changedRows: results.reduce((total: number, result: unknown) => total + d1Changes(result), 0),
  };
}

async function readCachedRevivableValues(
  env: Env,
  tableName: string,
  factionId: number,
): Promise<Map<number, number | null>> {
  const rows = ((await env.DB.prepare(
    `
    SELECT member_id, is_revivable
    FROM ${tableName}
    WHERE faction_id = ?
    `,
  )
    .bind(factionId)
    .all()).results ?? []) as { member_id: number; is_revivable: number | null }[];

  return new Map(rows.map((row) => [row.member_id, row.is_revivable]));
}

function countRecentlyActiveMembers(
  members: TornFactionMember[],
  sampledAt: number,
): number {
  return members.filter((member) => {
    const lastAction = Number(member.last_action?.timestamp ?? 0);
    return lastAction > 0 && sampledAt - lastAction <= ACTIVITY_WINDOW_SECONDS;
  }).length;
}

async function cleanupHomeHeatmapIfDue(
  env: Env,
  sampledAt: number,
): Promise<{ writeStatements: number; changedRows: number; staleRowsDeleted: number }> {
  const lastCleanup = (await env.DB.prepare(
    `
    SELECT last_started
    FROM sync_state
    WHERE name = ?
    LIMIT 1
    `,
  )
    .bind(HOME_HEATMAP_CLEANUP_STATE_NAME)
    .first()) as { last_started: number | null } | null;

  if (lastCleanup?.last_started && lastCleanup.last_started > sampledAt - 24 * 60 * 60) {
    return { writeStatements: 0, changedRows: 0, staleRowsDeleted: 0 };
  }

  const result = await env.DB.prepare(
    `
    DELETE FROM faction_activity_heatmap
    WHERE faction_id = ?
      AND sampled_at < ?
    `,
  )
    .bind(HOME_FACTION_ID, sampledAt - HOME_RETENTION_SECONDS)
    .run();
  const staleRowsDeleted = d1Changes(result);
  await env.DB.prepare(
    `
    INSERT INTO sync_state (name, last_started, active_war_id)
    VALUES (?, ?, NULL)
    ON CONFLICT(name) DO UPDATE SET
      last_started = excluded.last_started,
      updated_at = CURRENT_TIMESTAMP
    `,
  )
    .bind(HOME_HEATMAP_CLEANUP_STATE_NAME, sampledAt)
    .run();

  return {
    writeStatements: 2,
    changedRows: staleRowsDeleted + 1,
    staleRowsDeleted,
  };
}

async function readLatestHeatmapWar(env: Env): Promise<HeatmapWar | null> {
  return (await env.DB.prepare(
    `
    SELECT
      id,
      name,
      practical_start_time,
      practical_finish_time,
      official_start_time,
      official_end_time,
      enemy_faction_id
    FROM wars
    WHERE enemy_faction_id IS NOT NULL
    ORDER BY practical_start_time DESC
    LIMIT 1
    `,
  ).first()) as HeatmapWar | null;
}

async function readHeatmapWarFromUrl(url: URL, env: Env): Promise<HeatmapWar | Response> {
  const name = decodeURIComponent(url.pathname.split("/")[3] ?? "").trim();

  if (!name) {
    return json({ ok: false, error: "Invalid war name", code: "INVALID_WAR_NAME" }, 400);
  }

  const war = (await env.DB.prepare(
    `
    SELECT
      id,
      name,
      practical_start_time,
      practical_finish_time,
      official_start_time,
      official_end_time,
      enemy_faction_id
    FROM wars
    WHERE LOWER(name) = LOWER(?)
    LIMIT 1
    `,
  )
    .bind(name)
    .first()) as HeatmapWar | null;

  if (!war) {
    return json({ ok: false, error: "War not found", code: "WAR_NOT_FOUND" }, 404);
  }

  return war;
}

function heatmapBucket(timestamp: number): { date: string; intervalIndex: number } {
  const date = new Date(timestamp * 1000);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();

  return {
    date: `${year}-${month}-${day}`,
    intervalIndex: Math.min(INTERVALS_PER_DAY - 1, Math.floor(minutes / 15)),
  };
}

function shouldUpdateRevivableMembers(war: HeatmapWar | null, sampledAt: number): boolean {
  if (!war) {
    return false;
  }

  const start = war.official_start_time ?? war.practical_start_time;
  const updateFrom = start - 2 * 60 * 60;
  const updateUntil = war.practical_finish_time;

  return sampledAt >= updateFrom && (updateUntil === null || sampledAt <= updateUntil);
}

function d1Changes(result: unknown): number {
  const changes = (result as { meta?: { changes?: unknown } } | null)?.meta?.changes;
  return typeof changes === "number" && Number.isFinite(changes) ? changes : 0;
}
