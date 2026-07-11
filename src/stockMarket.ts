import { readJsonObject } from "./backend/request";
import { fetchTrackedTornJson } from "./external/torn";
import { readSyncTimestamp, upsertSyncTimestamp } from "./syncState";
import { withTornKeyPool } from "./tornKeyPool";
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
  market_cap: number | null;
  total_shares: number | null;
  investors: number | null;
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

type StockBenefitValueOverride = {
  benefit_key: string;
  override_value: number;
};

type StockBenefitItemPrice = {
  benefit_key: string;
  market_type: string;
  torn_item_id: number | null;
  item_name: string | null;
  market_value: number | null;
  fetched_at: number | null;
  status: string;
  error: string | null;
  raw_json: string | null;
};

type StockInvestmentProfileRow = {
  stock_id: number;
  acronym: string | null;
  name: string | null;
  current_price: number | null;
  benefit_json: string | null;
  latest_price: number | null;
  latest_observed_at: number | null;
};

export type StockBenefitValueSource = "cash" | "custom" | "default" | "unpriced";

export type StockBenefitValueRow = {
  benefit_key: string;
  label: string;
  default_value: number | null;
  override_value: number | null;
  effective_value: number | null;
  source: Exclude<StockBenefitValueSource, "cash">;
  used_by_stock_count: number;
};

export type StockInvestmentRoiRow = {
  stock_id: number;
  acronym: string | null;
  name: string | null;
  increment: number;
  required_shares: number;
  total_shares_required: number;
  latest_price: number;
  increment_cost: number;
  total_cost: number;
  benefit_key: string | null;
  benefit_description: string;
  valuation_source: StockBenefitValueSource;
  frequency_days: number;
  benefit_value: number;
  annual_return: number;
  days_to_break_even: number;
  roi_percent: number;
};

type ParsedActiveBenefit = {
  passive: false;
  frequency: number;
  requirement: number;
  description: string;
};

type ParsedBenefitValue = {
  benefit_key: string | null;
  label: string;
  value: number | null;
  editable: boolean;
};

type NormalizedMarketOffer = {
  price: number;
  quantity: number;
};

type StockBenefitItemDefinition = {
  marketType: "itemmarket";
  benefitKey: string;
  label: string;
  tornItemId: number;
};

type StockBenefitPointsDefinition = {
  marketType: "pointsmarket";
  benefitKey: string;
  label: string;
  quantity: number;
};

type StockBenefitMarketDefinition = StockBenefitItemDefinition | StockBenefitPointsDefinition;

const TORN_API_BASE = "https://api.torn.com/v2";
const REQUEST_TIMEOUT_MS = 12_000;
const STOCK_PROFILE_REFRESH_STATE = "stock_market_profiles_refreshed";
const PROFILE_REFRESH_SECONDS = 24 * 60 * 60;
const STOCK_HISTORY_WINDOW_SECONDS = 60 * 60;
const STALE_STOCK_SECONDS = 5 * 60;
const DEFAULT_STOCK_IDS = Array.from({ length: 35 }, (_, index) => index + 1);
const PRIMARY_STOCK_CADENCE = "1m all-stocks";
const RECOVERY_STOCK_CADENCE = "30m stale-stock history fallback";
const MAX_ROI_INCREMENTS = 10;
const BENEFIT_ITEM_PRICE_REFRESH_SECONDS = 6 * 60 * 60;
const BENEFIT_ITEM_REFERENCE_QUANTITY = 5;
const DEFAULT_BENEFIT_VALUES: Record<string, number> = {
  "item:box_of_medical_supplies": 850_000,
};
const STOCK_BENEFIT_MARKET_DEFINITIONS: StockBenefitMarketDefinition[] = [
  { marketType: "itemmarket", benefitKey: "item:lawyer_s_business_card", label: "Lawyer's Business Card", tornItemId: 368 },
  { marketType: "itemmarket", benefitKey: "item:box_of_medical_supplies", label: "Box of Medical Supplies", tornItemId: 365 },
  { marketType: "itemmarket", benefitKey: "item:feathery_hotel_coupon", label: "Feathery Hotel Coupon", tornItemId: 367 },
  { marketType: "itemmarket", benefitKey: "item:drug_pack", label: "Drug Pack", tornItemId: 370 },
  { marketType: "itemmarket", benefitKey: "item:lottery_voucher", label: "Lottery Voucher", tornItemId: 369 },
  { marketType: "itemmarket", benefitKey: "item:erotic_dvd", label: "Erotic DVD", tornItemId: 366 },
  { marketType: "itemmarket", benefitKey: "item:box_of_grenades", label: "Box of Grenades", tornItemId: 364 },
  { marketType: "itemmarket", benefitKey: "item:six_pack_of_energy_drink", label: "Six-Pack of Energy Drink", tornItemId: 818 },
  { marketType: "itemmarket", benefitKey: "item:six_pack_of_alcohol", label: "Six-Pack of Alcohol", tornItemId: 817 },
  { marketType: "pointsmarket", benefitKey: "item:100_points", label: "100 points", quantity: 100 },
];

function createStockIngestionRun(batchGroup: string, startedAt: number): StockIngestionRun {
  return {
    id: crypto.randomUUID(),
    batch_group: batchGroup,
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
}

export async function refreshTornStockMarketMinute(
  env: Env,
  scheduledTime: number,
): Promise<StockIngestionRun> {
  const startedAt = nowSeconds();
  const observedAt = minuteFromScheduledTime(scheduledTime);
  const run = createStockIngestionRun("minute", startedAt);
  await insertStockIngestionRun(env, run);

  try {
    const data = await fetchTornJson("/torn/stocks", env);
    const snapshots = normalizeStockMarketSnapshots(data, observedAt, startedAt);
    if (snapshots.length === 0) {
      throw new Error("Torn stocks response did not include snapshot prices");
    }

    const shouldSaveProfiles = await shouldSaveMinuteStockProfiles(env, startedAt);
    let profilesSaved = 0;
    if (shouldSaveProfiles) {
      const profiles = normalizeStockProfiles(data, startedAt);
      if (profiles.length === 0) {
        throw new Error("Torn stocks response did not include stock profiles");
      }
      await saveStockProfiles(env, profiles);
      await upsertSyncTimestamp(env, STOCK_PROFILE_REFRESH_STATE, startedAt, null);
      profilesSaved = profiles.length;
    }

    const written = await saveStockSnapshots(env, snapshots);

    run.stocks_attempted = Math.max(snapshots.length, profilesSaved);
    run.stocks_succeeded = snapshots.length;
    run.stocks_failed = Math.max(0, run.stocks_attempted - snapshots.length);
    run.points_seen = snapshots.length;
    run.points_written = written;
    run.details_json = JSON.stringify({
      source: "all-stocks",
      observed_at: observedAt,
      profiles_saved: profilesSaved,
      profile_refresh: shouldSaveProfiles,
      snapshots: snapshots.length,
    });
    run.status = run.stocks_failed > 0 ? "partial" : "ok";
    run.error = null;
    run.finished_at = nowSeconds();
    await updateStockIngestionRun(env, run);
    return run;
  } catch (err: any) {
    run.finished_at = nowSeconds();
    run.status = "error";
    run.error = err?.message || String(err);
    run.details_json = JSON.stringify({ source: "all-stocks" });
    await updateStockIngestionRun(env, run);
    return run;
  }
}

export async function refreshTornStockHistoryBatch(
  env: Env,
  scheduledTime: number,
  options: { forceAll?: boolean } = {},
): Promise<StockIngestionRun> {
  const startedAt = nowSeconds();
  const run = createStockIngestionRun("recovery", startedAt);

  await insertStockIngestionRun(env, run);

  const details: Array<{ stock_id: number; status: string; points?: number; written?: number; error?: string }> = [];

  try {
    const profiles = await ensureStockProfiles(env, startedAt);
    const stockIds = profiles.length > 0
      ? profiles.map((profile) => profile.stock_id).sort((a, b) => a - b)
      : DEFAULT_STOCK_IDS;
    const latestByStock = await readLatestSnapshotTimes(env, stockIds);
    const staleStockIds = options.forceAll ? stockIds : stockIds.filter((stockId) => {
      const latestObservedAt = latestByStock.get(stockId) ?? null;
      if (latestObservedAt === null) {
        return true;
      }
      const gapSeconds = Math.max(0, startedAt - latestObservedAt);
      if (gapSeconds > STALE_STOCK_SECONDS) {
        if (gapSeconds <= STOCK_HISTORY_WINDOW_SECONDS) {
          run.recoverable_gap_count += 1;
        } else {
          run.unrecoverable_gap_count += 1;
        }
        return true;
      }
      return false;
    });
    const batch = options.forceAll
      ? { group: "all" as const, stockIds }
      : selectRecoveryStockBatch(stockIds, staleStockIds, scheduledTime);

    run.batch_group = `recovery-${batch.group}`;
    run.stocks_attempted = batch.stockIds.length;

    await updateStockIngestionRun(env, run);

    for (const stockId of batch.stockIds) {
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

export type StockBenefitItemPriceRefreshResult = {
  ok: boolean;
  refreshed: number;
  skipped: number;
  failed: number;
  prices: Array<{
    benefit_key: string;
    label: string;
    market_type: string;
    torn_item_id: number | null;
    market_value: number | null;
    status: string;
    error: string | null;
  }>;
};

export async function refreshStockBenefitItemPrices(
  env: Env,
  options: { force?: boolean; now?: number } = {},
): Promise<StockBenefitItemPriceRefreshResult> {
  const fetchedAt = options.now ?? nowSeconds();
  const existing = new Map((await readStockBenefitItemPrices(env)).map((row) => [row.benefit_key, row]));
  const prices: StockBenefitItemPriceRefreshResult["prices"] = [];
  let refreshed = 0;
  let skipped = 0;
  let failed = 0;

  for (const definition of STOCK_BENEFIT_MARKET_DEFINITIONS) {
    const current = existing.get(definition.benefitKey);
    const currentFetchedAt = nullableNumber(current?.fetched_at);
    if (
      !options.force &&
      current?.status === "ok" &&
      currentFetchedAt !== null &&
      fetchedAt - currentFetchedAt < BENEFIT_ITEM_PRICE_REFRESH_SECONDS
    ) {
      skipped += 1;
      prices.push({
        benefit_key: definition.benefitKey,
        label: definition.label,
        market_type: definition.marketType,
        torn_item_id: stockBenefitDefinitionItemId(definition),
        market_value: nullableNumber(current.market_value),
        status: current.status,
        error: current.error,
      });
      continue;
    }

    try {
      const result = await fetchStockBenefitMarketValue(env, definition);
      const marketValue = result.marketValue;
      if (marketValue === null || marketValue <= 0) {
        throw new Error("Torn market response did not include priced listings");
      }

      await upsertStockBenefitItemPrice(env, {
        benefit_key: definition.benefitKey,
        market_type: definition.marketType,
        torn_item_id: stockBenefitDefinitionItemId(definition),
        item_name: result.itemName ?? definition.label,
        market_value: marketValue,
        fetched_at: fetchedAt,
        status: "ok",
        error: null,
        raw_json: JSON.stringify(result.rawJson),
      });
      refreshed += 1;
      prices.push({
        benefit_key: definition.benefitKey,
        label: definition.label,
        market_type: definition.marketType,
        torn_item_id: stockBenefitDefinitionItemId(definition),
        market_value: marketValue,
        status: "ok",
        error: null,
      });
    } catch (err: any) {
      const error = String(err?.message ?? err);
      await upsertStockBenefitItemPrice(env, {
        benefit_key: definition.benefitKey,
        market_type: definition.marketType,
        torn_item_id: stockBenefitDefinitionItemId(definition),
        item_name: current?.item_name ?? definition.label,
        market_value: nullableNumber(current?.market_value),
        fetched_at: currentFetchedAt,
        status: "error",
        error,
        raw_json: current?.raw_json ?? null,
      });
      failed += 1;
      prices.push({
        benefit_key: definition.benefitKey,
        label: definition.label,
        market_type: definition.marketType,
        torn_item_id: stockBenefitDefinitionItemId(definition),
        market_value: nullableNumber(current?.market_value),
        status: "error",
        error,
      });
    }
  }

  return {
    ok: failed === 0,
    refreshed,
    skipped,
    failed,
    prices,
  };
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
      s.market_cap AS latest_snapshot_market_cap,
      s.total_shares AS latest_snapshot_total_shares,
      s.investors AS latest_snapshot_investors,
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
    SELECT stock_id, observed_at, price, market_cap, total_shares, investors, fetched_at
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

export async function getStockInvestmentRoi(env: Env, tornUserId: number | null): Promise<Response> {
  if (!tornUserId) {
    return json({ ok: false, error: "Unauthorized", code: "UNAUTHORIZED" }, 401);
  }

  const [profiles, overrides, standardBenefitValues] = await Promise.all([
    readInvestmentProfileRows(env),
    readBenefitValueOverrides(env, tornUserId),
    readStockBenefitStandardValueMap(env),
  ]);
  const overrideMap = new Map(overrides.map((override) => [override.benefit_key, override.override_value]));
  const skipped = { passive: 0, unpriced: 0, invalid: 0 };
  const rows: StockInvestmentRoiRow[] = [];
  let refreshedAt: number | null = null;

  for (const profile of profiles) {
    refreshedAt = maxNullable(refreshedAt, nullableNumber(profile.latest_observed_at));
    const parsed = parseActiveStockBenefit(profile.benefit_json);
    if (parsed.status === "passive") {
      skipped.passive += 1;
      continue;
    }
    if (parsed.status !== "active") {
      skipped.invalid += 1;
      continue;
    }

    const price = nullableNumber(profile.latest_price) ?? nullableNumber(profile.current_price);
    if (price === null || price <= 0) {
      skipped.invalid += 1;
      continue;
    }

    const valued = valueStockBenefit(parsed.benefit, overrideMap, standardBenefitValues);
    if (valued.value === null || valued.value <= 0) {
      skipped.unpriced += 1;
      continue;
    }

    for (let increment = 1; increment <= MAX_ROI_INCREMENTS; increment += 1) {
      rows.push(stockInvestmentRoiRow(profile, parsed.benefit, valued, price, increment));
    }
  }

  rows.sort((left, right) => right.roi_percent - left.roi_percent);
  return json({
    ok: true,
    refreshed_at: refreshedAt,
    rows,
    skipped,
  });
}

export async function getStockBenefitValues(env: Env, tornUserId: number | null): Promise<Response> {
  if (!tornUserId) {
    return json({ ok: false, error: "Unauthorized", code: "UNAUTHORIZED" }, 401);
  }

  return json({
    ok: true,
    benefits: await readEffectiveStockBenefitValues(env, tornUserId),
  });
}

export async function updateStockBenefitValueFromRequest(
  request: Request,
  env: Env,
  tornUserId: number | null,
  benefitKey: string,
): Promise<Response> {
  if (!tornUserId) {
    return json({ ok: false, error: "Unauthorized", code: "UNAUTHORIZED" }, 401);
  }
  if (!isEditableBenefitKey(benefitKey)) {
    return json({ ok: false, error: "Invalid benefit key", code: "INVALID_BENEFIT_KEY" }, 400);
  }

  const body = await readJsonObject(request);
  if (body.override_value === null) {
    await deleteBenefitValueOverride(env, tornUserId, benefitKey);
    return json({
      ok: true,
      benefits: await readEffectiveStockBenefitValues(env, tornUserId),
    });
  }

  const overrideValue = positiveMoneyValue(body.override_value);
  if (overrideValue === null) {
    return json({ ok: false, error: "override_value must be a positive number or null", code: "INVALID_OVERRIDE_VALUE" }, 400);
  }

  await upsertBenefitValueOverride(env, tornUserId, benefitKey, overrideValue);
  return json({
    ok: true,
    benefits: await readEffectiveStockBenefitValues(env, tornUserId),
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
    primary_cadence: PRIMARY_STOCK_CADENCE,
    recovery_cadence: RECOVERY_STOCK_CADENCE,
    last_error: lastError?.error ?? null,
  });
}

export function selectRecoveryStockBatch(
  allStockIds: number[],
  staleStockIds: number[],
  scheduledTime: number,
): { group: "A" | "B" | "all"; stockIds: number[] } {
  const maxPerRun = Math.ceil(Math.max(allStockIds.length, DEFAULT_STOCK_IDS.length) / 2);
  if (staleStockIds.length <= maxPerRun) {
    return { group: "all", stockIds: staleStockIds };
  }
  return selectStockBatchForTime(staleStockIds, scheduledTime);
}

export function selectStockBatchForTime(
  stockIds: number[],
  scheduledTime: number,
): { group: "A" | "B"; stockIds: number[] } {
  const slot = Math.floor(scheduledTime / (30 * 60 * 1000));
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

async function readInvestmentProfileRows(env: Env): Promise<StockInvestmentProfileRow[]> {
  const rows = await env.DB.prepare(
    `
    SELECT
      p.stock_id,
      p.acronym,
      p.name,
      p.current_price,
      p.benefit_json,
      s.price AS latest_price,
      s.observed_at AS latest_observed_at
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
  ).all<StockInvestmentProfileRow>();

  return rows.results ?? [];
}

async function readBenefitValueOverrides(env: Env, tornUserId: number): Promise<StockBenefitValueOverride[]> {
  const rows = await env.DB.prepare(
    `
    SELECT benefit_key, override_value
    FROM stock_benefit_value_overrides
    WHERE torn_user_id = ?
    `,
  )
    .bind(tornUserId)
    .all<StockBenefitValueOverride>();

  return rows.results ?? [];
}

async function readStockBenefitStandardValueMap(env: Env): Promise<Map<string, number>> {
  const prices = await readStockBenefitItemPrices(env);
  const values = new Map<string, number>();
  for (const price of prices) {
    const marketValue = nullableNumber(price.market_value);
    if (marketValue !== null && marketValue > 0) {
      values.set(price.benefit_key, marketValue);
    }
  }
  return values;
}

async function readStockBenefitItemPrices(env: Env): Promise<StockBenefitItemPrice[]> {
  const rows = await env.DB.prepare(
    `
    SELECT *
    FROM stock_benefit_item_prices
    `,
  ).all<StockBenefitItemPrice>();

  return rows.results ?? [];
}

async function fetchStockBenefitMarketValue(
  env: Env,
  definition: StockBenefitMarketDefinition,
): Promise<{ marketValue: number | null; itemName: string | null; rawJson: unknown }> {
  if (definition.marketType === "pointsmarket") {
    const data = await fetchTornJson("/market", env, {
      selections: "pointsmarket",
      sort: "ASC",
    });
    return {
      marketValue: stockBenefitPointsValueFromResponse(data, definition.quantity),
      itemName: definition.label,
      rawJson: data,
    };
  }

  const data = await fetchTornJson(`/market/${definition.tornItemId}/itemmarket`, env, {
    limit: "20",
    offset: "0",
  });
  return {
    marketValue: stockBenefitMarketValueFromResponse(data),
    itemName: stockBenefitItemNameFromResponse(data),
    rawJson: data,
  };
}

function stockBenefitDefinitionItemId(definition: StockBenefitMarketDefinition): number | null {
  return definition.marketType === "itemmarket" ? definition.tornItemId : null;
}

async function readEffectiveStockBenefitValues(env: Env, tornUserId: number): Promise<StockBenefitValueRow[]> {
  const [profiles, overrides, standardBenefitValues] = await Promise.all([
    readInvestmentProfileRows(env),
    readBenefitValueOverrides(env, tornUserId),
    readStockBenefitStandardValueMap(env),
  ]);
  const overrideMap = new Map(overrides.map((override) => [override.benefit_key, nullableNumber(override.override_value)]));
  const observed = new Map<string, { label: string; usedByStockIds: Set<number> }>();

  for (const profile of profiles) {
    const parsed = parseActiveStockBenefit(profile.benefit_json);
    if (parsed.status !== "active") {
      continue;
    }
    const benefitValue = parseBenefitDescription(parsed.benefit.description);
    if (!benefitValue.editable || !benefitValue.benefit_key) {
      continue;
    }

    const current = observed.get(benefitValue.benefit_key) ?? {
      label: benefitValue.label,
      usedByStockIds: new Set<number>(),
    };
    current.usedByStockIds.add(profile.stock_id);
    observed.set(benefitValue.benefit_key, current);
  }

  return [...observed.entries()]
    .map(([benefitKey, value]) => {
      const defaultValue = stockBenefitDefaultValue(benefitKey, standardBenefitValues);
      const overrideValue = overrideMap.get(benefitKey) ?? null;
      const effectiveValue = overrideValue ?? defaultValue;
      return {
        benefit_key: benefitKey,
        label: value.label,
        default_value: defaultValue,
        override_value: overrideValue,
        effective_value: effectiveValue,
        source: overrideValue !== null ? "custom" as const : defaultValue !== null ? "default" as const : "unpriced" as const,
        used_by_stock_count: value.usedByStockIds.size,
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label));
}

async function upsertBenefitValueOverride(
  env: Env,
  tornUserId: number,
  benefitKey: string,
  overrideValue: number,
): Promise<void> {
  await env.DB.prepare(
    `
    INSERT INTO stock_benefit_value_overrides (torn_user_id, benefit_key, override_value, updated_at)
    VALUES (?, ?, ?, unixepoch())
    ON CONFLICT(torn_user_id, benefit_key) DO UPDATE SET
      override_value = excluded.override_value,
      updated_at = excluded.updated_at
    `,
  )
    .bind(tornUserId, benefitKey, overrideValue)
    .run();
}

async function deleteBenefitValueOverride(env: Env, tornUserId: number, benefitKey: string): Promise<void> {
  await env.DB.prepare(
    `
    DELETE FROM stock_benefit_value_overrides
    WHERE torn_user_id = ? AND benefit_key = ?
    `,
  )
    .bind(tornUserId, benefitKey)
    .run();
}

async function upsertStockBenefitItemPrice(env: Env, price: StockBenefitItemPrice): Promise<void> {
  await env.DB.prepare(
    `
    INSERT INTO stock_benefit_item_prices (
      benefit_key,
      market_type,
      torn_item_id,
      item_name,
      market_value,
      fetched_at,
      status,
      error,
      raw_json,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
    ON CONFLICT(benefit_key) DO UPDATE SET
      market_type = excluded.market_type,
      torn_item_id = excluded.torn_item_id,
      item_name = excluded.item_name,
      market_value = excluded.market_value,
      fetched_at = excluded.fetched_at,
      status = excluded.status,
      error = excluded.error,
      raw_json = excluded.raw_json,
      updated_at = excluded.updated_at
    `,
  )
    .bind(
      price.benefit_key,
      price.market_type,
      price.torn_item_id,
      price.item_name,
      price.market_value,
      price.fetched_at,
      price.status,
      price.error,
      price.raw_json,
    )
    .run();
}

export function parseActiveStockBenefit(
  benefitJson: string | null,
): { status: "active"; benefit: ParsedActiveBenefit } | { status: "passive" | "invalid" } {
  if (!benefitJson) {
    return { status: "invalid" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(benefitJson);
  } catch {
    return { status: "invalid" };
  }

  if (!isRecord(parsed)) {
    return { status: "invalid" };
  }
  if (parsed.passive !== false) {
    return { status: parsed.passive === true ? "passive" : "invalid" };
  }

  const frequency = finiteInteger(parsed.frequency);
  const requirement = finiteInteger(parsed.requirement);
  const description = cleanString(parsed.description);
  if (!frequency || frequency <= 0 || !requirement || requirement <= 0 || !description) {
    return { status: "invalid" };
  }

  return {
    status: "active",
    benefit: {
      passive: false,
      frequency,
      requirement,
      description,
    },
  };
}

export function parseBenefitDescription(
  description: string,
  standardBenefitValues: ReadonlyMap<string, number> = new Map(),
): ParsedBenefitValue {
  const trimmed = description.trim();
  const cashValue = parseCashBenefitValue(trimmed);
  if (cashValue !== null) {
    return {
      benefit_key: null,
      label: trimmed,
      value: cashValue,
      editable: false,
    };
  }

  const item = /^(\d+(?:\.\d+)?)\s*x\s+(.+)$/i.exec(trimmed);
  if (item) {
    const quantity = Number(item[1]);
    const label = item[2].trim();
    const benefitKey = `item:${slugifyBenefitLabel(label)}`;
    const unitValue = stockBenefitDefaultValue(benefitKey, standardBenefitValues);
    return {
      benefit_key: benefitKey,
      label,
      value: unitValue === null ? null : quantity * unitValue,
      editable: true,
    };
  }

  const benefitKey = `item:${slugifyBenefitLabel(trimmed)}`;
  return {
    benefit_key: benefitKey,
    label: trimmed,
    value: stockBenefitDefaultValue(benefitKey, standardBenefitValues),
    editable: true,
  };
}

export function valueStockBenefit(
  benefit: Pick<ParsedActiveBenefit, "description">,
  overrideMap: Map<string, number | null>,
  standardBenefitValues: ReadonlyMap<string, number> = new Map(),
): ParsedBenefitValue & { source: StockBenefitValueSource } {
  const parsed = parseBenefitDescription(benefit.description, standardBenefitValues);
  if (!parsed.editable || !parsed.benefit_key) {
    return { ...parsed, source: "cash" };
  }

  const overrideValue = overrideMap.get(parsed.benefit_key) ?? null;
  if (overrideValue !== null && overrideValue > 0) {
    const baseParsed = /^(\d+(?:\.\d+)?)\s*x\s+(.+)$/i.exec(benefit.description.trim());
    const quantity = baseParsed ? Number(baseParsed[1]) : 1;
    return { ...parsed, value: quantity * overrideValue, source: "custom" };
  }

  return {
    ...parsed,
    source: parsed.value === null ? "unpriced" : "default",
  };
}

export function calculateStockInvestmentIncrement(input: {
  requirement: number;
  latestPrice: number;
  benefitValue: number;
  frequencyDays: number;
  increment: number;
}): Pick<StockInvestmentRoiRow, "required_shares" | "total_shares_required" | "increment_cost" | "total_cost" | "annual_return" | "days_to_break_even" | "roi_percent"> {
  const requiredShares = input.requirement * 2 ** (input.increment - 1);
  const totalSharesRequired = input.requirement * (2 ** input.increment - 1);
  const incrementCost = requiredShares * input.latestPrice;
  const totalCost = totalSharesRequired * input.latestPrice;
  const annualReturn = input.benefitValue * (365 / input.frequencyDays);
  return {
    required_shares: requiredShares,
    total_shares_required: totalSharesRequired,
    increment_cost: incrementCost,
    total_cost: totalCost,
    annual_return: annualReturn,
    days_to_break_even: incrementCost / (input.benefitValue / input.frequencyDays),
    roi_percent: (annualReturn / incrementCost) * 100,
  };
}

export function stockBenefitMarketValueFromResponse(data: unknown): number | null {
  return priceAtCumulativeQuantity(
    normalizeMarketOffers(data, "itemmarket"),
    BENEFIT_ITEM_REFERENCE_QUANTITY,
  );
}

export function stockBenefitPointsValueFromResponse(data: unknown, quantity: number): number | null {
  const unitValue = priceAtCumulativeQuantity(normalizeMarketOffers(data, "pointsmarket"), quantity);
  return unitValue === null ? null : unitValue * quantity;
}

function stockInvestmentRoiRow(
  profile: Pick<StockInvestmentProfileRow, "stock_id" | "acronym" | "name">,
  benefit: ParsedActiveBenefit,
  valued: ParsedBenefitValue & { source: StockBenefitValueSource },
  latestPrice: number,
  increment: number,
): StockInvestmentRoiRow {
  const calculated = calculateStockInvestmentIncrement({
    requirement: benefit.requirement,
    latestPrice,
    benefitValue: valued.value ?? 0,
    frequencyDays: benefit.frequency,
    increment,
  });
  return {
    stock_id: profile.stock_id,
    acronym: profile.acronym,
    name: profile.name,
    increment,
    ...calculated,
    latest_price: latestPrice,
    benefit_key: valued.benefit_key,
    benefit_description: benefit.description,
    valuation_source: valued.source,
    frequency_days: benefit.frequency,
    benefit_value: valued.value ?? 0,
  };
}

function parseCashBenefitValue(value: string): number | null {
  if (!/^\$[\d,]+(?:\.\d+)?$/.test(value)) {
    return null;
  }
  const parsed = Number(value.replace(/[$,]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function stockBenefitItemNameFromResponse(data: unknown): string | null {
  if (!isRecord(data)) {
    return null;
  }
  const item = isRecord(data.item) ? data.item : null;
  return cleanString(item?.name ?? data.name ?? data.item_name);
}

function normalizeMarketOffers(data: unknown, key: "itemmarket" | "bazaar" | "pointsmarket"): NormalizedMarketOffer[] {
  if (!isRecord(data)) {
    return [];
  }
  const container = data[key];
  const raw = isRecord(container)
    ? container.listings ?? container
    : container ?? (key === "itemmarket" ? data.listings : null);
  const offers = Array.isArray(raw) ? raw : isRecord(raw) ? Object.values(raw) : [];
  return offers
    .map((offer): NormalizedMarketOffer | null => {
      if (!isRecord(offer)) {
        return null;
      }
      const price = nullableNumber(offer.cost ?? offer.price ?? offer.market_price);
      if (price === null || price <= 0) {
        return null;
      }
      return {
        price,
        quantity: Math.max(1, finiteInteger(offer.quantity ?? offer.qty ?? offer.amount) ?? 1),
      };
    })
    .filter((offer): offer is NormalizedMarketOffer => Boolean(offer))
    .sort((left, right) => left.price - right.price);
}

function priceAtCumulativeQuantity(offers: NormalizedMarketOffer[], targetQuantity: number): number | null {
  let seen = 0;
  let lastPrice: number | null = null;

  for (const offer of offers) {
    lastPrice = offer.price;
    seen += Math.max(1, offer.quantity);
    if (seen >= targetQuantity) {
      return offer.price;
    }
  }

  return lastPrice;
}

function stockBenefitDefaultValue(
  benefitKey: string,
  standardBenefitValues: ReadonlyMap<string, number>,
): number | null {
  return standardBenefitValues.get(benefitKey) ?? DEFAULT_BENEFIT_VALUES[benefitKey] ?? null;
}

function slugifyBenefitLabel(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function isEditableBenefitKey(value: string): boolean {
  return /^item:[a-z0-9_]+$/.test(value);
}

function positiveMoneyValue(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function nullableNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function maxNullable(left: number | null, right: number | null): number | null {
  if (left === null) return right;
  if (right === null) return left;
  return Math.max(left, right);
}

async function readLatestSnapshotTimes(env: Env, stockIds: number[]): Promise<Map<number, number>> {
  if (stockIds.length === 0) {
    return new Map();
  }

  const statements = stockIds.map((stockId) =>
    env.DB.prepare(
      `
      SELECT observed_at
      FROM stock_price_snapshots
      WHERE stock_id = ?
      ORDER BY observed_at DESC
      LIMIT 1
      `,
    ).bind(stockId),
  );
  const results = await env.DB.batch(statements);
  const latestByStock = new Map<number, number>();
  results.forEach((result, index) => {
    const row = (result.results?.[0] ?? null) as { observed_at?: number | null } | null;
    if (row?.observed_at !== null && row?.observed_at !== undefined) {
      latestByStock.set(stockIds[index], Number(row.observed_at));
    }
  });
  return latestByStock;
}

async function readStockCoverage(env: Env, now: number): Promise<StockCoverageRow> {
  const row = await env.DB.prepare(
    `
    WITH latest AS (
      SELECT
        p.stock_id,
        (
          SELECT observed_at
          FROM stock_price_snapshots
          WHERE stock_id = p.stock_id
          ORDER BY observed_at DESC
          LIMIT 1
        ) AS latest_observed_at
      FROM stock_profiles p
    )
    SELECT
      COUNT(*) AS total_stocks,
      COUNT(latest_observed_at) AS stocks_with_snapshots,
      MIN(latest_observed_at) AS oldest_snapshot_at,
      MAX(latest_observed_at) AS newest_snapshot_at,
      SUM(CASE WHEN latest_observed_at IS NULL OR latest_observed_at < ? THEN 1 ELSE 0 END) AS stale_stocks
    FROM latest
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

async function shouldSaveMinuteStockProfiles(env: Env, now: number): Promise<boolean> {
  const lastRefresh = await readSyncTimestamp(env, STOCK_PROFILE_REFRESH_STATE);
  if (lastRefresh === 0 || now - lastRefresh >= PROFILE_REFRESH_SECONDS) {
    return true;
  }

  const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM stock_profiles").first<{ count: number }>();
  return Number(row?.count ?? 0) === 0;
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
        market_cap,
        total_shares,
        investors,
        raw_json,
        fetched_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(stock_id, observed_at) DO UPDATE SET
        price = excluded.price,
        market_cap = COALESCE(excluded.market_cap, stock_price_snapshots.market_cap),
        total_shares = COALESCE(excluded.total_shares, stock_price_snapshots.total_shares),
        investors = COALESCE(excluded.investors, stock_price_snapshots.investors),
        raw_json = excluded.raw_json,
        fetched_at = excluded.fetched_at
      `,
    ).bind(
      snapshot.stock_id,
      snapshot.observed_at,
      snapshot.price,
      snapshot.market_cap,
      snapshot.total_shares,
      snapshot.investors,
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

async function fetchTornJson(endpoint: string, env: Env, params: Record<string, string> = {}): Promise<unknown> {
  const url = new URL(`${TORN_API_BASE}${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  return withTornKeyPool(env, {
    feature: "stock_tools",
    run: ({ key, keySource }) => fetchTrackedTornJson<unknown>(env, url, {
      headers: {
        Accept: "application/json",
        Authorization: `ApiKey ${key}`,
        "User-Agent": "buttgrass-stock-market/1.0",
      },
    }, {
      feature: "stock-market",
      keySource,
      timeoutMs: REQUEST_TIMEOUT_MS,
    }, {
      service: "Torn stock",
    }),
  });
}

function normalizeStockProfiles(data: unknown, fetchedAt: number): StockProfile[] {
  const container = isRecord(data) ? data.stocks : null;
  const entries = entriesFromContainer(container);
  return entries
    .map(([key, value]) => normalizeStockProfile(value, numericKey(key), fetchedAt))
    .filter((profile): profile is StockProfile => Boolean(profile));
}

function normalizeStockMarketSnapshots(data: unknown, observedAt: number, fetchedAt: number): StockSnapshot[] {
  const container = isRecord(data) ? data.stocks : null;
  return entriesFromContainer(container)
    .map(([key, value]) => normalizeStockMarketSnapshot(value, numericKey(key), observedAt, fetchedAt))
    .filter((snapshot): snapshot is StockSnapshot => Boolean(snapshot));
}

function normalizeStockMarketSnapshot(
  value: unknown,
  fallbackId: number | null,
  observedAt: number,
  fetchedAt: number,
): StockSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }

  const stockId = getPositiveInteger(value, ["id", "stock_id", "stockId"]) ?? fallbackId;
  const price = stockPriceFromValue(value);
  if (!stockId || price === null || price <= 0) {
    return null;
  }

  return {
    stock_id: stockId,
    observed_at: observedAt,
    price,
    market_cap: stockMarketCapFromValue(value),
    total_shares: stockTotalSharesFromValue(value),
    investors: stockInvestorsFromValue(value),
    raw_json: null,
    fetched_at: fetchedAt,
  };
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

  const benefit = isRecord(value.benefit) || Array.isArray(value.benefit)
    ? value.benefit
    : (isRecord(value.bonus) || Array.isArray(value.bonus) ? value.bonus : null);
  return {
    stock_id: stockId,
    acronym: cleanString(value.acronym ?? value.ticker ?? value.symbol),
    name: cleanString(value.name),
    current_price: stockPriceFromValue(value),
    market_cap: stockMarketCapFromValue(value),
    total_shares: stockTotalSharesFromValue(value),
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
    addSnapshot(stockId, keyTimestamp, value, null, null, null, value, fetchedAt, byTimestamp);
    return;
  }

  if (Array.isArray(value)) {
    const tuple = tupleSnapshot(value);
    if (tuple) {
      addSnapshot(stockId, tuple.timestamp, tuple.price, null, null, null, value, fetchedAt, byTimestamp);
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
    addSnapshot(
      stockId,
      timestamp,
      price,
      stockMarketCapFromValue(value),
      stockTotalSharesFromValue(value),
      stockInvestorsFromValue(value),
      value,
      fetchedAt,
      byTimestamp,
    );
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
  marketCap: number | null,
  totalShares: number | null,
  investors: number | null,
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
    market_cap: marketCap,
    total_shares: totalShares,
    investors,
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

function stockPriceFromValue(value: Record<string, unknown>): number | null {
  const market = isRecord(value.market) ? value.market : null;
  return priceFromValue(market ?? value) ?? priceFromValue(value);
}

function stockMarketCapFromValue(value: Record<string, unknown>): number | null {
  const market = isRecord(value.market) ? value.market : null;
  return finiteInteger(
    value.market_cap ??
      value.marketCap ??
      value.marketcap ??
      market?.cap ??
      market?.market_cap ??
      market?.marketCap,
  );
}

function stockTotalSharesFromValue(value: Record<string, unknown>): number | null {
  const market = isRecord(value.market) ? value.market : null;
  return finiteInteger(
    value.total_shares ??
      value.totalShares ??
      market?.shares ??
      market?.total_shares ??
      market?.totalShares,
  );
}

function stockInvestorsFromValue(value: Record<string, unknown>): number | null {
  const market = isRecord(value.market) ? value.market : null;
  return finiteInteger(
    value.investors ??
      value.investor_count ??
      value.investorCount ??
      market?.investors ??
      market?.investor_count ??
      market?.investorCount,
  );
}

function minuteFromScheduledTime(scheduledTime: number): number {
  return Math.floor(Math.floor(scheduledTime / 1000) / 60) * 60;
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
