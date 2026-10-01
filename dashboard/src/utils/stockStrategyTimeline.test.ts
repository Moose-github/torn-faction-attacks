import { describe, expect, it } from "vitest";
import type { StockInvestmentRoiRow } from "../api/types";
import type { CityBankInvestment, OwnedStockPosition } from "./ownedStocks";
import { buildFhgTciHybridRow, type PrivateIslandRentalRow } from "./stockRecommendations";
import { annualIncomeToWeekly, buildStockStrategyTimeline, type StockStrategyTimelineInput } from "./stockStrategyTimeline";

const DAY = 86400;
const START = Date.UTC(2026, 9, 1, 12) / 1000;
const MIDNIGHT = START - DAY / 2;
function row(id: number, cost = 100, payout = 10, frequency = 7): StockInvestmentRoiRow {
  const annual = payout * 365 / frequency;
  return {
    investment_type: "stock", row_id: `stock:${id}:1`, stock_id: id, acronym: `S${id}`, name: `Stock ${id}`,
    increment: 1, required_shares: cost, total_shares_required: cost, latest_price: 1,
    increment_cost: cost, total_cost: cost, benefit_key: "cash:test", benefit_description: "1x Reward",
    valuation_source: "cash", frequency_days: frequency, benefit_value: payout,
    annual_return: annual, days_to_break_even: cost * 365 / annual, roi_percent: annual / cost * 100,
  };
}
function position(id = 1, progress = 0, frequency = 7, ready = false, shares = 100): OwnedStockPosition {
  return { stock_id: id, shares, bonus: { available: ready, increment: 1, progress, frequency } };
}
function input(rows: StockInvestmentRoiRow[], stocks: OwnedStockPosition[] = [], overrides: Partial<StockStrategyTimelineInput> = {}): StockStrategyTimelineInput {
  return { rows, ownedSnapshot: { refreshed_at: START, stocks, city_bank: null }, cityBankActive: false,
    asOf: START, budget: 0, additionalIncomePerWeek: 0, minimumRoi: null, affordableOnly: false,
    lockedStockIds: new Set(stocks.map((stock) => stock.stock_id)), ...overrides };
}
function bankRow(): StockInvestmentRoiRow {
  return { ...row(99, 1000, 90, 90), investment_type: "city_bank", stock_id: null, increment: null,
    required_shares: null, total_shares_required: null, latest_price: null, row_id: "city_bank:90", benefit_key: "city_bank:90", acronym: "BANK" };
}
function bank(until = START + 2 * DAY): CityBankInvestment {
  return { amount: 1100, profit: 100, duration: 90, interest_rate: 10, invested_at: until - 90 * DAY, until };
}

describe("scheduled stock strategy", () => {
  it("groups a smaller high-ROI repurchase under the next larger milestone", () => {
    const result = buildStockStrategyTimeline(input([row(1, 1000, 100), row(2, 100, 9), row(3, 3000, 240)], [],
      { additionalIncomePerWeek: 70 }));
    expect(result.timeline.slice(0, 4).map(entry => entry.step.recommendation.row.stock_id)).toEqual([2, 1, 2, 3]);
    expect(result.timeline.slice(0, 4).map(entry => entry.savings_target.row.stock_id)).toEqual([1, 1, 3, 3]);
    expect(result.timeline[1].step.sales.some(sale => sale.stock_id === 2)).toBe(true);
    expect(result.timeline[3].step.sales.some(sale => sale.stock_id === 1)).toBe(true);
    expect(result.savings_target?.purchase_at).toBe(result.timeline[1].purchase_at);
  });

  it("keeps a higher-ROI TCT repurchase as an intermediary between SYM and MUN", () => {
    const sym = { ...row(1, 1000, 100), acronym: "SYM" };
    const tct = { ...row(2, 100, 11), acronym: "TCT" };
    const mun = { ...row(3, 3000, 270), acronym: "MUN" };
    const result = buildStockStrategyTimeline(input([sym, tct, mun], [position(2)],
      { additionalIncomePerWeek: 70, lockedStockIds: new Set() }));
    expect(result.timeline.slice(0, 3).map(entry => entry.step.recommendation.row.acronym)).toEqual(["SYM", "TCT", "MUN"]);
    expect(result.timeline.slice(0, 3).map(entry => entry.savings_target.row.acronym)).toEqual(["SYM", "MUN", "MUN"]);
    expect(result.timeline[1].step.recommendation.ranking_roi_percent).toBeGreaterThan(result.timeline[1].savings_target.ranking_roi_percent);
    expect(result.timeline[0].step.sales.some(sale => sale.stock_id === 2)).toBe(true);
    expect(result.timeline[2].step.sales.some(sale => sale.stock_id === 1)).toBe(true);
    expect(result.timeline[2].step.sales.some(sale => sale.stock_id === 2)).toBe(true);
  });

  it("retains the known target when a truncated plan has no larger milestone", () => {
    const result = buildStockStrategyTimeline(input([row(1, 1000, 100), row(2, 100, 9), row(3, 3000, 240)], [],
      { additionalIncomePerWeek: 70 }), 3);
    expect(result.timeline.map(entry => entry.step.recommendation.row.stock_id)).toEqual([2, 1, 2]);
    expect(result.timeline.map(entry => entry.savings_target.row.stock_id)).toEqual([1, 1, 2]);
  });

  it("identifies the higher-ROI savings target behind an intermediary purchase and dates it from the full plan", () => {
    const result = buildStockStrategyTimeline(input([row(1, 1000, 100), row(2, 100, 9), row(3, 1200, 96)], [],
      { additionalIncomePerWeek: 70, lockedStockIds: new Set([2]) }));
    expect(result.timeline.slice(0, 2).map(entry => entry.step.recommendation.row.stock_id)).toEqual([2, 1]);
    expect(result.timeline.slice(0, 2).map(entry => entry.savings_target.row.stock_id)).toEqual([1, 1]);
    expect(result.savings_target).toMatchObject({ recommendation: { row: { stock_id: 1 }, estimated_cost: 1000 }, cash_shortfall: 1000,
      status: "scheduled", purchase_at: result.timeline[1].purchase_at });
    expect(result.timeline[1].purchase_at!).toBeGreaterThan(result.timeline[0].purchase_at!);
    expect(result.timeline[2].savings_target.row.stock_id).toBe(3);
  });

  it("uses remaining shares for target cost and credits ready rewards without assuming stock sales", () => {
    const result = buildStockStrategyTimeline(input([row(1, 1000, 100), row(2, 100, 10)],
      [position(1, 0, 7, false, 250), position(2, 7, 7, true)], { budget: 20, additionalIncomePerWeek: 70 }));
    expect(result.savings_target).toMatchObject({ recommendation: { row: { stock_id: 1 }, estimated_cost: 750 }, cash_shortfall: 720 });
  });

  it("does not invent target dates when income is absent or the horizon is exceeded", () => {
    const args = input([row(1, 1000, 100)]);
    expect(buildStockStrategyTimeline(args).savings_target).toMatchObject({ status: "unfunded", purchase_at: null, cash_shortfall: 1000 });
    expect(buildStockStrategyTimeline({ ...args, additionalIncomePerWeek: 0.1 }).savings_target)
      .toMatchObject({ status: "horizon", purchase_at: null });
    expect(buildStockStrategyTimeline({ ...args, ownedSnapshot: null }).savings_target).toBeNull();
    expect(buildStockStrategyTimeline({ ...args, budget: 1000 }).savings_target)
      .toMatchObject({ status: "scheduled", purchase_at: START, cash_shortfall: 0 });
  });

  it("converts annual income using seven days", () => expect(annualIncomeToWeekly(365)).toBe(7));

  it.each([[0, 7, 7], [3, 7, 4], [30, 31, 1]])("uses %s/%s actual progress", (progress, frequency, days) => {
    const result = buildStockStrategyTimeline(input([row(1, 100, 25, frequency), row(2, 25)], [position(1, progress, frequency)]), 1);
    expect(result.issues).toEqual([]);
    expect(result.timeline[0].purchase_at).toBe(MIDNIGHT + days * DAY);
    expect(result.timeline[0].funding).toMatchObject({ investment_income: 25, ending_cash: 0, additional_income: 0 });
  });

  it("credits a ready reward once, carries surplus and funds multiple purchases at that instant", () => {
    const result = buildStockStrategyTimeline(input([row(1, 100, 150), row(2, 60), row(3, 60), row(4, 60)], [position(1, 7, 7, true)]));
    expect(result.timeline.slice(0, 2).map((step) => step.purchase_at)).toEqual([START, START]);
    expect(result.timeline[0].funding).toMatchObject({ starting_cash: 0, investment_income: 150, ending_cash: 90 });
    expect(result.timeline[1].funding).toMatchObject({ starting_cash: 90, investment_income: 0, ending_cash: 30 });
    expect(result.timeline[2].purchase_at).toBe(MIDNIGHT + 7 * DAY);
    expect(result.timeline[2].funding?.payouts.filter((event) => event.id === "stock:1")).toHaveLength(1);
  });

  it("starts purchased stock cycles without granting a payout on purchase", () => {
    const result = buildStockStrategyTimeline(input([row(1, 100, 50), row(2, 100, 45)], [], { budget: 100 }), 2);
    expect(result.timeline[0].purchase_at).toBe(START);
    expect(result.timeline[0].funding?.investment_income).toBe(0);
    expect(result.timeline[1].purchase_at).toBe(MIDNIGHT + 14 * DAY);
    expect(result.timeline[1].funding?.payouts.map((event) => event.at)).toEqual([MIDNIGHT + 7 * DAY, MIDNIGHT + 14 * DAY]);
  });

  it.each([0, 3])("adds new blocks to the correct cycle at progress %s", (progress) => {
    const first = row(1, 100, 40);
    const second = { ...first, row_id: "stock:1:2", increment: 2, total_shares_required: 200, total_cost: 200 };
    const result = buildStockStrategyTimeline(input([first, second, row(2, 200, 70)], [position(1, progress)], { budget: 100 }), 2);
    expect(result.timeline[0].step.recommendation.row.row_id).toBe("stock:1:2");
    const events = result.timeline[1].funding!.payouts.filter((event) => event.id === "stock:1");
    expect(events[0].amount).toBe(progress === 0 ? 80 : 40);
    expect(events[1].amount).toBe(80);
  });

  it("uses the API active increment for blocks already purchased mid-cycle", () => {
    const first = row(1, 100, 40);
    const second = { ...first, row_id: "stock:1:2", increment: 2, total_shares_required: 200 };
    const result = buildStockStrategyTimeline(input([first, second, row(2, 120, 40)], [position(1, 3, 7, false, 200)]), 1);
    expect(result.timeline[0].funding?.payouts.map((event) => event.amount)).toEqual([40, 80]);
  });

  it("funds purchases between payout dates using additional income", () => {
    const result = buildStockStrategyTimeline(input([row(1, 100, 25), row(2, 25)], [position()], { additionalIncomePerWeek: 70 }), 1);
    expect(result.timeline[0].purchase_at).toBe(START + 2.5 * DAY);
    expect(result.timeline[0].funding).toMatchObject({ investment_income: 0, additional_income: 25, total_available: 25 });
  });

  it("advances even when very large additional income rounds the wait below timestamp precision", () => {
    const result = buildStockStrategyTimeline(input([row(1, 100)], [], { additionalIncomePerWeek: 1e15 }), 1);
    expect(result.timeline[0].purchase_at).toBeGreaterThan(START);
    expect(result.timeline[0].purchase_at).toBeLessThan(START + 0.001);
    expect(result.timeline[0].funding!.total_available).toBeGreaterThanOrEqual(100);
  });

  it("credits simultaneous rewards before choosing sales, avoiding unnecessary sales", () => {
    const args = input([row(1, 100, 80), row(2, 100, 80), row(3, 150, 200)], [position(1, 6), position(2, 6)], { lockedStockIds: new Set([1, 2]) });
    const result = buildStockStrategyTimeline(args, 1);
    expect(result.timeline[0].funding).toMatchObject({ investment_income: 160, ending_cash: 10, sales: [] });
    expect(result.timeline[0].funding?.payouts).toHaveLength(2);
  });

  it("includes selected net sales, fees and stops the sold stock's payouts", () => {
    const args = input([row(1, 100, 1), row(2, 100, 50), row(3, 100, 45)], [position()], { budget: 0.1, lockedStockIds: new Set() });
    const result = buildStockStrategyTimeline(args, 2);
    expect(result.timeline[0].funding?.sales[0]).toMatchObject({ stock_id: 1, sale_fee: 0.1 });
    expect(result.timeline[0].funding?.sales[0].sale_value).toBeCloseTo(99.9);
    expect(result.timeline[0].purchase_at).toBe(START);
    expect(result.timeline[1].funding?.payouts.every((event) => event.id !== "stock:1")).toBe(true);
  });

  it("recalculates proposed sales after a payout makes them unnecessary", () => {
    const result = buildStockStrategyTimeline(input([row(1, 100, 350), row(2, 300, 400)], [position(1, 6)], { lockedStockIds: new Set() }), 1);
    expect(result.timeline[0].step.kind).toBe("buy");
    expect(result.timeline[0].funding).toMatchObject({ investment_income: 350, sales: [], ending_cash: 50 });
  });

  it("honours locked stocks and does not count rejected sales as funding", () => {
    const result = buildStockStrategyTimeline(input([row(1, 100, 1), row(2, 100, 50)], [position()]), 1);
    expect(result.timeline[0].funding?.sales).toEqual([]);
    expect(result.timeline[0].funding?.investment_income).toBe(100);
    expect(result.timeline[0].purchase_at).toBe(MIDNIGHT + 700 * DAY);
  });

  it("preserves a stock cycle when only excess shares are sold", () => {
    const args = input([row(1, 100, 40), row(2, 50, 30), row(3, 60, 30)], [position(1, 6, 7, false, 200)],
      { budget: 0.05, lockedStockIds: new Set() });
    const result = buildStockStrategyTimeline(args, 2);
    expect(result.timeline[0].funding?.sales[0].current_annual_return).toBe(0);
    expect(result.timeline[1].funding?.payouts.find((event) => event.id === "stock:1")?.at).toBe(MIDNIGHT + DAY);
    expect(result.warnings).toEqual([]);
  });

  it("restarts a reduced active entitlement after a sale interrupts the cycle", () => {
    const first = row(1, 100, 1);
    const second = { ...first, row_id: "stock:1:2", increment: 2, total_shares_required: 300, required_shares: 200, increment_cost: 200 };
    const holding = { ...position(1, 6, 7, false, 300), bonus: { ...position().bonus!, progress: 6, increment: 2 } };
    const result = buildStockStrategyTimeline(input([first, second, row(2, 100, 12), row(3, 200, 20)], [holding], { lockedStockIds: new Set([2]) }), 2);
    expect(result.timeline[0].funding?.sales[0].shares).toBeLessThan(201);
    expect(result.warnings.join()).toContain("conservatively restarted");
    const retainedPayout = result.timeline[1].funding?.payouts.find((event) => event.id === "stock:1");
    expect(retainedPayout?.at).toBe(MIDNIGHT + 7 * DAY);
    expect(retainedPayout?.amount).toBe(1);
  });

  it("pays only current bank profit at exact maturity and reserves principal", () => {
    const current = bank();
    const result = buildStockStrategyTimeline(input([bankRow(), row(1, 100, 10)], [], {
      ownedSnapshot: { refreshed_at: START, stocks: [], city_bank: current },
    }), 1);
    expect(result.timeline[0].purchase_at).toBe(current.until);
    expect(result.timeline[0].funding).toMatchObject({ investment_income: 100, total_available: 100, sales: [], ending_cash: 0 });
    expect(result.timeline[0].funding?.payouts[0].estimated).toBe(false);
  });

  it("credits a matured bank once and estimates renewed terms, without releasing principal", () => {
    const result = buildStockStrategyTimeline(input([bankRow(), row(1, 200, 10)], [], {
      ownedSnapshot: { refreshed_at: START, stocks: [], city_bank: bank(START - DAY) },
    }), 1);
    expect(result.timeline[0].funding?.payouts.map((event) => [event.amount, event.at, event.estimated]))
      .toEqual([[100, START, false], [100, START + 90 * DAY, true]]);
    expect(result.timeline[0].funding?.ending_cash).toBe(0);
    expect(result.timeline[0].funding?.investment_income_sources[0]).toMatchObject({ basis: "imported_bank", confirmed_amount: 100, estimated_amount: 100 });
  });

  it("repeats the actual profit and term for a smaller deposit", () => {
    const current = { ...bank(), amount: 510, duration: 14, profit: 10 };
    const result = buildStockStrategyTimeline(input([bankRow(), row(1, 16, 10)], [], {
      ownedSnapshot: { refreshed_at: START, stocks: [], city_bank: current },
    }), 1);
    expect(result.timeline[0].funding?.payouts.map((event) => event.amount)).toEqual([10, 10]);
    expect(result.timeline[0].purchase_at).toBe(current.until + 14 * DAY);
  });

  it("does not add a TCI bonus again when renewing an imported deposit", () => {
    const tci = { ...row(9, 100, 9, 90), benefit_key: "city_bank:tci_bonus", acronym: "TCI" };
    const result = buildStockStrategyTimeline(input([bankRow(), tci, row(2, 280, 90)], [position(9, 6)], {
      ownedSnapshot: { refreshed_at: START, stocks: [position(9, 6)], city_bank: bank() },
    }), 1);
    expect(result.timeline[0].funding?.payouts.map((event) => event.amount)).toEqual([100, 100, 100]);
    expect(result.timeline[0].funding?.payouts.every((event) => event.id === "city_bank")).toBe(true);
    expect(result.weekly_investment_income).toBeCloseTo(100 * 7 / 90);
  });

  it("accepts an active passive TCI bonus without dividend increment or progress fields", () => {
    const tci = { ...row(9, 100, 9, 90), benefit_key: "city_bank:tci_bonus" };
    const holding = { ...position(9), bonus: { available: true, increment: null, progress: null, frequency: null } };
    const result = buildStockStrategyTimeline(input([bankRow(), tci, row(2, 190, 50)], [holding], {
      ownedSnapshot: { refreshed_at: START, stocks: [holding], city_bank: bank() },
    }), 1);
    expect(result.issues).toEqual([]);
    expect(result.timeline[0].funding?.payouts.map((event) => event.amount)).toEqual([100, 100]);
  });

  it("does not apply a TCI activation midway through an already renewed bank term", () => {
    const tci = { ...row(9, 100, 9, 90), benefit_key: "city_bank:tci_bonus" };
    const holding = position(9, 0);
    const result = buildStockStrategyTimeline(input([bankRow(), tci, row(2, 280, 90)], [holding], {
      ownedSnapshot: { refreshed_at: START, stocks: [holding], city_bank: bank() },
    }), 1);
    expect(result.timeline[0].funding?.payouts.map((event) => event.amount)).toEqual([100, 100, 100]);
  });

  it("does not recommend buying TCI on top of an imported all-in return", () => {
    const tci = { ...row(9, 10, 9, 90), benefit_key: "city_bank:tci_bonus" };
    const result = buildStockStrategyTimeline(input([bankRow(), tci, row(2, 270, 90)], [], { budget: 10,
      ownedSnapshot: { refreshed_at: START, stocks: [], city_bank: bank() },
    }), 2);
    expect(result.timeline.map((step) => step.step.recommendation.row.stock_id)).not.toContain(9);
    expect(result.timeline[0].funding?.payouts.map((event) => event.amount)).toEqual([100, 100, 100]);
  });

  it("credits activation, stock reward and bank interest together before a purchase", () => {
    const tci = { ...row(9, 100, 9, 90), benefit_key: "city_bank:tci_bonus" };
    const holdings = [position(9, 6), position(1, 6)];
    const current = bank(MIDNIGHT + DAY);
    const result = buildStockStrategyTimeline(input([bankRow(), tci, row(1, 100, 25), row(2, 200, 50)], holdings, {
      ownedSnapshot: { refreshed_at: START, stocks: holdings, city_bank: current },
    }), 1);
    expect(result.timeline[0].funding?.payouts.slice(0, 2).map((event) => [event.at, event.amount]))
      .toEqual([[current.until, 25], [current.until, 100]]);
    // Renewals repeat the all-in imported profit without an additional TCI source.
    expect(result.timeline[0].weekly_investment_income_after).toBeCloseTo(25 + 50 + 100 * 7 / 90);
  });

  it("accrues rentals evenly rather than interpreting the annualized valuation as a yearly payout", () => {
    const rental = { ...bankRow(), investment_type: "private_island", row_id: "private_island:rental", acronym: "PI",
      name: "Private Island Rental", benefit_key: "private_island:rental", benefit_description: "Rental income",
      frequency_days: 365, annual_return: 3650, benefit_value: 3650, increment_cost: 100000 } as PrivateIslandRentalRow;
    const result = buildStockStrategyTimeline(input([row(1, 25)], [], { rows: [rental, row(1, 25)], privateIslandCount: 2 }), 1);
    expect(result.timeline[0].purchase_at).toBe(START + 1.25 * DAY);
    expect(result.timeline[0].funding?.investment_income_sources[0]).toMatchObject({ amount: 25, averaged: true, reward_count: 0 });
    expect(result.timeline[0].funding?.payouts).toEqual([]);
  });

  it("starts a newly purchased bank term at purchase", () => {
    const result = buildStockStrategyTimeline(input([bankRow()], [], { budget: 1000 }), 1);
    expect(result.timeline[0].purchase_at).toBe(START);
    expect(result.timeline[0].funding).toMatchObject({ purchase_cost: 1000, investment_income: 0, ending_cash: 0 });
  });

  it("distinguishes absent bank details, no deposit and a conflicting manual active setting", () => {
    const args = input([row(1)]);
    expect(buildStockStrategyTimeline({ ...args, ownedSnapshot: { refreshed_at: START, stocks: [] } }).issues.join()).toContain("bank request may have failed");
    expect(buildStockStrategyTimeline(args).issues).toEqual([]);
    expect(buildStockStrategyTimeline({ ...args, cityBankActive: true }).issues.join()).toContain("no deposit");
  });

  it("rejects stale snapshots and missing/manual timing without backfilling income", () => {
    const args = input([row(1), row(2)], [position()]);
    expect(buildStockStrategyTimeline({ ...args, asOf: MIDNIGHT + DAY }).issues.join()).toContain("Refresh owned stocks today");
    expect(buildStockStrategyTimeline({ ...args, ownedSnapshot: { ...args.ownedSnapshot!, stocks: [{ ...position(), bonus: null }] } }).timeline).toEqual([]);
    expect(buildStockStrategyTimeline({ ...args, ownedSnapshot: null }).issues).not.toEqual([]);
  });

  it("uses UTC boundaries consistently across the daylight-saving change", () => {
    const stamp = Date.UTC(2026, 9, 24, 23, 59, 59) / 1000;
    const result = buildStockStrategyTimeline(input([row(1, 100, 25), row(2, 25)], [position(1, 6)], {
      asOf: stamp, ownedSnapshot: { refreshed_at: stamp, stocks: [position(1, 6)], city_bank: null },
    }), 1);
    expect(result.timeline[0].purchase_at).toBe(stamp + 1);
  });

  it("distinguishes unfunded from beyond-horizon purchases", () => {
    const args = input([row(1, 1000)]);
    expect(buildStockStrategyTimeline(args).timeline[0].status).toBe("unfunded");
    expect(buildStockStrategyTimeline({ ...args, additionalIncomePerWeek: 0.1 }).timeline[0].status).toBe("horizon");
  });

  it("excludes the synthetic hybrid while retaining actual stock income", () => {
    const fhg = { ...row(1, 100, 25), acronym: "FHG" };
    const tci = { ...row(9, 100, 9, 90), benefit_key: "city_bank:tci_bonus", acronym: "TCI" };
    const hybrid = buildFhgTciHybridRow([fhg, tci])!;
    const result = buildStockStrategyTimeline(input([fhg, tci, row(2, 25)], [position()], { rows: [fhg, tci, hybrid, row(2, 25)], fhgTciHybridActive: true }), 1);
    expect(result.timeline[0].funding?.payouts.map((event) => event.id)).toEqual(["stock:1"]);
    expect(result.warnings.join()).toContain("hybrid is excluded");
  });

  it("reconciles every step's funding, including carried cash and additional income", () => {
    const result = buildStockStrategyTimeline(input([row(1, 100, 100), row(2, 200, 70), row(3, 220, 70), row(4, 240, 70)], [position(1, 6)], { budget: 15, additionalIncomePerWeek: 20 }));
    expect(result.timeline.length).toBeGreaterThan(1);
    for (const { funding } of result.timeline) {
      if (!funding) continue;
      expect(funding.starting_cash + funding.investment_income + funding.additional_income + funding.sales.reduce((sum, sale) => sum + sale.sale_value, 0)).toBeCloseTo(funding.total_available);
      expect(funding.total_available - funding.purchase_cost).toBeCloseTo(funding.ending_cash);
      expect(funding.investment_income_sources.reduce((sum, source) => sum + source.amount, 0)).toBeCloseTo(funding.investment_income);
    }
  });
});
