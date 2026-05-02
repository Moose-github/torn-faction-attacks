import { HOME_FACTION_ID } from "./constants";
import { fetchTornFactionMembers } from "./enemyScouting";
import { Env, TornFactionMember, WarRow } from "./types";
import { boolToInt, json, nowSeconds } from "./utils";

const ACTIVITY_WINDOW_SECONDS = 15 * 60;
const HOME_RETENTION_SECONDS = 30 * 24 * 60 * 60;
const INTERVALS_PER_DAY = 96;

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

export async function sampleFactionActivityHeatmaps(env: Env): Promise<void> {
  const sampledAt = nowSeconds();
  await cleanupHomeHeatmap(env, sampledAt);

  const latestWar = await readLatestHeatmapWar(env);
  await sampleFactionActivity(env, HOME_FACTION_ID, sampledAt);

  if (
    latestWar?.enemy_faction_id &&
    latestWar.official_end_time === null &&
    latestWar.practical_finish_time === null
  ) {
    await clearReplaceableEnemyHeatmaps(env, latestWar.enemy_faction_id);
    await sampleFactionActivity(env, latestWar.enemy_faction_id, sampledAt);
  }
}

async function clearReplaceableEnemyHeatmaps(
  env: Env,
  nextFactionId: number,
): Promise<void> {
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

    await env.DB.prepare(
      `
      DELETE FROM faction_activity_heatmap
      WHERE faction_id = ?
      `,
    )
      .bind(cachedFaction.faction_id)
      .run();
  }
}

export async function getWarActivityHeatmap(url: URL, env: Env): Promise<Response> {
  const war = await readHeatmapWarFromUrl(url, env);
  if (war instanceof Response) {
    return war;
  }

  const now = nowSeconds();
  const warStart = war.official_start_time ?? war.practical_start_time;
  const from =
    warStart > now
      ? Math.max(0, now - HOME_RETENTION_SECONDS)
      : Math.max(0, warStart - ACTIVITY_WINDOW_SECONDS);
  const to = war.official_end_time ?? now;
  const factionIds = [HOME_FACTION_ID];
  if (war.enemy_faction_id !== null) {
    factionIds.push(war.enemy_faction_id);
  }

  const rows = await env.DB.prepare(
    `
    SELECT *
    FROM faction_activity_heatmap
    WHERE faction_id IN (${factionIds.map(() => "?").join(",")})
      AND sampled_at BETWEEN ? AND ?
    ORDER BY date ASC, interval_index ASC, faction_id ASC
    `,
  )
    .bind(...factionIds, from, to)
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
): Promise<void> {
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
    return;
  }

  const members = await fetchTornFactionMembers(env, factionId);
  const activeCount = countRecentlyActiveMembers(members, sampledAt);
  await updateCachedRevivableMembers(env, factionId, members);

  await env.DB.prepare(
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
}

async function updateCachedRevivableMembers(
  env: Env,
  factionId: number,
  members: TornFactionMember[],
): Promise<void> {
  const tableName =
    factionId === HOME_FACTION_ID ? "home_faction_members" : "enemy_faction_members";
  const statements = members
    .filter((member) => typeof member.is_revivable === "boolean")
    .map((member) =>
      env.DB.prepare(
        `
        UPDATE ${tableName}
        SET is_revivable = ?,
            updated_at = unixepoch()
        WHERE faction_id = ?
          AND member_id = ?
          AND (
            is_revivable IS NULL
            OR is_revivable != ?
          )
        `,
      ).bind(
        boolToInt(member.is_revivable ?? false),
        factionId,
        member.id,
        boolToInt(member.is_revivable ?? false),
      ),
    );

  if (statements.length > 0) {
    await env.DB.batch(statements);
  }
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

async function cleanupHomeHeatmap(env: Env, sampledAt: number): Promise<void> {
  await env.DB.prepare(
    `
    DELETE FROM faction_activity_heatmap
    WHERE faction_id = ?
      AND sampled_at < ?
    `,
  )
    .bind(HOME_FACTION_ID, sampledAt - HOME_RETENTION_SECONDS)
    .run();
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
