import { describe, expect, it } from "vitest";
import type { StockInvestmentRoiRow } from "../api/types";
import { nextScheduledStockStrategyStep, STOCK_SELL_FEE_RATE } from "./stockRecommendations";

function row(id: number, shares: number, price: number, annual: number): StockInvestmentRoiRow {
  const cost = shares * price;
  return {
    investment_type: "stock", row_id: `stock:${id}:1`, stock_id: id, acronym: `S${id}`, name: `Stock ${id}`,
    increment: 1, required_shares: shares, total_shares_required: shares, latest_price: price,
    increment_cost: cost, total_cost: cost, benefit_key: "cash:test", benefit_description: "1x Reward",
    valuation_source: "cash", frequency_days: 7, benefit_value: annual * 7 / 365,
    annual_return: annual, days_to_break_even: cost * 365 / annual, roi_percent: annual / cost * 100,
  };
}

function selectStep(rows: StockInvestmentRoiRow[], holdings: [number, number][], budget = 0) {
  return nextScheduledStockStrategyStep({
    rows,
    ownedSnapshot: { refreshed_at: 1, stocks: holdings.map(([stock_id, shares]) => ({ stock_id, shares, bonus: null })) },
    cityBankActive: false, budget, minimumRoi: null, affordableOnly: false,
  }, [], 1)!;
}

describe("strategy sale selection", () => {
  it.each([[100, 1000], [1000, 100], [10, 10000]])(
    "preserves higher income independently of individual share prices (%s, %s)", (lowPrice, highPrice) => {
      const lowShares = 100_000_000 / lowPrice;
      const highShares = 100_000_000 / highPrice;
      const step = selectStep([
        row(1, lowShares, lowPrice, 1_000_000), row(2, highShares, highPrice, 2_000_000),
        row(3, 90_000, 1000, 3_000_000),
      ], [[1, lowShares], [2, highShares]]);
      const sold = Math.ceil(90_000_000 / (lowPrice * (1 - STOCK_SELL_FEE_RATE)));
      expect(step.sales).toHaveLength(1);
      expect(step.sales[0]).toMatchObject({ stock_id: 1, shares: sold, retained_shares: lowShares - sold, current_annual_return: 1_000_000 });
      expect(step.annual_return_gain).toBe(2_000_000);
      expect(step.sales[0].sale_value + step.sales[0].sale_fee).toBeCloseTo(sold * lowPrice);
      expect(step.ending_cash).toBeGreaterThanOrEqual(0);
      expect(step.ending_cash).toBeLessThan(lowPrice);
    },
  );

  it("finds a beneficial sale instead of requiring new cash after rejecting a worse source", () => {
    const step = selectStep([
      row(1, 1_000_000, 100, 1_000_000), row(2, 100_000, 1000, 2_000_000), row(3, 90_000, 1000, 1_500_000),
    ], [[1, 1_000_000], [2, 100_000]]);
    expect(step).toMatchObject({ kind: "rebalance", extra_cash_needed: 0, annual_return_gain: 500_000 });
    expect(step.sales.map(sale => sale.stock_id)).toEqual([1]);
  });

  it("scores only capital needed for the purchase when another block would release far more", () => {
    const step = selectStep([
      row(1, 1_000_000, 100, 1_000_000), row(2, 1_000_000, 1000, 2_000_000), row(3, 90_000, 1000, 3_000_000),
    ], [[1, 1_000_000], [2, 1_000_000]]);
    expect(step.sales.map(sale => sale.stock_id)).toEqual([1]);
    expect(step.annual_return_gain).toBe(2_000_000);
  });

  it.each([[12_000_000, 120_121], [19_980_000, 200_000]])(
    "breaks only the upper increment and sells the minimum shares for a %s gap", (cost, sold) => {
      const first = row(1, 100_000, 100, 3_000_000);
      const second = { ...row(1, 200_000, 100, 1_000_000), row_id: "stock:1:2", increment: 2,
        total_shares_required: 300_000, total_cost: 30_000_000 };
      const step = selectStep([first, second, row(2, cost / 100, 100, 2_000_000)], [[1, 300_000]]);
      expect(step.sales).toHaveLength(1);
      expect(step.sales[0]).toMatchObject({ stock_id: 1, shares: sold, retained_shares: 300_000 - sold, current_annual_return: 1_000_000 });
      expect(step.annual_return_gain).toBe(1_000_000);
      expect(step.extra_cash_needed).toBe(0);
    },
  );

  it("counts each lost increment once when a larger sale crosses two thresholds", () => {
    const first = row(1, 100_000, 100, 3_000_000);
    const second = { ...row(1, 200_000, 100, 1_000_000), row_id: "stock:1:2", increment: 2,
      total_shares_required: 300_000, total_cost: 30_000_000 };
    const step = selectStep([first, second, row(2, 250_000, 100, 5_000_000)], [[1, 300_000]]);
    expect(step.sales).toHaveLength(1);
    expect(step.sales[0]).toMatchObject({ stock_id: 1, shares: 250_251, retained_shares: 49_749, current_annual_return: 4_000_000 });
    expect(step.annual_return_gain).toBe(1_000_000);
  });

  it("uses free surplus shares before sacrificing any active benefit block", () => {
    const step = selectStep([
      row(1, 100_000, 100, 5_000_000), row(2, 100_000, 100, 100_000), row(3, 50_000, 100, 6_000_000),
    ], [[1, 200_000], [2, 100_000]]);
    expect(step.sales).toHaveLength(1);
    expect(step.sales[0]).toMatchObject({ stock_id: 1, shares: 50_051, retained_shares: 149_949, current_annual_return: 0 });
    expect(step.annual_return_gain).toBe(6_000_000);
  });
});
