import type { StockInvestmentRoiResponse, StockInvestmentRoiRow } from "../api/types";
import type { OwnedStockSnapshot } from "./ownedStocks";

export const MAX_PLANNER_FILE_BYTES = 2_000_000;
export type StockPlannerSettings = {
  cash: { cashAvailable: string; investmentIncomePerWeek: string; additionalIncomePerWeek: string };
  privateIsland: { count: string; costEach: string; dailyRentEach: string; vacantDays: string };
  manualCityBankActive: boolean; bankMerits: number;
  includeFhgTciHybrid: boolean; fhgTciHybridActive: boolean; includePrivateIslandRental: boolean;
  lockedStockIds: number[]; manualOwnedRowIds: string[];
  minimumRoi: string; affordableOnly: boolean; hideOwnedBlocks: boolean;
};
export type StockPlannerExport = {
  format: "torn-stock-planner";
  version: 1;
  asOf: number;
  roi: StockInvestmentRoiResponse;
  portfolio: OwnedStockSnapshot | null;
  settings: StockPlannerSettings;
};

/** Replay the recorded payout progress at its own timestamp, even if exported on a later day. */
export function stockPlannerReplayAsOf(data: StockPlannerExport): number {
  return data.portfolio && data.portfolio.refreshed_at > 0 ? data.portfolio.refreshed_at : data.asOf;
}

/** Explicitly reconstruct allowed fields on both import and export; never serialize app/session storage. */
export function sanitizeStockPlannerExport(value: unknown): StockPlannerExport {
  const data = record(value);
  if (data.format !== "torn-stock-planner" || data.version !== 1) throw new Error("Choose a supported Stock ROI planner export (version 1).");
  const roi = record(data.roi), skipped = record(roi.skipped), settings = record(data.settings);
  const cash = record(settings.cash), island = record(settings.privateIsland);
  const rows = list(roi.rows, 1000).map(parseRow);
  if (new Set(rows.map(row => row.row_id)).size !== rows.length) invalid();
  return {
    format: "torn-stock-planner", version: 1, asOf: timestamp(data.asOf),
    roi: {
      ok: bool(roi.ok), refreshed_at: roi.refreshed_at === null ? null : timestamp(roi.refreshed_at), benefit_prices_refreshed_at: roi.benefit_prices_refreshed_at === null ? null : timestamp(roi.benefit_prices_refreshed_at), rows,
      skipped: { passive: number(skipped.passive), unpriced: number(skipped.unpriced), invalid: number(skipped.invalid), disabled: number(skipped.disabled) },
    },
    portfolio: data.portfolio === null ? null : parsePortfolio(data.portfolio),
    settings: {
      cash: { cashAvailable: string(cash.cashAvailable), investmentIncomePerWeek: string(cash.investmentIncomePerWeek), additionalIncomePerWeek: string(cash.additionalIncomePerWeek) },
      privateIsland: { count: string(island.count), costEach: string(island.costEach), dailyRentEach: string(island.dailyRentEach), vacantDays: string(island.vacantDays) },
      manualCityBankActive: bool(settings.manualCityBankActive), bankMerits: integer(settings.bankMerits, 0, 10),
      includeFhgTciHybrid: bool(settings.includeFhgTciHybrid), fhgTciHybridActive: bool(settings.fhgTciHybridActive), includePrivateIslandRental: bool(settings.includePrivateIslandRental),
      lockedStockIds: list(settings.lockedStockIds, 500).map(id => integer(id, 1)),
      manualOwnedRowIds: list(settings.manualOwnedRowIds, 1000).map(string),
      minimumRoi: string(settings.minimumRoi), affordableOnly: bool(settings.affordableOnly), hideOwnedBlocks: bool(settings.hideOwnedBlocks),
    },
  };
}

export function parseStockPlannerFile(text: string): StockPlannerExport {
  if (new Blob([text]).size > MAX_PLANNER_FILE_BYTES) throw new Error("Planner files must be smaller than 2 MB.");
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error("This file is not valid JSON. Choose a Stock ROI planner export."); }
  return sanitizeStockPlannerExport(value);
}

export function serializeStockPlannerExport(value: StockPlannerExport): string {
  return JSON.stringify(sanitizeStockPlannerExport(value), null, 2);
}

function parseRow(value: unknown): StockInvestmentRoiRow {
  const row = record(value);
  if (row.investment_type !== "stock" && row.investment_type !== "city_bank") invalid();
  const valuation = string(row.valuation_source);
  if (!["cash", "market", "custom", "default", "unpriced"].includes(valuation)) invalid();
  const result: StockInvestmentRoiRow = {
    investment_type: row.investment_type as StockInvestmentRoiRow["investment_type"],
    row_id: string(row.row_id), stock_id: nullableNumber(row.stock_id), acronym: nullableString(row.acronym), name: nullableString(row.name),
    increment: nullableNumber(row.increment), required_shares: nullableNumber(row.required_shares), total_shares_required: nullableNumber(row.total_shares_required),
    latest_price: nullableNumber(row.latest_price), increment_cost: number(row.increment_cost), total_cost: number(row.total_cost),
    benefit_key: nullableString(row.benefit_key), benefit_description: string(row.benefit_description),
    valuation_source: valuation as StockInvestmentRoiRow["valuation_source"], frequency_days: number(row.frequency_days, Number.EPSILON),
    benefit_value: number(row.benefit_value), annual_return: number(row.annual_return), days_to_break_even: number(row.days_to_break_even), roi_percent: number(row.roi_percent),
  };
  if (result.investment_type === "stock" && [result.stock_id, result.increment, result.required_shares, result.total_shares_required, result.latest_price].some(value => value === null || value <= 0)) invalid();
  return result;
}

function parsePortfolio(value: unknown): OwnedStockSnapshot {
  const data = record(value);
  const stocks = list(data.stocks, 500).map(value => {
    const stock = record(value), bonus = stock.bonus === null ? null : record(stock.bonus);
    return {
      stock_id: integer(stock.stock_id, 1), shares: integer(stock.shares),
      bonus: bonus === null ? null : {
        available: bonus.available === null ? null : bool(bonus.available),
        increment: nullableNumber(bonus.increment), progress: nullableNumber(bonus.progress), frequency: nullableNumber(bonus.frequency),
      },
    };
  });
  if (new Set(stocks.map(stock => stock.stock_id)).size !== stocks.length) invalid();
  const result: OwnedStockSnapshot = { refreshed_at: timestamp(data.refreshed_at), stocks };
  if (data.city_bank === null) result.city_bank = null;
  else if (data.city_bank !== undefined) {
    const bank = record(data.city_bank);
    result.city_bank = {
      amount: number(bank.amount), profit: number(bank.profit), duration: number(bank.duration, Number.EPSILON),
      interest_rate: number(bank.interest_rate), until: timestamp(bank.until), invested_at: timestamp(bank.invested_at),
    };
    if (result.city_bank.amount <= result.city_bank.profit) invalid();
  }
  return result;
}

function invalid(): never { throw new Error("Planner file contains missing or invalid values. Export a new file from Stock ROI."); }
function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) invalid(); return value as Record<string, unknown>; }
function list(value: unknown, max: number): unknown[] { if (!Array.isArray(value) || value.length > max) invalid(); return value; }
function number(value: unknown, min = 0): number { if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > Number.MAX_SAFE_INTEGER) invalid(); return value; }
function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number { const result = number(value, min); if (!Number.isInteger(result) || result > max) invalid(); return result; }
function timestamp(value: unknown): number { return integer(value, 0, 253_402_300_799); }
function string(value: unknown): string { if (typeof value !== "string" || value.length > 500) invalid(); return value; }
function bool(value: unknown): boolean { if (typeof value !== "boolean") invalid(); return value; }
function nullableNumber(value: unknown): number | null { return value === null ? null : number(value); }
function nullableString(value: unknown): string | null { return value === null ? null : string(value); }
