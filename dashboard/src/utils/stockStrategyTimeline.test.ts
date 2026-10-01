import { describe, expect, it } from "vitest";
import { buildStockStrategyPlan } from "./stockRecommendations";
import type { StockInvestmentRoiRow } from "../api/types";
import { annualIncomeToWeekly, buildStockStrategyTimeline } from "./stockStrategyTimeline";

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
  });

  it("can start with no income when an affordable purchase creates it", () => {
    const timeline = buildStockStrategyTimeline(plan(150), {
      investmentIncomePerWeek: 0, additionalIncomePerWeek: 0,
    });
    expect(timeline[0].elapsed_weeks).toBe(0);
    expect(timeline[1].wait_weeks).toBeCloseTo(50 / 0.7);
  });

  it("keeps subsequent estimates unreachable when the first purchase cannot be funded", () => {
    const timeline = buildStockStrategyTimeline(plan(), {
      investmentIncomePerWeek: 0, additionalIncomePerWeek: 0,
    });
    expect(timeline).toHaveLength(2);
    for (const timing of timeline) {
      expect(timing.elapsed_weeks).toBeNull();
      expect(timing.weekly_total_income_after).toBeNull();
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
  });
});
