import { bumpMemberLifestyleCacheVersion } from "../cacheVersions";
import { refreshMemberAchievementSummaries } from "../memberAchievements";
import { fetchTornPersonalStatsWithTimestamps } from "../personalStats";
import { runWithTornKeyPool } from "../tornKeyPool";
import type { Env } from "../types";
import { d1Changes, nowSeconds } from "../utils";
import {
  dateKeyFromMs,
  timestampForDailyPoll,
  personalStatsBucketDate,
} from "./dates";
import {
  LIFESTYLE_STAT_KEYS,
  MAX_DAILY_XANTAKEN_DELTA,
  STALE_STATS_RECHECK_AFTER_DAY_START_SECONDS,
  STALE_STATS_RECHECK_MAX_ATTEMPTS,
  TORN_LIFESTYLE_STAT_KEYS,
  XANTAKEN_RECHECK_INITIAL_DELAY_SECONDS,
  XANTAKEN_RECHECK_MAX_ATTEMPTS,
  XANTAKEN_RECHECK_PROCESS_LIMIT,
  XANTAKEN_RECHECK_RETRY_DELAY_SECONDS,
  type LifestyleStatKey,
  type LifestyleTimestampKey,
  type TimedLifestyleStats,
  type XantakenRecheckHealthRow,
  type XantakenRecheckReason,
  type XantakenRecheckRow,
  type XantakenRecheckStatus,
} from "./model";
import { upsertLifestyleSnapshotPersonalStats } from "./internal";

type SnapshotXanaxRow = {
  member_id: number;
  snapshot_date: string;
  member_name: string | null;
  xantaken: number | null;
  personal_ready: number;
};

type NeighborContext = {
  current: SnapshotXanaxRow | null;
  previous: SnapshotXanaxRow | null;
  next: SnapshotXanaxRow | null;
};

type StoredSnapshotStats = TimedLifestyleStats & {
  member_name: string | null;
  personal_ready: number;
};

// Stats that can lag behind the rest of a member's daily Torn snapshot.
// daysbeendonator is left out: the bucket check already requires it to be current.
const RECHECKED_STAT_KEYS = ["xantaken", "overdosed", "refills", "useractivity", "networth"] as const;
type RecheckedStatKey = (typeof RECHECKED_STAT_KEYS)[number];
// Cumulative counters only go up, so a lower re-fetched value is not fresher.
const CUMULATIVE_STAT_KEYS = new Set<RecheckedStatKey>(["xantaken", "overdosed", "refills", "useractivity"]);

type QueueRecheckInput = {
  memberId: number;
  memberName: string | null;
  snapshotDate: string;
  reason: XantakenRecheckReason;
  priorXantaken: number | null;
  currentXantaken: number | null;
  nextXantaken: number | null;
  nextCheckAt: number;
};

export async function queueXantakenRecheckIfNeeded(
  env: Env,
  memberId: number,
  snapshotDate: string,
): Promise<boolean> {
  const context = await readNeighborContext(env, memberId, snapshotDate);
  if (!context.current || !context.previous) {
    return false;
  }
  if (context.current.xantaken === null || context.previous.xantaken === null) {
    return false;
  }

  const delta = context.current.xantaken - context.previous.xantaken;
  if (delta !== 0) {
    return false;
  }
  if (await hasRepeatedZeroUseHistory(env, memberId, snapshotDate)) {
    return false;
  }

  await upsertXantakenRecheck(env, {
    memberId,
    memberName: context.current.member_name,
    snapshotDate,
    reason: "zero_delta_recheck",
    priorXantaken: context.previous.xantaken,
    currentXantaken: context.current.xantaken,
    nextXantaken: context.next?.xantaken ?? null,
    nextCheckAt: nowSeconds() + XANTAKEN_RECHECK_INITIAL_DELAY_SECONDS,
  });
  return true;
}

export async function queueImpossibleXantakenDeltaIfNeeded(
  env: Env,
  memberId: number,
  snapshotDate: string,
): Promise<boolean> {
  const context = await readNeighborContext(env, memberId, snapshotDate);
  if (!context.current || !context.previous) {
    return false;
  }
  if (context.current.xantaken === null || context.previous.xantaken === null) {
    return false;
  }

  const delta = context.current.xantaken - context.previous.xantaken;
  if (delta >= 0 && delta <= MAX_DAILY_XANTAKEN_DELTA) {
    return false;
  }

  const suspectDate = previousDate(snapshotDate);
  const suspectContext = await readNeighborContext(env, memberId, suspectDate);
  if (!suspectContext.current) {
    return false;
  }

  await upsertXantakenRecheck(env, {
    memberId,
    memberName: suspectContext.current.member_name ?? context.current.member_name,
    snapshotDate: suspectDate,
    reason: "impossible_delta",
    priorXantaken: suspectContext.previous?.xantaken ?? null,
    currentXantaken: suspectContext.current.xantaken,
    nextXantaken: context.current.xantaken,
    nextCheckAt: nowSeconds(),
  });
  return true;
}

/**
 * Torn can return a member's daily snapshot with some stats still from the day
 * before. A stat whose timestamp predates the day either did not change that day
 * or has not caught up yet, so re-fetch the day once it is two days old.
 * Does nothing when the day already has a recheck queued for another reason.
 */
export async function queueStaleStatsRecheckIfNeeded(
  env: Env,
  memberId: number,
  snapshotDate: string,
): Promise<boolean> {
  const stored = await readStoredSnapshotStats(env, memberId, snapshotDate);
  if (!stored || stored.personal_ready !== 1) {
    return false;
  }

  const dayStart = timestampForDailyPoll(snapshotDate);
  if (!RECHECKED_STAT_KEYS.some((key) => (stored[`${key}_timestamp`] ?? 0) < dayStart)) {
    return false;
  }

  const now = nowSeconds();
  const result = await env.DB.prepare(
    `
    INSERT INTO member_lifestyle_xantaken_rechecks (
      member_id,
      snapshot_date,
      member_name,
      status,
      reason,
      requested_at,
      prior_xantaken,
      current_xantaken,
      next_xantaken,
      attempts,
      max_attempts,
      next_check_at,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, 'pending', 'stale_stats_recheck', ?, NULL, ?, NULL, 0, ?, ?, ?, ?)
    ON CONFLICT(member_id, snapshot_date) DO NOTHING
    `,
  )
    .bind(
      memberId,
      snapshotDate,
      stored.member_name,
      dayStart,
      stored.xantaken,
      STALE_STATS_RECHECK_MAX_ATTEMPTS,
      Math.max(now + XANTAKEN_RECHECK_INITIAL_DELAY_SECONDS, dayStart + STALE_STATS_RECHECK_AFTER_DAY_START_SECONDS),
      now,
      now,
    )
    .run();
  return d1Changes(result) > 0;
}

export async function evaluateXantakenSnapshotForRechecks(
  env: Env,
  memberId: number,
  snapshotDate: string,
): Promise<void> {
  await queueXantakenRecheckIfNeeded(env, memberId, snapshotDate);
  await queueImpossibleXantakenDeltaIfNeeded(env, memberId, snapshotDate);
  await queueStaleStatsRecheckIfNeeded(env, memberId, snapshotDate);
}

export async function processXantakenRechecks(
  env: Env,
  options: { limit?: number; now?: number } = {},
): Promise<{
  processed: number;
  auto_fixed: number;
  confirmed_zero: number;
  needs_repair: number;
  failed: number;
  skipped: boolean;
}> {
  const now = options.now ?? nowSeconds();
  const limit = Math.max(1, Math.min(Math.floor(options.limit ?? XANTAKEN_RECHECK_PROCESS_LIMIT), XANTAKEN_RECHECK_PROCESS_LIMIT));
  const rows = ((await env.DB.prepare(
    `
    SELECT *
    FROM member_lifestyle_xantaken_rechecks
    WHERE status = 'pending'
      AND next_check_at <= ?
    ORDER BY
      CASE WHEN reason = 'impossible_delta' THEN 0 ELSE 1 END,
      next_check_at ASC,
      snapshot_date ASC,
      member_id ASC
    LIMIT ?
    `,
  )
    .bind(now, limit)
    .all()).results ?? []) as XantakenRecheckRow[];

  if (rows.length === 0) {
    return { processed: 0, auto_fixed: 0, confirmed_zero: 0, needs_repair: 0, failed: 0, skipped: true };
  }

  let autoFixed = 0;
  let confirmedZero = 0;
  let needsRepair = 0;
  let failed = 0;

  for (const row of rows) {
    const result = await processXantakenRecheck(env, row, now);
    if (result === "auto_fixed") autoFixed += 1;
    if (result === "confirmed_zero") confirmedZero += 1;
    if (result === "needs_repair") needsRepair += 1;
    if (result === "failed") failed += 1;
  }

  return {
    processed: rows.length,
    auto_fixed: autoFixed,
    confirmed_zero: confirmedZero,
    needs_repair: needsRepair,
    failed,
    skipped: false,
  };
}

export async function readXantakenRecheckHealth(env: Env, now = nowSeconds()): Promise<XantakenRecheckHealthRow> {
  const row = await env.DB.prepare(
    `
    SELECT
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_rechecks,
      SUM(CASE WHEN status = 'auto_fixed' AND COALESCE(finished_at, updated_at) >= ? THEN 1 ELSE 0 END) AS auto_fixed_24h,
      SUM(CASE WHEN status = 'needs_repair' THEN 1 ELSE 0 END) AS needs_repair
    FROM member_lifestyle_xantaken_rechecks
    `,
  )
    .bind(now - 24 * 60 * 60)
    .first<XantakenRecheckHealthRow>();

  return {
    pending_rechecks: Number(row?.pending_rechecks ?? 0),
    auto_fixed_24h: Number(row?.auto_fixed_24h ?? 0),
    needs_repair: Number(row?.needs_repair ?? 0),
  };
}

async function processXantakenRecheck(
  env: Env,
  row: XantakenRecheckRow,
  now: number,
): Promise<XantakenRecheckStatus> {
  try {
    const fetched = await runWithTornKeyPool(env, {
      feature: "faction_lifestyle_stats",
      run: ({ key, keySource }) => fetchTornPersonalStatsWithTimestamps(env, row.member_id, TORN_LIFESTYLE_STAT_KEYS, {
        timestamp: row.requested_at,
        apiKey: key,
        keySource,
      }),
    });
    const stats = extractTimedLifestyleStats(fetched.result, {
      requestedAt: row.requested_at,
      keySource: fetched.candidate.keySource,
    });

    if (stats.personalstats_bucket_date !== row.snapshot_date) {
      return await deferOrFinish(env, row, {
        status: row.attempts + 1 >= row.max_attempts ? "failed" : "pending",
        now,
        returnedBucketDate: stats.personalstats_bucket_date,
        returnedXantaken: stats.xantaken,
        keySource: stats.personalstats_key_source,
        error: `Bucket mismatch: expected ${row.snapshot_date}, received ${stats.personalstats_bucket_date ?? "none"}`,
      });
    }

    if (stats.xantaken === null) {
      return await deferOrFinish(env, row, {
        status: row.attempts + 1 >= row.max_attempts ? "failed" : "pending",
        now,
        returnedBucketDate: stats.personalstats_bucket_date,
        returnedXantaken: null,
        keySource: stats.personalstats_key_source,
        error: "xantaken was not returned",
      });
    }

    const context = await readNeighborContext(env, row.member_id, row.snapshot_date);
    const stored = await readStoredSnapshotStats(env, row.member_id, row.snapshot_date);
    const currentValue = context.current?.xantaken ?? row.current_xantaken;
    const xantakenIncreased = currentValue !== null && stats.xantaken > currentValue;
    if (xantakenIncreased && !fitsNeighborConstraints(stats.xantaken, context.previous?.xantaken ?? null, context.next?.xantaken ?? row.next_xantaken)) {
      return await finishRecheck(env, row, {
        status: "needs_repair",
        now,
        returnedBucketDate: stats.personalstats_bucket_date,
        returnedXantaken: stats.xantaken,
        keySource: stats.personalstats_key_source,
        error: "Returned xantaken does not fit neighboring daily limits",
      });
    }

    const fixedKeys: RecheckedStatKey[] = [
      ...(stored ? fresherStatKeys(stored, stats) : []),
      ...(xantakenIncreased ? ["xantaken" as const] : []),
    ];
    if (fixedKeys.length > 0) {
      // Only take the stats that are fresher than what was saved, so a stat that
      // happens to come back behind on this fetch cannot overwrite a newer one.
      const fixed = stored ? withRefreshedStats(stored, stats, fixedKeys) : stats;
      await upsertLifestyleSnapshotPersonalStats(env, {
        member_id: row.member_id,
        member_name: row.member_name,
        snapshot_date: row.snapshot_date,
      }, fixed);
      await updateRecentPersonalStatsFromRecheck(env, row, fixed);
    }

    // Xanax rechecks stay open until xantaken itself is settled, even if other
    // stats were corrected on this fetch.
    if (xantakenIncreased || (row.reason === "stale_stats_recheck" && fixedKeys.length > 0)) {
      await finishRecheck(env, row, {
        status: "auto_fixed",
        now,
        returnedBucketDate: stats.personalstats_bucket_date,
        returnedXantaken: stats.xantaken,
        keySource: stats.personalstats_key_source,
        error: null,
      });
      await refreshMemberAchievementSummaries(env, row.snapshot_date);
      await bumpMemberLifestyleCacheVersion(env);
      await evaluateXantakenSnapshotForRechecks(env, row.member_id, row.snapshot_date);
      const next = nextDate(row.snapshot_date);
      await queueImpossibleXantakenDeltaIfNeeded(env, row.member_id, next);
      return "auto_fixed";
    }

    if (fixedKeys.length > 0) {
      await refreshMemberAchievementSummaries(env, row.snapshot_date);
      await bumpMemberLifestyleCacheVersion(env);
    }

    if (row.reason === "stale_stats_recheck") {
      // A day that is two days old and still unchanged did not change that day.
      return await finishRecheck(env, row, {
        status: "confirmed_zero",
        now,
        returnedBucketDate: stats.personalstats_bucket_date,
        returnedXantaken: stats.xantaken,
        keySource: stats.personalstats_key_source,
        error: null,
      });
    }

    if (row.reason === "impossible_delta") {
      return await finishRecheck(env, row, {
        status: "needs_repair",
        now,
        returnedBucketDate: stats.personalstats_bucket_date,
        returnedXantaken: stats.xantaken,
        keySource: stats.personalstats_key_source,
        error: "Impossible xantaken delta persisted after recheck",
      });
    }

    return await deferOrFinish(env, row, {
      status: row.attempts + 1 >= row.max_attempts ? "confirmed_zero" : "pending",
      now,
      returnedBucketDate: stats.personalstats_bucket_date,
      returnedXantaken: stats.xantaken,
      keySource: stats.personalstats_key_source,
      error: row.attempts + 1 >= row.max_attempts ? null : "Zero delta still present",
    });
  } catch (err: any) {
    return await deferOrFinish(env, row, {
      status: row.attempts + 1 >= row.max_attempts ? "failed" : "pending",
      now,
      returnedBucketDate: null,
      returnedXantaken: null,
      keySource: null,
      error: err?.message || String(err),
    });
  }
}

async function readNeighborContext(env: Env, memberId: number, snapshotDate: string): Promise<NeighborContext> {
  const previous = previousDate(snapshotDate);
  const next = nextDate(snapshotDate);
  const rows = ((await env.DB.prepare(
    `
    SELECT member_id, snapshot_date, member_name, xantaken, personal_ready
    FROM member_lifestyle_stat_snapshots
    WHERE member_id = ?
      AND snapshot_date IN (?, ?, ?)
    `,
  )
    .bind(memberId, previous, snapshotDate, next)
    .all()).results ?? []) as SnapshotXanaxRow[];
  const byDate = new Map(rows.map((row) => [row.snapshot_date, row]));
  return {
    previous: byDate.get(previous) ?? null,
    current: byDate.get(snapshotDate) ?? null,
    next: byDate.get(next) ?? null,
  };
}

async function hasRepeatedZeroUseHistory(env: Env, memberId: number, snapshotDate: string): Promise<boolean> {
  const rows = ((await env.DB.prepare(
    `
    WITH ordered AS (
      SELECT
        snapshot_date,
        xantaken,
        LAG(xantaken) OVER (ORDER BY snapshot_date) AS previous_xantaken
      FROM member_lifestyle_stat_snapshots
      WHERE member_id = ?
        AND snapshot_date < ?
        AND personal_ready = 1
        AND xantaken IS NOT NULL
      ORDER BY snapshot_date DESC
      LIMIT 8
    )
    SELECT xantaken, previous_xantaken
    FROM ordered
    WHERE previous_xantaken IS NOT NULL
    `,
  )
    .bind(memberId, snapshotDate)
    .all()).results ?? []) as Array<{ xantaken: number | null; previous_xantaken: number | null }>;

  let validDeltas = 0;
  let zeroDeltas = 0;
  let impossibleDeltas = 0;
  for (const row of rows) {
    if (row.xantaken === null || row.previous_xantaken === null) continue;
    const delta = row.xantaken - row.previous_xantaken;
    if (delta < 0 || delta > MAX_DAILY_XANTAKEN_DELTA) {
      impossibleDeltas += 1;
      continue;
    }
    validDeltas += 1;
    if (delta === 0) zeroDeltas += 1;
  }

  return impossibleDeltas === 0 && validDeltas >= 4 && zeroDeltas >= 4;
}

async function upsertXantakenRecheck(env: Env, input: QueueRecheckInput): Promise<void> {
  const now = nowSeconds();
  await env.DB.prepare(
    `
    INSERT INTO member_lifestyle_xantaken_rechecks (
      member_id,
      snapshot_date,
      member_name,
      status,
      reason,
      requested_at,
      prior_xantaken,
      current_xantaken,
      next_xantaken,
      attempts,
      max_attempts,
      next_check_at,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
    ON CONFLICT(member_id, snapshot_date) DO UPDATE SET
      member_name = excluded.member_name,
      status = CASE
        WHEN member_lifestyle_xantaken_rechecks.status IN ('auto_fixed', 'confirmed_zero')
          AND excluded.reason != 'impossible_delta'
        THEN member_lifestyle_xantaken_rechecks.status
        ELSE 'pending'
      END,
      reason = CASE
        WHEN excluded.reason = 'impossible_delta' THEN excluded.reason
        ELSE member_lifestyle_xantaken_rechecks.reason
      END,
      prior_xantaken = excluded.prior_xantaken,
      current_xantaken = excluded.current_xantaken,
      next_xantaken = excluded.next_xantaken,
      next_check_at = CASE
        WHEN excluded.reason = 'impossible_delta' THEN excluded.next_check_at
        ELSE MIN(member_lifestyle_xantaken_rechecks.next_check_at, excluded.next_check_at)
      END,
      last_error = NULL,
      finished_at = NULL,
      updated_at = excluded.updated_at
    WHERE member_lifestyle_xantaken_rechecks.status != 'needs_repair'
    `,
  )
    .bind(
      input.memberId,
      input.snapshotDate,
      input.memberName,
      input.reason,
      timestampForDailyPoll(input.snapshotDate),
      input.priorXantaken,
      input.currentXantaken,
      input.nextXantaken,
      XANTAKEN_RECHECK_MAX_ATTEMPTS,
      input.nextCheckAt,
      now,
      now,
    )
    .run();
}

async function deferOrFinish(
  env: Env,
  row: XantakenRecheckRow,
  options: {
    status: XantakenRecheckStatus;
    now: number;
    returnedBucketDate: string | null;
    returnedXantaken: number | null;
    keySource: string | null;
    error: string | null;
  },
): Promise<XantakenRecheckStatus> {
  if (options.status === "pending") {
    await env.DB.prepare(
      `
      UPDATE member_lifestyle_xantaken_rechecks
      SET attempts = attempts + 1,
          next_check_at = ?,
          returned_bucket_date = ?,
          returned_xantaken = ?,
          key_source = COALESCE(?, key_source),
          last_error = ?,
          updated_at = ?
      WHERE member_id = ?
        AND snapshot_date = ?
      `,
    )
      .bind(
        options.now + XANTAKEN_RECHECK_RETRY_DELAY_SECONDS,
        options.returnedBucketDate,
        options.returnedXantaken,
        options.keySource,
        options.error,
        options.now,
        row.member_id,
        row.snapshot_date,
      )
      .run();
    return "pending";
  }

  return finishRecheck(env, row, {
    ...options,
    status: options.status,
  } as {
    status: Exclude<XantakenRecheckStatus, "pending">;
    now: number;
    returnedBucketDate: string | null;
    returnedXantaken: number | null;
    keySource: string | null;
    error: string | null;
  });
}

async function finishRecheck(
  env: Env,
  row: XantakenRecheckRow,
  options: {
    status: Exclude<XantakenRecheckStatus, "pending">;
    now: number;
    returnedBucketDate: string | null;
    returnedXantaken: number | null;
    keySource: string | null;
    error: string | null;
  },
): Promise<XantakenRecheckStatus> {
  await env.DB.prepare(
    `
    UPDATE member_lifestyle_xantaken_rechecks
    SET status = ?,
        attempts = attempts + 1,
        returned_bucket_date = ?,
        returned_xantaken = ?,
        key_source = COALESCE(?, key_source),
        last_error = ?,
        finished_at = ?,
        updated_at = ?
    WHERE member_id = ?
      AND snapshot_date = ?
    `,
  )
    .bind(
      options.status,
      options.returnedBucketDate,
      options.returnedXantaken,
      options.keySource,
      options.error,
      options.now,
      options.now,
      row.member_id,
      row.snapshot_date,
    )
    .run();
  return options.status;
}

async function updateRecentPersonalStatsFromRecheck(
  env: Env,
  row: XantakenRecheckRow,
  stats: TimedLifestyleStats,
): Promise<number> {
  const result = await env.DB.prepare(
    `
    UPDATE member_personal_stats_recent
    SET member_name = COALESCE(?, member_name),
        xantaken = ?,
        overdosed = ?,
        refills = ?,
        useractivity = ?,
        networth = ?,
        daysbeendonator = ?,
        xantaken_timestamp = ?,
        overdosed_timestamp = ?,
        refills_timestamp = ?,
        useractivity_timestamp = ?,
        networth_timestamp = ?,
        daysbeendonator_timestamp = ?,
        personalstats_bucket_date = ?,
        target_timestamp = ?,
        attempted_at = unixepoch(),
        personalstats_key_source = ?,
        personal_captured_at = unixepoch(),
        status = 'completed',
        error = NULL,
        updated_at = unixepoch()
    WHERE member_id = ?
      AND snapshot_date = ?
    `,
  )
    .bind(
      row.member_name,
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
      row.requested_at,
      stats.personalstats_key_source,
      row.member_id,
      row.snapshot_date,
    )
    .run();
  return d1Changes(result);
}

async function readStoredSnapshotStats(
  env: Env,
  memberId: number,
  snapshotDate: string,
): Promise<StoredSnapshotStats | null> {
  return (await env.DB.prepare(
    `
    SELECT
      member_name,
      personal_ready,
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
      personalstats_key_source
    FROM member_lifestyle_stat_snapshots
    WHERE member_id = ?
      AND snapshot_date = ?
    LIMIT 1
    `,
  )
    .bind(memberId, snapshotDate)
    .first<StoredSnapshotStats>()) ?? null;
}

/** Stats (other than xantaken) that Torn has since recorded a later change for. */
export function fresherStatKeys(stored: TimedLifestyleStats, fetched: TimedLifestyleStats): RecheckedStatKey[] {
  return RECHECKED_STAT_KEYS.filter((key) => {
    if (key === "xantaken") return false;
    const value = fetched[key];
    const previous = stored[key];
    if (value === null || value === previous) return false;
    if ((fetched[`${key}_timestamp`] ?? 0) <= (stored[`${key}_timestamp`] ?? 0)) return false;
    return !CUMULATIVE_STAT_KEYS.has(key) || previous === null || value > previous;
  });
}

function withRefreshedStats(
  stored: TimedLifestyleStats,
  fetched: TimedLifestyleStats,
  keys: RecheckedStatKey[],
): TimedLifestyleStats {
  const merged: TimedLifestyleStats = {
    ...emptyTimedLifestyleStats(),
    ...Object.fromEntries(LIFESTYLE_STAT_KEYS.flatMap((key) => [
      [key, stored[key]],
      [`${key}_timestamp`, stored[`${key}_timestamp`]],
    ])),
    personalstats_bucket_date: fetched.personalstats_bucket_date,
    personalstats_requested_at: fetched.personalstats_requested_at,
    personalstats_key_source: fetched.personalstats_key_source,
  };
  for (const key of keys) {
    merged[key] = fetched[key];
    merged[`${key}_timestamp`] = fetched[`${key}_timestamp`];
  }
  return merged;
}

function fitsNeighborConstraints(value: number, previous: number | null, next: number | null): boolean {
  if (previous !== null) {
    const delta = value - previous;
    if (delta < 0 || delta > MAX_DAILY_XANTAKEN_DELTA) return false;
  }
  if (next !== null) {
    const delta = next - value;
    if (delta < 0 || delta > MAX_DAILY_XANTAKEN_DELTA) return false;
  }
  return true;
}

function extractTimedLifestyleStats(
  source: Record<string, { value: number | null; timestamp: number | null }>,
  options: { requestedAt: number; keySource: string },
): TimedLifestyleStats {
  const stats = emptyTimedLifestyleStats();
  for (const [name, stat] of Object.entries(source)) {
    setLifestyleStat(stats, name, stat.value, stat.timestamp);
  }
  stats.personalstats_bucket_date = personalStatsBucketDate(stats, options.requestedAt);
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

function emptyTimedLifestyleStats(): TimedLifestyleStats {
  const values = Object.fromEntries(LIFESTYLE_STAT_KEYS.map((key) => [key, null]));
  const timestamps = Object.fromEntries(LIFESTYLE_STAT_KEYS.map((key) => [`${key}_timestamp`, null]));
  return {
    ...values,
    ...timestamps,
    personalstats_bucket_date: null,
    personalstats_requested_at: null,
    personalstats_key_source: null,
  } as TimedLifestyleStats;
}

function previousDate(snapshotDate: string): string {
  return dateKeyFromMs(Date.parse(`${snapshotDate}T00:00:00.000Z`) - 86_400_000);
}

function nextDate(snapshotDate: string): string {
  return dateKeyFromMs(Date.parse(`${snapshotDate}T00:00:00.000Z`) + 86_400_000);
}
