import { HOME_FACTION_ID } from "../constants";
import { bumpMemberLifestyleCacheVersion } from "../cacheVersions";
import { refreshMemberAchievementSummaries } from "../memberAchievements";
import {
  fetchTornPersonalStatsWithTimestamps,
  TornPersonalStatsResponse,
} from "../personalStats";
import { claimDailyBatchGate } from "../scheduledGates";
import { upsertSyncTimestamp } from "../syncState";
import { Env } from "../types";
import { nowSeconds } from "../utils";
import {
  dailyRefreshReadyAt,
  recentCompletedPersonalStatsDates,
  timestampForDailyPoll,
  utcDateKey,
} from "./dates";
import {
  DAILY_LIFESTYLE_COMPLETE_STATE_NAME,
  DAILY_LIFESTYLE_LOCK_SECONDS,
  DAILY_LIFESTYLE_LOCK_STATE_NAME,
  DAILY_LIFESTYLE_REFRESH_LIMIT,
  EXPIRED_PERSONAL_STATS_RETRY_LIMIT,
  LIFESTYLE_STAT_KEYS,
  MISSING_DONATOR_DAYS_ERROR_CODE,
  MISSING_PERSONALSTATS_BUCKET_ERROR_CODE,
  OLD_PERSONALSTATS_BUCKET_ERROR_CODE,
  PERSONALSTATS_BUCKET_MISMATCH_ERROR_CODE,
  RETRY_EXPIRED_PERSONALSTATS_ERROR_CODE,
  TORN_LIFESTYLE_STAT_KEYS,
} from "./model";
import type {
  LifestyleStatKey,
  LifestyleStats,
  LifestyleStatTimestamps,
  LifestyleTimestampKey,
  PersonalStatsRecentRow,
  PersonalStatsRecentStatus,
  TimedLifestyleStats,
} from "./model";
import {
  syncHomeFactionMemberList,
  upsertLifestyleSnapshotPersonalStats,
  writeLifestyleSnapshotForDate,
} from "./internal";

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
  let refreshed = 0;
  let failed = 0;

  for (const queueRow of members) {
    try {
      const stats = await fetchMemberPersonalStats(env, queueRow.member_id, {
        requestedAt: queueRow.target_timestamp,
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
        await updateHomeFactionMemberNetworth(env, queueRow.member_id, stats);
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
          await updateHomeFactionMemberNetworth(env, queueRow.member_id, stats);
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
        target_timestamp,
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
        target_timestamp = excluded.target_timestamp,
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
      target_timestamp,
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
        CAST(strftime('%s', snapshots.snapshot_date || ' 00:00:00') AS INTEGER)
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
        recent.target_timestamp,
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
        recent.target_timestamp,
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
      AND (
        members.days_in_faction IS NULL
        OR members.updated_at IS NULL
        OR ? > date(members.updated_at, 'unixepoch', '-' || members.days_in_faction || ' days')
      )
      AND snapshots.member_id IS NULL
    LIMIT 1
    `,
  )
    .bind(targetSnapshotDate, HOME_FACTION_ID, targetSnapshotDate)
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

export async function fetchMemberPersonalStats(
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

export function personalStatsDataQualityError(
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
      target_timestamp,
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
      target_timestamp = excluded.target_timestamp,
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

async function updateHomeFactionMemberNetworth(
  env: Env,
  memberId: number,
  stats: TimedLifestyleStats,
): Promise<void> {
  if (stats.networth === null) {
    return;
  }

  await env.DB.prepare(
    `
    UPDATE home_faction_members
    SET networth = ?,
        networth_updated_at = unixepoch(),
        updated_at = unixepoch()
    WHERE member_id = ?
      AND faction_id = ?
      AND (
        networth IS NULL
        OR networth != ?
        OR networth_updated_at IS NULL
      )
    `,
  )
    .bind(stats.networth, memberId, HOME_FACTION_ID, stats.networth)
    .run();
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


