import { describe, expect, it } from "vitest";
import { buildStockStrategyTimeline } from "./stockStrategyTimeline";
import { parseStockPlannerFile, sanitizeStockPlannerExport, serializeStockPlannerExport, stockPlannerReplayAsOf, type StockPlannerExport } from "./stockPlannerTransfer";

const AS_OF = Date.UTC(2026, 9, 1, 12) / 1000;
function fixture(): StockPlannerExport {
  return {
    format: "torn-stock-planner", version: 1, asOf: AS_OF,
    roi: {
      ok: true, refreshed_at: AS_OF, benefit_prices_refreshed_at: AS_OF,
      skipped: { passive: 1, unpriced: 2, invalid: 0, disabled: 3 },
      rows: [1, 2].map(id => ({
        investment_type: "stock", row_id: `stock:${id}:1`, stock_id: id, acronym: `S${id}`, name: `Stock ${id}`,
        increment: 1, required_shares: 100, total_shares_required: 100, latest_price: 1, increment_cost: 100, total_cost: 100,
        benefit_key: "cash:test", benefit_description: "1x Reward", valuation_source: "custom",
        frequency_days: 7, benefit_value: 10, annual_return: 10 * 365 / 7, days_to_break_even: 70, roi_percent: 10 * 365 / 7,
      })),
    },
    portfolio: {
      refreshed_at: AS_OF, stocks: [{ stock_id: 1, shares: 150, bonus: { available: false, increment: 1, progress: 6, frequency: 7 } }],
      city_bank: { amount: 1100, profit: 100, duration: 90, interest_rate: 10, until: AS_OF + 86400, invested_at: AS_OF - 89 * 86400 },
    },
    settings: {
      cash: { cashAvailable: "0m", investmentIncomePerWeek: "", additionalIncomePerWeek: "70" },
      privateIsland: { count: "0", costEach: "1.7b", dailyRentEach: "900k", vacantDays: "7" },
      manualCityBankActive: false, bankMerits: 10, includeFhgTciHybrid: false, fhgTciHybridActive: false, includePrivateIslandRental: true,
      lockedStockIds: [1], manualOwnedRowIds: [], minimumRoi: "5", affordableOnly: false, hideOwnedBlocks: true,
    },
  };
}

describe("stock planner export/import", () => {
  it("round-trips prices, holdings, bank/progress, raw inputs and settings", () => {
    const data = fixture();
    expect(parseStockPlannerFile(serializeStockPlannerExport(data))).toEqual(data);
  });

  it("omits credentials, account identity and other balances even from nested objects", () => {
    const data = fixture();
    const poisoned = {
      ...data, apiKey: "SECRET", session: { token: "TOKEN", user: { id: 999, name: "PRIVATE" } },
      roi: { ...data.roi, apiKey: "SECRET", rows: data.roi.rows.map(row => ({ ...row, token: "SECRET" })) },
      portfolio: { ...data.portfolio!, user_id: 999, apiKey: "SECRET", wallet: 54321,
        stocks: data.portfolio!.stocks.map(stock => ({ ...stock, transactions: [{ key: "SECRET" }], bonus: { ...stock.bonus, key: "SECRET" } })),
        city_bank: { ...data.portfolio!.city_bank!, key: "SECRET" } },
      settings: { ...data.settings, ownedApiKey: "SECRET", cash: { ...data.settings.cash, token: "SECRET" } },
    };
    const serialized = serializeStockPlannerExport(poisoned);
    expect(serialized).not.toMatch(/SECRET|TOKEN|PRIVATE|wallet|transactions|user_id|apiKey|ownedApiKey/);
    expect(parseStockPlannerFile(serialized)).toEqual(data);
  });

  it("replays identical funding, sales and dates even when opened on a later day", () => {
    const data = fixture();
    const restored = parseStockPlannerFile(serializeStockPlannerExport(data));
    const forecast = (value: StockPlannerExport) => buildStockStrategyTimeline({
      rows: value.roi.rows, ownedSnapshot: value.portfolio, asOf: value.asOf, cityBankActive: true,
      budget: 0, additionalIncomePerWeek: 70, minimumRoi: null, affordableOnly: false, lockedStockIds: new Set(value.settings.lockedStockIds),
    });
    expect(forecast(data).timeline.length).toBeGreaterThan(0);
    expect(forecast(restored)).toEqual(forecast(data));
    expect(forecast({ ...restored, asOf: AS_OF + 86400 }).issues).not.toEqual([]);
  });

  it("preserves missing bank details and missing portfolios without inventing data", () => {
    const data = fixture();
    delete data.portfolio!.city_bank;
    expect(parseStockPlannerFile(serializeStockPlannerExport(data)).portfolio?.city_bank).toBeUndefined();
    data.portfolio = null;
    expect(parseStockPlannerFile(serializeStockPlannerExport(data)).portfolio).toBeNull();
  });

  it("replays an older portfolio when the file was exported days after refreshing holdings", () => {
    const original = fixture();
    const laterExport = parseStockPlannerFile(serializeStockPlannerExport({ ...original, asOf: AS_OF + 3 * 86400 }));
    const forecast = (asOf: number) => buildStockStrategyTimeline({
      rows: laterExport.roi.rows, ownedSnapshot: laterExport.portfolio, asOf, cityBankActive: true,
      budget: 0, additionalIncomePerWeek: 70, minimumRoi: null, affordableOnly: false, lockedStockIds: new Set([1]),
    });
    expect(stockPlannerReplayAsOf(laterExport)).toBe(AS_OF);
    const replay = forecast(stockPlannerReplayAsOf(laterExport));
    expect(replay.issues).toEqual([]);
    expect(replay.timeline.length).toBeGreaterThan(0);
    expect(replay).toEqual(forecast(original.asOf));
    expect(laterExport.portfolio?.refreshed_at).toBe(AS_OF);
    // The live path still requires up-to-date progress; only imported replay uses the snapshot date.
    expect(forecast(laterExport.asOf).issues.join()).toContain("Refresh owned stocks today");
  });

  it("rejects unsupported versions and malformed JSON", () => {
    expect(() => parseStockPlannerFile("bad json")).toThrow("valid JSON");
    expect(() => sanitizeStockPlannerExport({ ...fixture(), version: 2 })).toThrow("supported");
  });

  it("rejects invalid numbers, missing settings, duplicate holdings and oversized files", () => {
    const data = fixture();
    expect(() => sanitizeStockPlannerExport({ ...data, asOf: Infinity })).toThrow("invalid values");
    expect(() => sanitizeStockPlannerExport({ ...data, asOf: Number.MAX_SAFE_INTEGER })).toThrow("invalid values");
    expect(() => sanitizeStockPlannerExport({ ...data, settings: {} })).toThrow("invalid values");
    data.portfolio!.stocks.push(data.portfolio!.stocks[0]);
    expect(() => sanitizeStockPlannerExport(data)).toThrow("invalid values");
    expect(() => parseStockPlannerFile(" ".repeat(2_000_001))).toThrow("2 MB");
  });
});
