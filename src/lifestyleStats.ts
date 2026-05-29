import { HOME_FACTION_ID, TORN_FACTION_API_BASE_URL } from "./constants";
import { bumpMemberLifestyleCacheVersion } from "./cacheVersions";
import { fetchTornFactionMembers } from "./enemyScouting";
import { refreshMemberAchievementSummaries } from "./memberAchievements";
import {
  fetchTornPersonalStatsWithTimestamps,
  TornPersonalStatsHttpError,
  TornPersonalStatsResponse,
} from "./personalStats";
import { claimDailyBatchGate } from "./scheduledGates";
import { readSyncTimestamp, upsertSyncTimestamp } from "./syncState";
import { trackedTornFetch } from "./tornApiUsage";
import { Env, TornFactionMember } from "./types";
import { boolToInt, d1Changes, finiteNumber, json, nowSeconds } from "./utils";

const LIFESTYLE_STAT_KEYS = [
  "xantaken",
  "overdosed",
  "refills",
  "useractivity",
  "networth",
  "daysbeendonator",
] as const;
const TORN_LIFESTYLE_STAT_KEYS = [
  "xantaken",
  "overdosed",
  "refills",
  "timeplayed",
  "networth",
  "daysbeendonator",
] as const;
const GYM_CONTRIBUTOR_STAT_KEYS = [
  "gymenergy",
  "gymstrength",
  "gymspeed",
  "gymdefense",
  "gymdexterity",
] as const;
const LIFESTYLE_FETCH_TIMEOUT_MS = 12000;
const DAILY_REFRESH_AFTER_UTC_HOUR = 0;
const DAILY_REFRESH_AFTER_UTC_MINUTE = 10;
const MAX_LIFESTYLE_PERIOD_DAYS = 90;
const DAILY_LIFESTYLE_REFRESH_LIMIT = 40;
const EXPIRED_PERSONAL_STATS_RETRY_LIMIT = 5;
const DAILY_LIFESTYLE_COMPLETE_STATE_NAME = "member_personal_stats_recent_daily";
const DAILY_GYM_COMPLETE_STATE_NAME = "member_gym_stats_current_daily";
const DAILY_LIFESTYLE_LOCK_SECONDS = 75;
const DAILY_LIFESTYLE_LOCK_STATE_NAME = "member_personal_stats_recent_daily_lock";
const OLD_PERSONALSTATS_BUCKET_ERROR_CODE = "OLD_PERSONALSTATS_BUCKET";
const MISSING_PERSONALSTATS_BUCKET_ERROR_CODE = "MISSING_PERSONALSTATS_BUCKET";
const MISSING_DONATOR_DAYS_ERROR_CODE = "MISSING_DONATOR_DAYS";
const RETRY_EXPIRED_PERSONALSTATS_ERROR_CODE = "RETRY_EXPIRED_PERSONALSTATS";
const PERSONALSTATS_BUCKET_MISMATCH_ERROR_CODE = "PERSONALSTATS_BUCKET_MISMATCH";
const DEFAULT_REPAIR_CALLS_PER_MINUTE_PER_KEY = 35;
const MAX_REPAIR_DATE_RANGE_DAYS = 120;
const REPAIR_JOB_PROCESS_LIMIT_SECONDS = 45;
const REPAIR_KEY_PAUSE_PREFIX = "member_lifestyle_repair_key_pause";
const REPAIR_FAILURE_ALERT_PREFIX = "member_lifestyle_repair_failure_alert";

type LifestyleStatKey = (typeof LIFESTYLE_STAT_KEYS)[number];
type GymContributorStatKey = (typeof GYM_CONTRIBUTOR_STAT_KEYS)[number];
type LifestyleTimestampKey = `${LifestyleStatKey}_timestamp`;

type LifestyleStats = Record<LifestyleStatKey, number | null>;
type LifestyleStatTimestamps = Record<LifestyleTimestampKey, number | null>;
type TimedLifestyleStats = LifestyleStats & LifestyleStatTimestamps & {
  personalstats_bucket_date: string | null;
  personalstats_requested_at: number | null;
  personalstats_key_source: string | null;
};
type GymContributorStats = Record<GymContributorStatKey, number | null>;

type LifestyleMemberRow = {
  member_id: number;
  name: string;
  level: number | null;
  position: string | null;
  personal_captured_at: number | null;
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
  daysbeendonator: number | null;
  xantaken_timestamp: number | null;
  overdosed_timestamp: number | null;
  refills_timestamp: number | null;
  useractivity_timestamp: number | null;
  networth_timestamp: number | null;
  daysbeendonator_timestamp: number | null;
  personalstats_bucket_date: string | null;
  personalstats_requested_at: number | null;
  personalstats_key_source: string | null;
  gymenergy: number | null;
  gymstrength: number | null;
  gymspeed: number | null;
  gymdefense: number | null;
  gymdexterity: number | null;
  personal_captured_at: number | null;
  gym_captured_at: number | null;
  personal_ready: number;
  gym_ready: number;
  fully_ready: number;
  captured_at: number;
  validation_error: string | null;
};

type LifestyleSnapshotNumberKey =
  | "xantaken"
  | "overdosed"
  | "refills"
  | "useractivity"
  | "daysbeendonator"
  | "gymenergy"
  | "gymstrength"
  | "gymspeed"
  | "gymdefense"
  | "gymdexterity";

type LifestyleDailyChartMetric = LifestyleSnapshotNumberKey | "networth";
type LifestyleSnapshotReadyColumn = "personal_ready" | "gym_ready" | "fully_ready";
type LifestyleSnapshotReadyFilter = LifestyleSnapshotReadyColumn | "any_ready";
type PersonalStatsRecentStatus = "pending" | "completed" | "retry_expired" | "failed";

const LIFESTYLE_DAILY_CHART_METRICS = new Set<LifestyleDailyChartMetric>([
  "xantaken",
  "overdosed",
  "refills",
  "useractivity",
  "gymenergy",
  "gymstrength",
  "gymspeed",
  "gymdefense",
  "gymdexterity",
  "networth",
]);

export type DailyStatsAttention = {
  stale_personalstats: number;
  missing_donator_days: number;
  personalstats_target_date: string | null;
  latest_personalstats_bucket_date: string | null;
  personalstats_lag_days: number | null;
  affected_members: Array<{
    member_id: number;
    member_name: string | null;
    error: string | null;
    updated_at: number | null;
  }>;
};

type RepairJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
type RepairItemStatus = "pending" | "running" | "completed" | "failed" | "skipped";

type LifestyleRepairJobRow = {
  id: string;
  status: RepairJobStatus;
  start_date: string;
  end_date: string;
  effective_start_date: string;
  member_scope: "current";
  member_id: number | null;
  calls_per_minute_per_key: number;
  include_primary_key: number;
  active_key_count: number;
  total_items: number;
  completed_items: number;
  failed_items: number;
  skipped_items: number;
  started_at: number | null;
  finished_at: number | null;
  created_at: number;
  updated_at: number;
  alert_sent_at: number | null;
  last_error: string | null;
};

type LifestyleRepairItemRow = {
  id: string;
  job_id: string;
  member_id: number;
  member_name: string | null;
  snapshot_date: string;
  requested_at: number;
  status: RepairItemStatus;
  attempts: number;
  key_source: string | null;
  returned_bucket_date: string | null;
  error: string | null;
  started_at: number | null;
  finished_at: number | null;
  updated_at: number;
};

type RepairKey = {
  key: string;
  keySource: string;
};

type PersonalStatsRecentRow = {
  member_id: number;
  snapshot_date: string;
  member_name: string | null;
  level: number | null;
  position: string | null;
  requested_at: number;
  attempted_at: number | null;
  personal_captured_at: number | null;
  status: PersonalStatsRecentStatus;
  error: string | null;
};

export async function getMemberLifestyleStats(url: URL, env: Env): Promise<Response> {
  const availableRange = await readLifestyleSnapshotDateRange(env, "any_ready");
  const period = readLifestylePeriod(url, availableRange);
  const snapshotRows = ((await env.DB.prepare(
    `
    SELECT
      snapshots.member_id,
      snapshots.snapshot_date,
      snapshots.member_name,
      snapshots.xantaken,
      snapshots.overdosed,
      snapshots.refills,
      snapshots.useractivity,
      snapshots.networth,
      snapshots.daysbeendonator,
      snapshots.xantaken_timestamp,
      snapshots.overdosed_timestamp,
      snapshots.refills_timestamp,
      snapshots.useractivity_timestamp,
      snapshots.networth_timestamp,
      snapshots.daysbeendonator_timestamp,
      snapshots.personalstats_bucket_date,
      snapshots.personalstats_requested_at,
      snapshots.personalstats_key_source,
      snapshots.gymenergy,
      snapshots.gymstrength,
      snapshots.gymspeed,
      snapshots.gymdefense,
      snapshots.gymdexterity,
      snapshots.personal_captured_at,
      snapshots.gym_captured_at,
      snapshots.personal_ready,
      snapshots.gym_ready,
      snapshots.fully_ready,
      snapshots.captured_at,
      snapshots.validation_error
    FROM member_lifestyle_stat_snapshots snapshots
    JOIN home_faction_members
      ON home_faction_members.member_id = snapshots.member_id
     AND home_faction_members.is_current = 1
     AND home_faction_members.report_exempt = 0
    WHERE snapshots.snapshot_date BETWEEN ? AND ?
      AND (snapshots.personal_ready = 1 OR snapshots.gym_ready = 1)
    ORDER BY snapshots.member_id ASC, snapshots.snapshot_date ASC
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

export async function getMemberLifestyleDailyChart(url: URL, env: Env): Promise<Response> {
  const metric = parseLifestyleDailyChartMetric(url.searchParams.get("metric"));
  if (!metric) {
    return json({ ok: false, error: "A valid metric is required", code: "INVALID_METRIC" }, 400);
  }
  const readyColumn = lifestyleMetricReadyColumn(metric);
  const availableRange = await readLifestyleSnapshotDateRange(env, readyColumn);
  const period = readLifestylePeriod(url, availableRange);

  const memberIds = parseLifestyleDailyChartMemberIds(url);
  if (memberIds.length === 0) {
    return json({ ok: false, error: "At least one member_id is required", code: "MISSING_MEMBER_IDS" }, 400);
  }
  if (memberIds.length > 5) {
    return json({ ok: false, error: "Daily chart can compare at most 5 members", code: "TOO_MANY_MEMBERS" }, 400);
  }

  const homeMembers = await readHomeMembersById(env);
  const chartMemberIds = memberIds.filter((memberId) => homeMembers.has(memberId));
  if (chartMemberIds.length === 0) {
    return json({
      ok: true,
      metric,
      period,
      series: [],
    });
  }

  const boundaryDate = dateKeyFromMs(Date.parse(`${period.start_date}T00:00:00.000Z`) - 86_400_000);
  const placeholders = chartMemberIds.map(() => "?").join(",");
  const snapshotRows = ((await env.DB.prepare(
    `
    SELECT
      snapshots.member_id,
      snapshots.snapshot_date,
      snapshots.member_name,
      snapshots.xantaken,
      snapshots.overdosed,
      snapshots.refills,
      snapshots.useractivity,
      snapshots.networth,
      snapshots.daysbeendonator,
      snapshots.xantaken_timestamp,
      snapshots.overdosed_timestamp,
      snapshots.refills_timestamp,
      snapshots.useractivity_timestamp,
      snapshots.networth_timestamp,
      snapshots.daysbeendonator_timestamp,
      snapshots.personalstats_bucket_date,
      snapshots.personalstats_requested_at,
      snapshots.personalstats_key_source,
      snapshots.gymenergy,
      snapshots.gymstrength,
      snapshots.gymspeed,
      snapshots.gymdefense,
      snapshots.gymdexterity,
      snapshots.personal_captured_at,
      snapshots.gym_captured_at,
      snapshots.personal_ready,
      snapshots.gym_ready,
      snapshots.fully_ready,
      snapshots.captured_at,
      snapshots.validation_error
    FROM member_lifestyle_stat_snapshots snapshots
    JOIN home_faction_members members
      ON members.member_id = snapshots.member_id
     AND members.is_current = 1
     AND members.report_exempt = 0
    WHERE snapshots.snapshot_date BETWEEN ? AND ?
      AND snapshots.member_id IN (${placeholders})
      AND snapshots.${readyColumn} = 1
    ORDER BY snapshots.member_id ASC, snapshots.snapshot_date ASC
    `,
  )
    .bind(boundaryDate, period.end_date, ...chartMemberIds)
    .all()).results ?? []) as LifestyleSnapshotRow[];

  return json({
    ok: true,
    metric,
    period,
    series: buildDailyChartSeries(snapshotRows, chartMemberIds, homeMembers, period.start_date, period.end_date, metric),
  });
}

export async function refreshMemberLifestyleStats(
  env: Env,
  options: {
    limit?: number;
    homeMembersSynced?: boolean;
    activeDates?: string[];
  } = {},
): Promise<{ considered: number; refreshed: number; failed: number }> {
  const limit = Math.max(1, Math.min(Math.floor(options.limit ?? DAILY_LIFESTYLE_REFRESH_LIMIT), DAILY_LIFESTYLE_REFRESH_LIMIT));
  const activeDates = options.activeDates ?? recentCompletedPersonalStatsDates(nowSeconds());

  if (!options.homeMembersSynced) {
    await syncHomeFactionMemberList(env);
  }

  await preparePersonalStatsRecentQueue(env, activeDates);
  const members = await readPersonalStatsRecentCandidates(env, activeDates, limit);
  const refreshedMemberIds: number[] = [];
  let refreshed = 0;
  let failed = 0;

  for (const queueRow of members) {
    try {
      const stats = await fetchMemberPersonalStats(env, queueRow.member_id, {
        requestedAt: queueRow.requested_at,
        keySource: "env:TORN_API_KEY",
      });
      const dataQualityError = personalStatsDataQualityError(stats, queueRow.snapshot_date, {
        allowBucketLag: true,
      });
      if (dataQualityError) {
        await markPersonalStatsRecentAttempt(env, queueRow, dataQualityError, "failed");
        failed += 1;
        continue;
      }

      const returnedBucketDate = stats.personalstats_bucket_date!;
      if (returnedBucketDate === queueRow.snapshot_date) {
        await completePersonalStatsRecentRow(env, queueRow, returnedBucketDate, stats);
        await upsertLifestyleSnapshotPersonalStats(env, {
          member_id: queueRow.member_id,
          member_name: queueRow.member_name,
          snapshot_date: returnedBucketDate,
        }, stats);
        await upsertLifestyleStats(env, personalStatsRecentRowToMember(queueRow), stats, null);
        refreshedMemberIds.push(queueRow.member_id);
        refreshed += 1;
        continue;
      }

      if (activeDates.includes(returnedBucketDate)) {
        const returnedDateComplete = await isPersonalStatsRecentMemberDateComplete(
          env,
          queueRow.member_id,
          returnedBucketDate,
        );
        if (!returnedDateComplete) {
          await completePersonalStatsRecentRow(env, queueRow, returnedBucketDate, stats);
          await upsertLifestyleSnapshotPersonalStats(env, {
            member_id: queueRow.member_id,
            member_name: queueRow.member_name,
            snapshot_date: returnedBucketDate,
          }, stats);
          await upsertLifestyleStats(env, personalStatsRecentRowToMember(queueRow), stats, null);
          refreshedMemberIds.push(queueRow.member_id);
          refreshed += 1;
        }
        await markPersonalStatsRecentAttempt(
          env,
          queueRow,
          `${PERSONALSTATS_BUCKET_MISMATCH_ERROR_CODE}: requested ${queueRow.snapshot_date}, received ${returnedBucketDate}`,
          queueRow.status === "retry_expired" ? "retry_expired" : "pending",
        );
        failed += 1;
      } else {
        await markPersonalStatsRecentAttempt(
          env,
          queueRow,
          `${PERSONALSTATS_BUCKET_MISMATCH_ERROR_CODE}: requested ${queueRow.snapshot_date}, received ${returnedBucketDate}`,
          queueRow.status === "retry_expired" ? "retry_expired" : "pending",
        );
        failed += 1;
      }
    } catch (err: any) {
      await markPersonalStatsRecentAttempt(env, queueRow, err?.message || String(err), "failed");
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

  await syncHomeFactionMemberList(env);
  const activeDates = recentCompletedPersonalStatsDates(now);
  await preparePersonalStatsRecentQueue(env, activeDates);
  const targetSnapshotDate = activeDates[activeDates.length - 1];
  const targetCompleteAt = timestampForDailyPoll(targetSnapshotDate);
  let result = { considered: 0, refreshed: 0, failed: 0 };
  let shouldRunPersonalBatch = true;
  let personalCompletionAlreadyRecorded = false;

  if (options.useLock) {
    const gate = await claimDailyBatchGate(env, {
      completeStateName: DAILY_LIFESTYLE_COMPLETE_STATE_NAME,
      completeAfter: targetCompleteAt,
      lockStateName: DAILY_LIFESTYLE_LOCK_STATE_NAME,
      now,
      lockSeconds: DAILY_LIFESTYLE_LOCK_SECONDS,
    });

    if (gate.completed) {
      shouldRunPersonalBatch = false;
      personalCompletionAlreadyRecorded = true;
    } else if (!gate.locked) {
      return { considered: 0, refreshed: 0, failed: 0, skipped: true };
    }
  } else if (await isPersonalStatsDateComplete(env, targetSnapshotDate)) {
    shouldRunPersonalBatch = false;
    personalCompletionAlreadyRecorded = true;
  }

  if (shouldRunPersonalBatch) {
    result = await refreshMemberLifestyleStats(env, {
      limit: options.limit ?? DAILY_LIFESTYLE_REFRESH_LIMIT,
      homeMembersSynced: true,
      activeDates,
    });
  }
  await refreshDailyGymContributorStats(env, refreshAt, { homeMembersSynced: true });
  const snapshotDate = utcDateKey(refreshAt);
  await writeLifestyleSnapshotForDate(env, snapshotDate, { freshAfter: refreshAt });
  const complete = personalCompletionAlreadyRecorded
    ? false
    : await markDailyLifestyleRefreshCompleteIfDone(env, targetSnapshotDate);
  if (complete) {
    await refreshMemberAchievementSummaries(env, targetSnapshotDate);
  }
  await bumpMemberLifestyleCacheVersion(env);

  return { ...result, skipped: false };
}

async function readLifestyleSnapshotDateRange(
  env: Env,
  readyFilter?: LifestyleSnapshotReadyFilter,
): Promise<{ start_date: string; end_date: string } | null> {
  const row = (await env.DB.prepare(
    `
    SELECT
      MIN(snapshot_date) AS start_date,
      MAX(snapshot_date) AS end_date
    FROM member_lifestyle_stat_snapshots
    ${lifestyleSnapshotReadyWhere(readyFilter)}
    `,
  ).first()) as { start_date: string | null; end_date: string | null } | null;

  if (!row?.start_date || !row.end_date) {
    return null;
  }

  return {
    start_date: row.start_date,
    end_date: row.end_date,
  };
}

function lifestyleSnapshotReadyWhere(readyFilter?: LifestyleSnapshotReadyFilter): string {
  if (!readyFilter) {
    return "";
  }

  if (readyFilter === "any_ready") {
    return "WHERE personal_ready = 1 OR gym_ready = 1";
  }

  return `WHERE ${readyFilter} = 1`;
}

export async function getDailyStatsAttention(env: Env): Promise<DailyStatsAttention> {
  const now = nowSeconds();
  const activeDates = recentCompletedPersonalStatsDates(now);
  const targetDate = activeDates.at(-1) ?? null;
  const activeDatePlaceholders = activeDates.map(() => "?").join(",");
  const latestBucketRow = (await env.DB.prepare(
    `
    SELECT snapshots.snapshot_date AS snapshot_date
    FROM member_lifestyle_stat_snapshots snapshots
    JOIN home_faction_members members
      ON members.member_id = snapshots.member_id
     AND members.is_current = 1
     AND members.report_exempt = 0
    WHERE snapshots.personal_ready = 1
    ORDER BY snapshots.snapshot_date DESC
    LIMIT 1
    `,
  ).first()) as { snapshot_date: string | null } | null;
  const latestBucketDate = latestBucketRow?.snapshot_date ?? null;
  const lagDays = targetDate && latestBucketDate
    ? calendarDateDiffDays(latestBucketDate, targetDate)
    : null;

  const rows = ((await env.DB.prepare(
    `
    SELECT
      members.member_id,
      COALESCE(stats.member_name, members.name) AS member_name,
      stats.error AS error,
      stats.updated_at AS updated_at
    FROM home_faction_members members
    JOIN member_personal_stats_recent stats
      ON stats.member_id = members.member_id
    WHERE members.is_current = 1
      AND members.report_exempt = 0
      AND (
        stats.status = 'retry_expired'
        OR (
          stats.snapshot_date NOT IN (${activeDatePlaceholders})
          AND (
            stats.error LIKE ?
            OR (
              stats.error IS NOT NULL
              AND stats.error NOT LIKE ?
              AND stats.error NOT LIKE ?
            )
          )
        )
      )
    ORDER BY stats.snapshot_date ASC, members.name ASC
    LIMIT 12
    `,
  )
    .bind(
      ...activeDates,
      `${MISSING_DONATOR_DAYS_ERROR_CODE}%`,
      `${OLD_PERSONALSTATS_BUCKET_ERROR_CODE}%`,
      `${MISSING_DONATOR_DAYS_ERROR_CODE}%`,
    )
    .all()).results ?? []) as DailyStatsAttention["affected_members"];

  const counts = (await env.DB.prepare(
    `
    SELECT
      SUM(CASE
        WHEN stats.status = 'retry_expired'
          OR (
            stats.snapshot_date NOT IN (${activeDatePlaceholders})
            AND stats.error IS NOT NULL
            AND stats.error NOT LIKE ?
            AND stats.error NOT LIKE ?
          )
        THEN 1
        ELSE 0
      END) AS stale_personalstats,
      SUM(CASE
        WHEN stats.snapshot_date NOT IN (${activeDatePlaceholders})
          AND stats.error LIKE ?
        THEN 1
        ELSE 0
      END) AS missing_donator_days
    FROM home_faction_members members
    JOIN member_personal_stats_recent stats
      ON stats.member_id = members.member_id
    WHERE members.is_current = 1
      AND members.report_exempt = 0
    `,
  )
    .bind(
      ...activeDates,
      `${OLD_PERSONALSTATS_BUCKET_ERROR_CODE}%`,
      `${MISSING_DONATOR_DAYS_ERROR_CODE}%`,
      ...activeDates,
      `${MISSING_DONATOR_DAYS_ERROR_CODE}%`,
    )
    .first()) as { stale_personalstats: number | null; missing_donator_days: number | null } | null;

  return {
    stale_personalstats: counts?.stale_personalstats ?? 0,
    missing_donator_days: counts?.missing_donator_days ?? 0,
    personalstats_target_date: targetDate,
    latest_personalstats_bucket_date: latestBucketDate,
    personalstats_lag_days: lagDays,
    affected_members: rows,
  };
}

export async function createMemberLifestyleRepairJob(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as {
    start_date?: unknown;
    end_date?: unknown;
    calls_per_minute_per_key?: unknown;
    member_id?: unknown;
  };
  const startDate = normalizeDateParam(typeof body.start_date === "string" ? body.start_date : null);
  const endDate = normalizeDateParam(typeof body.end_date === "string" ? body.end_date : null);

  if (!startDate || !endDate || startDate > endDate) {
    return json({ ok: false, error: "A valid start_date and end_date are required", code: "INVALID_DATE_RANGE" }, 400);
  }

  if (dateDiffDays(startDate, endDate) > MAX_REPAIR_DATE_RANGE_DAYS) {
    return json(
      {
        ok: false,
        error: `Repair range cannot exceed ${MAX_REPAIR_DATE_RANGE_DAYS} days`,
        code: "DATE_RANGE_TOO_LARGE",
      },
      400,
    );
  }

  await syncHomeFactionMemberList(env);
  const homeMembers = await readHomeMembersById(env);
  const memberId = parseOptionalPositiveInteger(body.member_id);
  if (memberId !== null && !homeMembers.has(memberId)) {
    return json(
      { ok: false, error: "Member is not a current faction member", code: "MEMBER_NOT_CURRENT" },
      400,
    );
  }
  const members = memberId === null
    ? Array.from(homeMembers.values())
    : [homeMembers.get(memberId)!];
  if (members.length === 0) {
    return json({ ok: false, error: "No current faction members found", code: "NO_CURRENT_MEMBERS" }, 400);
  }

  const callsPerMinutePerKey = clampRepairCallsPerKey(body.calls_per_minute_per_key);
  const now = nowSeconds();
  const id = crypto.randomUUID();
  const dates = enumerateDateRange(dateKeyFromMs(Date.parse(`${startDate}T00:00:00.000Z`) - 86_400_000), endDate);
  const statements = [
    env.DB.prepare(
      `
      INSERT INTO member_lifestyle_repair_jobs (
        id,
        status,
        start_date,
        end_date,
        effective_start_date,
        member_scope,
        member_id,
        calls_per_minute_per_key,
        include_primary_key,
        total_items,
        created_at,
        updated_at
      )
      VALUES (?, 'queued', ?, ?, ?, 'current', ?, ?, 1, ?, ?, ?)
      `,
    ).bind(
      id,
      startDate,
      endDate,
      dates[0],
      memberId,
      callsPerMinutePerKey,
      members.length * dates.length,
      now,
      now,
    ),
  ];

  for (const date of dates) {
    const requestedAt = timestampForDailyPoll(date);
    for (const member of members) {
      statements.push(
        env.DB.prepare(
          `
          INSERT INTO member_lifestyle_repair_items (
            id,
            job_id,
            member_id,
            member_name,
            snapshot_date,
            requested_at,
            status,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
          `,
        ).bind(crypto.randomUUID(), id, member.member_id, member.name, date, requestedAt, now),
      );
    }
  }

  for (const batch of chunk(statements, 50)) {
    await env.DB.batch(batch);
  }

  return getMemberLifestyleRepairJob(env, id);
}

export async function listMemberLifestyleRepairJobs(env: Env): Promise<Response> {
  const rows = ((await env.DB.prepare(
    `
    SELECT *
    FROM member_lifestyle_repair_jobs
    ORDER BY created_at DESC
    LIMIT 20
    `,
  ).all()).results ?? []) as LifestyleRepairJobRow[];

  return json({
    ok: true,
    jobs: rows.map(formatRepairJob),
  });
}

export async function getMemberLifestyleRepairJob(env: Env, jobId: string): Promise<Response> {
  const job = await readRepairJob(env, jobId);
  if (!job) {
    return json({ ok: false, error: "Repair job not found", code: "REPAIR_JOB_NOT_FOUND" }, 404);
  }

  const statusCounts = await readRepairJobStatusCounts(env, jobId);
  const recentErrors = ((await env.DB.prepare(
    `
    SELECT *
    FROM member_lifestyle_repair_items
    WHERE job_id = ?
      AND error IS NOT NULL
    ORDER BY updated_at DESC
    LIMIT 12
    `,
  )
    .bind(jobId)
    .all()).results ?? []) as LifestyleRepairItemRow[];

  return json({
    ok: true,
    job: {
      ...formatRepairJob(job),
      status_counts: statusCounts,
      recent_errors: recentErrors.map(formatRepairItem),
    },
  });
}

export async function cancelMemberLifestyleRepairJob(env: Env, jobId: string): Promise<Response> {
  const now = nowSeconds();
  const result = await env.DB.prepare(
    `
    UPDATE member_lifestyle_repair_jobs
    SET status = 'cancelled',
        finished_at = COALESCE(finished_at, ?),
        updated_at = ?,
        last_error = 'Cancelled by admin'
    WHERE id = ?
      AND status IN ('queued', 'running')
    `,
  )
    .bind(now, now, jobId)
    .run();

  if (Number(result.meta?.changes ?? 0) === 0) {
    const existing = await readRepairJob(env, jobId);
    if (!existing) {
      return json({ ok: false, error: "Repair job not found", code: "REPAIR_JOB_NOT_FOUND" }, 404);
    }
  } else {
    await env.DB.prepare(
      `
      UPDATE member_lifestyle_repair_items
      SET status = 'skipped',
          error = 'Cancelled by admin',
          updated_at = ?
      WHERE job_id = ?
        AND status IN ('pending', 'running')
      `,
    )
      .bind(now, jobId)
      .run();
    await refreshRepairJobCounts(env, jobId);
  }

  return getMemberLifestyleRepairJob(env, jobId);
}

export async function processMemberLifestyleRepairJobs(env: Env): Promise<{
  writeStatements: number;
  changedRows: number;
  details: Record<string, unknown>;
}> {
  const now = nowSeconds();
  const keys = await readAvailableRepairKeys(env, now);
  if (keys.length === 0) {
    return {
      writeStatements: 0,
      changedRows: 0,
      details: { skipped: true, reason: "no repair API keys available" },
    };
  }

  const job = (await env.DB.prepare(
    `
    SELECT *
    FROM member_lifestyle_repair_jobs
    WHERE status IN ('queued', 'running')
    ORDER BY created_at ASC
    LIMIT 1
    `,
  ).first()) as LifestyleRepairJobRow | null;

  if (!job) {
    return {
      writeStatements: 0,
      changedRows: 0,
      details: { skipped: true, reason: "no queued repair job" },
    };
  }

  await env.DB.prepare(
    `
    UPDATE member_lifestyle_repair_items
    SET status = 'pending',
        error = 'Reset after stale running state',
        updated_at = ?
    WHERE job_id = ?
      AND status = 'running'
      AND started_at < ?
    `,
  )
    .bind(now, job.id, now - 5 * 60)
    .run();

  const limit = Math.max(1, job.calls_per_minute_per_key) * keys.length;
  const items = ((await env.DB.prepare(
    `
    SELECT *
    FROM member_lifestyle_repair_items
    WHERE job_id = ?
      AND status = 'pending'
    ORDER BY snapshot_date ASC, member_id ASC
    LIMIT ?
    `,
  )
    .bind(job.id, limit)
    .all()).results ?? []) as LifestyleRepairItemRow[];

  if (items.length === 0) {
    await finalizeRepairJobIfDone(env, job.id);
    const refreshed = await readRepairJob(env, job.id);
    return {
      writeStatements: 1,
      changedRows: 1,
      details: { job_id: job.id, status: refreshed?.status ?? job.status, processed: 0 },
    };
  }

  await env.DB.prepare(
    `
    UPDATE member_lifestyle_repair_jobs
    SET status = 'running',
        started_at = COALESCE(started_at, ?),
        active_key_count = ?,
        updated_at = ?
    WHERE id = ?
    `,
  )
    .bind(now, keys.length, now, job.id)
    .run();

  let processed = 0;
  let completed = 0;
  let failed = 0;
  let skipped = 0;
  let changedRows = 1;
  let writeStatements = 1;
  const affectedDates = new Set<string>();
  const autoSkippedItemIds = new Set<string>();
  let keyIndex = 0;
  const activeKeys = [...keys];
  const startedAt = Date.now();

  for (const item of items) {
    if ((Date.now() - startedAt) / 1000 > REPAIR_JOB_PROCESS_LIMIT_SECONDS) {
      break;
    }
    if (activeKeys.length === 0) {
      break;
    }
    if (autoSkippedItemIds.has(item.id)) {
      continue;
    }

    const key = activeKeys[keyIndex % activeKeys.length];
    keyIndex += 1;
    const result = await processRepairItem(env, item, key);
    processed += 1;
    writeStatements += result.writeStatements;
    changedRows += result.changedRows;
    if (result.status === "completed") {
      completed += 1;
    } else if (result.status === "failed") {
      failed += 1;
    } else if (result.status === "skipped") {
      skipped += result.skippedItems;
    }
    for (const date of result.affectedSnapshotDates) {
      affectedDates.add(date);
    }
    for (const skippedItemId of result.skippedItemIds) {
      autoSkippedItemIds.add(skippedItemId);
    }

    if (result.rateLimited) {
      await upsertSyncTimestamp(env, repairKeyPauseStateName(key.keySource), nowSeconds() + 60, null);
      activeKeys.splice(activeKeys.indexOf(key), 1);
    }
  }

  await refreshRepairJobCounts(env, job.id);
  await finalizeRepairJobIfDone(env, job.id);
  await sendRepairFailureAlertIfNeeded(env, job.id);

  if (affectedDates.size > 0) {
    for (const date of affectedDates) {
      await refreshMemberAchievementSummaries(env, date);
    }
    await bumpMemberLifestyleCacheVersion(env);
  }

  return {
    writeStatements,
    changedRows,
    details: {
      job_id: job.id,
      processed,
      completed,
      failed,
      skipped,
      active_keys: keys.length,
    },
  };
}

async function processRepairItem(
  env: Env,
  item: LifestyleRepairItemRow,
  key: RepairKey,
): Promise<{
  status: RepairItemStatus;
  writeStatements: number;
  changedRows: number;
  rateLimited: boolean;
  affectedSnapshotDates: string[];
  skippedItems: number;
  skippedItemIds: string[];
}> {
  const now = nowSeconds();
  await env.DB.prepare(
    `
    UPDATE member_lifestyle_repair_items
    SET status = 'running',
        attempts = attempts + 1,
        key_source = ?,
        started_at = COALESCE(started_at, ?),
        updated_at = ?
    WHERE id = ?
    `,
  )
    .bind(key.keySource, now, now, item.id)
    .run();

  try {
    const stats = await fetchMemberPersonalStats(env, item.member_id, {
      requestedAt: item.requested_at,
      apiKey: key.key,
      keySource: key.keySource,
    });
    const validationError = personalStatsDataQualityError(stats, item.snapshot_date, {
      allowBucketLag: true,
    });
    if (validationError) {
      await markRepairItemFailed(env, item, stats.personalstats_bucket_date, validationError);
      return {
        status: "failed",
        writeStatements: 2,
        changedRows: 2,
        rateLimited: false,
        affectedSnapshotDates: [],
        skippedItems: 0,
        skippedItemIds: [],
      };
    }

    const returnedBucketDate = stats.personalstats_bucket_date!;
    await upsertLifestyleSnapshotForRepair(env, item, stats, returnedBucketDate);
    if (returnedBucketDate !== item.snapshot_date) {
      const clearedRows = await clearSnapshotPersonalStatsForDate(env, item.member_id, item.snapshot_date);
      await markRepairItemSkipped(
        env,
        item,
        returnedBucketDate,
        null,
      );
      const laterSkipped = await skipLaterUnavailableRepairItems(env, item, returnedBucketDate);
      return {
        status: "skipped",
        writeStatements: 4 + laterSkipped.writeStatements,
        changedRows: 3 + clearedRows + laterSkipped.changedRows,
        rateLimited: false,
        affectedSnapshotDates: [returnedBucketDate, item.snapshot_date, ...laterSkipped.affectedSnapshotDates],
        skippedItems: 1 + laterSkipped.skippedItems,
        skippedItemIds: laterSkipped.skippedItemIds,
      };
    }

    await env.DB.prepare(
      `
      UPDATE member_lifestyle_repair_items
      SET status = 'completed',
          returned_bucket_date = ?,
          error = NULL,
          finished_at = ?,
          updated_at = ?
      WHERE id = ?
      `,
    )
      .bind(stats.personalstats_bucket_date, nowSeconds(), nowSeconds(), item.id)
      .run();

    return {
      status: "completed",
      writeStatements: 3,
      changedRows: 3,
      rateLimited: false,
      affectedSnapshotDates: [returnedBucketDate],
      skippedItems: 0,
      skippedItemIds: [],
    };
  } catch (err: any) {
    const rateLimited = err instanceof TornPersonalStatsHttpError && err.status === 429;
    if (rateLimited) {
      await markRepairItemPending(env, item, err.message);
      return {
        status: "pending",
        writeStatements: 2,
        changedRows: 2,
        rateLimited,
        affectedSnapshotDates: [],
        skippedItems: 0,
        skippedItemIds: [],
      };
    }
    await markRepairItemFailed(env, item, null, err?.message || String(err));
    return {
      status: "failed",
      writeStatements: 2,
      changedRows: 2,
      rateLimited,
      affectedSnapshotDates: [],
      skippedItems: 0,
      skippedItemIds: [],
    };
  }
}

async function markRepairItemPending(
  env: Env,
  item: LifestyleRepairItemRow,
  error: string,
): Promise<void> {
  const now = nowSeconds();
  await env.DB.prepare(
    `
    UPDATE member_lifestyle_repair_items
    SET status = 'pending',
        error = ?,
        updated_at = ?
    WHERE id = ?
    `,
  )
    .bind(error, now, item.id)
    .run();
}

async function markRepairItemFailed(
  env: Env,
  item: LifestyleRepairItemRow,
  returnedBucketDate: string | null,
  error: string,
): Promise<void> {
  const now = nowSeconds();
  await env.DB.prepare(
    `
    UPDATE member_lifestyle_repair_items
    SET status = 'failed',
        returned_bucket_date = ?,
        error = ?,
        finished_at = ?,
        updated_at = ?
    WHERE id = ?
    `,
  )
    .bind(returnedBucketDate, error, now, now, item.id)
    .run();
}

async function markRepairItemSkipped(
  env: Env,
  item: LifestyleRepairItemRow,
  returnedBucketDate: string,
  reason: string | null,
): Promise<void> {
  const now = nowSeconds();
  await env.DB.prepare(
    `
    UPDATE member_lifestyle_repair_items
    SET status = 'skipped',
        returned_bucket_date = ?,
        error = ?,
        finished_at = ?,
        updated_at = ?
    WHERE id = ?
    `,
  )
    .bind(returnedBucketDate, reason, now, now, item.id)
    .run();
}

async function upsertLifestyleSnapshotForRepair(
  env: Env,
  item: LifestyleRepairItemRow,
  stats: TimedLifestyleStats,
  snapshotDate: string,
): Promise<void> {
  await upsertLifestyleSnapshotPersonalStats(env, {
    member_id: item.member_id,
    member_name: item.member_name,
    snapshot_date: snapshotDate,
  }, stats);
}

async function skipLaterUnavailableRepairItems(
  env: Env,
  item: LifestyleRepairItemRow,
  returnedBucketDate: string,
): Promise<{
  skippedItems: number;
  affectedSnapshotDates: string[];
  skippedItemIds: string[];
  writeStatements: number;
  changedRows: number;
}> {
  const repeatedBucket = await env.DB.prepare(
    `
    SELECT id
    FROM member_lifestyle_repair_items
    WHERE job_id = ?
      AND member_id = ?
      AND snapshot_date < ?
      AND returned_bucket_date = ?
      AND status IN ('completed', 'skipped')
    LIMIT 1
    `,
  )
    .bind(item.job_id, item.member_id, item.snapshot_date, returnedBucketDate)
    .first();

  if (!repeatedBucket) {
    return {
      skippedItems: 0,
      affectedSnapshotDates: [],
      skippedItemIds: [],
      writeStatements: 0,
      changedRows: 0,
    };
  }

  const rows = ((await env.DB.prepare(
    `
    SELECT id, snapshot_date
    FROM member_lifestyle_repair_items
    WHERE job_id = ?
      AND member_id = ?
      AND status = 'pending'
      AND snapshot_date > ?
    ORDER BY snapshot_date ASC
    `,
  )
    .bind(item.job_id, item.member_id, item.snapshot_date)
    .all()).results ?? []) as Array<{ id: string; snapshot_date: string }>;

  if (rows.length === 0) {
    return {
      skippedItems: 0,
      affectedSnapshotDates: [],
      skippedItemIds: [],
      writeStatements: 0,
      changedRows: 0,
    };
  }

  let writeStatements = 0;
  let changedRows = 0;
  const affectedSnapshotDates = rows.map((row) => row.snapshot_date);

  for (const row of rows) {
    changedRows += await clearSnapshotPersonalStatsForDate(env, item.member_id, row.snapshot_date);
    writeStatements += 1;
  }

  const now = nowSeconds();
  const ids = rows.map((row) => row.id);
  const result = await env.DB.prepare(
    `
    UPDATE member_lifestyle_repair_items
    SET status = 'skipped',
        returned_bucket_date = ?,
        error = NULL,
        finished_at = ?,
        updated_at = ?
    WHERE id IN (${ids.map(() => "?").join(",")})
    `,
  )
    .bind(returnedBucketDate, now, now, ...ids)
    .run();
  writeStatements += 1;
  changedRows += d1Changes(result);

  return {
    skippedItems: rows.length,
    affectedSnapshotDates,
    skippedItemIds: ids,
    writeStatements,
    changedRows,
  };
}

async function clearSnapshotPersonalStatsForDate(
  env: Env,
  memberId: number,
  snapshotDate: string,
): Promise<number> {
  const result = await env.DB.prepare(
    `
    UPDATE member_lifestyle_stat_snapshots
    SET
      xantaken = NULL,
      overdosed = NULL,
      refills = NULL,
      useractivity = NULL,
      networth = NULL,
      daysbeendonator = NULL,
      xantaken_timestamp = NULL,
      overdosed_timestamp = NULL,
      refills_timestamp = NULL,
      useractivity_timestamp = NULL,
      networth_timestamp = NULL,
      daysbeendonator_timestamp = NULL,
      personalstats_bucket_date = NULL,
      personalstats_requested_at = NULL,
      personalstats_key_source = NULL,
      validation_error = NULL,
      personal_captured_at = NULL,
      personal_ready = 0,
      fully_ready = 0,
      captured_at = unixepoch()
    WHERE member_id = ?
      AND snapshot_date = ?
      AND (
        personalstats_bucket_date IS NULL
        OR personalstats_bucket_date != ?
      )
      AND (
        personal_ready != 0
        OR personal_captured_at IS NOT NULL
        OR personalstats_bucket_date IS NOT NULL
        OR personalstats_requested_at IS NOT NULL
        OR validation_error IS NOT NULL
        OR xantaken IS NOT NULL
        OR overdosed IS NOT NULL
        OR refills IS NOT NULL
        OR useractivity IS NOT NULL
        OR networth IS NOT NULL
        OR daysbeendonator IS NOT NULL
      )
    `,
  )
    .bind(memberId, snapshotDate, snapshotDate)
    .run();

  return d1Changes(result);
}

async function upsertLifestyleSnapshotPersonalStats(
  env: Env,
  target: { member_id: number; member_name: string | null; snapshot_date: string },
  stats: TimedLifestyleStats,
): Promise<void> {
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
      daysbeendonator,
      xantaken_timestamp,
      overdosed_timestamp,
      refills_timestamp,
      useractivity_timestamp,
      networth_timestamp,
      daysbeendonator_timestamp,
      personalstats_bucket_date,
      personalstats_requested_at,
      personalstats_key_source,
      validation_error,
      personal_captured_at,
      personal_ready,
      fully_ready,
      captured_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, unixepoch(), 1, 0, unixepoch())
    ON CONFLICT(member_id, snapshot_date) DO UPDATE SET
      member_name = excluded.member_name,
      xantaken = excluded.xantaken,
      overdosed = excluded.overdosed,
      refills = excluded.refills,
      useractivity = excluded.useractivity,
      networth = excluded.networth,
      daysbeendonator = excluded.daysbeendonator,
      xantaken_timestamp = excluded.xantaken_timestamp,
      overdosed_timestamp = excluded.overdosed_timestamp,
      refills_timestamp = excluded.refills_timestamp,
      useractivity_timestamp = excluded.useractivity_timestamp,
      networth_timestamp = excluded.networth_timestamp,
      daysbeendonator_timestamp = excluded.daysbeendonator_timestamp,
      personalstats_bucket_date = excluded.personalstats_bucket_date,
      personalstats_requested_at = excluded.personalstats_requested_at,
      personalstats_key_source = excluded.personalstats_key_source,
      validation_error = NULL,
      personal_captured_at = excluded.personal_captured_at,
      personal_ready = 1,
      fully_ready = CASE WHEN member_lifestyle_stat_snapshots.gym_ready = 1 THEN 1 ELSE 0 END,
      captured_at = excluded.captured_at
    `,
  )
    .bind(
      target.member_id,
      target.snapshot_date,
      target.member_name,
      stats.xantaken,
      stats.overdosed,
      stats.refills,
      stats.useractivity,
      stats.networth,
      stats.daysbeendonator,
      stats.xantaken_timestamp,
      stats.overdosed_timestamp,
      stats.refills_timestamp,
      stats.useractivity_timestamp,
      stats.networth_timestamp,
      stats.daysbeendonator_timestamp,
      stats.personalstats_bucket_date,
      stats.personalstats_requested_at,
      stats.personalstats_key_source,
    )
    .run();
}

async function readAvailableRepairKeys(env: Env, now: number): Promise<RepairKey[]> {
  const candidates: Array<RepairKey | null> = [
    env.TORN_API_KEY?.trim()
      ? { key: env.TORN_API_KEY.trim(), keySource: "env:TORN_API_KEY" }
      : null,
    await readRepairSecretKey(env.TORN_API_KEY_POOL_1, "secrets:TORN_API_KEY_POOL_1"),
    await readRepairSecretKey(env.TORN_API_KEY_POOL_2, "secrets:TORN_API_KEY_POOL_2"),
  ];
  const keys: RepairKey[] = [];
  for (const key of candidates) {
    if (!key) {
      continue;
    }
    const pauseUntil = await readSyncTimestamp(env, repairKeyPauseStateName(key.keySource));
    if (pauseUntil <= now) {
      keys.push(key);
    }
  }
  return keys;
}

async function readRepairSecretKey(
  binding: Env["TORN_API_KEY_POOL_1"],
  keySource: string,
): Promise<RepairKey | null> {
  try {
    const value = typeof binding === "string" ? binding : await binding?.get();
    const trimmed = value?.trim() ?? "";
    return trimmed ? { key: trimmed, keySource } : null;
  } catch {
    return null;
  }
}

async function readRepairJob(env: Env, jobId: string): Promise<LifestyleRepairJobRow | null> {
  return (await env.DB.prepare(
    `
    SELECT *
    FROM member_lifestyle_repair_jobs
    WHERE id = ?
    LIMIT 1
    `,
  )
    .bind(jobId)
    .first()) as LifestyleRepairJobRow | null;
}

async function readRepairJobStatusCounts(env: Env, jobId: string): Promise<Record<RepairItemStatus, number>> {
  const rows = ((await env.DB.prepare(
    `
    SELECT status, COUNT(*) AS count
    FROM member_lifestyle_repair_items
    WHERE job_id = ?
    GROUP BY status
    `,
  )
    .bind(jobId)
    .all()).results ?? []) as Array<{ status: RepairItemStatus; count: number }>;
  const counts: Record<RepairItemStatus, number> = {
    pending: 0,
    running: 0,
    completed: 0,
    failed: 0,
    skipped: 0,
  };
  for (const row of rows) {
    counts[row.status] = Number(row.count ?? 0);
  }
  return counts;
}

async function refreshRepairJobCounts(env: Env, jobId: string): Promise<void> {
  const counts = await readRepairJobStatusCounts(env, jobId);
  const now = nowSeconds();
  await env.DB.prepare(
    `
    UPDATE member_lifestyle_repair_jobs
    SET completed_items = ?,
        failed_items = ?,
        skipped_items = ?,
        updated_at = ?,
        last_error = (
          SELECT error
          FROM member_lifestyle_repair_items
          WHERE job_id = ?
            AND error IS NOT NULL
          ORDER BY updated_at DESC
          LIMIT 1
        )
    WHERE id = ?
    `,
  )
    .bind(counts.completed, counts.failed, counts.skipped, now, jobId, jobId)
    .run();
}

async function finalizeRepairJobIfDone(env: Env, jobId: string): Promise<void> {
  await refreshRepairJobCounts(env, jobId);
  const counts = await readRepairJobStatusCounts(env, jobId);
  if (counts.pending > 0 || counts.running > 0) {
    return;
  }

  const now = nowSeconds();
  const status: RepairJobStatus = counts.failed > 0 ? "failed" : "completed";
  await env.DB.prepare(
    `
    UPDATE member_lifestyle_repair_jobs
    SET status = ?,
        finished_at = COALESCE(finished_at, ?),
        updated_at = ?
    WHERE id = ?
      AND status IN ('queued', 'running')
    `,
  )
    .bind(status, now, now, jobId)
    .run();
}

async function sendRepairFailureAlertIfNeeded(env: Env, jobId: string): Promise<void> {
  const job = await readRepairJob(env, jobId);
  if (!job || job.status !== "failed" || job.alert_sent_at !== null) {
    return;
  }

  const alertStateName = `${REPAIR_FAILURE_ALERT_PREFIX}:${jobId}`;
  if ((await readSyncTimestamp(env, alertStateName)) > 0) {
    return;
  }

  const message =
    `Member lifestyle repair job ${job.id} failed for ${job.start_date} to ${job.end_date}. ` +
    `Completed ${job.completed_items}/${job.total_items}; failed ${job.failed_items}.` +
    (job.last_error ? ` Last error: ${job.last_error}` : "");

  console.warn(message);

  const now = nowSeconds();
  await upsertSyncTimestamp(env, alertStateName, now, null);
  await env.DB.prepare(
    `
    UPDATE member_lifestyle_repair_jobs
    SET alert_sent_at = ?,
        updated_at = ?
    WHERE id = ?
    `,
  )
    .bind(now, now, jobId)
    .run();
}

function formatRepairJob(job: LifestyleRepairJobRow) {
  return {
    id: job.id,
    status: job.status,
    start_date: job.start_date,
    end_date: job.end_date,
    effective_start_date: job.effective_start_date,
    member_scope: job.member_scope,
    member_id: job.member_id,
    calls_per_minute_per_key: job.calls_per_minute_per_key,
    include_primary_key: Boolean(job.include_primary_key),
    active_key_count: job.active_key_count,
    total_items: job.total_items,
    completed_items: job.completed_items,
    failed_items: job.failed_items,
    skipped_items: job.skipped_items,
    started_at: job.started_at,
    finished_at: job.finished_at,
    created_at: job.created_at,
    updated_at: job.updated_at,
    alert_sent_at: job.alert_sent_at,
    last_error: job.last_error,
  };
}

function formatRepairItem(item: LifestyleRepairItemRow) {
  return {
    id: item.id,
    member_id: item.member_id,
    member_name: item.member_name,
    snapshot_date: item.snapshot_date,
    requested_at: item.requested_at,
    status: item.status,
    attempts: item.attempts,
    key_source: item.key_source,
    returned_bucket_date: item.returned_bucket_date,
    error: item.error,
    updated_at: item.updated_at,
  };
}

async function refreshDailyGymContributorStats(
  env: Env,
  refreshAt: number,
  options: { homeMembersSynced?: boolean } = {},
): Promise<{ refreshed_stats: number; updated_members: number; skipped: boolean }> {
  if ((await readSyncTimestamp(env, DAILY_GYM_COMPLETE_STATE_NAME)) >= refreshAt) {
    return { refreshed_stats: 0, updated_members: 0, skipped: true };
  }

  const result = await refreshGymContributorStats(env, options);
  await upsertSyncTimestamp(env, DAILY_GYM_COMPLETE_STATE_NAME, refreshAt, null);

  return { ...result, skipped: false };
}

async function markDailyLifestyleRefreshCompleteIfDone(
  env: Env,
  targetSnapshotDate: string,
): Promise<boolean> {
  if (!(await isPersonalStatsDateComplete(env, targetSnapshotDate))) {
    return false;
  }

  await upsertSyncTimestamp(
    env,
    DAILY_LIFESTYLE_COMPLETE_STATE_NAME,
    timestampForDailyPoll(targetSnapshotDate),
    null,
  );

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
          is_current,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, unixepoch())
        ON CONFLICT(member_id) DO UPDATE SET
          faction_id = excluded.faction_id,
          name = excluded.name,
          level = excluded.level,
          position = excluded.position,
          days_in_faction = excluded.days_in_faction,
          is_revivable = excluded.is_revivable,
          is_current = 1,
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

  await markDepartedHomeFactionMembers(env, members);
  await removeDepartedLifestyleMembers(env, members);
}

async function markDepartedHomeFactionMembers(
  env: Env,
  members: TornFactionMember[],
): Promise<void> {
  const ids = members.map((member) => member.id).filter((id) => Number.isInteger(id) && id > 0);
  if (ids.length === 0) {
    return;
  }

  await env.DB.prepare(
    `
    UPDATE home_faction_members
    SET is_current = 0,
        updated_at = unixepoch()
    WHERE member_id NOT IN (${ids.map(() => "?").join(",")})
      AND is_current != 0
    `,
  )
    .bind(...ids)
    .run();
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
    DELETE FROM member_personal_stats_current
    WHERE member_id NOT IN (${ids.map(() => "?").join(",")})
    `,
  )
    .bind(...ids)
    .run();

  await env.DB.prepare(
    `
    DELETE FROM member_personal_stats_recent
    WHERE member_id NOT IN (${ids.map(() => "?").join(",")})
    `,
  )
    .bind(...ids)
    .run();

  await env.DB.prepare(
    `
    DELETE FROM member_gym_stats_current
    WHERE member_id NOT IN (${ids.map(() => "?").join(",")})
    `,
  )
    .bind(...ids)
    .run();
}

async function preparePersonalStatsRecentQueue(env: Env, activeDates: string[]): Promise<void> {
  await seedPersonalStatsRecentQueue(env, activeDates);
  await hydratePersonalStatsRecentQueueFromSnapshots(env, activeDates);
  await prunePersonalStatsRecentQueue(env, activeDates);
}

async function seedPersonalStatsRecentQueue(env: Env, activeDates: string[]): Promise<void> {
  if (activeDates.length === 0) {
    return;
  }

  const statements = activeDates.map((snapshotDate) =>
    env.DB.prepare(
      `
      INSERT INTO member_personal_stats_recent (
        member_id,
        snapshot_date,
        member_name,
        level,
        position,
        requested_at,
        status,
        updated_at
      )
      SELECT
        member_id,
        ?,
        name,
        level,
        position,
        ?,
        'pending',
        unixepoch()
      FROM home_faction_members
      WHERE faction_id = ?
        AND is_current = 1
        AND report_exempt = 0
      ON CONFLICT(member_id, snapshot_date) DO UPDATE SET
        member_name = excluded.member_name,
        level = excluded.level,
        position = excluded.position,
        requested_at = excluded.requested_at,
        status = CASE
          WHEN member_personal_stats_recent.personal_captured_at IS NULL
            AND member_personal_stats_recent.status = 'failed'
          THEN 'pending'
          ELSE member_personal_stats_recent.status
        END
      `,
    ).bind(snapshotDate, timestampForDailyPoll(snapshotDate), HOME_FACTION_ID),
  );

  await env.DB.batch(statements);
}

async function hydratePersonalStatsRecentQueueFromSnapshots(
  env: Env,
  activeDates: string[],
): Promise<void> {
  if (activeDates.length === 0) {
    return;
  }

  await env.DB.prepare(
    `
    INSERT INTO member_personal_stats_recent (
      member_id,
      snapshot_date,
      member_name,
      level,
      position,
      xantaken,
      overdosed,
      refills,
      useractivity,
      networth,
      daysbeendonator,
      xantaken_timestamp,
      overdosed_timestamp,
      refills_timestamp,
      useractivity_timestamp,
      networth_timestamp,
      daysbeendonator_timestamp,
      personalstats_bucket_date,
      requested_at,
      attempted_at,
      personalstats_key_source,
      personal_captured_at,
      status,
      error,
      updated_at
    )
    SELECT
      snapshots.member_id,
      snapshots.snapshot_date,
      COALESCE(snapshots.member_name, members.name),
      members.level,
      members.position,
      snapshots.xantaken,
      snapshots.overdosed,
      snapshots.refills,
      snapshots.useractivity,
      snapshots.networth,
      snapshots.daysbeendonator,
      snapshots.xantaken_timestamp,
      snapshots.overdosed_timestamp,
      snapshots.refills_timestamp,
      snapshots.useractivity_timestamp,
      snapshots.networth_timestamp,
      snapshots.daysbeendonator_timestamp,
      snapshots.personalstats_bucket_date,
      COALESCE(
        snapshots.personalstats_requested_at,
        CAST(strftime('%s', snapshots.snapshot_date || ' 00:10:00') AS INTEGER)
      ),
      snapshots.personal_captured_at,
      snapshots.personalstats_key_source,
      snapshots.personal_captured_at,
      'completed',
      NULL,
      unixepoch()
    FROM member_lifestyle_stat_snapshots snapshots
    JOIN home_faction_members members
      ON members.member_id = snapshots.member_id
     AND members.faction_id = ?
     AND members.is_current = 1
     AND members.report_exempt = 0
    WHERE snapshots.snapshot_date IN (${activeDates.map(() => "?").join(",")})
      AND snapshots.personal_ready = 1
    ON CONFLICT(member_id, snapshot_date) DO UPDATE SET
      member_name = excluded.member_name,
      level = excluded.level,
      position = excluded.position,
      xantaken = excluded.xantaken,
      overdosed = excluded.overdosed,
      refills = excluded.refills,
      useractivity = excluded.useractivity,
      networth = excluded.networth,
      daysbeendonator = excluded.daysbeendonator,
      xantaken_timestamp = excluded.xantaken_timestamp,
      overdosed_timestamp = excluded.overdosed_timestamp,
      refills_timestamp = excluded.refills_timestamp,
      useractivity_timestamp = excluded.useractivity_timestamp,
      networth_timestamp = excluded.networth_timestamp,
      daysbeendonator_timestamp = excluded.daysbeendonator_timestamp,
      personalstats_bucket_date = excluded.personalstats_bucket_date,
      attempted_at = excluded.attempted_at,
      personalstats_key_source = excluded.personalstats_key_source,
      personal_captured_at = excluded.personal_captured_at,
      status = 'completed',
      error = NULL,
      updated_at = excluded.updated_at
    `,
  )
    .bind(HOME_FACTION_ID, ...activeDates)
    .run();
}

async function prunePersonalStatsRecentQueue(env: Env, activeDates: string[]): Promise<void> {
  if (activeDates.length === 0) {
    return;
  }

  const placeholders = activeDates.map(() => "?").join(",");
  await env.DB.prepare(
    `
    UPDATE member_personal_stats_recent
    SET status = 'retry_expired',
        error = COALESCE(error, ?),
        updated_at = unixepoch()
    WHERE snapshot_date NOT IN (${placeholders})
      AND personal_captured_at IS NULL
      AND status != 'retry_expired'
    `,
  )
    .bind(`${RETRY_EXPIRED_PERSONALSTATS_ERROR_CODE}: no data before row aged out`, ...activeDates)
    .run();

  await env.DB.prepare(
    `
    DELETE FROM member_personal_stats_recent
    WHERE snapshot_date NOT IN (${placeholders})
      AND personal_captured_at IS NOT NULL
    `,
  )
    .bind(...activeDates)
    .run();
}

async function readPersonalStatsRecentCandidates(
  env: Env,
  activeDates: string[],
  limit: number,
): Promise<PersonalStatsRecentRow[]> {
  const expiredLimit = Math.min(EXPIRED_PERSONAL_STATS_RETRY_LIMIT, limit);
  const activeLimit = Math.max(0, limit - expiredLimit);
  const activeRows = activeLimit === 0 || activeDates.length === 0
    ? []
    : ((await env.DB.prepare(
      `
      SELECT
        recent.member_id,
        recent.snapshot_date,
        recent.member_name,
        recent.level,
        recent.position,
        recent.requested_at,
        recent.attempted_at,
        recent.personal_captured_at,
        recent.status,
        recent.error
      FROM member_personal_stats_recent recent
      JOIN home_faction_members members
        ON members.member_id = recent.member_id
       AND members.faction_id = ?
       AND members.is_current = 1
       AND members.report_exempt = 0
      WHERE recent.snapshot_date IN (${activeDates.map(() => "?").join(",")})
        AND recent.personal_captured_at IS NULL
        AND recent.status != 'retry_expired'
      ORDER BY recent.snapshot_date ASC, recent.attempted_at ASC NULLS FIRST, recent.member_name ASC
      LIMIT ?
      `,
    )
      .bind(HOME_FACTION_ID, ...activeDates, activeLimit)
      .all()).results ?? []) as PersonalStatsRecentRow[];

  const expiredRows = expiredLimit === 0
    ? []
    : ((await env.DB.prepare(
      `
      SELECT
        recent.member_id,
        recent.snapshot_date,
        recent.member_name,
        recent.level,
        recent.position,
        recent.requested_at,
        recent.attempted_at,
        recent.personal_captured_at,
        recent.status,
        recent.error
      FROM member_personal_stats_recent recent
      JOIN home_faction_members members
        ON members.member_id = recent.member_id
       AND members.faction_id = ?
       AND members.is_current = 1
       AND members.report_exempt = 0
      WHERE recent.personal_captured_at IS NULL
        AND recent.status = 'retry_expired'
      ORDER BY recent.snapshot_date ASC, recent.attempted_at ASC NULLS FIRST, recent.member_name ASC
      LIMIT ?
      `,
    )
      .bind(HOME_FACTION_ID, expiredLimit)
      .all()).results ?? []) as PersonalStatsRecentRow[];

  return [...activeRows, ...expiredRows];
}

async function isPersonalStatsDateComplete(env: Env, targetSnapshotDate: string): Promise<boolean> {
  const remaining = await env.DB.prepare(
    `
    SELECT members.member_id
    FROM home_faction_members members
    LEFT JOIN member_lifestyle_stat_snapshots snapshots
      ON snapshots.member_id = members.member_id
     AND snapshots.snapshot_date = ?
     AND snapshots.personal_ready = 1
    WHERE members.faction_id = ?
      AND members.is_current = 1
      AND members.report_exempt = 0
      AND snapshots.member_id IS NULL
    LIMIT 1
    `,
  )
    .bind(targetSnapshotDate, HOME_FACTION_ID)
    .first();

  return remaining === null;
}

async function isPersonalStatsRecentMemberDateComplete(
  env: Env,
  memberId: number,
  snapshotDate: string,
): Promise<boolean> {
  const row = await env.DB.prepare(
    `
    SELECT 1
    FROM member_personal_stats_recent
    WHERE member_id = ?
      AND snapshot_date = ?
      AND personal_captured_at IS NOT NULL
    LIMIT 1
    `,
  )
    .bind(memberId, snapshotDate)
    .first();

  return row !== null;
}

async function fetchMemberPersonalStats(
  env: Env,
  memberId: number,
  options: {
    requestedAt?: number;
    apiKey?: string;
    keySource: string;
  },
): Promise<TimedLifestyleStats> {
  return extractLifestyleStats(
    await fetchTornPersonalStatsWithTimestamps(env, memberId, TORN_LIFESTYLE_STAT_KEYS, {
      timestamp: options.requestedAt,
      apiKey: options.apiKey,
      keySource: options.keySource,
    }),
    {
      requestedAt: options.requestedAt ?? null,
      keySource: options.keySource,
    },
  );
}

function personalStatsDataQualityError(
  stats: TimedLifestyleStats,
  targetSnapshotDate: string | undefined,
  options: { allowBucketLag?: boolean } = {},
): string | null {
  if (stats.daysbeendonator === null) {
    return `${MISSING_DONATOR_DAYS_ERROR_CODE}: daysbeendonator was not returned`;
  }

  if (!targetSnapshotDate) {
    return null;
  }

  if (!stats.personalstats_bucket_date) {
    return `${MISSING_PERSONALSTATS_BUCKET_ERROR_CODE}: daysbeendonator timestamp was not returned for ${targetSnapshotDate}`;
  }

  if (!options.allowBucketLag && stats.personalstats_bucket_date !== targetSnapshotDate) {
    return `${OLD_PERSONALSTATS_BUCKET_ERROR_CODE}: expected ${targetSnapshotDate}, received ${stats.personalstats_bucket_date}`;
  }

  return null;
}

function personalStatsRecentRowToMember(row: PersonalStatsRecentRow): LifestyleMemberRow {
  return {
    member_id: row.member_id,
    name: row.member_name ?? String(row.member_id),
    level: row.level,
    position: row.position,
    personal_captured_at: row.personal_captured_at,
  };
}

async function markPersonalStatsRecentAttempt(
  env: Env,
  row: PersonalStatsRecentRow,
  error: string,
  status: PersonalStatsRecentStatus,
): Promise<void> {
  const nextStatus = row.status === "retry_expired" ? "retry_expired" : status;
  await env.DB.prepare(
    `
    UPDATE member_personal_stats_recent
    SET attempted_at = unixepoch(),
        status = ?,
        error = ?,
        updated_at = unixepoch()
    WHERE member_id = ?
      AND snapshot_date = ?
    `,
  )
    .bind(nextStatus, error, row.member_id, row.snapshot_date)
    .run();
}

async function completePersonalStatsRecentRow(
  env: Env,
  row: PersonalStatsRecentRow,
  snapshotDate: string,
  stats: TimedLifestyleStats,
): Promise<void> {
  await env.DB.prepare(
    `
    INSERT INTO member_personal_stats_recent (
      member_id,
      snapshot_date,
      member_name,
      level,
      position,
      xantaken,
      overdosed,
      refills,
      useractivity,
      networth,
      daysbeendonator,
      xantaken_timestamp,
      overdosed_timestamp,
      refills_timestamp,
      useractivity_timestamp,
      networth_timestamp,
      daysbeendonator_timestamp,
      personalstats_bucket_date,
      requested_at,
      attempted_at,
      personalstats_key_source,
      personal_captured_at,
      status,
      error,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), ?, unixepoch(), 'completed', NULL, unixepoch())
    ON CONFLICT(member_id, snapshot_date) DO UPDATE SET
      member_name = excluded.member_name,
      level = excluded.level,
      position = excluded.position,
      xantaken = excluded.xantaken,
      overdosed = excluded.overdosed,
      refills = excluded.refills,
      useractivity = excluded.useractivity,
      networth = excluded.networth,
      daysbeendonator = excluded.daysbeendonator,
      xantaken_timestamp = excluded.xantaken_timestamp,
      overdosed_timestamp = excluded.overdosed_timestamp,
      refills_timestamp = excluded.refills_timestamp,
      useractivity_timestamp = excluded.useractivity_timestamp,
      networth_timestamp = excluded.networth_timestamp,
      daysbeendonator_timestamp = excluded.daysbeendonator_timestamp,
      personalstats_bucket_date = excluded.personalstats_bucket_date,
      requested_at = excluded.requested_at,
      attempted_at = excluded.attempted_at,
      personalstats_key_source = excluded.personalstats_key_source,
      personal_captured_at = excluded.personal_captured_at,
      status = 'completed',
      error = NULL,
      updated_at = excluded.updated_at
    `,
  )
    .bind(
      row.member_id,
      snapshotDate,
      row.member_name,
      row.level,
      row.position,
      stats.xantaken,
      stats.overdosed,
      stats.refills,
      stats.useractivity,
      stats.networth,
      stats.daysbeendonator,
      stats.xantaken_timestamp,
      stats.overdosed_timestamp,
      stats.refills_timestamp,
      stats.useractivity_timestamp,
      stats.networth_timestamp,
      stats.daysbeendonator_timestamp,
      stats.personalstats_bucket_date,
      timestampForDailyPoll(snapshotDate),
      stats.personalstats_key_source,
    )
    .run();
}

async function upsertLifestyleStats(
  env: Env,
  member: LifestyleMemberRow,
  stats: TimedLifestyleStats,
  error: string | null,
): Promise<void> {
  await env.DB.prepare(
    `
    INSERT INTO member_personal_stats_current (
      member_id,
      member_name,
      level,
      position,
      xantaken,
      overdosed,
      refills,
      useractivity,
      networth,
      daysbeendonator,
      xantaken_timestamp,
      overdosed_timestamp,
      refills_timestamp,
      useractivity_timestamp,
      networth_timestamp,
      daysbeendonator_timestamp,
      personalstats_bucket_date,
      personalstats_requested_at,
      personalstats_key_source,
      personal_captured_at,
      validation_error,
      error
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? IS NULL THEN unixepoch() ELSE NULL END, ?, NULL)
    ON CONFLICT(member_id) DO UPDATE SET
      member_name = excluded.member_name,
      level = excluded.level,
      position = excluded.position,
      xantaken = COALESCE(excluded.xantaken, member_personal_stats_current.xantaken),
      overdosed = COALESCE(excluded.overdosed, member_personal_stats_current.overdosed),
      refills = COALESCE(excluded.refills, member_personal_stats_current.refills),
      useractivity = COALESCE(excluded.useractivity, member_personal_stats_current.useractivity),
      networth = COALESCE(excluded.networth, member_personal_stats_current.networth),
      daysbeendonator = COALESCE(excluded.daysbeendonator, member_personal_stats_current.daysbeendonator),
      xantaken_timestamp = COALESCE(excluded.xantaken_timestamp, member_personal_stats_current.xantaken_timestamp),
      overdosed_timestamp = COALESCE(excluded.overdosed_timestamp, member_personal_stats_current.overdosed_timestamp),
      refills_timestamp = COALESCE(excluded.refills_timestamp, member_personal_stats_current.refills_timestamp),
      useractivity_timestamp = COALESCE(excluded.useractivity_timestamp, member_personal_stats_current.useractivity_timestamp),
      networth_timestamp = COALESCE(excluded.networth_timestamp, member_personal_stats_current.networth_timestamp),
      daysbeendonator_timestamp = COALESCE(excluded.daysbeendonator_timestamp, member_personal_stats_current.daysbeendonator_timestamp),
      personalstats_bucket_date = excluded.personalstats_bucket_date,
      personalstats_requested_at = excluded.personalstats_requested_at,
      personalstats_key_source = excluded.personalstats_key_source,
      personal_captured_at = CASE
        WHEN excluded.validation_error IS NULL THEN excluded.personal_captured_at
        ELSE member_personal_stats_current.personal_captured_at
      END,
      validation_error = excluded.validation_error,
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
      stats.daysbeendonator,
      stats.xantaken_timestamp,
      stats.overdosed_timestamp,
      stats.refills_timestamp,
      stats.useractivity_timestamp,
      stats.networth_timestamp,
      stats.daysbeendonator_timestamp,
      stats.personalstats_bucket_date,
      stats.personalstats_requested_at,
      stats.personalstats_key_source,
      error,
      error,
    )
    .run();
}

async function refreshGymContributorStats(
  env: Env,
  options: { homeMembersSynced?: boolean } = {},
): Promise<{ refreshed_stats: number; updated_members: number }> {
  if (!options.homeMembersSynced) {
    await syncHomeFactionMemberList(env);
  }

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

  const homeMembers = await readHomeMembersById(env, { includeReportExempt: true });
  const statements = Array.from(contributorStats.entries()).map(([memberId, stats]) => {
    const member = homeMembers.get(memberId);
    return env.DB.prepare(
      `
      INSERT INTO member_gym_stats_current (
        member_id,
        member_name,
        level,
        position,
        gymenergy,
        gymstrength,
        gymspeed,
        gymdefense,
        gymdexterity,
        gym_captured_at,
        gym_error
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), NULL)
      ON CONFLICT(member_id) DO UPDATE SET
        member_name = COALESCE(excluded.member_name, member_gym_stats_current.member_name),
        level = COALESCE(excluded.level, member_gym_stats_current.level),
        position = COALESCE(excluded.position, member_gym_stats_current.position),
        gymenergy = COALESCE(excluded.gymenergy, member_gym_stats_current.gymenergy),
        gymstrength = COALESCE(excluded.gymstrength, member_gym_stats_current.gymstrength),
        gymspeed = COALESCE(excluded.gymspeed, member_gym_stats_current.gymspeed),
        gymdefense = COALESCE(excluded.gymdefense, member_gym_stats_current.gymdefense),
        gymdexterity = COALESCE(excluded.gymdexterity, member_gym_stats_current.gymdexterity),
        gym_captured_at = excluded.gym_captured_at,
        gym_error = excluded.gym_error
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

  const response = await trackedTornFetch(env, url, {
    headers: {
      Accept: "application/json",
      Authorization: `ApiKey ${env.TORN_API_KEY}`,
    },
  }, {
    feature: "lifestyle:contributors",
    keySource: "env:TORN_API_KEY",
    timeoutMs: LIFESTYLE_FETCH_TIMEOUT_MS,
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

async function readHomeMembersById(
  env: Env,
  options: { includeReportExempt?: boolean } = {},
): Promise<Map<number, LifestyleMemberRow>> {
  const rows = ((await env.DB.prepare(
    `
    SELECT member_id, name, level, position, updated_at AS personal_captured_at
    FROM home_faction_members
    WHERE faction_id = ?
      AND is_current = 1
      AND (? = 1 OR report_exempt = 0)
    `,
  )
    .bind(HOME_FACTION_ID, options.includeReportExempt ? 1 : 0)
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
        FROM member_personal_stats_current stats
        WHERE stats.member_id = home_faction_members.member_id
      ),
      networth_updated_at = (
        SELECT stats.personal_captured_at
        FROM member_personal_stats_current stats
        WHERE stats.member_id = home_faction_members.member_id
      ),
      updated_at = unixepoch()
    WHERE member_id IN (${placeholders})
      AND EXISTS (
        SELECT 1
        FROM member_personal_stats_current stats
        WHERE stats.member_id = home_faction_members.member_id
          AND stats.networth IS NOT NULL
          AND (
            home_faction_members.networth IS NULL
            OR home_faction_members.networth != stats.networth
            OR home_faction_members.networth_updated_at IS NULL
            OR home_faction_members.networth_updated_at != stats.personal_captured_at
          )
      )
    `,
  )
    .bind(...uniqueIds)
    .run();
}

async function writeLifestyleSnapshotForDate(
  env: Env,
  snapshotDate: string,
  options: { freshAfter?: number } = {},
): Promise<void> {
  const freshAfter = options.freshAfter ?? null;
  await env.DB.prepare(
    `
    WITH source AS (
      SELECT
        members.member_id,
        ? AS snapshot_date,
        COALESCE(personal.member_name, gym.member_name, members.name) AS member_name,
        personal.xantaken,
        personal.overdosed,
        personal.refills,
        personal.useractivity,
        personal.networth,
        personal.daysbeendonator,
        personal.xantaken_timestamp,
        personal.overdosed_timestamp,
        personal.refills_timestamp,
        personal.useractivity_timestamp,
        personal.networth_timestamp,
        personal.daysbeendonator_timestamp,
        personal.personalstats_bucket_date,
        personal.requested_at AS personalstats_requested_at,
        personal.personalstats_key_source,
        personal.error AS validation_error,
        gym.gymenergy,
        gym.gymstrength,
        gym.gymspeed,
        gym.gymdefense,
        gym.gymdexterity,
        personal.personal_captured_at,
        gym.gym_captured_at,
        CASE
          WHEN personal.personal_captured_at IS NOT NULL
            AND (? IS NULL OR personal.personal_captured_at >= ?)
            AND personal.error IS NULL
            AND personal.personalstats_bucket_date = ?
          THEN 1
          ELSE 0
        END AS personal_ready,
        CASE
          WHEN gym.gym_captured_at IS NOT NULL
            AND (? IS NULL OR gym.gym_captured_at >= ?)
            AND gym.gym_error IS NULL
          THEN 1
          ELSE 0
        END AS gym_ready
      FROM home_faction_members members
      LEFT JOIN member_personal_stats_recent personal
        ON personal.member_id = members.member_id
       AND personal.snapshot_date = ?
      LEFT JOIN member_gym_stats_current gym
        ON gym.member_id = members.member_id
      WHERE members.faction_id = ?
        AND members.is_current = 1
        AND members.report_exempt = 0
    )
    INSERT INTO member_lifestyle_stat_snapshots (
      member_id,
      snapshot_date,
      member_name,
      xantaken,
      overdosed,
      refills,
      useractivity,
      networth,
      daysbeendonator,
      xantaken_timestamp,
      overdosed_timestamp,
      refills_timestamp,
      useractivity_timestamp,
      networth_timestamp,
      daysbeendonator_timestamp,
      personalstats_bucket_date,
      personalstats_requested_at,
      personalstats_key_source,
      validation_error,
      gymenergy,
      gymstrength,
      gymspeed,
      gymdefense,
      gymdexterity,
      personal_captured_at,
      gym_captured_at,
      personal_ready,
      gym_ready,
      fully_ready,
      captured_at
    )
    SELECT
      member_id,
      snapshot_date,
      member_name,
      CASE WHEN personal_ready = 1 THEN xantaken ELSE NULL END,
      CASE WHEN personal_ready = 1 THEN overdosed ELSE NULL END,
      CASE WHEN personal_ready = 1 THEN refills ELSE NULL END,
      CASE WHEN personal_ready = 1 THEN useractivity ELSE NULL END,
      CASE WHEN personal_ready = 1 THEN networth ELSE NULL END,
      CASE WHEN personal_ready = 1 THEN daysbeendonator ELSE NULL END,
      CASE WHEN personal_ready = 1 THEN xantaken_timestamp ELSE NULL END,
      CASE WHEN personal_ready = 1 THEN overdosed_timestamp ELSE NULL END,
      CASE WHEN personal_ready = 1 THEN refills_timestamp ELSE NULL END,
      CASE WHEN personal_ready = 1 THEN useractivity_timestamp ELSE NULL END,
      CASE WHEN personal_ready = 1 THEN networth_timestamp ELSE NULL END,
      CASE WHEN personal_ready = 1 THEN daysbeendonator_timestamp ELSE NULL END,
      CASE WHEN personal_ready = 1 THEN personalstats_bucket_date ELSE NULL END,
      CASE WHEN personal_ready = 1 THEN personalstats_requested_at ELSE NULL END,
      CASE WHEN personal_ready = 1 THEN personalstats_key_source ELSE NULL END,
      CASE WHEN personal_ready = 1 THEN NULL ELSE validation_error END,
      CASE WHEN gym_ready = 1 THEN gymenergy ELSE NULL END,
      CASE WHEN gym_ready = 1 THEN gymstrength ELSE NULL END,
      CASE WHEN gym_ready = 1 THEN gymspeed ELSE NULL END,
      CASE WHEN gym_ready = 1 THEN gymdefense ELSE NULL END,
      CASE WHEN gym_ready = 1 THEN gymdexterity ELSE NULL END,
      CASE WHEN personal_ready = 1 THEN personal_captured_at ELSE NULL END,
      CASE WHEN gym_ready = 1 THEN gym_captured_at ELSE NULL END,
      personal_ready,
      gym_ready,
      CASE WHEN personal_ready = 1 AND gym_ready = 1 THEN 1 ELSE 0 END,
      unixepoch()
    FROM source
    WHERE 1 = 1
    ON CONFLICT(member_id, snapshot_date) DO UPDATE SET
      member_name = excluded.member_name,
      xantaken = CASE WHEN excluded.personal_ready = 1 THEN excluded.xantaken ELSE member_lifestyle_stat_snapshots.xantaken END,
      overdosed = CASE WHEN excluded.personal_ready = 1 THEN excluded.overdosed ELSE member_lifestyle_stat_snapshots.overdosed END,
      refills = CASE WHEN excluded.personal_ready = 1 THEN excluded.refills ELSE member_lifestyle_stat_snapshots.refills END,
      useractivity = CASE WHEN excluded.personal_ready = 1 THEN excluded.useractivity ELSE member_lifestyle_stat_snapshots.useractivity END,
      networth = CASE WHEN excluded.personal_ready = 1 THEN excluded.networth ELSE member_lifestyle_stat_snapshots.networth END,
      daysbeendonator = CASE WHEN excluded.personal_ready = 1 THEN excluded.daysbeendonator ELSE member_lifestyle_stat_snapshots.daysbeendonator END,
      xantaken_timestamp = CASE WHEN excluded.personal_ready = 1 THEN excluded.xantaken_timestamp ELSE member_lifestyle_stat_snapshots.xantaken_timestamp END,
      overdosed_timestamp = CASE WHEN excluded.personal_ready = 1 THEN excluded.overdosed_timestamp ELSE member_lifestyle_stat_snapshots.overdosed_timestamp END,
      refills_timestamp = CASE WHEN excluded.personal_ready = 1 THEN excluded.refills_timestamp ELSE member_lifestyle_stat_snapshots.refills_timestamp END,
      useractivity_timestamp = CASE WHEN excluded.personal_ready = 1 THEN excluded.useractivity_timestamp ELSE member_lifestyle_stat_snapshots.useractivity_timestamp END,
      networth_timestamp = CASE WHEN excluded.personal_ready = 1 THEN excluded.networth_timestamp ELSE member_lifestyle_stat_snapshots.networth_timestamp END,
      daysbeendonator_timestamp = CASE WHEN excluded.personal_ready = 1 THEN excluded.daysbeendonator_timestamp ELSE member_lifestyle_stat_snapshots.daysbeendonator_timestamp END,
      personalstats_bucket_date = CASE WHEN excluded.personal_ready = 1 THEN excluded.personalstats_bucket_date ELSE member_lifestyle_stat_snapshots.personalstats_bucket_date END,
      personalstats_requested_at = CASE WHEN excluded.personal_ready = 1 THEN excluded.personalstats_requested_at ELSE member_lifestyle_stat_snapshots.personalstats_requested_at END,
      personalstats_key_source = CASE WHEN excluded.personal_ready = 1 THEN excluded.personalstats_key_source ELSE member_lifestyle_stat_snapshots.personalstats_key_source END,
      validation_error = CASE
        WHEN excluded.personal_ready = 1 THEN NULL
        WHEN excluded.validation_error IS NOT NULL THEN excluded.validation_error
        WHEN member_lifestyle_stat_snapshots.personal_ready = 1 THEN member_lifestyle_stat_snapshots.validation_error
        ELSE NULL
      END,
      gymenergy = CASE WHEN excluded.gym_ready = 1 THEN excluded.gymenergy ELSE member_lifestyle_stat_snapshots.gymenergy END,
      gymstrength = CASE WHEN excluded.gym_ready = 1 THEN excluded.gymstrength ELSE member_lifestyle_stat_snapshots.gymstrength END,
      gymspeed = CASE WHEN excluded.gym_ready = 1 THEN excluded.gymspeed ELSE member_lifestyle_stat_snapshots.gymspeed END,
      gymdefense = CASE WHEN excluded.gym_ready = 1 THEN excluded.gymdefense ELSE member_lifestyle_stat_snapshots.gymdefense END,
      gymdexterity = CASE WHEN excluded.gym_ready = 1 THEN excluded.gymdexterity ELSE member_lifestyle_stat_snapshots.gymdexterity END,
      personal_captured_at = CASE WHEN excluded.personal_ready = 1 THEN excluded.personal_captured_at ELSE member_lifestyle_stat_snapshots.personal_captured_at END,
      gym_captured_at = CASE WHEN excluded.gym_ready = 1 THEN excluded.gym_captured_at ELSE member_lifestyle_stat_snapshots.gym_captured_at END,
      personal_ready = CASE WHEN excluded.personal_ready = 1 THEN 1 ELSE member_lifestyle_stat_snapshots.personal_ready END,
      gym_ready = CASE WHEN excluded.gym_ready = 1 THEN 1 ELSE member_lifestyle_stat_snapshots.gym_ready END,
      fully_ready = CASE
        WHEN (CASE WHEN excluded.personal_ready = 1 THEN 1 ELSE member_lifestyle_stat_snapshots.personal_ready END) = 1
          AND (CASE WHEN excluded.gym_ready = 1 THEN 1 ELSE member_lifestyle_stat_snapshots.gym_ready END) = 1
        THEN 1
        ELSE 0
      END,
      captured_at = excluded.captured_at
    `,
  )
    .bind(snapshotDate, freshAfter, freshAfter, snapshotDate, snapshotDate, freshAfter, freshAfter, HOME_FACTION_ID)
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

function buildDailyChartSeries(
  rows: LifestyleSnapshotRow[],
  memberIds: number[],
  homeMembers: Map<number, LifestyleMemberRow>,
  startDate: string,
  endDate: string,
  metric: LifestyleDailyChartMetric,
) {
  const dates = enumerateDateRange(startDate, endDate);
  const grouped = new Map<number, Map<string, LifestyleSnapshotRow>>();
  for (const row of rows) {
    const snapshotsByDate = grouped.get(row.member_id) ?? new Map<string, LifestyleSnapshotRow>();
    snapshotsByDate.set(row.snapshot_date, row);
    grouped.set(row.member_id, snapshotsByDate);
  }

  return memberIds.map((memberId) => {
    const member = homeMembers.get(memberId);
    const snapshotsByDate = grouped.get(memberId) ?? new Map<string, LifestyleSnapshotRow>();
    return {
      member_id: memberId,
      member_name: member?.name ?? snapshotsByDate.get(endDate)?.member_name ?? null,
      points: dates.map((date) => ({
        date,
        value: dailyChartValue(snapshotsByDate, date, metric),
      })),
    };
  });
}

function dailyChartValue(
  snapshotsByDate: Map<string, LifestyleSnapshotRow>,
  date: string,
  metric: LifestyleDailyChartMetric,
): number | null {
  const snapshot = snapshotsByDate.get(date);
  if (!snapshot) {
    return null;
  }

  if (metric === "networth") {
    return snapshot.networth;
  }

  const previousDate = dateKeyFromMs(Date.parse(`${date}T00:00:00.000Z`) - 86_400_000);
  const previousSnapshot = snapshotsByDate.get(previousDate);
  if (!previousSnapshot) {
    return null;
  }

  return delta(previousSnapshot[metric], snapshot[metric]);
}

function readLifestylePeriod(
  url: URL,
  availableRange: { start_date: string; end_date: string } | null = null,
): {
  start_date: string;
  end_date: string;
  available_start_date: string | null;
  available_end_date: string | null;
  days: number;
  max_days: number;
  capped: boolean;
} {
  const current = currentUtcMonthRange();
  const startDate = clampDateToRange(
    normalizeDateParam(url.searchParams.get("start_date")) ?? current.start_date,
    availableRange,
  );
  const endDate = clampDateToRange(
    normalizeDateParam(url.searchParams.get("end_date")) ?? current.end_date,
    availableRange,
  );
  const normalizedEnd = startDate > endDate ? startDate : endDate;
  const days = Math.max(1, dateDiffDays(startDate, normalizedEnd));
  const capped = days > MAX_LIFESTYLE_PERIOD_DAYS;
  const cappedStartDate = clampDateToRange(
    capped
      ? dateKeyFromMs(Date.parse(`${normalizedEnd}T00:00:00.000Z`) - MAX_LIFESTYLE_PERIOD_DAYS * 86_400_000)
      : startDate,
    availableRange,
  );

  return {
    start_date: cappedStartDate,
    end_date: normalizedEnd,
    available_start_date: availableRange?.start_date ?? null,
    available_end_date: availableRange?.end_date ?? null,
    days: Math.max(1, dateDiffDays(cappedStartDate, normalizedEnd)),
    max_days: MAX_LIFESTYLE_PERIOD_DAYS,
    capped,
  };
}

function clampDateToRange(
  date: string,
  range: { start_date: string; end_date: string } | null,
): string {
  if (!range) {
    return date;
  }

  if (date < range.start_date) {
    return range.start_date;
  }

  if (date > range.end_date) {
    return range.end_date;
  }

  return date;
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

function parseLifestyleDailyChartMetric(value: string | null): LifestyleDailyChartMetric | null {
  return value && LIFESTYLE_DAILY_CHART_METRICS.has(value as LifestyleDailyChartMetric)
    ? value as LifestyleDailyChartMetric
    : null;
}

function lifestyleMetricReadyColumn(metric: LifestyleDailyChartMetric): "personal_ready" | "gym_ready" {
  return GYM_CONTRIBUTOR_STAT_KEYS.includes(metric as GymContributorStatKey)
    ? "gym_ready"
    : "personal_ready";
}

function parseLifestyleDailyChartMemberIds(url: URL): number[] {
  const values = [
    ...url.searchParams.getAll("member_id"),
    ...(url.searchParams.get("member_ids")?.split(",") ?? []),
  ];
  return Array.from(
    new Set(
      values
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isInteger(value) && value > 0),
    ),
  );
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

  const adjustedXanax = Math.max(0, delta(xanaxEndpoints.first.xantaken, xanaxEndpoints.last.xantaken) - overdoses);
  return adjustedXanax / adjustedDays;
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
  return Math.max(1, calendarDateDiffDays(startDate, endDate));
}

function calendarDateDiffDays(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00.000Z`);
  const end = Date.parse(`${endDate}T00:00:00.000Z`);
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

function extractLifestyleStats(
  source: TornPersonalStatsResponse,
  options: { requestedAt: number | null; keySource: string },
): TimedLifestyleStats {
  const stats = emptyTimedLifestyleStats();
  if (!source) {
    return stats;
  }

  for (const [name, stat] of Object.entries(source)) {
    setLifestyleStat(stats, name, stat.value, stat.timestamp);
  }

  stats.personalstats_bucket_date = stats.daysbeendonator_timestamp
    ? utcDateKey(stats.daysbeendonator_timestamp)
    : null;
  stats.personalstats_requested_at = options.requestedAt;
  stats.personalstats_key_source = options.keySource;

  return stats;
}

function setLifestyleStat(
  stats: TimedLifestyleStats,
  name: string,
  value: number | null,
  timestamp: number | null,
): void {
  if (name === "timeplayed" || name === "useractivity") {
    stats.useractivity = value;
    stats.useractivity_timestamp = timestamp;
    return;
  }

  if (LIFESTYLE_STAT_KEYS.includes(name as LifestyleStatKey)) {
    stats[name as LifestyleStatKey] = value;
    stats[`${name as LifestyleStatKey}_timestamp` as LifestyleTimestampKey] = timestamp;
  }
}

function emptyLifestyleStats(): LifestyleStats {
  return Object.fromEntries(LIFESTYLE_STAT_KEYS.map((key) => [key, null])) as LifestyleStats;
}

function emptyLifestyleTimestamps(): LifestyleStatTimestamps {
  return Object.fromEntries(LIFESTYLE_STAT_KEYS.map((key) => [`${key}_timestamp`, null])) as LifestyleStatTimestamps;
}

function emptyTimedLifestyleStats(): TimedLifestyleStats {
  return {
    ...emptyLifestyleStats(),
    ...emptyLifestyleTimestamps(),
    personalstats_bucket_date: null,
    personalstats_requested_at: null,
    personalstats_key_source: null,
  };
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

function recentCompletedPersonalStatsDates(timestamp: number): string[] {
  const date = new Date(timestamp * 1000);
  const todayStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return [
    dateKeyFromMs(todayStart - 2 * 86_400_000),
    dateKeyFromMs(todayStart - 86_400_000),
  ];
}

function timestampForDailyPoll(date: string): number {
  return Math.floor(Date.parse(`${date}T00:10:00.000Z`) / 1000);
}

function utcDateKey(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

function dateKeyFromMs(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function enumerateDateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  let cursor = Date.parse(`${startDate}T00:00:00.000Z`);
  const end = Date.parse(`${endDate}T00:00:00.000Z`);
  while (cursor <= end) {
    dates.push(dateKeyFromMs(cursor));
    cursor += 86_400_000;
  }
  return dates;
}

function clampRepairCallsPerKey(value: unknown): number {
  const parsed = Number(value ?? DEFAULT_REPAIR_CALLS_PER_MINUTE_PER_KEY);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_REPAIR_CALLS_PER_MINUTE_PER_KEY;
  }
  return Math.max(1, Math.min(35, Math.floor(parsed)));
}

function parseOptionalPositiveInteger(value: unknown): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function repairKeyPauseStateName(keySource: string): string {
  return `${REPAIR_KEY_PAUSE_PREFIX}:${keySource}`;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}
