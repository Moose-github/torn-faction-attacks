import { HOME_FACTION_ID, TORN_FACTION_API_BASE_URL } from "./constants";
import { fetchTornFactionMembers } from "./enemyScouting";
import { fetchTornPersonalStats } from "./personalStats";
import { claimDailyBatchGate } from "./scheduledGates";
import { Env, TornFactionMember } from "./types";
import { boolToInt, json, nowSeconds, parseLimit } from "./utils";

const LIFESTYLE_STAT_KEYS = [
  "xantaken",
  "overdosed",
  "refills",
  "useractivity",
  "networth",
] as const;
const TORN_LIFESTYLE_STAT_KEYS = [
  "xantaken",
  "overdosed",
  "refills",
  "timeplayed",
  "networth",
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
const MAX_LIFESTYLE_PERIOD_DAYS = 90;
const MAX_MANUAL_PERSONAL_STATS_REFRESH = 40;
const DAILY_LIFESTYLE_REFRESH_LIMIT = 40;
const DAILY_LIFESTYLE_COMPLETE_STATE_NAME = "member_lifestyle_stats_daily";
const DAILY_GYM_COMPLETE_STATE_NAME = "member_gym_contributors_daily";
const DAILY_LIFESTYLE_LOCK_SECONDS = 75;
const DAILY_LIFESTYLE_LOCK_STATE_NAME = "member_lifestyle_stats_daily_lock";

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

type LifestylePeriodRow = {
  member_id: number;
  member_name: string | null;
  overdosed: number;
  total_xantaken: number;
  average_xantaken: number;
  adjusted_average_xantaken: number;
  average_refills: number;
  average_useractivity: number;
  networth: number | null;
  total_gymenergy: number;
  average_gymenergy: number;
  average_gymstrength: number;
  average_gymspeed: number;
  average_gymdefense: number;
  average_gymdexterity: number;
  first_snapshot_date: string | null;
  last_snapshot_date: string | null;
  updated_at: number | null;
};

type LifestyleSnapshotRow = {
  member_id: number;
  snapshot_date: string;
  member_name: string | null;
  xantaken: number | null;
  overdosed: number | null;
  refills: number | null;
  useractivity: number | null;
  networth: number | null;
  gymenergy: number | null;
  gymstrength: number | null;
  gymspeed: number | null;
  gymdefense: number | null;
  gymdexterity: number | null;
  captured_at: number;
};

type LifestyleSnapshotNumberKey =
  | "xantaken"
  | "overdosed"
  | "refills"
  | "useractivity"
  | "gymenergy"
  | "gymstrength"
  | "gymspeed"
  | "gymdefense"
  | "gymdexterity";

export async function getMemberLifestyleStats(url: URL, env: Env): Promise<Response> {
  const period = readLifestylePeriod(url);
  const snapshotRows = ((await env.DB.prepare(
    `
    SELECT
      member_id,
      snapshot_date,
      member_name,
      xantaken,
      overdosed,
      refills,
      useractivity,
      networth,
      gymenergy,
      gymstrength,
      gymspeed,
      gymdefense,
      gymdexterity,
      captured_at
    FROM member_lifestyle_stat_snapshots
    WHERE snapshot_date BETWEEN ? AND ?
    ORDER BY member_id ASC, snapshot_date ASC
    `,
  )
    .bind(period.start_date, period.end_date)
    .all()).results ?? []) as LifestyleSnapshotRow[];
  const rows = buildPeriodRows(snapshotRows);

  return json({
    ok: true,
    period,
    summary: summarizeLifestylePeriodRows(rows),
    members: rows,
  });
}

export async function refreshMemberLifestyleStatsFromRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const limit = parseLimit(url.searchParams.get("limit"), 10, MAX_MANUAL_PERSONAL_STATS_REFRESH);
    const force = url.searchParams.get("force") === "true";
    const result = await refreshMemberLifestyleStats(env, { limit, force });
    const gymResult = await refreshGymContributorStats(env).catch((err: any) => ({
      refreshed_stats: 0,
      updated_members: 0,
      error: err?.message || String(err),
    }));

    await writeLifestyleSnapshotForDate(env, utcDateKey(nowSeconds()));

    return json({ ok: true, ...result, gym_contributors: gymResult });
  } catch (err: any) {
    return json(
      {
        ok: false,
        error: err?.message || String(err),
        code: "LIFESTYLE_REFRESH_FAILED",
      },
      500,
    );
  }
}

export async function refreshMemberLifestyleStats(
  env: Env,
  options: { limit?: number; force?: boolean; staleBefore?: number } = {},
): Promise<{ considered: number; refreshed: number; failed: number }> {
  const limit = Math.max(1, Math.min(Math.floor(options.limit ?? 10), MAX_MANUAL_PERSONAL_STATS_REFRESH));
  const force = options.force ?? false;

  await syncHomeFactionMemberList(env);

  const members = await readLifestyleRefreshCandidates(env, limit, force, options.staleBefore);
  const refreshedMemberIds: number[] = [];
  let refreshed = 0;
  let failed = 0;

  for (const member of members) {
    try {
      const stats = await fetchMemberPersonalStats(env, member.member_id);
      await upsertLifestyleStats(env, member, stats, null);
      refreshedMemberIds.push(member.member_id);
      refreshed += 1;
    } catch (err: any) {
      await upsertLifestyleStats(env, member, emptyLifestyleStats(), err?.message || String(err));
      failed += 1;
    }
  }

  await syncHomeFactionMemberNetworth(env, refreshedMemberIds);

  return {
    considered: members.length,
    refreshed,
    failed,
  };
}

export async function refreshDailyMemberLifestyleStats(
  env: Env,
  options: { limit?: number; useLock?: boolean } = {},
): Promise<{ considered: number; refreshed: number; failed: number; skipped: boolean }> {
  const now = nowSeconds();
  const refreshAt = dailyRefreshReadyAt(now);
  if (refreshAt === null) {
    return { considered: 0, refreshed: 0, failed: 0, skipped: true };
  }

  if (options.useLock) {
    const gate = await claimDailyBatchGate(env, {
      completeStateName: DAILY_LIFESTYLE_COMPLETE_STATE_NAME,
      completeAfter: refreshAt,
      lockStateName: DAILY_LIFESTYLE_LOCK_STATE_NAME,
      now,
      lockSeconds: DAILY_LIFESTYLE_LOCK_SECONDS,
    });

    if (gate.completed || !gate.locked) {
      return { considered: 0, refreshed: 0, failed: 0, skipped: true };
    }
  } else if (await isDailyLifestyleRefreshComplete(env, refreshAt)) {
    return { considered: 0, refreshed: 0, failed: 0, skipped: true };
  }

  const result = await refreshMemberLifestyleStats(env, {
    limit: options.limit ?? DAILY_LIFESTYLE_REFRESH_LIMIT,
    staleBefore: refreshAt,
  });
  await refreshDailyGymContributorStats(env, refreshAt);
  const complete = await markDailyLifestyleRefreshCompleteIfDone(env, refreshAt);
  if (complete) {
    await writeLifestyleSnapshotForDate(env, utcDateKey(refreshAt));
  }

  return { ...result, skipped: false };
}

async function isDailyLifestyleRefreshComplete(
  env: Env,
  refreshAt: number,
): Promise<boolean> {
  const existing = await env.DB.prepare(
    `
    SELECT last_started
    FROM sync_state
    WHERE name = ?
    LIMIT 1
    `,
  )
    .bind(DAILY_LIFESTYLE_COMPLETE_STATE_NAME)
    .first() as { last_started?: number } | null;

  return Number(existing?.last_started ?? 0) >= refreshAt;
}

async function refreshDailyGymContributorStats(
  env: Env,
  refreshAt: number,
): Promise<{ refreshed_stats: number; updated_members: number; skipped: boolean }> {
  const existing = await env.DB.prepare(
    `
    SELECT last_started
    FROM sync_state
    WHERE name = ?
    LIMIT 1
    `,
  )
    .bind(DAILY_GYM_COMPLETE_STATE_NAME)
    .first() as { last_started?: number } | null;

  if (Number(existing?.last_started ?? 0) >= refreshAt) {
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
    .bind(DAILY_GYM_COMPLETE_STATE_NAME, refreshAt)
    .run();

  return { ...result, skipped: false };
}

async function markDailyLifestyleRefreshCompleteIfDone(
  env: Env,
  refreshAt: number,
): Promise<boolean> {
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
    return false;
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
    .bind(DAILY_LIFESTYLE_COMPLETE_STATE_NAME, refreshAt)
    .run();

  return true;
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
  return extractLifestyleStats(await fetchTornPersonalStats(env, memberId, TORN_LIFESTYLE_STAT_KEYS));
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
      networth,
      updated_at,
      error
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), ?)
    ON CONFLICT(member_id) DO UPDATE SET
      member_name = excluded.member_name,
      level = excluded.level,
      position = excluded.position,
      xantaken = COALESCE(excluded.xantaken, member_lifestyle_stats.xantaken),
      overdosed = COALESCE(excluded.overdosed, member_lifestyle_stats.overdosed),
      refills = COALESCE(excluded.refills, member_lifestyle_stats.refills),
      useractivity = COALESCE(excluded.useractivity, member_lifestyle_stats.useractivity),
      networth = COALESCE(excluded.networth, member_lifestyle_stats.networth),
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
      stats.networth,
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

async function syncHomeFactionMemberNetworth(env: Env, memberIds: number[]): Promise<void> {
  if (memberIds.length === 0) {
    return;
  }

  const uniqueIds = Array.from(new Set(memberIds));
  const placeholders = uniqueIds.map(() => "?").join(", ");
  await env.DB.prepare(
    `
    UPDATE home_faction_members
    SET
      networth = (
        SELECT stats.networth
        FROM member_lifestyle_stats stats
        WHERE stats.member_id = home_faction_members.member_id
      ),
      networth_updated_at = (
        SELECT stats.updated_at
        FROM member_lifestyle_stats stats
        WHERE stats.member_id = home_faction_members.member_id
      ),
      updated_at = unixepoch()
    WHERE member_id IN (${placeholders})
      AND EXISTS (
        SELECT 1
        FROM member_lifestyle_stats stats
        WHERE stats.member_id = home_faction_members.member_id
          AND stats.networth IS NOT NULL
          AND (
            home_faction_members.networth IS NULL
            OR home_faction_members.networth != stats.networth
            OR home_faction_members.networth_updated_at IS NULL
            OR home_faction_members.networth_updated_at != stats.updated_at
          )
      )
    `,
  )
    .bind(...uniqueIds)
    .run();
}

async function writeLifestyleSnapshotForDate(env: Env, snapshotDate: string): Promise<void> {
  await env.DB.prepare(
    `
    INSERT INTO member_lifestyle_stat_snapshots (
      member_id,
      snapshot_date,
      member_name,
      xantaken,
      overdosed,
      refills,
      useractivity,
      networth,
      gymenergy,
      gymstrength,
      gymspeed,
      gymdefense,
      gymdexterity,
      captured_at
    )
    SELECT
      member_id,
      ?,
      member_name,
      xantaken,
      overdosed,
      refills,
      useractivity,
      networth,
      gymenergy,
      gymstrength,
      gymspeed,
      gymdefense,
      gymdexterity,
      unixepoch()
    FROM member_lifestyle_stats
    WHERE updated_at IS NOT NULL
    ON CONFLICT(member_id, snapshot_date) DO UPDATE SET
      member_name = excluded.member_name,
      xantaken = excluded.xantaken,
      overdosed = excluded.overdosed,
      refills = excluded.refills,
      useractivity = excluded.useractivity,
      networth = excluded.networth,
      gymenergy = excluded.gymenergy,
      gymstrength = excluded.gymstrength,
      gymspeed = excluded.gymspeed,
      gymdefense = excluded.gymdefense,
      gymdexterity = excluded.gymdexterity,
      captured_at = excluded.captured_at
    `,
  )
    .bind(snapshotDate)
    .run();
}

function buildPeriodRows(rows: LifestyleSnapshotRow[]): LifestylePeriodRow[] {
  const grouped = new Map<number, LifestyleSnapshotRow[]>();
  for (const row of rows) {
    const existing = grouped.get(row.member_id) ?? [];
    existing.push(row);
    grouped.set(row.member_id, existing);
  }

  return Array.from(grouped.entries()).map(([memberId, snapshots]) => {
    const ordered = [...snapshots].sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
    const first = ordered[0];
    const last = ordered[ordered.length - 1];

    return {
      member_id: memberId,
      member_name: last.member_name ?? first.member_name,
      overdosed: periodDelta(ordered, "overdosed"),
      total_xantaken: periodDelta(ordered, "xantaken"),
      average_xantaken: averagePeriodDelta(ordered, "xantaken"),
      adjusted_average_xantaken: adjustedAverageXanax(ordered),
      average_refills: averagePeriodDelta(ordered, "refills"),
      average_useractivity: averagePeriodDelta(ordered, "useractivity"),
      networth: latestNonNullValue(ordered, "networth"),
      total_gymenergy: periodDelta(ordered, "gymenergy"),
      average_gymenergy: averagePeriodDelta(ordered, "gymenergy"),
      average_gymstrength: averagePeriodDelta(ordered, "gymstrength"),
      average_gymspeed: averagePeriodDelta(ordered, "gymspeed"),
      average_gymdefense: averagePeriodDelta(ordered, "gymdefense"),
      average_gymdexterity: averagePeriodDelta(ordered, "gymdexterity"),
      first_snapshot_date: first.snapshot_date,
      last_snapshot_date: last.snapshot_date,
      updated_at: last.captured_at,
    };
  });
}

function summarizeLifestylePeriodRows(rows: LifestylePeriodRow[]) {
  const members = rows.length;
  return {
    members,
    total_overdosed: rows.reduce((total, row) => total + row.overdosed, 0),
    total_xantaken: rows.reduce((total, row) => total + row.total_xantaken, 0),
    average_xantaken: average(rows.map((row) => row.average_xantaken)),
    adjusted_average_xantaken: average(rows.map((row) => row.adjusted_average_xantaken)),
    average_refills: average(rows.map((row) => row.average_refills)),
    average_useractivity: average(rows.map((row) => row.average_useractivity)),
    average_networth: average(
      rows.map((row) => row.networth).filter((value): value is number => value !== null),
    ),
    total_gymenergy: rows.reduce((total, row) => total + row.total_gymenergy, 0),
    average_gymenergy: average(rows.map((row) => row.average_gymenergy)),
    average_gymstrength: average(rows.map((row) => row.average_gymstrength)),
    average_gymspeed: average(rows.map((row) => row.average_gymspeed)),
    average_gymdefense: average(rows.map((row) => row.average_gymdefense)),
    average_gymdexterity: average(rows.map((row) => row.average_gymdexterity)),
    oldest_updated_at: rows.reduce<number | null>((oldest, row) => {
      if (row.updated_at === null) {
        return oldest;
      }
      return oldest === null ? row.updated_at : Math.min(oldest, row.updated_at);
    }, null),
  };
}

function readLifestylePeriod(url: URL): {
  start_date: string;
  end_date: string;
  days: number;
  max_days: number;
  capped: boolean;
} {
  const current = currentUtcMonthRange();
  const startDate = normalizeDateParam(url.searchParams.get("start_date")) ?? current.start_date;
  const endDate = normalizeDateParam(url.searchParams.get("end_date")) ?? current.end_date;
  const normalizedEnd = startDate > endDate ? startDate : endDate;
  const days = Math.max(1, dateDiffDays(startDate, normalizedEnd));
  const capped = days > MAX_LIFESTYLE_PERIOD_DAYS;
  const cappedStartDate = capped
    ? dateKeyFromMs(Date.parse(`${normalizedEnd}T00:00:00.000Z`) - MAX_LIFESTYLE_PERIOD_DAYS * 86_400_000)
    : startDate;

  return {
    start_date: cappedStartDate,
    end_date: normalizedEnd,
    days: Math.max(1, dateDiffDays(cappedStartDate, normalizedEnd)),
    max_days: MAX_LIFESTYLE_PERIOD_DAYS,
    capped,
  };
}

function currentUtcMonthRange(): { start_date: string; end_date: string } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  return {
    start_date: start.toISOString().slice(0, 10),
    end_date: now.toISOString().slice(0, 10),
  };
}

function normalizeDateParam(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  return Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)) ? null : value;
}

function averageDelta(start: number | null, finish: number | null, days: number): number {
  return delta(start, finish) / Math.max(1, days);
}

function averagePeriodDelta(rows: LifestyleSnapshotRow[], key: LifestyleSnapshotNumberKey): number {
  const endpoints = nonNullPeriodEndpoints(rows, key);
  if (!endpoints) {
    return 0;
  }

  return averageDelta(
    endpoints.first[key],
    endpoints.last[key],
    dateDiffDays(endpoints.first.snapshot_date, endpoints.last.snapshot_date),
  );
}

function periodDelta(rows: LifestyleSnapshotRow[], key: LifestyleSnapshotNumberKey): number {
  const endpoints = nonNullPeriodEndpoints(rows, key);
  if (!endpoints) {
    return 0;
  }

  return delta(endpoints.first[key], endpoints.last[key]);
}

function adjustedAverageXanax(rows: LifestyleSnapshotRow[]): number {
  const xanaxEndpoints = nonNullPeriodEndpoints(rows, "xantaken");
  const overdoseEndpoints = nonNullPeriodEndpoints(rows, "overdosed");
  if (!xanaxEndpoints) {
    return 0;
  }

  const days = dateDiffDays(xanaxEndpoints.first.snapshot_date, xanaxEndpoints.last.snapshot_date);
  const overdoses = overdoseEndpoints ? delta(overdoseEndpoints.first.overdosed, overdoseEndpoints.last.overdosed) : 0;
  const adjustedDays = days - overdoses;

  if (adjustedDays <= 0) {
    return 0;
  }

  return delta(xanaxEndpoints.first.xantaken, xanaxEndpoints.last.xantaken) / adjustedDays;
}

function latestNonNullValue(rows: LifestyleSnapshotRow[], key: LifestyleStatKey): number | null {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const value = rows[index][key];
    if (value !== null) {
      return value;
    }
  }

  return null;
}

function nonNullPeriodEndpoints(
  rows: LifestyleSnapshotRow[],
  key: LifestyleSnapshotNumberKey,
): { first: LifestyleSnapshotRow; last: LifestyleSnapshotRow } | null {
  const populatedRows = rows.filter((row) => row[key] !== null);
  if (populatedRows.length === 0) {
    return null;
  }

  return {
    first: populatedRows[0],
    last: populatedRows[populatedRows.length - 1],
  };
}

function delta(start: number | null, finish: number | null): number {
  if (start === null || finish === null) {
    return 0;
  }

  return Math.max(0, Number(finish) - Number(start));
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

function dateDiffDays(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00.000Z`);
  const end = Date.parse(`${endDate}T00:00:00.000Z`);
  return Math.max(1, Math.round((end - start) / 86_400_000));
}

function extractLifestyleStats(source: unknown): LifestyleStats {
  const stats = emptyLifestyleStats();
  if (!source) {
    return stats;
  }

  if (Array.isArray(source)) {
    for (const item of source) {
      if (!item || typeof item !== "object") {
        continue;
      }

      const name = String((item as { name?: unknown }).name ?? "");
      const value = finiteNumber((item as { value?: unknown }).value);
      setLifestyleStat(stats, name, value);
    }

    return stats;
  }

  if (typeof source !== "object") {
    return stats;
  }

  for (const key of LIFESTYLE_STAT_KEYS) {
    stats[key] = finiteNumber((source as Record<string, unknown>)[key]);
  }
  stats.useractivity =
    stats.useractivity ?? finiteNumber((source as Record<string, unknown>).timeplayed);

  return stats;
}

function setLifestyleStat(stats: LifestyleStats, name: string, value: number | null): void {
  if (name === "timeplayed") {
    stats.useractivity = value;
    return;
  }

  if (LIFESTYLE_STAT_KEYS.includes(name as LifestyleStatKey)) {
    stats[name as LifestyleStatKey] = value;
  }
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

function dateKeyFromMs(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
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
