import { bumpMemberLifestyleCacheVersion } from "../cacheVersions";
import { refreshMemberAchievementSummaries } from "../memberAchievements";
import { readSyncTimestamp, upsertSyncTimestamp } from "../syncState";
import { Env } from "../types";
import { chunkArray, d1Changes, json, nowSeconds } from "../utils";
import {
  TornPersonalStatsHttpError,
} from "../personalStats";
import {
  dateDiffDays,
  dateKeyFromMs,
  enumerateDateRange,
  normalizeDateParam,
  timestampForDailyPoll,
} from "./dates";
import {
  DEFAULT_REPAIR_CALLS_PER_MINUTE_PER_KEY,
  MAX_REPAIR_DATE_RANGE_DAYS,
  REPAIR_FAILURE_ALERT_PREFIX,
  REPAIR_JOB_PROCESS_LIMIT_SECONDS,
  REPAIR_KEY_PAUSE_PREFIX,
} from "./model";
import type {
  LifestyleRepairItemRow,
  LifestyleRepairJobRow,
  RepairItemStatus,
  RepairJobStatus,
  RepairKey,
  TimedLifestyleStats,
} from "./model";
import {
  syncHomeFactionMemberList,
  upsertLifestyleSnapshotPersonalStats,
} from "./internal";
import {
  fetchMemberPersonalStats,
  personalStatsDataQualityError,
} from "./dailyPersonal";
import { readHomeMembersById } from "./queries";

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

  for (const batch of chunkArray(statements, 50)) {
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
