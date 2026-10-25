import { describe, expect, it } from "vitest";
import type { StockInvestmentRoiRow } from "../api/types";
import { buildStockRebalanceRecommendations, recommendBestStockBuy } from "./stockRecommendations";
import { stockBankPlannerContext } from "./stockBankPlannerContext";

function stock(id: number, annual: number): StockInvestmentRoiRow {
  return {
    investment_type: "stock", row_id: `stock:${id}:1`, stock_id: id, acronym: id === 9 ? "TCI" : "SYM", name: "Stock",
    increment: 1, required_shares: 100, total_shares_required: 100, latest_price: 1_000_000,
    increment_cost: 100_000_000, total_cost: 100_000_000, benefit_key: id === 9 ? "city_bank:tci_bonus" : "cash:test",
    benefit_description: "Cash", valuation_source: "cash", frequency_days: 7, benefit_value: annual * 7 / 365,
    annual_return: annual, days_to_break_even: 100_000_000 * 365 / annual, roi_percent: annual / 1_000_000,
  };
}

const rows = [stock(9, 50_000_000), stock(1, 10_000_000)];
const noBankContext = () => stockBankPlannerContext({ rows, cityBankActive: false, bankInvestment: null });
const recommendationInput = (stockId: number) => ({
  ...noBankContext(),
  ownedSnapshot: { refreshed_at: 1, stocks: [{ stock_id: stockId, shares: 100, bonus: null }], city_bank: null },
  budget: 100_000, affordableOnly: false, minimumRoi: null,
});

describe("bank context shared by recommendations and owned-income summaries", () => {
  it("does not sell a paying stock to buy TCI when there is no bank deposit", () => {
    const input = recommendationInput(1);
    expect(recommendBestStockBuy(input)).toBeNull();
    expect(buildStockRebalanceRecommendations(input)).toEqual([]);
  });

  it("uses owned TCI capital with zero lost income when there is no deposit", () => {
    const input = recommendationInput(9);
    expect(recommendBestStockBuy(input)?.row.stock_id).toBe(1);
    const rebalances = buildStockRebalanceRecommendations(input);
    expect(rebalances).toHaveLength(1);
    expect(rebalances[0]).toMatchObject({ sell_stock_id: 9, current_annual_return: 0, annual_return_gain: 10_000_000 });
    expect(rebalances[0].sale_value).toBeCloseTo(99_900_000);
  });

  it("removes hypothetical TCI income from summary rows while preserving future planner inputs", () => {
    const context = noBankContext();
    expect(context.rows.find(row => row.stock_id === 9)).toMatchObject({ annual_return: 0, benefit_value: 0, roi_percent: 0 });
    expect(rows[0].annual_return).toBe(50_000_000);
    expect(context.rows.find(row => row.stock_id === 1)).toBe(rows[1]);
  });

  it("protects TCI for imported bank returns and preserves explicit locks and exclusions", () => {
    const bank = { amount: 2_100_000_000, profit: 100_000_000, duration: 90, interest_rate: 5, invested_at: 1, until: 90 * 86400 + 1 };
    const context = stockBankPlannerContext({ rows, cityBankActive: true, bankInvestment: bank,
      lockedStockIds: new Set([2]), excludedPurchaseRowIds: new Set(["stock:2:1"]) });
    expect([...context.lockedStockIds]).toEqual([2, 9]);
    expect([...context.excludedPurchaseRowIds]).toEqual(["stock:2:1", "stock:9:1"]);
    expect(context.rows[0].annual_return).toBe(0);
    expect(buildStockRebalanceRecommendations({ ...recommendationInput(9), ...context })).toEqual([]);
  });

  it("retains the generic TCI bonus for a manually active bank without imported details", () => {
    const context = stockBankPlannerContext({ rows, cityBankActive: true, bankInvestment: undefined });
    expect(context.rows[0]).toBe(rows[0]);
    expect(context.excludedPurchaseRowIds.size).toBe(0);
    expect(recommendBestStockBuy({ ...recommendationInput(1), ...context })?.row.stock_id).toBe(9);
  });

  it("uses an imported absence of a deposit instead of a conflicting manual toggle", () => {
    const context = stockBankPlannerContext({ rows, cityBankActive: true, bankInvestment: null });
    expect(context.cityBankActive).toBe(false);
    expect(context.rows[0].annual_return).toBe(0);
    expect(context.excludedPurchaseRowIds.has("stock:9:1")).toBe(true);
  });
});
