import {
  boundedInteger,
  cleanString,
  positiveIntegerOrNull,
  readJsonObject,
} from "../backend/request";
import { TORN_FACTION_API_BASE_URL } from "../constants";
import { fetchTrackedTornJson } from "../external/torn";
import { fetchTornPersonalStatsWithTimestamps, type TornPersonalStatsResponse } from "../personalStats";
import {
  runWithTornKeyPool,
  TornKeyPoolExhaustedError,
  TornKeyPoolUnavailableError,
} from "../tornKeyPool";
import type { Env, TornFactionMember, TornFactionMembersResponse } from "../types";
import { json, nowSeconds } from "../utils";
import {
  ARREST_SCOUT_STAT_KEYS,
  DEFAULT_LOOKBACK_DAYS,
  DEFAULT_MIN_COUNTERFEITING_DELTA,
  DEFAULT_MIN_FRAUD_DELTA,
  DEFAULT_REQUIRED_FORGERYSKILL,
  type ArrestScoutFutureTargetRow,
  type ArrestScoutFactionHofFaction,
  type ArrestScoutFactionHofResponse,
  type ArrestScoutResultResponse,
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
  source_faction_id: number | null;
  target_user_ids: number[];
  target_names_by_id: Map<number, string>;
  lookback_days: number;
  settings: ArrestScoutSettings;
};

type PendingResult = Omit<ArrestScoutResultRow, "created_at">;

const TORN_FACTION_HOF_API_URL = "https://api.torn.com/v2/torn/factionhof";

export async function scanArrestScout(
  request: Request,
  env: Env,
  scannedByTornUserId: number | null,
): Promise<Response> {
  const usedKeySources = new Set<string>();
  let validated: Awaited<ReturnType<typeof readScanPayload>>;
  try {
    validated = await readScanPayload(request, env, usedKeySources);
  } catch (err) {
    if (isArrestScoutKeyPoolUnavailable(err)) {
      return noArrestScoutKeyResponse();
    }
    throw err;
  }
  if ("response" in validated) {
    return validated.response;
  }

  const payload = validated.payload;
  const snapshotId = crypto.randomUUID();
  const scannedAt = nowSeconds();
  const historicalTimestamp = scannedAt - payload.settings.lookback_seconds;
  const results: PendingResult[] = [];

  try {
    for (const [index, targetUserId] of payload.target_user_ids.entries()) {
      results.push(
        await scanOneTarget(env, {
          targetUserId,
          rowId: `${snapshotId}:${index}`,
          snapshotId,
          targetName: payload.target_names_by_id.get(targetUserId) ?? null,
          usedKeySources,
          settings: payload.settings,
          historicalTimestamp,
        }),
      );
    }
  } catch (err) {
    if (isArrestScoutKeyPoolUnavailable(err)) {
      return noArrestScoutKeyResponse();
    }
    throw err;
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
    source_faction_id: payload.source_faction_id,
    scanned_by_torn_user_id: scannedByTornUserId,
    scanned_at: scannedAt,
    lookback_seconds: payload.settings.lookback_seconds,
    min_counterfeiting_delta: payload.settings.min_counterfeiting_delta,
    min_fraud_delta: payload.settings.min_fraud_delta,
    status,
    error: status === "ok" ? null : `${counts.error_count} target scan error${counts.error_count === 1 ? "" : "s"}`,
    settings_json: JSON.stringify({
      source: payload.source_type,
      source_faction_id: payload.source_faction_id,
      target_user_ids: payload.target_user_ids,
      lookback_days: payload.lookback_days,
      min_counterfeiting_delta: payload.settings.min_counterfeiting_delta,
      min_fraud_delta: payload.settings.min_fraud_delta,
      required_forgeryskill: payload.settings.required_forgeryskill,
      key_sources: Array.from(usedKeySources),
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
    source_faction_id: payload.source_faction_id,
    lookback_days: payload.lookback_days,
    min_counterfeiting_delta: payload.settings.min_counterfeiting_delta,
    min_fraud_delta: payload.settings.min_fraud_delta,
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

export async function listArrestScoutFactionHof(request: Request, env: Env): Promise<Response> {
  const requestUrl = new URL(request.url);
  const cat = normalizeFactionHofCategory(requestUrl.searchParams.get("cat"));
  if (!cat) {
    return json({ ok: false, error: "Invalid faction HoF category", code: "INVALID_HOF_CATEGORY" }, 400);
  }

  const limit = boundedInteger(requestUrl.searchParams.get("limit"), 1, 100, 100);
  const offset = boundedInteger(requestUrl.searchParams.get("offset"), 0, 100_000, 0);
  const url = new URL(TORN_FACTION_HOF_API_URL);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("cat", cat);

  try {
    const output = await runWithTornKeyPool(env, {
      feature: "arrest_scout",
      run: ({ key, keySource }) => fetchTrackedTornJson<unknown>(env, url, {
        headers: {
          Accept: "application/json",
          Authorization: `ApiKey ${key}`,
        },
      }, {
        feature: "arrest-scout:faction-hof",
        keySource,
        timeoutMs: 15000,
      }, { service: "Torn faction HoF" }),
    });

    const response: ArrestScoutFactionHofResponse = {
      ok: true,
      cat,
      limit,
      offset,
      key_source: output.candidate.keySource,
      factions: normalizeFactionHofRows(output.result),
    };
    return json(response);
  } catch (err) {
    if (isArrestScoutKeyPoolUnavailable(err)) {
      return noArrestScoutKeyResponse();
    }
    throw err;
  }
}

async function scanOneTarget(
  env: Env,
  input: {
    targetUserId: number;
    rowId: string;
    snapshotId: string;
    targetName: string | null;
    usedKeySources: Set<string>;
    settings: ArrestScoutSettings;
    historicalTimestamp: number;
  },
): Promise<PendingResult> {
  try {
    const currentStats = await fetchStats(env, input.targetUserId, input.usedKeySources);
    const current = targetStatsFromPersonalStats(currentStats);
    const currentTimestamps = statTimestampsFromPersonalStats(currentStats);

    if (
      current.forgeryskill !== input.settings.required_forgeryskill &&
      current.scammingskill !== input.settings.required_forgeryskill
    ) {
      const classified = classifyArrestScoutTarget(current, null, input.settings);
      return resultFromClassification(input, classified, currentTimestamps, emptyTimestamps(), currentStats, null);
    }

    const historicalStats = await fetchStats(env, input.targetUserId, input.usedKeySources, input.historicalTimestamp);
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
    if (isArrestScoutKeyPoolUnavailable(err)) {
      throw err;
    }
    return errorResult(input, err);
  }
}

async function fetchStats(
  env: Env,
  targetUserId: number,
  usedKeySources: Set<string>,
  timestamp?: number,
): Promise<TornPersonalStatsResponse> {
  const output = await runWithTornKeyPool(env, {
    feature: "arrest_scout",
    run: ({ key, keySource }) => fetchTornPersonalStatsWithTimestamps(env, targetUserId, ARREST_SCOUT_STAT_KEYS, {
      apiKey: key,
      keySource,
      ...(timestamp ? { timestamp } : {}),
    }),
  });
  usedKeySources.add(output.candidate.keySource);
  return output.result;
}

function isArrestScoutKeyPoolUnavailable(err: unknown): boolean {
  return err instanceof TornKeyPoolUnavailableError || err instanceof TornKeyPoolExhaustedError;
}

function resultFromClassification(
  input: {
    targetUserId: number;
    rowId: string;
    snapshotId: string;
    targetName: string | null;
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
    name: input.targetName,
    classification: classified.classification,
    score: classified.score,
    current_forgeryskill: classified.current_forgeryskill,
    current_counterfeiting: classified.current_counterfeiting,
    historical_counterfeiting: classified.historical_counterfeiting,
    counterfeiting_delta: classified.counterfeiting_delta,
    current_scammingskill: classified.current_scammingskill,
    current_fraud: classified.current_fraud,
    historical_fraud: classified.historical_fraud,
    fraud_delta: classified.fraud_delta,
    current_criminaloffenses: classified.current_criminaloffenses,
    historical_criminaloffenses: classified.historical_criminaloffenses,
    criminaloffenses_delta: classified.criminaloffenses_delta,
    current_jailed: classified.current_jailed,
    historical_jailed: classified.historical_jailed,
    jailed_delta: classified.jailed_delta,
    current_jailed_timestamp: currentTimestamps.jailed,
    current_counterfeiting_timestamp: currentTimestamps.counterfeiting,
    current_forgeryskill_timestamp: currentTimestamps.forgeryskill,
    current_fraud_timestamp: currentTimestamps.fraud,
    current_scammingskill_timestamp: currentTimestamps.scammingskill,
    current_criminaloffenses_timestamp: currentTimestamps.criminaloffenses,
    historical_jailed_timestamp: historicalTimestamps.jailed,
    historical_counterfeiting_timestamp: historicalTimestamps.counterfeiting,
    historical_forgeryskill_timestamp: historicalTimestamps.forgeryskill,
    historical_fraud_timestamp: historicalTimestamps.fraud,
    historical_scammingskill_timestamp: historicalTimestamps.scammingskill,
    historical_criminaloffenses_timestamp: historicalTimestamps.criminaloffenses,
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
    targetName: string | null;
    settings: ArrestScoutSettings;
    historicalTimestamp: number;
  },
  err: unknown,
): PendingResult {
  return {
    id: input.rowId,
    snapshot_id: input.snapshotId,
    target_user_id: input.targetUserId,
    name: input.targetName,
    classification: "error",
    score: 0,
    current_forgeryskill: null,
    current_counterfeiting: null,
    historical_counterfeiting: null,
    counterfeiting_delta: null,
    current_scammingskill: null,
    current_fraud: null,
    historical_fraud: null,
    fraud_delta: null,
    current_criminaloffenses: null,
    historical_criminaloffenses: null,
    criminaloffenses_delta: null,
    current_jailed: null,
    historical_jailed: null,
    jailed_delta: null,
    current_jailed_timestamp: null,
    current_counterfeiting_timestamp: null,
    current_forgeryskill_timestamp: null,
    current_fraud_timestamp: null,
    current_scammingskill_timestamp: null,
    current_criminaloffenses_timestamp: null,
    historical_jailed_timestamp: null,
    historical_counterfeiting_timestamp: null,
    historical_forgeryskill_timestamp: null,
    historical_fraud_timestamp: null,
    historical_scammingskill_timestamp: null,
    historical_criminaloffenses_timestamp: null,
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
  usedKeySources: Set<string>,
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
    min_fraud_delta: boundedInteger(
      body.min_fraud_delta ?? body.minFraudDelta,
      1,
      1_000_000,
      DEFAULT_MIN_FRAUD_DELTA,
    ),
    required_forgeryskill: DEFAULT_REQUIRED_FORGERYSKILL,
  };

  const sourceFactionId = sourceType === "faction"
    ? positiveIntegerOrNull(body.source_faction_id ?? body.sourceFactionId)
    : null;
  if (sourceType === "faction" && !sourceFactionId) {
    return {
      response: json({
        ok: false,
        error: "A valid source faction ID is required",
        code: "INVALID_SOURCE_FACTION_ID",
      }, 400),
    };
  }

  const targetSelection = sourceType === "future_targets_due"
    ? await readDueFutureTargets(env)
    : sourceType === "faction"
      ? await readFactionTargets(env, sourceFactionId as number, usedKeySources)
      : {
          targetUserIds: parseTargetIds(body.target_user_ids ?? body.targetUserIds),
          targetNamesById: new Map<number, string>(),
        };
  const targetUserIds = targetSelection.targetUserIds;

  if (targetUserIds.length === 0) {
    return {
      response: json({
        ok: false,
        error: sourceType === "future_targets_due"
          ? "No future targets are due"
          : sourceType === "faction"
            ? "No faction members were found"
            : "At least one target user ID is required",
        code: sourceType === "future_targets_due"
          ? "NO_FUTURE_TARGETS_DUE"
          : sourceType === "faction"
            ? "NO_FACTION_MEMBERS"
            : "INVALID_TARGET_USER_IDS",
      }, 400),
    };
  }

  return {
    payload: {
      source_type: sourceType,
      source_faction_id: sourceFactionId,
      target_user_ids: targetUserIds,
      target_names_by_id: targetSelection.targetNamesById,
      lookback_days: lookbackDays,
      settings,
    },
  };
}

async function readDueFutureTargets(env: Env): Promise<{ targetUserIds: number[]; targetNamesById: Map<number, string> }> {
  const now = nowSeconds();
  const rows = await env.DB.prepare(
    `
    SELECT target_user_id, name
    FROM arrest_scout_future_targets
    WHERE next_check_after IS NOT NULL
      AND next_check_after <= ?
    ORDER BY next_check_after ASC, best_score DESC
    `,
  )
    .bind(now)
    .all<{ target_user_id: number; name: string | null }>();

  return targetSelectionFromRows(rows.results ?? []);
}

async function readFactionTargets(
  env: Env,
  factionId: number,
  usedKeySources: Set<string>,
): Promise<{ targetUserIds: number[]; targetNamesById: Map<number, string> }> {
  const url = new URL(`${TORN_FACTION_API_BASE_URL}/${factionId}/members`);
  url.searchParams.set("striptags", "false");

  const output = await runWithTornKeyPool(env, {
    feature: "arrest_scout",
    run: ({ key, keySource }) => fetchTrackedTornJson<TornFactionMembersResponse>(env, url, {
      headers: {
        Accept: "application/json",
        Authorization: `ApiKey ${key}`,
      },
    }, {
      feature: "arrest-scout:faction-members",
      keySource,
      timeoutMs: 15000,
    }, { service: "Torn faction members" }),
  });
  usedKeySources.add(output.candidate.keySource);

  return targetSelectionFromRows(normalizeFactionMembers(output.result.members));
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
        min_fraud_delta,
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
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).bind(
      snapshot.id,
      snapshot.source_type,
      snapshot.source_faction_id,
      snapshot.scanned_by_torn_user_id,
      snapshot.scanned_at,
      snapshot.lookback_seconds,
      snapshot.min_counterfeiting_delta,
      snapshot.min_fraud_delta,
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
      current_scammingskill,
      current_fraud,
      historical_fraud,
      fraud_delta,
      current_criminaloffenses,
      historical_criminaloffenses,
      criminaloffenses_delta,
      current_jailed,
      historical_jailed,
      jailed_delta,
      current_jailed_timestamp,
      current_counterfeiting_timestamp,
      current_forgeryskill_timestamp,
      current_fraud_timestamp,
      current_scammingskill_timestamp,
      current_criminaloffenses_timestamp,
      historical_jailed_timestamp,
      historical_counterfeiting_timestamp,
      historical_forgeryskill_timestamp,
      historical_fraud_timestamp,
      historical_scammingskill_timestamp,
      historical_criminaloffenses_timestamp,
      lookback_seconds,
      historical_timestamp_requested,
      notes_json,
      current_personalstats_json,
      historical_personalstats_json,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    result.current_scammingskill,
    result.current_fraud,
    result.historical_fraud,
    result.fraud_delta,
    result.current_criminaloffenses,
    result.historical_criminaloffenses,
    result.criminaloffenses_delta,
    result.current_jailed,
    result.historical_jailed,
    result.jailed_delta,
    result.current_jailed_timestamp,
    result.current_counterfeiting_timestamp,
    result.current_forgeryskill_timestamp,
    result.current_fraud_timestamp,
    result.current_scammingskill_timestamp,
    result.current_criminaloffenses_timestamp,
    result.historical_jailed_timestamp,
    result.historical_counterfeiting_timestamp,
    result.historical_forgeryskill_timestamp,
    result.historical_fraud_timestamp,
    result.historical_scammingskill_timestamp,
    result.historical_criminaloffenses_timestamp,
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
      last_fraud_delta,
      last_jailed_delta,
      first_seen_at,
      last_seen_at,
      next_check_after,
      latest_snapshot_id,
      notes_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch(), ?, ?, ?)
    ON CONFLICT(target_user_id) DO UPDATE SET
      name = COALESCE(excluded.name, arrest_scout_future_targets.name),
      best_score = MAX(arrest_scout_future_targets.best_score, excluded.best_score),
      last_classification = excluded.last_classification,
      last_counterfeiting_delta = excluded.last_counterfeiting_delta,
      last_fraud_delta = excluded.last_fraud_delta,
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
    result.fraud_delta,
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
      last_fraud_delta = ?,
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
    result.fraud_delta,
    result.jailed_delta,
    nextCheckAfter,
    result.snapshot_id,
    result.notes_json,
    result.target_user_id,
  );
}

async function readResultsForSnapshot(env: Env, snapshotId: string): Promise<ArrestScoutResultResponse[]> {
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
      fraud_delta DESC,
      jailed_delta ASC,
      target_user_id ASC
    `,
  )
    .bind(snapshotId)
    .all<ArrestScoutResultRow>();

  return (rows.results ?? []).map(withEstimatedLastArrest);
}

function countResults(results: PendingResult[]) {
  return {
    skill_100_count: results.filter((row) =>
      row.current_forgeryskill === DEFAULT_REQUIRED_FORGERYSKILL ||
      row.current_scammingskill === DEFAULT_REQUIRED_FORGERYSKILL
    ).length,
    current_target_count: results.filter((row) => row.classification === "current_target").length,
    future_target_count: results.filter((row) => row.classification === "future_target").length,
    inactive_count: results.filter((row) => row.classification === "inactive").length,
    ignored_count: results.filter((row) => row.classification === "ignored").length,
    error_count: results.filter((row) => row.classification === "error").length,
  };
}

function withEstimatedLastArrest(row: ArrestScoutResultRow): ArrestScoutResultResponse {
  const timestamp = estimatedLastArrestTimestamp(row);
  return {
    ...row,
    estimated_last_arrest_timestamp: timestamp,
    estimated_last_arrest_date: timestamp === null ? null : formatReadableUtcTimestamp(timestamp),
  };
}

function estimatedLastArrestTimestamp(row: ArrestScoutResultRow): number | null {
  if (
    row.current_jailed_timestamp === null ||
    row.historical_jailed_timestamp === null ||
    row.current_jailed_timestamp !== row.historical_jailed_timestamp
  ) {
    return null;
  }
  return row.current_jailed_timestamp;
}

function formatReadableUtcTimestamp(timestamp: number): string {
  return new Date(Math.trunc(timestamp) * 1000)
    .toISOString()
    .replace("T", " ")
    .replace(".000Z", " UTC");
}

function targetStatsFromPersonalStats(stats: TornPersonalStatsResponse): ArrestScoutTargetStats {
  return {
    jailed: stats.jailed?.value ?? null,
    counterfeiting: stats.counterfeiting?.value ?? null,
    forgeryskill: stats.forgeryskill?.value ?? 0,
    fraud: stats.fraud?.value ?? null,
    scammingskill: stats.scammingskill?.value ?? 0,
    criminaloffenses: stats.criminaloffenses?.value ?? null,
  };
}

function statTimestampsFromPersonalStats(stats: TornPersonalStatsResponse): ArrestScoutStatTimestamps {
  return {
    jailed: stats.jailed?.timestamp ?? null,
    counterfeiting: stats.counterfeiting?.timestamp ?? null,
    forgeryskill: stats.forgeryskill?.timestamp ?? null,
    fraud: stats.fraud?.timestamp ?? null,
    scammingskill: stats.scammingskill?.timestamp ?? null,
    criminaloffenses: stats.criminaloffenses?.timestamp ?? null,
  };
}

function emptyTimestamps(): ArrestScoutStatTimestamps {
  return {
    jailed: null,
    counterfeiting: null,
    forgeryskill: null,
    fraud: null,
    scammingskill: null,
    criminaloffenses: null,
  };
}

function normalizeSourceType(value: unknown): ArrestScoutSourceType | null {
  const source = cleanString(value);
  if (source === "manual" || source === "faction" || source === "future_targets_due") {
    return source;
  }
  return null;
}

function normalizeFactionHofCategory(value: unknown): string | null {
  const category = cleanString(value) ?? "rank";
  return /^[a-z][a-z0-9_]{0,40}$/i.test(category) ? category.toLowerCase() : null;
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

function normalizeFactionHofRows(data: unknown): ArrestScoutFactionHofFaction[] {
  const rows = factionHofRowCandidates(data);
  const factions: ArrestScoutFactionHofFaction[] = [];
  const seen = new Set<number>();

  for (const row of rows) {
    const faction = normalizeFactionHofRow(row.value, row.fallbackId);
    if (!faction || seen.has(faction.faction_id)) {
      continue;
    }
    seen.add(faction.faction_id);
    factions.push(faction);
  }

  return factions;
}

function factionHofRowCandidates(data: unknown): Array<{ value: unknown; fallbackId: unknown }> {
  const root = data && typeof data === "object" && !Array.isArray(data)
    ? data as Record<string, unknown>
    : {};
  const candidate = root.factionhof ?? root.factions ?? root.hof ?? data;

  if (Array.isArray(candidate)) {
    return candidate.map((value) => ({ value, fallbackId: null }));
  }

  if (candidate && typeof candidate === "object") {
    return Object.entries(candidate as Record<string, unknown>)
      .map(([id, value]) => ({ value, fallbackId: id }));
  }

  return [];
}

function normalizeFactionHofRow(value: unknown, fallbackId: unknown): ArrestScoutFactionHofFaction | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const row = value as Record<string, unknown>;
  const faction = row.faction && typeof row.faction === "object" && !Array.isArray(row.faction)
    ? row.faction as Record<string, unknown>
    : {};
  const factionId = positiveIntegerOrNull(
    row.faction_id ??
    row.id ??
    faction.id ??
    fallbackId,
  );
  if (factionId === null) {
    return null;
  }

  return {
    faction_id: factionId,
    name: cleanString(row.name ?? row.faction_name ?? faction.name),
    rank: finiteIntegerOrNull(row.rank ?? row.position),
    value: finiteNumberOrNull(row.value),
    members: finiteIntegerOrNull(row.members ?? row.member_count),
    respect: finiteNumberOrNull(row.respect),
  };
}

function finiteIntegerOrNull(value: unknown): number | null {
  const parsed = Math.floor(readNumber(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function finiteNumberOrNull(value: unknown): number | null {
  const parsed = readNumber(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readNumber(value: unknown): number {
  if (typeof value === "string") {
    return Number(value.replace(/[,_\s]/g, ""));
  }
  return Number(value);
}

function targetSelectionFromRows(
  rows: Array<{ id?: number | string; target_user_id?: number | string; name?: string | null }>,
): { targetUserIds: number[]; targetNamesById: Map<number, string> } {
  const targetUserIds: number[] = [];
  const targetNamesById = new Map<number, string>();
  const seen = new Set<number>();

  for (const row of rows) {
    const targetUserId = positiveIntegerOrNull(row.target_user_id ?? row.id);
    if (targetUserId === null || seen.has(targetUserId)) {
      continue;
    }

    seen.add(targetUserId);
    targetUserIds.push(targetUserId);

    const name = cleanString(row.name);
    if (name) {
      targetNamesById.set(targetUserId, name);
    }
  }

  return { targetUserIds, targetNamesById };
}

function normalizeFactionMembers(members: TornFactionMembersResponse["members"]): TornFactionMember[] {
  if (!members) return [];
  if (Array.isArray(members)) return members;

  return Object.entries(members).map(([id, member]) => ({
    ...member,
    id: Number.isInteger(Number(member.id)) && Number(member.id) > 0
      ? Number(member.id)
      : Number(id),
  }));
}

function noArrestScoutKeyResponse(): Response {
  return json(
    {
      ok: false,
      error: "No eligible Torn API key is available for Arrest Scout",
      code: "NO_TORN_KEYS_AVAILABLE",
    },
    503,
  );
}

function safeErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/(ApiKey\s+)[A-Za-z0-9_-]+/gi, "$1[redacted]");
}
