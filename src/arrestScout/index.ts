import {
  boundedInteger,
  cleanString,
  positiveIntegerOrNull,
  readJsonObject,
} from "../backend/request";
import { fetchTornPersonalStatsWithTimestamps, type TornPersonalStatsResponse } from "../personalStats";
import {
  readAvailableTornApiKeys,
  recordTornKeyUse,
  sortCandidatesForFeature,
  type TornKeyPoolCandidate,
} from "../tornKeyPool";
import type { Env } from "../types";
import { json, nowSeconds } from "../utils";
import {
  ARREST_SCOUT_STAT_KEYS,
  DEFAULT_LOOKBACK_DAYS,
  DEFAULT_MIN_COUNTERFEITING_DELTA,
  DEFAULT_REQUIRED_FORGERYSKILL,
  MAX_TARGETS_PER_SCAN,
  type ArrestScoutFutureTargetRow,
  type ArrestScoutResultRow,
  type ArrestScoutScanResponse,
  type ArrestScoutSettings,
  type ArrestScoutSnapshotRow,
  type ArrestScoutSourceType,
  type ArrestScoutStatTimestamps,
  type ArrestScoutTargetStats,
} from "./model";
import { classifyArrestScoutTarget } from "./scoring";

type ScanPayload = {
  source_type: ArrestScoutSourceType;
  target_user_ids: number[];
  lookback_days: number;
  settings: ArrestScoutSettings;
};

type PendingResult = Omit<ArrestScoutResultRow, "created_at">;

export async function scanArrestScout(
  request: Request,
  env: Env,
  scannedByTornUserId: number | null,
): Promise<Response> {
  const validated = await readScanPayload(request, env);
  if ("response" in validated) {
    return validated.response;
  }

  const payload = validated.payload;
  const snapshotId = crypto.randomUUID();
  const scannedAt = nowSeconds();
  const historicalTimestamp = scannedAt - payload.settings.lookback_seconds;
  const results: PendingResult[] = [];
  const keyCandidates = await readAvailableTornApiKeys(env, "arrest_scout", scannedAt);

  if (keyCandidates.length === 0) {
    return json(
      {
        ok: false,
        error: "No eligible Torn API key is available for Arrest Scout",
        code: "NO_TORN_KEYS_AVAILABLE",
      },
      503,
    );
  }

  for (const [index, targetUserId] of payload.target_user_ids.entries()) {
    results.push(
      await scanOneTarget(env, {
        targetUserId,
        rowId: `${snapshotId}:${index}`,
        snapshotId,
        keyCandidates,
        settings: payload.settings,
        historicalTimestamp,
      }),
    );
  }

  const counts = countResults(results);
  const status = counts.error_count > 0 && counts.error_count < results.length
    ? "partial_error"
    : counts.error_count === results.length && results.length > 0
      ? "error"
      : "ok";
  const snapshot: Omit<ArrestScoutSnapshotRow, "error"> & { error: string | null } = {
    id: snapshotId,
    source_type: payload.source_type,
    source_faction_id: null,
    scanned_by_torn_user_id: scannedByTornUserId,
    scanned_at: scannedAt,
    lookback_seconds: payload.settings.lookback_seconds,
    min_counterfeiting_delta: payload.settings.min_counterfeiting_delta,
    status,
    error: status === "ok" ? null : `${counts.error_count} target scan error${counts.error_count === 1 ? "" : "s"}`,
    settings_json: JSON.stringify({
      source: payload.source_type,
      target_user_ids: payload.target_user_ids,
      lookback_days: payload.lookback_days,
      min_counterfeiting_delta: payload.settings.min_counterfeiting_delta,
      required_forgeryskill: payload.settings.required_forgeryskill,
      key_sources: Array.from(new Set(keyCandidates.map((key) => key.keySource))),
    }),
    target_count: payload.target_user_ids.length,
    checked_count: results.length,
    skill_100_count: counts.skill_100_count,
    current_target_count: counts.current_target_count,
    future_target_count: counts.future_target_count,
    inactive_count: counts.inactive_count,
    ignored_count: counts.ignored_count,
    error_count: counts.error_count,
  };

  await saveSnapshotAndResults(env, snapshot, results, scannedAt, payload.settings.lookback_seconds, payload.source_type);

  const savedResults = await readResultsForSnapshot(env, snapshotId);
  const response: ArrestScoutScanResponse = {
    ok: status !== "error",
    snapshot_id: snapshotId,
    source_type: payload.source_type,
    lookback_days: payload.lookback_days,
    min_counterfeiting_delta: payload.settings.min_counterfeiting_delta,
    target_count: snapshot.target_count,
    checked_count: snapshot.checked_count,
    skill_100_count: snapshot.skill_100_count,
    current_target_count: snapshot.current_target_count,
    future_target_count: snapshot.future_target_count,
    inactive_count: snapshot.inactive_count,
    ignored_count: snapshot.ignored_count,
    error_count: snapshot.error_count,
    current_targets: savedResults.filter((row) => row.classification === "current_target"),
    future_targets: savedResults.filter((row) => row.classification === "future_target"),
    results: savedResults,
  };

  return json(response, status === "error" ? 502 : 200);
}

export async function listArrestScoutSnapshots(env: Env): Promise<Response> {
  const rows = await env.DB.prepare(
    `
    SELECT *
    FROM arrest_scout_snapshots
    ORDER BY scanned_at DESC
    LIMIT 50
    `,
  ).all<ArrestScoutSnapshotRow>();

  return json({
    ok: true,
    snapshots: rows.results ?? [],
  });
}

export async function getArrestScoutSnapshot(env: Env, snapshotId: string): Promise<Response> {
  const snapshot = await env.DB.prepare(
    `
    SELECT *
    FROM arrest_scout_snapshots
    WHERE id = ?
    LIMIT 1
    `,
  )
    .bind(snapshotId)
    .first<ArrestScoutSnapshotRow>();

  if (!snapshot) {
    return json({ ok: false, error: "Snapshot not found", code: "SNAPSHOT_NOT_FOUND" }, 404);
  }

  return json({
    ok: true,
    snapshot,
    results: await readResultsForSnapshot(env, snapshotId),
  });
}

export async function listArrestScoutFutureTargets(env: Env): Promise<Response> {
  const rows = await env.DB.prepare(
    `
    SELECT *
    FROM arrest_scout_future_targets
    ORDER BY
      next_check_after IS NULL ASC,
      next_check_after ASC,
      best_score DESC
    LIMIT 250
    `,
  ).all<ArrestScoutFutureTargetRow>();

  return json({
    ok: true,
    future_targets: rows.results ?? [],
  });
}

async function scanOneTarget(
  env: Env,
  input: {
    targetUserId: number;
    rowId: string;
    snapshotId: string;
    keyCandidates: TornKeyPoolCandidate[];
    settings: ArrestScoutSettings;
    historicalTimestamp: number;
  },
): Promise<PendingResult> {
  try {
    const currentStats = await fetchStats(env, input.targetUserId, input.keyCandidates);
    const current = targetStatsFromPersonalStats(currentStats);
    const currentTimestamps = statTimestampsFromPersonalStats(currentStats);

    if (current.forgeryskill !== input.settings.required_forgeryskill) {
      const classified = classifyArrestScoutTarget(current, null, input.settings);
      return resultFromClassification(input, classified, currentTimestamps, emptyTimestamps(), currentStats, null);
    }

    const historicalStats = await fetchStats(env, input.targetUserId, input.keyCandidates, input.historicalTimestamp);
    const classified = classifyArrestScoutTarget(
      current,
      targetStatsFromPersonalStats(historicalStats),
      input.settings,
    );

    return resultFromClassification(
      input,
      classified,
      currentTimestamps,
      statTimestampsFromPersonalStats(historicalStats),
      currentStats,
      historicalStats,
    );
  } catch (err) {
    return errorResult(input, err);
  }
}

async function fetchStats(
  env: Env,
  targetUserId: number,
  keyCandidates: TornKeyPoolCandidate[],
  timestamp?: number,
): Promise<TornPersonalStatsResponse> {
  const candidate = chooseNextCandidate(keyCandidates);
  if (!candidate) {
    throw new Error("No eligible Torn API key is currently under its minute limit");
  }

  try {
    return await fetchTornPersonalStatsWithTimestamps(env, targetUserId, ARREST_SCOUT_STAT_KEYS, {
      apiKey: candidate.key,
      keySource: candidate.keySource,
      ...(timestamp ? { timestamp } : {}),
    });
  } finally {
    candidate.currentMinuteUsage += 1;
    await recordTornKeyUse(env, candidate, "arrest_scout");
  }
}

function resultFromClassification(
  input: {
    targetUserId: number;
    rowId: string;
    snapshotId: string;
    settings: ArrestScoutSettings;
    historicalTimestamp: number;
  },
  classified: ReturnType<typeof classifyArrestScoutTarget>,
  currentTimestamps: ArrestScoutStatTimestamps,
  historicalTimestamps: ArrestScoutStatTimestamps,
  currentStats: TornPersonalStatsResponse | null,
  historicalStats: TornPersonalStatsResponse | null,
): PendingResult {
  return {
    id: input.rowId,
    snapshot_id: input.snapshotId,
    target_user_id: input.targetUserId,
    name: null,
    classification: classified.classification,
    score: classified.score,
    current_forgeryskill: classified.current_forgeryskill,
    current_counterfeiting: classified.current_counterfeiting,
    historical_counterfeiting: classified.historical_counterfeiting,
    counterfeiting_delta: classified.counterfeiting_delta,
    current_jailed: classified.current_jailed,
    historical_jailed: classified.historical_jailed,
    jailed_delta: classified.jailed_delta,
    current_jailed_timestamp: currentTimestamps.jailed,
    current_counterfeiting_timestamp: currentTimestamps.counterfeiting,
    current_forgeryskill_timestamp: currentTimestamps.forgeryskill,
    historical_jailed_timestamp: historicalTimestamps.jailed,
    historical_counterfeiting_timestamp: historicalTimestamps.counterfeiting,
    historical_forgeryskill_timestamp: historicalTimestamps.forgeryskill,
    lookback_seconds: input.settings.lookback_seconds,
    historical_timestamp_requested: input.historicalTimestamp,
    notes_json: JSON.stringify(classified.notes),
    current_personalstats_json: currentStats ? JSON.stringify(currentStats) : null,
    historical_personalstats_json: historicalStats ? JSON.stringify(historicalStats) : null,
  };
}

function errorResult(
  input: {
    targetUserId: number;
    rowId: string;
    snapshotId: string;
    settings: ArrestScoutSettings;
    historicalTimestamp: number;
  },
  err: unknown,
): PendingResult {
  return {
    id: input.rowId,
    snapshot_id: input.snapshotId,
    target_user_id: input.targetUserId,
    name: null,
    classification: "error",
    score: 0,
    current_forgeryskill: null,
    current_counterfeiting: null,
    historical_counterfeiting: null,
    counterfeiting_delta: null,
    current_jailed: null,
    historical_jailed: null,
    jailed_delta: null,
    current_jailed_timestamp: null,
    current_counterfeiting_timestamp: null,
    current_forgeryskill_timestamp: null,
    historical_jailed_timestamp: null,
    historical_counterfeiting_timestamp: null,
    historical_forgeryskill_timestamp: null,
    lookback_seconds: input.settings.lookback_seconds,
    historical_timestamp_requested: input.historicalTimestamp,
    notes_json: JSON.stringify(["scan_error", safeErrorMessage(err)]),
    current_personalstats_json: null,
    historical_personalstats_json: null,
  };
}

async function readScanPayload(
  request: Request,
  env: Env,
): Promise<{ payload: ScanPayload } | { response: Response }> {
  const body = await readJsonObject(request);
  const sourceType = normalizeSourceType(body.source ?? body.source_type ?? body.sourceType);
  if (!sourceType) {
    return { response: json({ ok: false, error: "Invalid Arrest Scout source", code: "INVALID_SOURCE" }, 400) };
  }

  const lookbackDays = boundedInteger(body.lookback_days ?? body.lookbackDays, 1, 90, DEFAULT_LOOKBACK_DAYS);
  const settings: ArrestScoutSettings = {
    lookback_seconds: lookbackDays * 24 * 60 * 60,
    min_counterfeiting_delta: boundedInteger(
      body.min_counterfeiting_delta ?? body.minCounterfeitingDelta,
      1,
      1_000_000,
      DEFAULT_MIN_COUNTERFEITING_DELTA,
    ),
    required_forgeryskill: DEFAULT_REQUIRED_FORGERYSKILL,
  };

  const targetUserIds = sourceType === "future_targets_due"
    ? await readDueFutureTargetIds(env)
    : parseTargetIds(body.target_user_ids ?? body.targetUserIds);

  if (targetUserIds.length === 0) {
    return {
      response: json({
        ok: false,
        error: sourceType === "future_targets_due" ? "No future targets are due" : "At least one target user ID is required",
        code: sourceType === "future_targets_due" ? "NO_FUTURE_TARGETS_DUE" : "INVALID_TARGET_USER_IDS",
      }, 400),
    };
  }

  return {
    payload: {
      source_type: sourceType,
      target_user_ids: targetUserIds.slice(0, MAX_TARGETS_PER_SCAN),
      lookback_days: lookbackDays,
      settings,
    },
  };
}

async function readDueFutureTargetIds(env: Env): Promise<number[]> {
  const now = nowSeconds();
  const rows = await env.DB.prepare(
    `
    SELECT target_user_id
    FROM arrest_scout_future_targets
    WHERE next_check_after IS NOT NULL
      AND next_check_after <= ?
    ORDER BY next_check_after ASC, best_score DESC
    LIMIT ?
    `,
  )
    .bind(now, MAX_TARGETS_PER_SCAN)
    .all<{ target_user_id: number }>();

  return (rows.results ?? []).map((row) => Number(row.target_user_id)).filter((id) => Number.isInteger(id) && id > 0);
}

async function saveSnapshotAndResults(
  env: Env,
  snapshot: ArrestScoutSnapshotRow,
  results: PendingResult[],
  createdAt: number,
  lookbackSeconds: number,
  sourceType: ArrestScoutSourceType,
): Promise<void> {
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `
      INSERT INTO arrest_scout_snapshots (
        id,
        source_type,
        source_faction_id,
        scanned_by_torn_user_id,
        scanned_at,
        lookback_seconds,
        min_counterfeiting_delta,
        status,
        error,
        settings_json,
        target_count,
        checked_count,
        skill_100_count,
        current_target_count,
        future_target_count,
        inactive_count,
        ignored_count,
        error_count
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).bind(
      snapshot.id,
      snapshot.source_type,
      snapshot.source_faction_id,
      snapshot.scanned_by_torn_user_id,
      snapshot.scanned_at,
      snapshot.lookback_seconds,
      snapshot.min_counterfeiting_delta,
      snapshot.status,
      snapshot.error,
      snapshot.settings_json,
      snapshot.target_count,
      snapshot.checked_count,
      snapshot.skill_100_count,
      snapshot.current_target_count,
      snapshot.future_target_count,
      snapshot.inactive_count,
      snapshot.ignored_count,
      snapshot.error_count,
    ),
  ];

  for (const result of results) {
    statements.push(insertResultStatement(env, result, createdAt));
    if (result.classification === "future_target") {
      statements.push(upsertFutureTargetStatement(env, result, createdAt + lookbackSeconds));
    } else if (result.classification === "current_target") {
      statements.push(deleteFutureTargetStatement(env, result.target_user_id));
    } else if (sourceType === "future_targets_due") {
      statements.push(delayFutureTargetStatement(env, result, createdAt + lookbackSeconds));
    }
  }

  for (let index = 0; index < statements.length; index += 50) {
    await env.DB.batch(statements.slice(index, index + 50));
  }
}

function insertResultStatement(env: Env, result: PendingResult, createdAt: number): D1PreparedStatement {
  return env.DB.prepare(
    `
    INSERT INTO arrest_scout_results (
      id,
      snapshot_id,
      target_user_id,
      name,
      classification,
      score,
      current_forgeryskill,
      current_counterfeiting,
      historical_counterfeiting,
      counterfeiting_delta,
      current_jailed,
      historical_jailed,
      jailed_delta,
      current_jailed_timestamp,
      current_counterfeiting_timestamp,
      current_forgeryskill_timestamp,
      historical_jailed_timestamp,
      historical_counterfeiting_timestamp,
      historical_forgeryskill_timestamp,
      lookback_seconds,
      historical_timestamp_requested,
      notes_json,
      current_personalstats_json,
      historical_personalstats_json,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).bind(
    result.id,
    result.snapshot_id,
    result.target_user_id,
    result.name,
    result.classification,
    result.score,
    result.current_forgeryskill,
    result.current_counterfeiting,
    result.historical_counterfeiting,
    result.counterfeiting_delta,
    result.current_jailed,
    result.historical_jailed,
    result.jailed_delta,
    result.current_jailed_timestamp,
    result.current_counterfeiting_timestamp,
    result.current_forgeryskill_timestamp,
    result.historical_jailed_timestamp,
    result.historical_counterfeiting_timestamp,
    result.historical_forgeryskill_timestamp,
    result.lookback_seconds,
    result.historical_timestamp_requested,
    result.notes_json,
    result.current_personalstats_json,
    result.historical_personalstats_json,
    createdAt,
  );
}

function upsertFutureTargetStatement(env: Env, result: PendingResult, nextCheckAfter: number): D1PreparedStatement {
  return env.DB.prepare(
    `
    INSERT INTO arrest_scout_future_targets (
      target_user_id,
      name,
      best_score,
      last_classification,
      last_counterfeiting_delta,
      last_jailed_delta,
      first_seen_at,
      last_seen_at,
      next_check_after,
      latest_snapshot_id,
      notes_json
    )
    VALUES (?, ?, ?, ?, ?, ?, unixepoch(), unixepoch(), ?, ?, ?)
    ON CONFLICT(target_user_id) DO UPDATE SET
      name = COALESCE(excluded.name, arrest_scout_future_targets.name),
      best_score = MAX(arrest_scout_future_targets.best_score, excluded.best_score),
      last_classification = excluded.last_classification,
      last_counterfeiting_delta = excluded.last_counterfeiting_delta,
      last_jailed_delta = excluded.last_jailed_delta,
      last_seen_at = unixepoch(),
      next_check_after = excluded.next_check_after,
      latest_snapshot_id = excluded.latest_snapshot_id,
      notes_json = excluded.notes_json
    `,
  ).bind(
    result.target_user_id,
    result.name,
    result.score,
    result.classification,
    result.counterfeiting_delta,
    result.jailed_delta,
    nextCheckAfter,
    result.snapshot_id,
    result.notes_json,
  );
}

function deleteFutureTargetStatement(env: Env, targetUserId: number): D1PreparedStatement {
  return env.DB.prepare(
    `
    DELETE FROM arrest_scout_future_targets
    WHERE target_user_id = ?
    `,
  ).bind(targetUserId);
}

function delayFutureTargetStatement(env: Env, result: PendingResult, nextCheckAfter: number): D1PreparedStatement {
  return env.DB.prepare(
    `
    UPDATE arrest_scout_future_targets
    SET
      name = COALESCE(?, name),
      last_classification = ?,
      last_counterfeiting_delta = ?,
      last_jailed_delta = ?,
      last_seen_at = unixepoch(),
      next_check_after = ?,
      latest_snapshot_id = ?,
      notes_json = ?
    WHERE target_user_id = ?
    `,
  ).bind(
    result.name,
    result.classification,
    result.counterfeiting_delta,
    result.jailed_delta,
    nextCheckAfter,
    result.snapshot_id,
    result.notes_json,
    result.target_user_id,
  );
}

async function readResultsForSnapshot(env: Env, snapshotId: string): Promise<ArrestScoutResultRow[]> {
  const rows = await env.DB.prepare(
    `
    SELECT *
    FROM arrest_scout_results
    WHERE snapshot_id = ?
    ORDER BY
      CASE classification
        WHEN 'current_target' THEN 1
        WHEN 'future_target' THEN 2
        WHEN 'inactive' THEN 3
        WHEN 'ignored' THEN 4
        ELSE 5
      END,
      score DESC,
      counterfeiting_delta DESC,
      jailed_delta ASC,
      target_user_id ASC
    `,
  )
    .bind(snapshotId)
    .all<ArrestScoutResultRow>();

  return rows.results ?? [];
}

function countResults(results: PendingResult[]) {
  return {
    skill_100_count: results.filter((row) => row.current_forgeryskill === DEFAULT_REQUIRED_FORGERYSKILL).length,
    current_target_count: results.filter((row) => row.classification === "current_target").length,
    future_target_count: results.filter((row) => row.classification === "future_target").length,
    inactive_count: results.filter((row) => row.classification === "inactive").length,
    ignored_count: results.filter((row) => row.classification === "ignored").length,
    error_count: results.filter((row) => row.classification === "error").length,
  };
}

function targetStatsFromPersonalStats(stats: TornPersonalStatsResponse): ArrestScoutTargetStats {
  return {
    jailed: stats.jailed?.value ?? null,
    counterfeiting: stats.counterfeiting?.value ?? null,
    forgeryskill: stats.forgeryskill?.value ?? null,
  };
}

function statTimestampsFromPersonalStats(stats: TornPersonalStatsResponse): ArrestScoutStatTimestamps {
  return {
    jailed: stats.jailed?.timestamp ?? null,
    counterfeiting: stats.counterfeiting?.timestamp ?? null,
    forgeryskill: stats.forgeryskill?.timestamp ?? null,
  };
}

function emptyTimestamps(): ArrestScoutStatTimestamps {
  return {
    jailed: null,
    counterfeiting: null,
    forgeryskill: null,
  };
}

function normalizeSourceType(value: unknown): ArrestScoutSourceType | null {
  const source = cleanString(value);
  if (source === "manual" || source === "future_targets_due") {
    return source;
  }
  return null;
}

function parseTargetIds(value: unknown): number[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\s,]+/)
      : [];

  return Array.from(new Set(
    raw
      .map((item) => positiveIntegerOrNull(item))
      .filter((item): item is number => item !== null),
  ));
}

function chooseNextCandidate(candidates: TornKeyPoolCandidate[]): TornKeyPoolCandidate | null {
  const now = nowSeconds();
  const eligible = candidates.filter((candidate) =>
    candidate.maxRequestsPerMinute === null ||
    candidate.currentMinuteUsage < candidate.maxRequestsPerMinute
  );
  return sortCandidatesForFeature(eligible, "arrest_scout", now)[0] ?? null;
}

function safeErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/(ApiKey\s+)[A-Za-z0-9_-]+/gi, "$1[redacted]");
}
