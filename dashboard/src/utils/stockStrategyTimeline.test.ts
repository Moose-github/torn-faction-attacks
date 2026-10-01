import { describe, expect, it } from "vitest";
import { buildStockStrategyPlan } from "./stockRecommendations";
import type { StockInvestmentRoiRow } from "../api/types";
import { annualIncomeToWeekly, buildStockStrategyTimeline, stockStrategyIncomeSource } from "./stockStrategyTimeline";

function row(stockId: number, cost: number, annualReturn: number): StockInvestmentRoiRow {
  return {
    investment_type: "stock", row_id: `stock:${stockId}:1`, stock_id: stockId,
    acronym: `S${stockId}`, name: `Stock ${stockId}`, increment: 1,
    required_shares: cost, total_shares_required: cost, latest_price: 1,
    increment_cost: cost, total_cost: cost, benefit_key: "cash:test",
    benefit_description: "Cash", valuation_source: "cash", frequency_days: 7,
    benefit_value: annualReturn * 7 / 365, annual_return: annualReturn,
    days_to_break_even: cost * 365 / annualReturn, roi_percent: annualReturn / cost * 100,
  };
}

function plan(budget: number | null = null) {
  return buildStockStrategyPlan({
    rows: [row(1, 100, 36.5), row(2, 100, 36.5)],
    ownedSnapshot: null, cityBankActive: false, budget,
    affordableOnly: false, minimumRoi: null,
  }, 2);
}

describe("weekly stock strategy timing", () => {
  it("converts annual income using seven days rather than rounding a year to 52 weeks", () => {
    expect(annualIncomeToWeekly(365)).toBe(7);
  });

  it("combines weekly income, spends existing cash once, and reinvests each new return", () => {
    const timeline = buildStockStrategyTimeline(plan(30), {
      investmentIncomePerWeek: 5, additionalIncomePerWeek: 2,
    });
    expect(timeline[0].wait_weeks).toBe(10);
    expect(timeline[0].elapsed_weeks).toBe(10);
    expect(timeline[0].weekly_investment_income_after).toBeCloseTo(5.7);
    expect(timeline[0].weekly_total_income_after).toBeCloseTo(7.7);
    expect(timeline[1].wait_weeks).toBeCloseTo(100 / 7.7);
    expect(timeline[1].elapsed_weeks).toBeCloseTo(10 + 100 / 7.7);
    expect(timeline[0].funding).toMatchObject({
      starting_cash: 30, investment_income: 50, additional_income: 20,
      total_available: 100, purchase_cost: 100, ending_cash: 0, sales: [],
    });
    expect(timeline[1].funding?.starting_cash).toBe(0);
    expect(timeline[1].funding?.investment_income).toBeCloseTo(100 * 5.7 / 7.7);
  });

  it("can start with no income when an affordable purchase creates it", () => {
    const timeline = buildStockStrategyTimeline(plan(150), {
      investmentIncomePerWeek: 0, additionalIncomePerWeek: 0,
    });
    expect(timeline[0].elapsed_weeks).toBe(0);
    expect(timeline[1].wait_weeks).toBeCloseTo(50 / 0.7);
    expect(timeline[0].funding).toMatchObject({ investment_income: 0, additional_income: 0, ending_cash: 50 });
    expect(timeline[1].funding).toMatchObject({ starting_cash: 50, investment_income: 50, total_available: 100, ending_cash: 0 });
  });

  it("keeps subsequent estimates unreachable when the first purchase cannot be funded", () => {
    const timeline = buildStockStrategyTimeline(plan(), {
      investmentIncomePerWeek: 0, additionalIncomePerWeek: 0,
    });
    expect(timeline).toHaveLength(2);
    for (const timing of timeline) {
      expect(timing.elapsed_weeks).toBeNull();
      expect(timing.weekly_total_income_after).toBeNull();
      expect(timing.funding).toBeNull();
    }
  });

  it("uses net income gains after a rebalance and includes net sale proceeds in funding", () => {
    const rebalancePlan = buildStockStrategyPlan({
      rows: [row(1, 100, 20), row(2, 1_000, 400)],
      ownedSnapshot: { refreshed_at: 1, stocks: [{ stock_id: 1, shares: 100, bonus: null }] },
      cityBankActive: false, budget: 100, affordableOnly: false, minimumRoi: null,
    }, 1);
    expect(rebalancePlan.steps[0].kind).toBe("rebalance");
    const timeline = buildStockStrategyTimeline(rebalancePlan, {
      investmentIncomePerWeek: annualIncomeToWeekly(20), additionalIncomePerWeek: 10,
    });
    expect(timeline[0].wait_weeks).toBeCloseTo(800.1 / (10 + annualIncomeToWeekly(20)));
    expect(timeline[0].weekly_investment_income_after).toBeCloseTo(annualIncomeToWeekly(400));
    expect(timeline[0].funding?.sales[0].sale_value).toBeCloseTo(99.9);
    expect(timeline[0].funding?.total_available).toBeCloseTo(1_000);
  });

  it("attributes only each saving period's income to existing and newly bought holdings", () => {
    const timeline = buildStockStrategyTimeline(plan(30), {
      investmentIncomePerWeek: 5, additionalIncomePerWeek: 2,
      investmentSources: [
        { id: "stock:10", label: "FHG income", weekly_income: 3 },
        { id: "stock:20", label: "SYM income", weekly_income: 2 },
      ],
    });
    expect(timeline[0].funding?.investment_income_sources).toEqual([
      { id: "stock:10", label: "FHG income", amount: 30 },
      { id: "stock:20", label: "SYM income", amount: 20 },
    ]);
    const later = timeline[1].funding!;
    expect(later.investment_income_sources.map((source) => source.id)).toEqual(["stock:10", "stock:20", "stock:1"]);
    expect(later.investment_income_sources[0].amount).toBeCloseTo(3 * 100 / 7.7);
    expect(later.investment_income_sources[2].amount).toBeCloseTo(0.7 * 100 / 7.7);
    for (const { funding } of timeline) {
      expect(funding!.investment_income_sources.reduce((sum, source) => sum + source.amount, 0)).toBeCloseTo(funding!.investment_income);
      expect(funding!.total_available).toBeCloseTo(funding!.purchase_cost + funding!.ending_cash);
    }
  });

  it.each([3, 7])("keeps a weekly income override of %s separate from holding income", (override) => {
    const timeline = buildStockStrategyTimeline(plan(), {
      investmentIncomePerWeek: override, additionalIncomePerWeek: 2,
      investmentSources: [{ id: "stock:10", label: "FHG income", weekly_income: 5 }],
      investmentIncomeOverridden: true,
    });
    const first = timeline[0].funding!;
    const adjustment = first.investment_income_sources.find((source) => source.id === "manual-adjustment")!;
    expect(adjustment.label).toBe("Manual investment income adjustment");
    expect(adjustment.amount).toBeCloseTo((override - 5) * 100 / (override + 2));
    expect(first.investment_income_sources.reduce((sum, source) => sum + source.amount, 0)).toBeCloseTo(first.investment_income);
    expect(first.total_available).toBeCloseTo(100);
  });

  it("stops attributing income to sold holdings after the sale", () => {
    const ownedRow = row(1, 100, 20);
    const salePlan = buildStockStrategyPlan({
      rows: [ownedRow, row(2, 1_000, 400), row(3, 1_000, 350)],
      ownedSnapshot: { refreshed_at: 1, stocks: [{ stock_id: 1, shares: 100, bonus: null }] },
      cityBankActive: false, budget: 100, affordableOnly: false, minimumRoi: null,
    }, 2);
    expect(salePlan.steps[0].kind).toBe("rebalance");
    const timeline = buildStockStrategyTimeline(salePlan, {
      investmentIncomePerWeek: annualIncomeToWeekly(20), additionalIncomePerWeek: 10,
      investmentSources: [stockStrategyIncomeSource(ownedRow)],
    });
    expect(timeline[0].funding?.investment_income_sources.map((source) => source.id)).toEqual(["stock:1"]);
    expect(timeline[1].funding?.investment_income_sources.map((source) => source.id)).toEqual(["stock:2"]);
    expect(timeline[1].funding?.sales).toEqual([]);
    expect(timeline[1].funding?.total_available).toBeCloseTo(1_000);
  });
});
