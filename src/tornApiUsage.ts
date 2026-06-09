import { Env } from "./types";
import { readSyncTimestamp, upsertSyncTimestamp } from "./syncState";
import { d1Changes, fetchWithTimeout, json, nowSeconds, parseLimit } from "./utils";

export type TornApiCallInput = {
  feature: string;
  keySource: string;
  retryAttempt?: number;
  timeoutMs?: number;
};

type TornApiUsageSummaryRow = {
  window_seconds: number;
  requests: number;
  errors: number;
  rate_limited: number;
  avg_duration_ms: number | null;
  max_duration_ms: number | null;
};

type TornApiUsageFeatureRow = {
  feature: string;
  requests: number;
  errors: number;
  rate_limited: number;
  avg_duration_ms: number | null;
  last_requested_at: number | null;
};

type TornApiUsageEndpointRow = {
  endpoint: string;
  requests: number;
  errors: number;
  rate_limited: number;
  avg_duration_ms: number | null;
  last_requested_at: number | null;
};

type TornApiUsageKeyRow = {
  key_source: string;
  requests: number;
  errors: number;
  rate_limited: number;
  avg_duration_ms: number | null;
  last_requested_at: number | null;
};

type TornApiUsageCallRow = {
  id: number;
  requested_at: number;
  feature: string;
  key_source: string;
  method: string;
  endpoint: string;
  status: number | null;
  ok: number;
  error: string | null;
  duration_ms: number;
  retry_attempt: number;
};

const DEFAULT_USAGE_WINDOWS_SECONDS = [60, 5 * 60, 60 * 60, 24 * 60 * 60];
const MAX_ERROR_LENGTH = 240;
const API_USAGE_ROLLUP_BUCKET_SECONDS = 15 * 60;
const API_USAGE_ROLLUP_OVERLAP_SECONDS = 2 * 60 * 60;
const API_USAGE_ROLLUP_INITIAL_LOOKBACK_SECONDS = 25 * 60 * 60;
const API_USAGE_ROLLUP_STATE_NAME = "torn_api_usage_rollup_15m";

export async function trackedTornFetch(
  env: Env,
  input: string | URL,
  init: RequestInit,
  call: TornApiCallInput,
): Promise<Response> {
  const url = new URL(input.toString());
  const method = (init.method ?? "GET").toUpperCase();
  const requestedAt = nowSeconds();
  const startedAt = Date.now();

  try {
    const response = call.timeoutMs
      ? await fetchWithTimeout(url.toString(), init, call.timeoutMs)
      : await fetch(url.toString(), init);
    await recordTornApiCall(env, {
      requestedAt,
      feature: call.feature,
      keySource: call.keySource,
      method,
      endpoint: sanitizedEndpoint(url),
      status: response.status,
      ok: response.ok,
      error: response.ok ? null : `HTTP ${response.status}`,
      durationMs: Date.now() - startedAt,
      retryAttempt: call.retryAttempt ?? 0,
    });
    return response;
  } catch (err) {
    await recordTornApiCall(env, {
      requestedAt,
      feature: call.feature,
      keySource: call.keySource,
      method,
      endpoint: sanitizedEndpoint(url),
      status: null,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startedAt,
      retryAttempt: call.retryAttempt ?? 0,
    });
    throw err;
  }
}

export async function getTornApiUsage(url: URL, env: Env): Promise<Response> {
  const windowSeconds = parseLimit(url.searchParams.get("window_seconds"), 60 * 60, 7 * 24 * 60 * 60);
  const limit = parseLimit(url.searchParams.get("limit"), 25, 100);
  const now = nowSeconds();
  const uniqueWindowSeconds = Array.from(new Set([...DEFAULT_USAGE_WINDOWS_SECONDS, windowSeconds]));
  const windowRows = await Promise.all(
    uniqueWindowSeconds.map((seconds) => readUsageSummaryForWindow(env, now, seconds)),
  );
  const windowsBySeconds = new Map(windowRows.map((row) => [row.window_seconds, row]));
  const summary = windowsBySeconds.get(windowSeconds) ?? await readUsageSummaryForWindow(env, now, windowSeconds);
  const windows = DEFAULT_USAGE_WINDOWS_SECONDS.map((seconds) => windowsBySeconds.get(seconds)!)
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
  const since = now - windowSeconds;

  const [byKey, byFeature, byEndpoint, recentCalls] = await Promise.all([
    env.DB.prepare(
      `
      SELECT
        key_source,
        COUNT(*) AS requests,
        SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS errors,
        SUM(CASE WHEN status = 429 THEN 1 ELSE 0 END) AS rate_limited,
        AVG(duration_ms) AS avg_duration_ms,
        MAX(requested_at) AS last_requested_at
      FROM torn_api_call_log
      WHERE requested_at >= ?
      GROUP BY key_source
      ORDER BY requests DESC, key_source ASC
      `,
    ).bind(since).all<TornApiUsageKeyRow>(),
    env.DB.prepare(
      `
      SELECT
        feature,
        COUNT(*) AS requests,
        SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS errors,
        SUM(CASE WHEN status = 429 THEN 1 ELSE 0 END) AS rate_limited,
        AVG(duration_ms) AS avg_duration_ms,
        MAX(requested_at) AS last_requested_at
      FROM torn_api_call_log
      WHERE requested_at >= ?
      GROUP BY feature
      ORDER BY requests DESC, feature ASC
      `,
    ).bind(since).all<TornApiUsageFeatureRow>(),
    env.DB.prepare(
      `
      SELECT
        endpoint,
        COUNT(*) AS requests,
        SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS errors,
        SUM(CASE WHEN status = 429 THEN 1 ELSE 0 END) AS rate_limited,
        AVG(duration_ms) AS avg_duration_ms,
        MAX(requested_at) AS last_requested_at
      FROM torn_api_call_log
      WHERE requested_at >= ?
      GROUP BY endpoint
      ORDER BY requests DESC, endpoint ASC
      LIMIT 15
      `,
    ).bind(since).all<TornApiUsageEndpointRow>(),
    env.DB.prepare(
      `
      SELECT *
      FROM torn_api_call_log
      ORDER BY requested_at DESC, id DESC
      LIMIT ?
      `,
    ).bind(limit).all<TornApiUsageCallRow>(),
  ]);

  return json({
    ok: true,
    window_seconds: windowSeconds,
    summary,
    windows,
    by_key: (byKey.results ?? []).map(mapKeyRow),
    by_feature: (byFeature.results ?? []).map(mapFeatureRow),
    by_endpoint: (byEndpoint.results ?? []).map(mapEndpointRow),
    recent_calls: (recentCalls.results ?? []).map(mapCallRow),
  });
}

export async function refreshTornApiUsageRollups(
  env: Env,
  now = nowSeconds(),
): Promise<{
  writeStatements: number;
  changedRows: number;
  details: Record<string, unknown>;
}> {
  const lastRolledAt = await readSyncTimestamp(env, API_USAGE_ROLLUP_STATE_NAME);
  const lookbackSeconds = lastRolledAt > 0
    ? Math.min(
      API_USAGE_ROLLUP_INITIAL_LOOKBACK_SECONDS,
      Math.max(API_USAGE_ROLLUP_OVERLAP_SECONDS, now - lastRolledAt + API_USAGE_ROLLUP_OVERLAP_SECONDS),
    )
    : API_USAGE_ROLLUP_INITIAL_LOOKBACK_SECONDS;
  const startAt = rollupBucketStart(Math.max(0, now - lookbackSeconds));
  const endBucket = rollupBucketStart(now);

  const deleteResult = await env.DB.prepare(
    `
    DELETE FROM torn_api_usage_rollup_15m
    WHERE bucket_start >= ?
      AND bucket_start <= ?
    `,
  ).bind(startAt, endBucket).run();

  const featureResult = await insertRollupGroup(env, "feature", "feature", startAt, now);
  const endpointResult = await insertRollupGroup(env, "endpoint", "endpoint", startAt, now);
  const keySourceResult = await insertRollupGroup(env, "key_source", "key_source", startAt, now);
  await upsertSyncTimestamp(env, API_USAGE_ROLLUP_STATE_NAME, now);

  const deletedRows = d1Changes(deleteResult);
  const featureRows = d1Changes(featureResult);
  const endpointRows = d1Changes(endpointResult);
  const keySourceRows = d1Changes(keySourceResult);

  return {
    writeStatements: 5,
    changedRows: deletedRows + featureRows + endpointRows + keySourceRows + 1,
    details: {
      start_at: startAt,
      end_at: now,
      bucket_seconds: API_USAGE_ROLLUP_BUCKET_SECONDS,
      deleted_rows: deletedRows,
      feature_rows: featureRows,
      endpoint_rows: endpointRows,
      key_source_rows: keySourceRows,
    },
  };
}

async function readUsageSummaryForWindow(
  env: Env,
  now: number,
  windowSeconds: number,
): Promise<{
  window_seconds: number;
  requests: number;
  errors: number;
  rate_limited: number;
  avg_duration_ms: number | null;
  max_duration_ms: number | null;
  requests_per_minute: number;
}> {
  const row = (await env.DB.prepare(
    `
    SELECT
      ? AS window_seconds,
      COUNT(*) AS requests,
      SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS errors,
      SUM(CASE WHEN status = 429 THEN 1 ELSE 0 END) AS rate_limited,
      AVG(duration_ms) AS avg_duration_ms,
      MAX(duration_ms) AS max_duration_ms
    FROM torn_api_call_log
    WHERE requested_at >= ?
    `,
  ).bind(windowSeconds, now - windowSeconds).first()) as TornApiUsageSummaryRow | null;

  const requests = Number(row?.requests ?? 0);
  return {
    window_seconds: windowSeconds,
    requests,
    errors: Number(row?.errors ?? 0),
    rate_limited: Number(row?.rate_limited ?? 0),
    avg_duration_ms: nullableRoundedNumber(row?.avg_duration_ms),
    max_duration_ms: nullableRoundedNumber(row?.max_duration_ms),
    requests_per_minute: Number((requests / Math.max(1, windowSeconds / 60)).toFixed(2)),
  };
}

function insertRollupGroup(
  env: Env,
  groupType: "feature" | "endpoint" | "key_source",
  column: "feature" | "endpoint" | "key_source",
  startAt: number,
  endAt: number,
): Promise<D1Result> {
  return env.DB.prepare(
    `
    INSERT INTO torn_api_usage_rollup_15m (
      bucket_start,
      group_type,
      group_value,
      requests,
      errors,
      rate_limited,
      total_duration_ms,
      max_duration_ms,
      last_requested_at,
      updated_at
    )
    SELECT
      requested_at - (requested_at % ?) AS bucket_start,
      ? AS group_type,
      ${column} AS group_value,
      COUNT(*) AS requests,
      SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS errors,
      SUM(CASE WHEN status = 429 THEN 1 ELSE 0 END) AS rate_limited,
      SUM(duration_ms) AS total_duration_ms,
      MAX(duration_ms) AS max_duration_ms,
      MAX(requested_at) AS last_requested_at,
      unixepoch() AS updated_at
    FROM torn_api_call_log
    WHERE requested_at >= ?
      AND requested_at <= ?
      AND ${column} IS NOT NULL
      AND ${column} <> ''
    GROUP BY bucket_start, group_value
    `,
  ).bind(API_USAGE_ROLLUP_BUCKET_SECONDS, groupType, startAt, endAt).run();
}

function rollupBucketStart(timestamp: number): number {
  return timestamp - (timestamp % API_USAGE_ROLLUP_BUCKET_SECONDS);
}

async function recordTornApiCall(
  env: Env,
  input: {
    requestedAt: number;
    feature: string;
    keySource: string;
    method: string;
    endpoint: string;
    status: number | null;
    ok: boolean;
    error: string | null;
    durationMs: number;
    retryAttempt: number;
  },
): Promise<void> {
  try {
    await env.DB.prepare(
      `
      INSERT INTO torn_api_call_log (
        requested_at,
        feature,
        key_source,
        method,
        endpoint,
        status,
        ok,
        error,
        duration_ms,
        retry_attempt
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).bind(
      input.requestedAt,
      input.feature,
      input.keySource,
      input.method,
      input.endpoint,
      input.status,
      input.ok ? 1 : 0,
      input.error ? input.error.slice(0, MAX_ERROR_LENGTH) : null,
      input.durationMs,
      input.retryAttempt,
    ).run();
  } catch (err) {
    console.warn("Unable to record Torn API call", err);
  }
}

function sanitizedEndpoint(url: URL): string {
  const sanitized = new URL(url.toString());
  ["key", "api_key", "apikey"].forEach((param) => sanitized.searchParams.delete(param));
  sanitized.searchParams.sort();
  return `${sanitized.pathname}${sanitized.search}`;
}

function nullableRoundedNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function mapFeatureRow(row: TornApiUsageFeatureRow) {
  return {
    feature: row.feature,
    requests: Number(row.requests ?? 0),
    errors: Number(row.errors ?? 0),
    rate_limited: Number(row.rate_limited ?? 0),
    avg_duration_ms: nullableRoundedNumber(row.avg_duration_ms),
    last_requested_at: row.last_requested_at,
  };
}

function mapEndpointRow(row: TornApiUsageEndpointRow) {
  return {
    endpoint: row.endpoint,
    requests: Number(row.requests ?? 0),
    errors: Number(row.errors ?? 0),
    rate_limited: Number(row.rate_limited ?? 0),
    avg_duration_ms: nullableRoundedNumber(row.avg_duration_ms),
    last_requested_at: row.last_requested_at,
  };
}

function mapKeyRow(row: TornApiUsageKeyRow) {
  return {
    key_source: row.key_source,
    requests: Number(row.requests ?? 0),
    errors: Number(row.errors ?? 0),
    rate_limited: Number(row.rate_limited ?? 0),
    avg_duration_ms: nullableRoundedNumber(row.avg_duration_ms),
    last_requested_at: row.last_requested_at,
  };
}

function mapCallRow(row: TornApiUsageCallRow) {
  return {
    id: row.id,
    requested_at: row.requested_at,
    feature: row.feature,
    key_source: row.key_source,
    method: row.method,
    endpoint: row.endpoint,
    status: row.status,
    ok: row.ok === 1,
    error: row.error,
    duration_ms: row.duration_ms,
    retry_attempt: row.retry_attempt,
  };
}
