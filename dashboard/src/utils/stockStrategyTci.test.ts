import { describe, expect, it } from "vitest";
import type { StockInvestmentRoiRow } from "../api/types";
import type { OwnedStockPosition } from "./ownedStocks";
import { recommendStockBuys } from "./stockRecommendations";
import { buildStockStrategyTimeline, type StockStrategyTimelineInput } from "./stockStrategyTimeline";

const DAY = 86_400;
const START = Date.UTC(2026, 9, 1, 12) / 1000;

function stock(id: number, cost: number, payout: number, frequency = 7): StockInvestmentRoiRow {
  const annual = payout * 365 / frequency;
  return {
    investment_type: "stock", row_id: `stock:${id}:1`, stock_id: id, acronym: `S${id}`, name: `Stock ${id}`,
    increment: 1, required_shares: cost, total_shares_required: cost, latest_price: 1,
    increment_cost: cost, total_cost: cost, benefit_key: "cash:test", benefit_description: "1x Reward",
    valuation_source: "cash", frequency_days: frequency, benefit_value: payout,
    annual_return: annual, days_to_break_even: cost * 365 / annual, roi_percent: annual / cost * 100,
  };
}

function tci(cost = 200, payout = 1000): StockInvestmentRoiRow {
  return { ...stock(9, cost, payout, 90), acronym: "TCI", benefit_key: "city_bank:tci_bonus" };
}

function bankRow(): StockInvestmentRoiRow {
  return { ...stock(99, 1000, 90, 90), investment_type: "city_bank", stock_id: null, increment: null,
    required_shares: null, total_shares_required: null, latest_price: null, row_id: "city_bank:90", benefit_key: "city_bank:90", acronym: "BANK" };
}

function holding(shares = 200): OwnedStockPosition {
  return { stock_id: 9, shares, bonus: { available: true, increment: null, progress: null, frequency: null } };
}

function input(rows: StockInvestmentRoiRow[], stocks: OwnedStockPosition[] = [], overrides: Partial<StockStrategyTimelineInput> = {}): StockStrategyTimelineInput {
  return {
    rows, ownedSnapshot: { refreshed_at: START, stocks, city_bank: null }, cityBankActive: false,
    asOf: START, budget: 0, additionalIncomePerWeek: 0, minimumRoi: null, affordableOnly: false,
    lockedStockIds: new Set(), ...overrides,
  };
}

describe("TCI capital in scheduled stock strategies", () => {
  it.each([true, false])("uses unlocked TCI as zero-income capital without a bank (known timing: %s)", (hasTiming) => {
    const owned = { ...holding(), bonus: hasTiming ? holding().bonus : null };
    const result = buildStockStrategyTimeline(input([tci(), stock(1, 100, 10)], [owned]), 1);
    expect(result.issues).toEqual([]);
    expect(result.weekly_investment_income).toBe(0);
    expect(result.timeline[0]).toMatchObject({ status: "scheduled", purchase_at: START });
    expect(result.timeline[0].step.recommendation.row.stock_id).toBe(1);
    expect(result.timeline[0].step.sales).toHaveLength(1);
    expect(result.timeline[0].step.sales[0]).toMatchObject({ stock_id: 9, shares: 101, retained_shares: 99, current_annual_return: 0 });
    expect(result.timeline[0].step.sales[0].sale_value).toBeCloseTo(100.899);
    expect(result.timeline[0].step.annual_return_gain).toBeCloseTo(stock(1, 100, 10).annual_return);
    expect(result.timeline[0].funding?.investment_income).toBe(0);
    if (!hasTiming) expect(result.warnings.join()).toContain("activation timing is unavailable");
  });

  it("honours explicit TCI sale locks when no bank is active", () => {
    const result = buildStockStrategyTimeline(input([tci(), stock(1, 100, 10)], [holding()], { lockedStockIds: new Set([9]) }), 1);
    expect(result.timeline[0]).toMatchObject({ status: "unfunded", purchase_at: null });
    expect(result.timeline[0].step.sales).toEqual([]);
  });

  it("never offers TCI purchases without a deposit, including when it is the only candidate", () => {
    expect(buildStockStrategyTimeline(input([tci()], [], { budget: 1000 })).timeline).toEqual([]);
  });

  it("protects owned TCI while repeating an imported bank return", () => {
    const stocks = [holding()];
    const result = buildStockStrategyTimeline(input([tci(), bankRow(), stock(1, 100, 10)], stocks, {
      ownedSnapshot: { refreshed_at: START, stocks, city_bank: {
        amount: 1100, profit: 100, duration: 90, interest_rate: 10, invested_at: START - 89 * DAY, until: START + DAY,
      } },
    }), 1);
    expect(result.issues).toEqual([]);
    expect(result.timeline[0]).toMatchObject({ status: "scheduled", purchase_at: START + DAY });
    expect(result.timeline[0].step.sales).toEqual([]);
    expect(result.timeline[0].funding?.investment_income).toBe(100);
    expect(result.timeline[0].funding?.payouts.map(event => event.id)).toEqual(["city_bank"]);
  });

  it.each([true, false])("preserves generic bank estimates without inventing unknown TCI activation (%s)", (hasTiming) => {
    const owned = { ...holding(100), bonus: hasTiming ? holding().bonus : null };
    const result = buildStockStrategyTimeline(input([tci(100, 9), bankRow(), stock(1, 120, 0.7)], [owned], {
      budget: 1000, lockedStockIds: new Set([9]),
    }), 2);
    expect(result.issues).toEqual([]);
    expect(result.timeline[0].step.recommendation.row.investment_type).toBe("city_bank");
    expect(result.timeline[0].purchase_at).toBe(START);
    expect(result.timeline[1].funding?.payouts.map(event => event.amount)).toEqual(hasTiming ? [99, 99] : [90, 90]);
    expect(result.timeline[1].step.sales).toEqual([]);
  });

  it("allows TCI purchases after a generic deposit is started", () => {
    const result = buildStockStrategyTimeline(input([tci(100, 9), bankRow()], [], { budget: 1000 }), 2);
    expect(result.timeline.map(timing => timing.step.recommendation.row.acronym)).toEqual(["BANK", "TCI"]);
    expect(result.timeline[0].purchase_at).toBe(START);
    expect(result.timeline[1].purchase_at).toBe(START + 180 * DAY);
    expect(result.timeline[1].funding?.payouts.map(event => event.amount)).toEqual([90, 90]);
  });

  it("excludes a specific purchase row without discarding other blocks of the stock", () => {
    const first = stock(1, 100, 10);
    const second = { ...first, row_id: "stock:1:2", increment: 2, required_shares: 200, total_shares_required: 300,
      increment_cost: 200, total_cost: 300, roi_percent: first.roi_percent / 2 };
    const recommendations = recommendStockBuys(input([first, second], [], { excludedPurchaseRowIds: new Set([first.row_id]) }));
    expect(recommendations.map(candidate => candidate.row.row_id)).toEqual([second.row_id]);
  });
});
