import { HOME_FACTION_ID } from "./constants";
import { bumpGlobalWarCacheVersion } from "./cacheVersions";
import { fetchTornFactionMembers } from "./enemyScouting";
import { warNameFromWarRoute } from "./routes";
import { readSyncTimestamp, upsertSyncTimestamp } from "./syncState";
import { Env, TornFactionMember, WarRow } from "./types";
import { boolToInt, cleanText, d1Changes, effectiveRevivableStatus, finiteNumber, json, nowSeconds } from "./utils";
import { isWarRoomMemberTrackingActive } from "./warRoomTracking";

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

type EnemyMemberActivityHeatmapRow = {
  war_id: number;
  faction_id: number;
  member_id: number;
  member_name: string;
  date: string;
  interval_index: number;
  is_recently_active: number;
  last_action_status: string | null;
  last_action_timestamp: number | null;
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

type ActivitySampleTarget =
  | { table: "home"; warId?: undefined }
  | { table: "enemy"; warId: number };

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
  const updateRevivableMembers = isWarRoomMemberTrackingActive(latestWar, sampledAt);
  addFactionSampleMetrics(
    metrics,
    await sampleFactionActivity(
      env,
      HOME_FACTION_ID,
      sampledAt,
      updateRevivableMembers,
      options.membersByFaction?.get(HOME_FACTION_ID),
      { table: "home" },
    ),
    "home",
  );

  if (
    latestWar?.enemy_faction_id &&
    latestWar.official_end_time === null &&
    latestWar.practical_finish_time === null
  ) {
    addFactionSampleMetrics(
      metrics,
      await sampleFactionActivity(
        env,
        latestWar.enemy_faction_id,
        sampledAt,
        updateRevivableMembers,
        options.membersByFaction?.get(latestWar.enemy_faction_id),
        { table: "enemy", warId: latestWar.id },
      ),
      "enemy",
    );
  }

  if (metrics.revivableChangedRows > 0) {
    await bumpGlobalWarCacheVersion(env);
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

export async function getWarActivityHeatmap(url: URL, env: Env): Promise<Response> {
  const war = await readHeatmapWarFromUrl(url, env);
  if (war instanceof Response) {
    return war;
  }

  const rows = war.enemy_faction_id === null
    ? await env.DB.prepare(
        `
        SELECT faction_id, date, interval_index, active_count, total_count, sampled_at
        FROM home_faction_activity_samples
        WHERE faction_id = ?
        ORDER BY date ASC, interval_index ASC, faction_id ASC
        `,
      )
        .bind(HOME_FACTION_ID)
        .all()
    : await env.DB.prepare(
        `
        SELECT faction_id, date, interval_index, active_count, total_count, sampled_at
        FROM home_faction_activity_samples
        WHERE faction_id = ?
        UNION ALL
        SELECT faction_id, date, interval_index, active_count, total_count, sampled_at
        FROM enemy_faction_activity_samples
        WHERE war_id = ?
          AND faction_id = ?
        ORDER BY date ASC, interval_index ASC, faction_id ASC
        `,
      )
        .bind(HOME_FACTION_ID, war.id, war.enemy_faction_id)
        .all();

  return json({
    ok: true,
    interval_minutes: 15,
    war: {
      id: war.id,
      name: war.name,
      practical_finish_time: war.practical_finish_time,
      official_end_time: war.official_end_time,
      enemy_faction_id: war.enemy_faction_id,
    },
    home_faction_id: HOME_FACTION_ID,
    rows: (rows.results ?? []) as HeatmapRow[],
  });
}

export async function getEnemyMemberActivityHeatmap(url: URL, env: Env): Promise<Response> {
  const war = await readHeatmapWarFromUrl(url, env);
  if (war instanceof Response) {
    return war;
  }

  if (war.enemy_faction_id === null) {
    return json({ ok: false, error: "Selected war has no enemy faction", code: "NO_ENEMY_FACTION" }, 400);
  }

  const memberIds = parseMemberIdFilters(url);
  if (memberIds instanceof Response) {
    return memberIds;
  }

  const filters = [
    "war_id = ?",
    "faction_id = ?",
  ];
  const bindValues: Array<number | string> = [war.id, war.enemy_faction_id];

  if (memberIds.length > 0) {
    filters.push(`member_id IN (${memberIds.map(() => "?").join(",")})`);
    bindValues.push(...memberIds);
  }

  const rows = await env.DB.prepare(
    `
    SELECT *
    FROM enemy_member_activity_samples
    WHERE ${filters.join("\n      AND ")}
    ORDER BY date ASC, interval_index ASC, member_name ASC, member_id ASC
    `,
  )
    .bind(...bindValues)
    .all();

  return json({
    ok: true,
    interval_minutes: 15,
    war: {
      id: war.id,
      name: war.name,
      practical_finish_time: war.practical_finish_time,
      official_end_time: war.official_end_time,
      enemy_faction_id: war.enemy_faction_id,
    },
    rows: (rows.results ?? []) as EnemyMemberActivityHeatmapRow[],
  });
}

async function sampleFactionActivity(
  env: Env,
  factionId: number,
  sampledAt: number,
  updateRevivable: boolean,
  prefetchedMembers?: TornFactionMember[],
  target: ActivitySampleTarget = { table: "home" },
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
    FROM ${target.table === "home" ? "home_faction_activity_samples" : "enemy_faction_activity_samples"}
    WHERE ${target.table === "home" ? "" : "war_id = ?\n      AND "}faction_id = ?
      AND date = ?
      AND interval_index = ?
    LIMIT 1
    `,
  )
    .bind(...(
      target.table === "home"
        ? [factionId, bucket.date, bucket.intervalIndex]
        : [target.warId, factionId, bucket.date, bucket.intervalIndex]
    ))
    .first();

  if (existing) {
    return metrics;
  }

  const members = prefetchedMembers ?? await fetchTornFactionMembers(env, factionId);
  const activeCount = countRecentlyActiveMembers(members, sampledAt);
  if (updateRevivable) {
    const revivableMetrics = await updateCachedRevivableMembers(env, factionId, members);
    metrics.writeStatements += revivableMetrics.writeStatements;
    metrics.changedRows += revivableMetrics.changedRows;
    metrics.revivableUpdateStatements += revivableMetrics.writeStatements;
    metrics.revivableChangedRows += revivableMetrics.changedRows;
  }

  const result = await env.DB.prepare(
    `
    INSERT INTO ${target.table === "home" ? "home_faction_activity_samples" : "enemy_faction_activity_samples"} (
      ${target.table === "home" ? "" : "war_id,"}
      faction_id,
      date,
      interval_index,
      active_count,
      total_count,
      sampled_at
    )
    VALUES (${target.table === "home" ? "" : "?,"} ?, ?, ?, ?, ?, ?)
    ON CONFLICT(${target.table === "home" ? "" : "war_id, "}faction_id, date, interval_index) DO UPDATE SET
      active_count = excluded.active_count,
      total_count = excluded.total_count,
      sampled_at = excluded.sampled_at
    `,
  )
    .bind(...(
      target.table === "home"
        ? [factionId, bucket.date, bucket.intervalIndex, activeCount, members.length, sampledAt]
        : [target.warId, factionId, bucket.date, bucket.intervalIndex, activeCount, members.length, sampledAt]
    ))
    .run();
  metrics.sampled = true;
  metrics.writeStatements += 1;
  metrics.changedRows += d1Changes(result);

  if (target.table === "enemy") {
    const memberMetrics = await insertEnemyMemberActivitySampleRows(
      env,
      target.warId,
      factionId,
      bucket,
      sampledAt,
      members,
    );
    metrics.writeStatements += memberMetrics.writeStatements;
    metrics.changedRows += memberMetrics.changedRows;
  }

  return metrics;
}

async function insertEnemyMemberActivitySampleRows(
  env: Env,
  warId: number,
  factionId: number,
  bucket: { date: string; intervalIndex: number },
  sampledAt: number,
  members: TornFactionMember[],
): Promise<{ writeStatements: number; changedRows: number }> {
  if (members.length === 0) {
    return { writeStatements: 0, changedRows: 0 };
  }

  const statements = members.map((member) => {
    const lastActionTimestamp = finiteNumber(member.last_action?.timestamp);
    return env.DB.prepare(
      `
      INSERT INTO enemy_member_activity_samples (
        war_id,
        faction_id,
        member_id,
        member_name,
        date,
        interval_index,
        is_recently_active,
        last_action_status,
        last_action_timestamp,
        sampled_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(war_id, faction_id, member_id, date, interval_index) DO UPDATE SET
        member_name = excluded.member_name,
        is_recently_active = excluded.is_recently_active,
        last_action_status = excluded.last_action_status,
        last_action_timestamp = excluded.last_action_timestamp,
        sampled_at = excluded.sampled_at
      `,
    ).bind(
      warId,
      factionId,
      member.id,
      member.name,
      bucket.date,
      bucket.intervalIndex,
      boolToInt(isRecentlyActiveMember(member, sampledAt)),
      normalizeLastActionStatus(member.last_action?.status),
      lastActionTimestamp,
      sampledAt,
    );
  });

  const results = await env.DB.batch(statements);
  return {
    writeStatements: statements.length,
    changedRows: results.reduce((total: number, result: unknown) => total + d1Changes(result), 0),
  };
}

async function updateCachedRevivableMembers(
  env: Env,
  factionId: number,
  members: TornFactionMember[],
): Promise<{ writeStatements: number; changedRows: number }> {
  const tableName =
    factionId === HOME_FACTION_ID ? "home_faction_members" : "enemy_faction_members";
  const revivableMembers = members.filter((member) => typeof effectiveRevivableStatus(member) === "boolean");
  if (revivableMembers.length === 0) {
    return { writeStatements: 0, changedRows: 0 };
  }

  const existingValues = await readCachedRevivableValues(env, tableName, factionId);
  const statements = members
    .filter((member) => {
      const effectiveRevivable = effectiveRevivableStatus(member);
      if (typeof effectiveRevivable !== "boolean") {
        return false;
      }

      const nextValue = boolToInt(effectiveRevivable);
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
        boolToInt(effectiveRevivableStatus(member) ?? false),
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
  return members.filter((member) => isRecentlyActiveMember(member, sampledAt)).length;
}

function isRecentlyActiveMember(member: TornFactionMember, sampledAt: number): boolean {
  const lastAction = Number(member.last_action?.timestamp ?? 0);
  return lastAction > 0 && sampledAt - lastAction <= ACTIVITY_WINDOW_SECONDS;
}

function normalizeLastActionStatus(value: unknown): string | null {
  return cleanText(value)?.toLowerCase() ?? null;
}

async function cleanupHomeHeatmapIfDue(
  env: Env,
  sampledAt: number,
): Promise<{ writeStatements: number; changedRows: number; staleRowsDeleted: number }> {
  const lastCleanupAt = await readSyncTimestamp(env, HOME_HEATMAP_CLEANUP_STATE_NAME);

  if (lastCleanupAt > sampledAt - 24 * 60 * 60) {
    return { writeStatements: 0, changedRows: 0, staleRowsDeleted: 0 };
  }

  const result = await env.DB.prepare(
    `
    DELETE FROM home_faction_activity_samples
    WHERE faction_id = ?
      AND sampled_at < ?
    `,
  )
    .bind(HOME_FACTION_ID, sampledAt - HOME_RETENTION_SECONDS)
    .run();
  const staleRowsDeleted = d1Changes(result);
  await upsertSyncTimestamp(env, HOME_HEATMAP_CLEANUP_STATE_NAME, sampledAt, null);

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
  const name = warNameFromWarRoute(url);
  const warId = parseHeatmapWarId(url.searchParams.get("war_id"));

  if (!name) {
    return json({ ok: false, error: "Invalid war name", code: "INVALID_WAR_NAME" }, 400);
  }

  if (url.searchParams.has("war_id") && warId === null) {
    return json({ ok: false, error: "Invalid war_id", code: "INVALID_WAR_ID" }, 400);
  }

  if (warId !== null) {
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
      WHERE id = ?
      LIMIT 1
      `,
    )
      .bind(warId)
      .first()) as HeatmapWar | null;

    if (!war) {
      return json({ ok: false, error: "War not found", code: "WAR_NOT_FOUND" }, 404);
    }

    return war;
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
    ORDER BY practical_start_time DESC, id DESC
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

function parseHeatmapWarId(value: string | null): number | null {
  if (value === null || value.trim() === "") {
    return null;
  }

  const warId = Number(value);
  if (!Number.isInteger(warId) || warId <= 0) {
    return null;
  }
  return warId;
}

function parseMemberIdFilters(url: URL): number[] | Response {
  const values = [
    ...url.searchParams.getAll("member_id"),
    ...url.searchParams.getAll("member_ids").flatMap((value) => value.split(",")),
  ];
  const uniqueMemberIds = new Set<number>();

  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed === "") {
      continue;
    }

    const memberId = Number(trimmed);
    if (!Number.isInteger(memberId) || memberId <= 0) {
      return json({ ok: false, error: "Invalid member_id", code: "INVALID_MEMBER_ID" }, 400);
    }

    uniqueMemberIds.add(memberId);
  }

  return [...uniqueMemberIds];
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
