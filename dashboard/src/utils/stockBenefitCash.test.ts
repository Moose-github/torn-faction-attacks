import { describe, expect, it } from "vitest";
import { isNonCashStockBenefit } from "./stockBenefitCash";
import type { StockInvestmentRoiRow } from "../api/types";
import { buildStockStrategyTimeline } from "./stockStrategyTimeline";

describe("stock benefit cash eligibility", () => {
  it.each([
    ["item:100_energy", "100 Energy"],
    ["item:50_nerve", "50 Nerve"],
    ["item:1000_happy", "1,000 Happy"],
    ["item:1000_happiness", "1000 Happiness"],
    ["item:ammunition_pack", "1x Ammunition Pack"],
    ["item:ammunition_pack_special_ammo", "1x Ammunition Pack (Special Ammo)"],
  ])("does not turn %s utility value into investment cash", (benefit_key, benefit_description) => {
    expect(isNonCashStockBenefit({ investment_type: "stock", benefit_key, benefit_description })).toBe(true);
  });

  it.each(["100 Energy", "+100 Energy", "1,000 Happy", "50 Nerve", "1x Ammunition Pack (Special Ammo)"])(
    "recognizes the exact utility description when its key is missing: %s", (benefit_description) => {
      expect(isNonCashStockBenefit({ investment_type: "stock", benefit_key: null, benefit_description })).toBe(true);
    },
  );

  it.each([
    [null, "$1,000,000"],
    ["item:100_points", "100 Points"],
    ["item:six_pack_of_energy_drink", "1x Six Pack of Energy Drink"],
    ["item:drug_pack", "1x Drug Pack"],
    ["item:box_of_grenades", "1x Box of Grenades"],
    ["item:random_property", "1x Random Property"],
    ["item:clothing_cache", "1x Clothing Cache"],
    ["item:box_of_medical_supplies", "1x Box of Medical Supplies"],
  ])("retains cash or tradable reward %s regardless of custom ROI valuation", (benefit_key, benefit_description) => {
    expect(isNonCashStockBenefit({ investment_type: "stock", benefit_key, benefit_description })).toBe(false);
  });

  it("leaves bank interest and rental cash to their existing simulation rules", () => {
    expect(isNonCashStockBenefit({ investment_type: "city_bank", benefit_key: "city_bank:90", benefit_description: "Interest" })).toBe(false);
    expect(isNonCashStockBenefit({ investment_type: "private_island", benefit_key: "private_island:rental", benefit_description: "Rental income" })).toBe(false);
    expect(isNonCashStockBenefit({ investment_type: "stock", benefit_key: "city_bank:tci_bonus", benefit_description: "10% bank interest bonus" })).toBe(false);
  });
});

describe("cash forecasts with personal-resource rewards", () => {
  const start = Date.UTC(2026, 9, 24, 12) / 1000;
  const utility: StockInvestmentRoiRow = {
    investment_type: "stock", row_id: "stock:1:1", stock_id: 1, acronym: "MCS", name: "MCS",
    increment: 1, required_shares: 100, total_shares_required: 100, latest_price: 1,
    increment_cost: 100, total_cost: 100, benefit_key: "item:100_energy", benefit_description: "100 Energy",
    valuation_source: "custom", frequency_days: 7, benefit_value: 25, annual_return: 25 * 365 / 7,
    days_to_break_even: 28, roi_percent: 25 * 365 / 7,
  };
  const target = { ...utility, row_id: "stock:2:1", stock_id: 2, acronym: "CASH", benefit_key: "cash:test",
    benefit_description: "$25", valuation_source: "cash" as const };

  it.each([true, false])("never funds purchases from energy valuations (known timing: %s)", knownTiming => {
    const result = buildStockStrategyTimeline({
      rows: [utility, target], budget: 75, additionalIncomePerWeek: 0, asOf: start,
      cityBankActive: false, minimumRoi: null, affordableOnly: false, lockedStockIds: new Set([1]),
      ownedSnapshot: { refreshed_at: start, city_bank: null, stocks: [{ stock_id: 1, shares: 100,
        bonus: knownTiming ? { increment: 1, available: true, progress: 7, frequency: 7 } : null }] },
    });
    expect(result.issues).toEqual([]);
    expect(result.weekly_investment_income).toBe(0);
    expect(result.timeline[0].status).toBe("unfunded");
    expect(result.timeline[0].purchase_at).toBeNull();
    expect(result.warnings.join()).toContain("not cash");
    expect(utility.benefit_value).toBe(25);
  });

  it("can sell unlocked utility shares but never buys a utility block to grow cash", () => {
    const result = buildStockStrategyTimeline({
      rows: [utility, target], budget: 75, additionalIncomePerWeek: 0, asOf: start,
      cityBankActive: false, minimumRoi: null, affordableOnly: false,
      ownedSnapshot: { refreshed_at: start, city_bank: null, stocks: [{ stock_id: 1, shares: 100, bonus: null }] },
    });
    expect(result.timeline).toHaveLength(1);
    expect(result.timeline[0].step.recommendation.row.stock_id).toBe(2);
    expect(result.timeline[0].purchase_at).toBe(start);
    expect(result.timeline[0].step.sales[0]).toMatchObject({ stock_id: 1, shares: 26, current_annual_return: 0 });
    expect(result.timeline[0].funding?.investment_income).toBe(0);
  });

  it("still funds purchases from a ready tradable energy-drink reward", () => {
    const result = buildStockStrategyTimeline({
      rows: [{ ...utility, benefit_key: "item:six_pack_of_energy_drink", benefit_description: "1x Six Pack of Energy Drink" }, target],
      budget: 75, additionalIncomePerWeek: 0, asOf: start, cityBankActive: false,
      minimumRoi: null, affordableOnly: false, lockedStockIds: new Set([1]),
      ownedSnapshot: { refreshed_at: start, city_bank: null, stocks: [{ stock_id: 1, shares: 100,
        bonus: { increment: 1, available: true, progress: 7, frequency: 7 } }] },
    });
    expect(result.timeline[0].purchase_at).toBe(start);
    expect(result.timeline[0].funding?.investment_income).toBe(25);
  });
});
