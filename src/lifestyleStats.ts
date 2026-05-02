import { HOME_FACTION_ID, TORN_FACTION_API_BASE_URL } from "./constants";
import { fetchTornFactionMembers } from "./enemyScouting";
import { Env, TornFactionMember } from "./types";
import { boolToInt, json, nowSeconds, parseLimit } from "./utils";

const PERSONAL_STATS_API_BASE_URL = "https://api.torn.com/v2/user";
const LIFESTYLE_STAT_KEYS = [
  "xantaken",
  "overdosed",
  "refills",
  "useractivity",
] as const;
const GYM_CONTRIBUTOR_STAT_KEYS = [
  "gymenergy",
  "gymstrength",
  "gymspeed",
  "gymdefense",
  "gymdexterity",
] as const;
const REFRESH_STALE_SECONDS = 24 * 60 * 60;
const LIFESTYLE_FETCH_TIMEOUT_MS = 12000;
const DAILY_REFRESH_AFTER_UTC_HOUR = 0;
const DAILY_REFRESH_AFTER_UTC_MINUTE = 10;

type LifestyleStatKey = (typeof LIFESTYLE_STAT_KEYS)[number];
type GymContributorStatKey = (typeof GYM_CONTRIBUTOR_STAT_KEYS)[number];

type LifestyleStats = Record<LifestyleStatKey, number | null>;
type GymContributorStats = Record<GymContributorStatKey, number | null>;

type LifestyleMemberRow = {
  member_id: number;
  name: string;
  level: number | null;
  position: string | null;
  updated_at: number | null;
};

type LifestyleStatsRow = LifestyleStats & {
  member_id: number;
  member_name: string | null;
  level: number | null;
  position: string | null;
  gymenergy: number | null;
  gymstrength: number | null;
  gymspeed: number | null;
  gymdefense: number | null;
  gymdexterity: number | null;
  updated_at: number | null;
  error: string | null;
};

export async function getMemberLifestyleStats(env: Env): Promise<Response> {
  const rows = ((await env.DB.prepare(
    `
    SELECT
      member_id,
      member_name,
      level,
      position,
      xantaken,
      overdosed,
      refills,
      useractivity,
      gymenergy,
      gymstrength,
      gymspeed,
      gymdefense,
      gymdexterity,
      updated_at,
      error
    FROM member_lifestyle_stats
    ORDER BY xantaken DESC NULLS LAST, member_name ASC
    `,
  ).all()).results ?? []) as LifestyleStatsRow[];

  return json({
    ok: true,
    summary: summarizeLifestyleRows(rows),
    members: rows,
  });
}

export async function refreshMemberLifestyleStatsFromRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get("limit"), 25, 90);
  const force = url.searchParams.get("force") === "true";
  const result = await refreshMemberLifestyleStats(env, { limit, force });
  const gymResult = await refreshGymContributorStats(env);

  return json({ ok: true, ...result, gym_contributors: gymResult });
}

export async function refreshMemberLifestyleStats(
  env: Env,
  options: { limit?: number; force?: boolean; staleBefore?: number } = {},
): Promise<{ considered: number; refreshed: number; failed: number }> {
  const limit = Math.max(1, Math.min(Math.floor(options.limit ?? 25), 90));
  const force = options.force ?? false;

  await syncHomeFactionMemberList(env);

  const members = await readLifestyleRefreshCandidates(env, limit, force, options.staleBefore);
  let refreshed = 0;
  let failed = 0;

  for (const member of members) {
    try {
      const stats = await fetchMemberPersonalStats(env, member.member_id);
      await upsertLifestyleStats(env, member, stats, null);
      refreshed += 1;
    } catch (err: any) {
      await upsertLifestyleStats(env, member, emptyLifestyleStats(), err?.message || String(err));
      failed += 1;
    }
  }

  return {
    considered: members.length,
    refreshed,
    failed,
  };
}

export async function refreshDailyMemberLifestyleStats(
  env: Env,
): Promise<{ considered: number; refreshed: number; failed: number; skipped: boolean }> {
  const refreshAt = dailyRefreshReadyAt(nowSeconds());
  if (refreshAt === null) {
    return { considered: 0, refreshed: 0, failed: 0, skipped: true };
  }

  const stateName = `member_lifestyle_stats_daily_${utcDateKey(refreshAt)}`;
  const existing = await env.DB.prepare(
    `
    SELECT name
    FROM sync_state
    WHERE name = ?
    LIMIT 1
    `,
  )
    .bind(stateName)
    .first();

  if (existing) {
    return { considered: 0, refreshed: 0, failed: 0, skipped: true };
  }

  const result = await refreshMemberLifestyleStats(env, {
    limit: 10,
    staleBefore: refreshAt,
  });
  await refreshDailyGymContributorStats(env, refreshAt);
  await markDailyLifestyleRefreshCompleteIfDone(env, stateName, refreshAt);

  return { ...result, skipped: false };
}

async function refreshDailyGymContributorStats(
  env: Env,
  refreshAt: number,
): Promise<{ refreshed_stats: number; updated_members: number; skipped: boolean }> {
  const stateName = `member_gym_contributors_daily_${utcDateKey(refreshAt)}`;
  const existing = await env.DB.prepare(
    `
    SELECT name
    FROM sync_state
    WHERE name = ?
    LIMIT 1
    `,
  )
    .bind(stateName)
    .first();

  if (existing) {
    return { refreshed_stats: 0, updated_members: 0, skipped: true };
  }

  const result = await refreshGymContributorStats(env);
  await env.DB.prepare(
    `
    INSERT INTO sync_state (name, last_started, active_war_id)
    VALUES (?, ?, NULL)
    ON CONFLICT(name) DO UPDATE SET
      last_started = excluded.last_started,
      updated_at = CURRENT_TIMESTAMP
    `,
  )
    .bind(stateName, nowSeconds())
    .run();

  return { ...result, skipped: false };
}

async function markDailyLifestyleRefreshCompleteIfDone(
  env: Env,
  stateName: string,
  refreshAt: number,
): Promise<void> {
  const remaining = await env.DB.prepare(
    `
    SELECT members.member_id
    FROM home_faction_members members
    LEFT JOIN member_lifestyle_stats stats
      ON stats.member_id = members.member_id
    WHERE stats.updated_at IS NULL
      OR stats.updated_at < ?
    LIMIT 1
    `,
  )
    .bind(refreshAt)
    .first();

  if (remaining) {
    return;
  }

  await env.DB.prepare(
    `
    INSERT INTO sync_state (name, last_started, active_war_id)
    VALUES (?, ?, NULL)
    ON CONFLICT(name) DO UPDATE SET
      last_started = excluded.last_started,
      updated_at = CURRENT_TIMESTAMP
    `,
  )
    .bind(stateName, nowSeconds())
    .run();
}

async function syncHomeFactionMemberList(env: Env): Promise<void> {
  const members = await fetchTornFactionMembers(env, HOME_FACTION_ID);
  if (members.length === 0) {
    return;
  }

  await env.DB.batch(
    members.map((member) =>
      env.DB.prepare(
        `
        INSERT INTO home_faction_members (
          member_id,
          faction_id,
          name,
          level,
          position,
          days_in_faction,
          is_revivable,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())
        ON CONFLICT(member_id) DO UPDATE SET
          faction_id = excluded.faction_id,
          name = excluded.name,
          level = excluded.level,
          position = excluded.position,
          days_in_faction = excluded.days_in_faction,
          is_revivable = excluded.is_revivable,
          updated_at = excluded.updated_at
        `,
      ).bind(
        member.id,
        HOME_FACTION_ID,
        member.name,
        finiteNumber(member.level),
        member.position ?? null,
        finiteNumber(member.days_in_faction),
        boolToInt(member.is_revivable ?? false),
      ),
    ),
  );

  await removeDepartedLifestyleMembers(env, members);
}

async function removeDepartedLifestyleMembers(
  env: Env,
  members: TornFactionMember[],
): Promise<void> {
  const ids = members.map((member) => member.id).filter((id) => Number.isInteger(id) && id > 0);
  if (ids.length === 0) {
    return;
  }

  await env.DB.prepare(
    `
    DELETE FROM member_lifestyle_stats
    WHERE member_id NOT IN (${ids.map(() => "?").join(",")})
    `,
  )
    .bind(...ids)
    .run();
}

async function readLifestyleRefreshCandidates(
  env: Env,
  limit: number,
  force: boolean,
  staleBefore?: number,
): Promise<LifestyleMemberRow[]> {
  const staleCutoff = staleBefore ?? nowSeconds() - REFRESH_STALE_SECONDS;
  const where = force
    ? ""
    : "WHERE stats.updated_at IS NULL OR stats.updated_at < ? OR stats.error IS NOT NULL";
  const query = `
    SELECT
      members.member_id,
      members.name,
      members.level,
      members.position,
      stats.updated_at
    FROM home_faction_members members
    LEFT JOIN member_lifestyle_stats stats
      ON stats.member_id = members.member_id
    ${where}
    ORDER BY stats.updated_at ASC NULLS FIRST, members.name ASC
    LIMIT ?
  `;
  const statement = env.DB.prepare(query);
  const rows = force
    ? await statement.bind(limit).all()
    : await statement.bind(staleCutoff, limit).all();

  return (rows.results ?? []) as LifestyleMemberRow[];
}

async function fetchMemberPersonalStats(env: Env, memberId: number): Promise<LifestyleStats> {
  const url = new URL(`${PERSONAL_STATS_API_BASE_URL}/${memberId}/personalstats`);
  url.searchParams.set("stat", LIFESTYLE_STAT_KEYS.join(","));

  const response = await fetchWithTimeout(url.toString(), {
    headers: {
      Accept: "application/json",
      Authorization: `ApiKey ${env.TORN_API_KEY}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Torn personalstats API error: ${response.status}`);
  }

  const data = (await response.json()) as any;
  if (data?.error) {
    throw new Error(data.error.error ?? data.error.message ?? "Torn personalstats API error");
  }

  return extractLifestyleStats(data?.personalstats);
}

async function upsertLifestyleStats(
  env: Env,
  member: LifestyleMemberRow,
  stats: LifestyleStats,
  error: string | null,
): Promise<void> {
  await env.DB.prepare(
    `
    INSERT INTO member_lifestyle_stats (
      member_id,
      member_name,
      level,
      position,
      xantaken,
      overdosed,
      refills,
      useractivity,
      updated_at,
      error
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch(), ?)
    ON CONFLICT(member_id) DO UPDATE SET
      member_name = excluded.member_name,
      level = excluded.level,
      position = excluded.position,
      xantaken = COALESCE(excluded.xantaken, member_lifestyle_stats.xantaken),
      overdosed = COALESCE(excluded.overdosed, member_lifestyle_stats.overdosed),
      refills = COALESCE(excluded.refills, member_lifestyle_stats.refills),
      useractivity = COALESCE(excluded.useractivity, member_lifestyle_stats.useractivity),
      updated_at = excluded.updated_at,
      error = excluded.error
    `,
  )
    .bind(
      member.member_id,
      member.name,
      member.level,
      member.position,
      stats.xantaken,
      stats.overdosed,
      stats.refills,
      stats.useractivity,
      error,
    )
    .run();
}

async function refreshGymContributorStats(
  env: Env,
): Promise<{ refreshed_stats: number; updated_members: number }> {
  await syncHomeFactionMemberList(env);

  const contributorStats = new Map<number, GymContributorStats>();
  for (const stat of GYM_CONTRIBUTOR_STAT_KEYS) {
    const contributors = await fetchFactionContributorStat(env, stat);
    for (const [memberId, contributed] of contributors.entries()) {
      const stats = contributorStats.get(memberId) ?? emptyGymContributorStats();
      stats[stat] = contributed;
      contributorStats.set(memberId, stats);
    }
  }

  if (contributorStats.size === 0) {
    return { refreshed_stats: GYM_CONTRIBUTOR_STAT_KEYS.length, updated_members: 0 };
  }

  const homeMembers = await readHomeMembersById(env);
  const statements = Array.from(contributorStats.entries()).map(([memberId, stats]) => {
    const member = homeMembers.get(memberId);
    return env.DB.prepare(
      `
      INSERT INTO member_lifestyle_stats (
        member_id,
        member_name,
        level,
        position,
        gymenergy,
        gymstrength,
        gymspeed,
        gymdefense,
        gymdexterity,
        error
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(member_id) DO UPDATE SET
        member_name = COALESCE(excluded.member_name, member_lifestyle_stats.member_name),
        level = COALESCE(excluded.level, member_lifestyle_stats.level),
        position = COALESCE(excluded.position, member_lifestyle_stats.position),
        gymenergy = COALESCE(excluded.gymenergy, member_lifestyle_stats.gymenergy),
        gymstrength = COALESCE(excluded.gymstrength, member_lifestyle_stats.gymstrength),
        gymspeed = COALESCE(excluded.gymspeed, member_lifestyle_stats.gymspeed),
        gymdefense = COALESCE(excluded.gymdefense, member_lifestyle_stats.gymdefense),
        gymdexterity = COALESCE(excluded.gymdexterity, member_lifestyle_stats.gymdexterity)
      `,
    ).bind(
      memberId,
      member?.name ?? null,
      member?.level ?? null,
      member?.position ?? null,
      stats.gymenergy,
      stats.gymstrength,
      stats.gymspeed,
      stats.gymdefense,
      stats.gymdexterity,
    );
  });

  await env.DB.batch(statements);
  return {
    refreshed_stats: GYM_CONTRIBUTOR_STAT_KEYS.length,
    updated_members: contributorStats.size,
  };
}

async function fetchFactionContributorStat(
  env: Env,
  stat: GymContributorStatKey,
): Promise<Map<number, number>> {
  const url = new URL(`${TORN_FACTION_API_BASE_URL}/contributors`);
  url.searchParams.set("stat", stat);

  const response = await fetchWithTimeout(url.toString(), {
    headers: {
      Accept: "application/json",
      Authorization: `ApiKey ${env.TORN_API_KEY}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Torn faction contributors API error for ${stat}: ${response.status}`);
  }

  const data = (await response.json()) as any;
  if (data?.error) {
    throw new Error(
      data.error.error ?? data.error.message ?? `Torn faction contributors API error for ${stat}`,
    );
  }

  return extractContributorValues(data?.contributors, stat);
}

async function readHomeMembersById(env: Env): Promise<Map<number, LifestyleMemberRow>> {
  const rows = ((await env.DB.prepare(
    `
    SELECT member_id, name, level, position, updated_at
    FROM home_faction_members
    WHERE faction_id = ?
    `,
  )
    .bind(HOME_FACTION_ID)
    .all()).results ?? []) as LifestyleMemberRow[];

  return new Map(rows.map((row) => [row.member_id, row]));
}

function summarizeLifestyleRows(rows: LifestyleStatsRow[]) {
  const withXanax = rows.filter((row) => row.xantaken !== null);
  const withOverdoses = rows.filter((row) => row.overdosed !== null);
  const totalXanax = rows.reduce((total, row) => total + Number(row.xantaken ?? 0), 0);
  const totalOverdoses = rows.reduce((total, row) => total + Number(row.overdosed ?? 0), 0);
  const totalGymEnergy = rows.reduce((total, row) => total + Number(row.gymenergy ?? 0), 0);
  const totalRefills = rows.reduce((total, row) => total + Number(row.refills ?? 0), 0);
  const withGymEnergy = rows.filter((row) => row.gymenergy !== null);
  const withRefills = rows.filter((row) => row.refills !== null);

  return {
    members: rows.length,
    updated_members: rows.filter((row) => row.updated_at !== null).length,
    total_xantaken: totalXanax,
    average_xantaken: withXanax.length === 0 ? 0 : totalXanax / withXanax.length,
    total_overdosed: totalOverdoses,
    average_overdosed: withOverdoses.length === 0 ? 0 : totalOverdoses / withOverdoses.length,
    average_gymenergy: withGymEnergy.length === 0 ? 0 : totalGymEnergy / withGymEnergy.length,
    average_refills: withRefills.length === 0 ? 0 : totalRefills / withRefills.length,
    errors: rows.filter((row) => row.error).length,
    oldest_updated_at: rows.reduce<number | null>((oldest, row) => {
      if (row.updated_at === null) {
        return oldest;
      }
      return oldest === null ? row.updated_at : Math.min(oldest, row.updated_at);
    }, null),
  };
}

function extractLifestyleStats(source: unknown): LifestyleStats {
  const stats = emptyLifestyleStats();
  if (!source || typeof source !== "object") {
    return stats;
  }

  for (const key of LIFESTYLE_STAT_KEYS) {
    stats[key] = finiteNumber((source as Record<string, unknown>)[key]);
  }

  return stats;
}

function emptyLifestyleStats(): LifestyleStats {
  return Object.fromEntries(LIFESTYLE_STAT_KEYS.map((key) => [key, null])) as LifestyleStats;
}

function emptyGymContributorStats(): GymContributorStats {
  return Object.fromEntries(GYM_CONTRIBUTOR_STAT_KEYS.map((key) => [key, null])) as GymContributorStats;
}

function extractContributorValues(
  source: unknown,
  stat: GymContributorStatKey,
): Map<number, number> {
  const contributors = new Map<number, number>();
  const statContainer =
    source && typeof source === "object" && !Array.isArray(source)
      ? ((source as Record<string, unknown>)[stat] ?? source)
      : source;

  if (!statContainer || typeof statContainer !== "object") {
    return contributors;
  }

  if (Array.isArray(statContainer)) {
    for (const item of statContainer) {
      addContributorValue(
        contributors,
        item?.id ?? item?.member_id ?? item?.user_id ?? item?.player_id,
        item,
      );
    }
    return contributors;
  }

  for (const [memberId, value] of Object.entries(statContainer)) {
    addContributorValue(contributors, memberId, value);
  }

  return contributors;
}

function addContributorValue(
  contributors: Map<number, number>,
  memberIdValue: unknown,
  source: any,
) {
  const memberId = Number(memberIdValue);
  if (!Number.isInteger(memberId) || memberId <= 0) {
    return;
  }

  const contributed =
    source && typeof source === "object"
      ? finiteNumber(source.contributed ?? source.value ?? source.amount)
      : finiteNumber(source);

  if (contributed !== null) {
    contributors.set(memberId, contributed);
  }
}

function finiteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function dailyRefreshReadyAt(timestamp: number): number | null {
  const date = new Date(timestamp * 1000);
  const readyAt = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    DAILY_REFRESH_AFTER_UTC_HOUR,
    DAILY_REFRESH_AFTER_UTC_MINUTE,
    0,
  );

  return timestamp * 1000 >= readyAt ? Math.floor(readyAt / 1000) : null;
}

function utcDateKey(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

async function fetchWithTimeout(input: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LIFESTYLE_FETCH_TIMEOUT_MS);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}
