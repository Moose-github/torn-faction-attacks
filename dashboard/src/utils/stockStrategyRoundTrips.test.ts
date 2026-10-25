import { describe, expect, it } from "vitest";
import type { StockInvestmentRoiRow } from "../api/types";
import { buildStockStrategyTimeline, type StockStrategyTimelineInput } from "./stockStrategyTimeline";

const DAY = 86_400;
const START = Date.UTC(2026, 9, 24, 12) / 1000;
function row(id: number, cost: number, payout: number): StockInvestmentRoiRow {
  const annual = payout * 365 / 7;
  return {
    investment_type: "stock", row_id: `stock:${id}:1`, stock_id: id, acronym: `S${id}`, name: `Stock ${id}`,
    increment: 1, required_shares: cost, total_shares_required: cost, latest_price: 1,
    increment_cost: cost, total_cost: cost, benefit_key: "cash:test", benefit_description: "Cash",
    valuation_source: "cash", frequency_days: 7, benefit_value: payout, annual_return: annual,
    days_to_break_even: cost * 365 / annual, roi_percent: annual / cost * 100,
  };
}
function input(rows: StockInvestmentRoiRow[], extra: Partial<StockStrategyTimelineInput> = {}): StockStrategyTimelineInput {
  return { rows, ownedSnapshot: { refreshed_at: START, stocks: [], city_bank: null }, cityBankActive: false,
    asOf: START, budget: 0, additionalIncomePerWeek: 0, minimumRoi: null, affordableOnly: false, ...extra };
}

describe("stock strategy round trips", () => {
  it("buys SYM block 2 directly instead of selling SYM to buy and immediately sell TCT", () => {
    const sym = { ...row(1, 500, 5), acronym: "SYM" };
    const sym2 = { ...sym, row_id: "stock:1:2", increment: 2, required_shares: 1000,
      total_shares_required: 1500, increment_cost: 1000, total_cost: 1500, roi_percent: sym.annual_return / 10 };
    const tct = { ...row(2, 32, 0.19), acronym: "TCT" };
    const prn = { ...row(3, 1000, 4.5), acronym: "PRN" };
    const result = buildStockStrategyTimeline(input([sym, sym2, tct, prn], {
      ownedSnapshot: { refreshed_at: START, city_bank: null, stocks: [
        { stock_id: 1, shares: 1136, bonus: { increment: 1, available: false, progress: 3, frequency: 7 } },
        { stock_id: 3, shares: 1000, bonus: { increment: 1, available: false, progress: 3, frequency: 7 } },
      ] },
    }), 2);
    const first = result.timeline[0];
    expect(first.step.recommendation.row.row_id).toBe(sym2.row_id);
    expect(first.purchase_at).toBe(START);
    expect(first.step.sales).toHaveLength(1);
    expect(first.step.sales[0]).toMatchObject({ acronym: "PRN", shares: 365, sale_fee: 0.365 });
    expect(first.step.recommendation.shares_needed).toBe(364);
    expect(result.savings_target?.recommendation.row.row_id).toBe(sym2.row_id);
    expect(first.funding).toMatchObject({ investment_income: 0, purchase_cost: 364 });
  });

  it("saves directly when weekly income would cause an intermediary to be sold before its first payout", () => {
    const result = buildStockStrategyTimeline(input([row(1, 1000, 100), row(2, 100, 9)], {
      budget: 100, additionalIncomePerWeek: 7000,
    }), 3);
    expect(result.timeline[0].step.recommendation.row.stock_id).toBe(1);
    expect(result.timeline[0].purchase_at).toBeCloseTo(START + 0.9 * DAY, 5);
    expect(result.timeline[0].funding).toMatchObject({ starting_cash: 100, investment_income: 0, additional_income: 900, sales: [] });
    expect(result.timeline.flatMap(entry => entry.step.sales)).toEqual([]);
  });

  it("retains an intermediary whose payouts help reach the target sooner", () => {
    const result = buildStockStrategyTimeline(input([row(1, 1000, 100), row(2, 100, 9)], {
      budget: 100, additionalIncomePerWeek: 70,
    }), 2);
    expect(result.timeline.map(entry => entry.step.recommendation.row.stock_id)).toEqual([2, 1]);
    expect(result.timeline[1].funding!.investment_income).toBeGreaterThan(0);
    expect(result.timeline[1].purchase_at!).toBeLessThan(START + 90 * DAY);
  });

  it("does not credit an existing block's imminent reward to a new mid-cycle upgrade", () => {
    const first = row(2, 100, 100);
    const upgrade = { ...first, row_id: "stock:2:2", increment: 2, required_shares: 200,
      total_shares_required: 300, increment_cost: 200, total_cost: 300, roi_percent: first.roi_percent / 2 };
    const result = buildStockStrategyTimeline(input([row(1, 1000, 600), first, upgrade], {
      budget: 200, additionalIncomePerWeek: 7000,
      ownedSnapshot: { refreshed_at: START, city_bank: null, stocks: [
        { stock_id: 2, shares: 100, bonus: { increment: 1, available: false, progress: 6, frequency: 7 } },
      ] },
    }), 2);
    expect(result.timeline[0].step.recommendation.row.stock_id).toBe(1);
    expect(result.timeline[0].purchase_at).toBeCloseTo(START + 0.6001 * DAY, 5);
    expect(result.timeline[0].funding?.payouts).toMatchObject([{ id: "stock:2", reward_count: 1, amount: 100 }]);
    expect(result.timeline[0].step.sales).toMatchObject([{ stock_id: 2, shares: 100, sale_fee: 0.1 }]);
  });

  it("retains a mid-cycle upgrade once its additional rewards earn cash toward the target", () => {
    const first = row(2, 100, 100);
    const upgrade = { ...first, row_id: "stock:2:2", increment: 2, required_shares: 200,
      total_shares_required: 300, increment_cost: 200, total_cost: 300, roi_percent: first.roi_percent / 2 };
    const result = buildStockStrategyTimeline(input([row(1, 1000, 600), first, upgrade], {
      budget: 200, additionalIncomePerWeek: 70,
      ownedSnapshot: { refreshed_at: START, city_bank: null, stocks: [
        { stock_id: 2, shares: 100, bonus: { increment: 1, available: false, progress: 6, frequency: 7 } },
      ] },
    }), 2);
    expect(result.timeline.map(entry => entry.step.recommendation.row.row_id)).toEqual([upgrade.row_id, "stock:1:1"]);
    expect(result.timeline[1].funding?.payouts).toMatchObject([
      { id: "stock:2", reward_count: 1, amount: 100 },
      { id: "stock:2", reward_count: 2, amount: 200 },
      { id: "stock:2", reward_count: 2, amount: 200 },
    ]);
    expect(result.timeline[1].purchase_at).toBeCloseTo(START + 20.03 * DAY, 5);
  });

  it("keeps separate purchases at the same timestamp when both holdings are retained", () => {
    const result = buildStockStrategyTimeline(input([row(1, 100, 20), row(2, 100, 19)], { budget: 200 }), 2);
    expect(result.timeline.map(entry => entry.step.recommendation.row.stock_id)).toEqual([1, 2]);
    expect(result.timeline.map(entry => entry.purchase_at)).toEqual([START, START]);
    expect(result.timeline.flatMap(entry => entry.step.sales)).toEqual([]);
    expect(result.timeline[1].funding?.ending_cash).toBe(0);
  });

  it("reconciles funding and preserves explicit locks after replanning", () => {
    const result = buildStockStrategyTimeline(input([row(1, 1000, 100), row(2, 100, 9)], {
      budget: 100, additionalIncomePerWeek: 7000, lockedStockIds: new Set([2]),
    }), 3);
    expect(result.timeline[0].step.recommendation.row.stock_id).toBe(2);
    for (const { funding, step } of result.timeline) {
      expect(step.sales.some(sale => sale.stock_id === 2)).toBe(false);
      if (!funding) continue;
      expect(funding.starting_cash + funding.additional_income + funding.investment_income
        + funding.sales.reduce((sum, sale) => sum + sale.sale_value, 0)).toBeCloseTo(funding.total_available);
      expect(funding.total_available - funding.purchase_cost).toBeCloseTo(funding.ending_cash);
    }
  });
});
