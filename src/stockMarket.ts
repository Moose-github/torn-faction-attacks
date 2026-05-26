import { readSyncTimestamp, upsertSyncTimestamp } from "./syncState";
import { trackedTornFetch } from "./tornApiUsage";
import { Env } from "./types";
import { json, nowSeconds, parseLimit } from "./utils";

type StockProfile = {
  stock_id: number;
  acronym: string | null;
  name: string | null;
  current_price: number | null;
  market_cap: number | null;
  total_shares: number | null;
  available_shares: number | null;
  forecast: string | null;
  demand: string | null;
  benefit_json: string | null;
  raw_json: string | null;
  updated_at: number;
};

type StockSnapshot = {
  stock_id: number;
  observed_at: number;
  price: number;
  raw_json: string | null;
  fetched_at: number;
};

type StockIngestionRun = {
  id: string;
  batch_group: string;
  started_at: number;
  finished_at: number | null;
  status: "running" | "ok" | "partial" | "error";
  stocks_attempted: number;
  stocks_succeeded: number;
  stocks_failed: number;
  points_seen: number;
  points_written: number;
  recoverable_gap_count: number;
  unrecoverable_gap_count: number;
  error: string | null;
  details_json: string | null;
};

type StockCoverageRow = {
  total_stocks: number;
  stocks_with_snapshots: number;
  oldest_snapshot_at: number | null;
  newest_snapshot_at: number | null;
  stale_stocks: number;
};

const TORN_API_BASE = "https://api.torn.com/v2";
const REQUEST_TIMEOUT_MS = 12_000;
const STOCK_PROFILE_REFRESH_STATE = "stock_market_profiles_refreshed";
const PROFILE_REFRESH_SECONDS = 24 * 60 * 60;
const STOCK_HISTORY_WINDOW_SECONDS = 60 * 60;
const STALE_STOCK_SECONDS = 45 * 60;
const DEFAULT_STOCK_IDS = Array.from({ length: 35 }, (_, index) => index + 1);

export async function refreshTornStockHistoryBatch(
  env: Env,
  scheduledTime: number,
): Promise<StockIngestionRun> {
  const startedAt = nowSeconds();
  const runId = crypto.randomUUID();
  const run: StockIngestionRun = {
    id: runId,
    batch_group: "pending",
    started_at: startedAt,
    finished_at: null,
    status: "running",
    stocks_attempted: 0,
    stocks_succeeded: 0,
    stocks_failed: 0,
    points_seen: 0,
    points_written: 0,
    recoverable_gap_count: 0,
    unrecoverable_gap_count: 0,
    error: null,
    details_json: null,
  };

  await insertStockIngestionRun(env, run);

  const details: Array<{ stock_id: number; status: string; points?: number; written?: number; error?: string }> = [];

  try {
    const profiles = await ensureStockProfiles(env, startedAt);
    const stockIds = profiles.length > 0
      ? profiles.map((profile) => profile.stock_id).sort((a, b) => a - b)
      : DEFAULT_STOCK_IDS;
    const batch = selectStockBatchForTime(stockIds, scheduledTime);

    run.batch_group = batch.group;
    run.stocks_attempted = batch.stockIds.length;

    await updateStockIngestionRun(env, run);

    const latestByStock = await readLatestSnapshotTimes(env, batch.stockIds);
    for (const stockId of batch.stockIds) {
      const latestObservedAt = latestByStock.get(stockId) ?? null;
      if (latestObservedAt !== null) {
        const gapSeconds = Math.max(0, startedAt - latestObservedAt);
        if (gapSeconds > STALE_STOCK_SECONDS) {
          if (gapSeconds <= STOCK_HISTORY_WINDOW_SECONDS) {
            run.recoverable_gap_count += 1;
          } else {
            run.unrecoverable_gap_count += 1;
          }
        }
      }

      try {
        const result = await fetchTornStockHistory(stockId, env);
        const profile = result.profile ?? minimalStockProfile(stockId, startedAt);
        await saveStockProfiles(env, [profile]);

        const snapshots = result.snapshots.map((snapshot) => ({
          ...snapshot,
          fetched_at: startedAt,
        }));
        const written = await saveStockSnapshots(env, snapshots);

        run.stocks_succeeded += 1;
        run.points_seen += snapshots.length;
        run.points_written += written;
        details.push({ stock_id: stockId, status: "ok", points: snapshots.length, written });
      } catch (err: any) {
        const message = err?.message || String(err);
        run.stocks_failed += 1;
        details.push({ stock_id: stockId, status: "error", error: message });
      }

      run.details_json = JSON.stringify(details);
      await updateStockIngestionRun(env, run);
    }

    run.finished_at = nowSeconds();
    run.status = run.stocks_failed > 0 ? (run.stocks_succeeded > 0 ? "partial" : "error") : "ok";
    run.error = run.status === "error"
      ? details.find((detail) => detail.error)?.error ?? "All stock history fetches failed"
      : null;
    run.details_json = JSON.stringify(details);
    await updateStockIngestionRun(env, run);
    return run;
  } catch (err: any) {
    run.finished_at = nowSeconds();
    run.status = "error";
    run.error = err?.message || String(err);
    run.details_json = JSON.stringify(details);
    await updateStockIngestionRun(env, run);
    return run;
  }
}

export async function refreshTornStockProfiles(env: Env): Promise<StockProfile[]> {
  const data = await fetchTornJson("/torn/stocks", env);
  const fetchedAt = nowSeconds();
  const profiles = normalizeStockProfiles(data, fetchedAt);
  if (profiles.length === 0) {
    throw new Error("Torn stocks response did not include stock profiles");
  }

  await saveStockProfiles(env, profiles);
  await upsertSyncTimestamp(env, STOCK_PROFILE_REFRESH_STATE, fetchedAt, null);
  return profiles;
}

export async function fetchTornStockHistory(
  stockId: number,
  env: Env,
): Promise<{ profile: StockProfile | null; snapshots: StockSnapshot[] }> {
  const fetchedAt = nowSeconds();
  const data = await fetchTornJson(`/torn/${encodeURIComponent(String(stockId))}/stocks`, env);
  const profile = normalizeSingleStockProfile(data, stockId, fetchedAt);
  const snapshots = normalizeStockSnapshots(data, stockId, fetchedAt);

  return { profile, snapshots };
}

export async function getStocks(env: Env): Promise<Response> {
  const rows = await env.DB.prepare(
    `
    SELECT
      p.*,
      s.observed_at AS latest_observed_at,
      s.price AS latest_snapshot_price,
      s.fetched_at AS latest_snapshot_fetched_at
    FROM stock_profiles p
    LEFT JOIN stock_price_snapshots s
      ON s.stock_id = p.stock_id
      AND s.observed_at = (
        SELECT MAX(observed_at)
        FROM stock_price_snapshots
        WHERE stock_id = p.stock_id
      )
    ORDER BY p.stock_id ASC
    `,
  ).all();

  return json({
    ok: true,
    stocks: rows.results ?? [],
  });
}

export async function getStockHistory(url: URL, env: Env, stockId: number): Promise<Response> {
  if (!Number.isInteger(stockId) || stockId <= 0) {
    return json({ ok: false, error: "Invalid stock ID", code: "INVALID_STOCK_ID" }, 400);
  }

  const limit = parseLimit(url.searchParams.get("limit"), 240, 1440);
  const rows = await env.DB.prepare(
    `
    SELECT stock_id, observed_at, price, fetched_at
    FROM stock_price_snapshots
    WHERE stock_id = ?
    ORDER BY observed_at DESC
    LIMIT ?
    `,
  )
    .bind(stockId, limit)
    .all();

  return json({
    ok: true,
    stock_id: stockId,
    history: rows.results ?? [],
  });
}

export async function getStockIngestionStatus(env: Env): Promise<Response> {
  const latest = await env.DB.prepare(
    `
    SELECT *
    FROM stock_ingestion_runs
    ORDER BY started_at DESC
    LIMIT 1
    `,
  ).first<StockIngestionRun>();

  const recent = await env.DB.prepare(
    `
    SELECT *
    FROM stock_ingestion_runs
    ORDER BY started_at DESC
    LIMIT 12
    `,
  ).all<StockIngestionRun>();

  const coverage = await readStockCoverage(env, nowSeconds());
  const lastError = await env.DB.prepare(
    `
    SELECT error
    FROM stock_ingestion_runs
    WHERE error IS NOT NULL
    ORDER BY started_at DESC
    LIMIT 1
    `,
  ).first<{ error: string | null }>();

  return json({
    ok: true,
    latest_run: latest ?? null,
    recent_runs: recent.results ?? [],
    coverage,
    last_error: lastError?.error ?? null,
  });
}

export function selectStockBatchForTime(
  stockIds: number[],
  scheduledTime: number,
): { group: "A" | "B"; stockIds: number[] } {
  const slot = Math.floor(scheduledTime / (15 * 60 * 1000));
  const groupIndex = slot % 2;
  return {
    group: groupIndex === 0 ? "A" : "B",
    stockIds: stockIds.filter((_, index) => index % 2 === groupIndex),
  };
}

async function ensureStockProfiles(env: Env, now: number): Promise<StockProfile[]> {
  const current = await readStockProfiles(env);
  const lastRefresh = await readSyncTimestamp(env, STOCK_PROFILE_REFRESH_STATE);
  if (current.length === 0 || now - lastRefresh >= PROFILE_REFRESH_SECONDS) {
    try {
      return await refreshTornStockProfiles(env);
    } catch (err) {
      if (current.length === 0) {
        throw err;
      }
      console.error("Stock profile refresh failed:", err instanceof Error ? err.message : err);
    }
  }

  return current;
}

async function readStockProfiles(env: Env): Promise<StockProfile[]> {
  const rows = await env.DB.prepare(
    `
    SELECT *
    FROM stock_profiles
    ORDER BY stock_id ASC
    `,
  ).all<StockProfile>();

  return rows.results ?? [];
}

async function readLatestSnapshotTimes(env: Env, stockIds: number[]): Promise<Map<number, number>> {
  if (stockIds.length === 0) {
    return new Map();
  }

  const placeholders = stockIds.map(() => "?").join(", ");
  const rows = await env.DB.prepare(
    `
    SELECT stock_id, MAX(observed_at) AS latest_observed_at
    FROM stock_price_snapshots
    WHERE stock_id IN (${placeholders})
    GROUP BY stock_id
    `,
  )
    .bind(...stockIds)
    .all<{ stock_id: number; latest_observed_at: number | null }>();

  return new Map(
    (rows.results ?? [])
      .filter((row) => row.latest_observed_at !== null)
      .map((row) => [Number(row.stock_id), Number(row.latest_observed_at)]),
  );
}

async function readStockCoverage(env: Env, now: number): Promise<StockCoverageRow> {
  const row = await env.DB.prepare(
    `
    SELECT
      COUNT(*) AS total_stocks,
      COUNT(s.latest_observed_at) AS stocks_with_snapshots,
      MIN(s.latest_observed_at) AS oldest_snapshot_at,
      MAX(s.latest_observed_at) AS newest_snapshot_at,
      SUM(CASE WHEN s.latest_observed_at IS NULL OR s.latest_observed_at < ? THEN 1 ELSE 0 END) AS stale_stocks
    FROM stock_profiles p
    LEFT JOIN (
      SELECT stock_id, MAX(observed_at) AS latest_observed_at
      FROM stock_price_snapshots
      GROUP BY stock_id
    ) s ON s.stock_id = p.stock_id
    `,
  )
    .bind(now - STALE_STOCK_SECONDS)
    .first<StockCoverageRow>();

  return {
    total_stocks: Number(row?.total_stocks ?? 0),
    stocks_with_snapshots: Number(row?.stocks_with_snapshots ?? 0),
    oldest_snapshot_at: row?.oldest_snapshot_at === null || row?.oldest_snapshot_at === undefined
      ? null
      : Number(row.oldest_snapshot_at),
    newest_snapshot_at: row?.newest_snapshot_at === null || row?.newest_snapshot_at === undefined
      ? null
      : Number(row.newest_snapshot_at),
    stale_stocks: Number(row?.stale_stocks ?? 0),
  };
}

async function saveStockProfiles(env: Env, profiles: StockProfile[]): Promise<void> {
  const statements = profiles.map((profile) =>
    env.DB.prepare(
      `
      INSERT INTO stock_profiles (
        stock_id,
        acronym,
        name,
        current_price,
        market_cap,
        total_shares,
        available_shares,
        forecast,
        demand,
        benefit_json,
        raw_json,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(stock_id) DO UPDATE SET
        acronym = COALESCE(excluded.acronym, stock_profiles.acronym),
        name = COALESCE(excluded.name, stock_profiles.name),
        current_price = COALESCE(excluded.current_price, stock_profiles.current_price),
        market_cap = COALESCE(excluded.market_cap, stock_profiles.market_cap),
        total_shares = COALESCE(excluded.total_shares, stock_profiles.total_shares),
        available_shares = COALESCE(excluded.available_shares, stock_profiles.available_shares),
        forecast = COALESCE(excluded.forecast, stock_profiles.forecast),
        demand = COALESCE(excluded.demand, stock_profiles.demand),
        benefit_json = COALESCE(excluded.benefit_json, stock_profiles.benefit_json),
        raw_json = COALESCE(excluded.raw_json, stock_profiles.raw_json),
        updated_at = excluded.updated_at
      `,
    ).bind(
      profile.stock_id,
      profile.acronym,
      profile.name,
      profile.current_price,
      profile.market_cap,
      profile.total_shares,
      profile.available_shares,
      profile.forecast,
      profile.demand,
      profile.benefit_json,
      profile.raw_json,
      profile.updated_at,
    )
  );

  for (let index = 0; index < statements.length; index += 50) {
    await env.DB.batch(statements.slice(index, index + 50));
  }
}

async function saveStockSnapshots(env: Env, snapshots: StockSnapshot[]): Promise<number> {
  if (snapshots.length === 0) {
    return 0;
  }

  let written = 0;
  const statements = snapshots.map((snapshot) =>
    env.DB.prepare(
      `
      INSERT INTO stock_price_snapshots (
        stock_id,
        observed_at,
        price,
        raw_json,
        fetched_at
      )
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(stock_id, observed_at) DO UPDATE SET
        price = excluded.price,
        raw_json = excluded.raw_json,
        fetched_at = excluded.fetched_at
      `,
    ).bind(
      snapshot.stock_id,
      snapshot.observed_at,
      snapshot.price,
      snapshot.raw_json,
      snapshot.fetched_at,
    )
  );

  for (let index = 0; index < statements.length; index += 50) {
    const results = await env.DB.batch(statements.slice(index, index + 50));
    written += results.reduce((total, result) => total + Number(result.meta?.changes ?? 0), 0);
  }

  return written;
}

async function insertStockIngestionRun(env: Env, run: StockIngestionRun): Promise<void> {
  await env.DB.prepare(
    `
    INSERT INTO stock_ingestion_runs (
      id,
      batch_group,
      started_at,
      finished_at,
      status,
      stocks_attempted,
      stocks_succeeded,
      stocks_failed,
      points_seen,
      points_written,
      recoverable_gap_count,
      unrecoverable_gap_count,
      error,
      details_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  )
    .bind(
      run.id,
      run.batch_group,
      run.started_at,
      run.finished_at,
      run.status,
      run.stocks_attempted,
      run.stocks_succeeded,
      run.stocks_failed,
      run.points_seen,
      run.points_written,
      run.recoverable_gap_count,
      run.unrecoverable_gap_count,
      run.error,
      run.details_json,
    )
    .run();
}

async function updateStockIngestionRun(env: Env, run: StockIngestionRun): Promise<void> {
  await env.DB.prepare(
    `
    UPDATE stock_ingestion_runs
    SET
      batch_group = ?,
      finished_at = ?,
      status = ?,
      stocks_attempted = ?,
      stocks_succeeded = ?,
      stocks_failed = ?,
      points_seen = ?,
      points_written = ?,
      recoverable_gap_count = ?,
      unrecoverable_gap_count = ?,
      error = ?,
      details_json = ?
    WHERE id = ?
    `,
  )
    .bind(
      run.batch_group,
      run.finished_at,
      run.status,
      run.stocks_attempted,
      run.stocks_succeeded,
      run.stocks_failed,
      run.points_seen,
      run.points_written,
      run.recoverable_gap_count,
      run.unrecoverable_gap_count,
      run.error,
      run.details_json,
      run.id,
    )
    .run();
}

async function fetchTornJson(endpoint: string, env: Env): Promise<unknown> {
  const response = await trackedTornFetch(env, `${TORN_API_BASE}${endpoint}`, {
    headers: {
      Accept: "application/json",
      Authorization: `ApiKey ${env.TORN_API_KEY}`,
      "User-Agent": "buttgrass-stock-market/1.0",
    },
  }, {
    feature: "stock-market",
    keySource: "env:TORN_API_KEY",
    timeoutMs: REQUEST_TIMEOUT_MS,
  });

  const data = await readUpstreamJson(response);
  if (!response.ok) {
    throw new Error(`Torn stock API error: ${response.status}`);
  }
  if (isRecord(data) && isRecord(data.error)) {
    throw new Error(String(data.error.error ?? data.error.message ?? "Torn API error"));
  }

  return data;
}

async function readUpstreamJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return { raw: await response.text().catch(() => "") };
  }
}

function normalizeStockProfiles(data: unknown, fetchedAt: number): StockProfile[] {
  const container = isRecord(data) ? data.stocks : null;
  const entries = entriesFromContainer(container);
  return entries
    .map(([key, value]) => normalizeStockProfile(value, numericKey(key), fetchedAt))
    .filter((profile): profile is StockProfile => Boolean(profile));
}

function normalizeSingleStockProfile(data: unknown, stockId: number, fetchedAt: number): StockProfile | null {
  if (!isRecord(data)) {
    return null;
  }

  const stock = isRecord(data.stock) ? data.stock : null;
  if (stock) {
    return normalizeStockProfile(stock, stockId, fetchedAt);
  }

  const stocks = entriesFromContainer(data.stocks);
  const candidate = stocks.find(([key, value]) => numericKey(key) === stockId || getPositiveInteger(value, ["id", "stock_id"]) === stockId);
  if (candidate) {
    return normalizeStockProfile(candidate[1], stockId, fetchedAt);
  }

  return normalizeStockProfile(data, stockId, fetchedAt);
}

function normalizeStockProfile(value: unknown, fallbackId: number | null, fetchedAt: number): StockProfile | null {
  if (!isRecord(value)) {
    return null;
  }

  const stockId = getPositiveInteger(value, ["id", "stock_id", "stockId"]) ?? fallbackId;
  if (!stockId) {
    return null;
  }

  const benefit = isRecord(value.benefit) || Array.isArray(value.benefit) ? value.benefit : null;
  return {
    stock_id: stockId,
    acronym: cleanString(value.acronym ?? value.ticker ?? value.symbol),
    name: cleanString(value.name),
    current_price: finiteNumber(value.current_price ?? value.currentPrice ?? value.price),
    market_cap: finiteInteger(value.market_cap ?? value.marketCap),
    total_shares: finiteInteger(value.total_shares ?? value.totalShares),
    available_shares: finiteInteger(value.available_shares ?? value.availableShares),
    forecast: cleanString(value.forecast),
    demand: cleanString(value.demand),
    benefit_json: benefit ? JSON.stringify(benefit) : null,
    raw_json: JSON.stringify(value),
    updated_at: fetchedAt,
  };
}

function minimalStockProfile(stockId: number, fetchedAt: number): StockProfile {
  return {
    stock_id: stockId,
    acronym: null,
    name: null,
    current_price: null,
    market_cap: null,
    total_shares: null,
    available_shares: null,
    forecast: null,
    demand: null,
    benefit_json: null,
    raw_json: null,
    updated_at: fetchedAt,
  };
}

function normalizeStockSnapshots(data: unknown, stockId: number, fetchedAt: number): StockSnapshot[] {
  const byTimestamp = new Map<number, StockSnapshot>();
  collectStockSnapshots(data, stockId, fetchedAt, byTimestamp, 0);
  return [...byTimestamp.values()].sort((a, b) => a.observed_at - b.observed_at);
}

function collectStockSnapshots(
  value: unknown,
  stockId: number,
  fetchedAt: number,
  byTimestamp: Map<number, StockSnapshot>,
  depth: number,
  keyTimestamp: number | null = null,
): void {
  if (depth > 6 || value === null || value === undefined) {
    return;
  }

  if (typeof value === "number" && keyTimestamp !== null) {
    addSnapshot(stockId, keyTimestamp, value, value, fetchedAt, byTimestamp);
    return;
  }

  if (Array.isArray(value)) {
    const tuple = tupleSnapshot(value);
    if (tuple) {
      addSnapshot(stockId, tuple.timestamp, tuple.price, value, fetchedAt, byTimestamp);
      return;
    }
    value.forEach((item) => collectStockSnapshots(item, stockId, fetchedAt, byTimestamp, depth + 1));
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  const timestamp = timestampFromValue(value) ?? keyTimestamp;
  const price = priceFromValue(value);
  if (timestamp !== null && price !== null) {
    addSnapshot(stockId, timestamp, price, value, fetchedAt, byTimestamp);
  }

  for (const [key, nested] of Object.entries(value)) {
    if (key === "benefit") {
      continue;
    }
    collectStockSnapshots(nested, stockId, fetchedAt, byTimestamp, depth + 1, timestampFromKey(key));
  }
}

function addSnapshot(
  stockId: number,
  timestamp: number,
  price: number,
  raw: unknown,
  fetchedAt: number,
  byTimestamp: Map<number, StockSnapshot>,
): void {
  if (!Number.isFinite(price) || price <= 0) {
    return;
  }

  const observedAt = Math.floor(normalizeTimestamp(timestamp) / 60) * 60;
  if (!Number.isFinite(observedAt) || observedAt <= 0) {
    return;
  }

  byTimestamp.set(observedAt, {
    stock_id: stockId,
    observed_at: observedAt,
    price,
    raw_json: JSON.stringify(raw),
    fetched_at: fetchedAt,
  });
}

function timestampFromValue(value: Record<string, unknown>): number | null {
  const timestamp = normalizeTimestamp(
    value.timestamp ??
      value.time ??
      value.t ??
      value.date ??
      value.created_at ??
      value.observed_at,
  );
  return Number.isFinite(timestamp) ? timestamp : null;
}

function timestampFromKey(value: string): number | null {
  if (!/^\d{10,13}$/.test(value)) {
    return null;
  }
  const timestamp = normalizeTimestamp(Number(value));
  return Number.isFinite(timestamp) ? timestamp : null;
}

function normalizeTimestamp(value: unknown): number {
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return normalizeTimestamp(numeric);
    }
    const parsed = Math.floor(Date.parse(value) / 1000);
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return NaN;
  }

  return numeric > 1_000_000_000_000 ? Math.floor(numeric / 1000) : Math.floor(numeric);
}

function priceFromValue(value: Record<string, unknown>): number | null {
  return finiteNumber(
    value.price ??
      value.current_price ??
      value.currentPrice ??
      value.value ??
      value.y,
  );
}

function tupleSnapshot(value: unknown[]): { timestamp: number; price: number } | null {
  if (value.length < 2) {
    return null;
  }

  const first = normalizeTimestamp(value[0]);
  const second = finiteNumber(value[1]);
  if (Number.isFinite(first) && first > 1_000_000_000 && second !== null && second > 0) {
    return { timestamp: first, price: second };
  }

  const reversedTimestamp = normalizeTimestamp(value[1]);
  const reversedPrice = finiteNumber(value[0]);
  if (
    Number.isFinite(reversedTimestamp) &&
    reversedTimestamp > 1_000_000_000 &&
    reversedPrice !== null &&
    reversedPrice > 0
  ) {
    return { timestamp: reversedTimestamp, price: reversedPrice };
  }

  return null;
}

function entriesFromContainer(value: unknown): Array<[string, unknown]> {
  if (Array.isArray(value)) {
    return value.map((item, index) => [String(index), item]);
  }
  if (isRecord(value)) {
    return Object.entries(value);
  }
  return [];
}

function numericKey(value: string): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function getPositiveInteger(value: unknown, keys: string[]): number | null {
  if (!isRecord(value)) {
    return null;
  }
  for (const key of keys) {
    const parsed = finiteInteger(value[key]);
    if (parsed !== null && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

function finiteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function finiteInteger(value: unknown): number | null {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
