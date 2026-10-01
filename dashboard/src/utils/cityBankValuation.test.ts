import { describe, expect, it } from "vitest";
import { cityBankInvestmentRoiRow } from "../../../src/stockMarket";
import { adjustCityBankRowForMerits, type StockInvestmentRecommendationRow } from "./stockRecommendations";
import { applyImportedCityBankReturn, bankReturnProtectedStockIds, cityBankValuation } from "./cityBankValuation";
import { buildStockStrategyTimeline } from "./stockStrategyTimeline";

const START = Date.UTC(2026, 9, 1, 12) / 1000;
const DAY = 86_400;
const imported = { amount: 2_387_200_000, profit: 387_200_000, duration: 90, interest_rate: 19.36,
  invested_at: START - 63 * DAY, until: START + 27 * DAY };
const base = cityBankInvestmentRoiRow();
const target: StockInvestmentRecommendationRow = { ...base, investment_type: "stock", row_id: "stock:1:1", stock_id: 1,
  acronym: "SYM", name: "Stock", increment: 1, required_shares: 1, total_shares_required: 1, latest_price: 700_000_000,
  increment_cost: 700_000_000, total_cost: 700_000_000, benefit_key: "cash:test", benefit_description: "Cash",
  frequency_days: 7, benefit_value: 10_000_000, annual_return: 10_000_000 * 365 / 7 };
const tci = { ...target, row_id: "stock:9:1", stock_id: 9, acronym: "TCI", benefit_key: "city_bank:tci_bonus" };

describe("shared bank return", () => {
  it("derives capital, annual return, weekly income and ROI from the imported term", () => {
    expect(cityBankValuation(imported)).toMatchObject({ principal: 2_000_000_000, profit: 387_200_000, duration: 90 });
    expect(cityBankValuation(imported).annual_return).toBeCloseTo(1_570_311_111.111111);
    expect(cityBankValuation(imported).weekly_income).toBeCloseTo(30_115_555.555555);
    expect(cityBankValuation(imported).roi_percent).toBeCloseTo(78.51555555);
  });

  it.each([0, 5, 10])("replaces the generic return without applying %s merits again", (merits) => {
    const adjusted = applyImportedCityBankReturn(adjustCityBankRowForMerits(base, merits), imported);
    expect(adjusted).toMatchObject({ increment_cost: 2_000_000_000, total_cost: 2_000_000_000, benefit_value: 387_200_000, frequency_days: 90 });
    expect(adjusted.annual_return).toBe(cityBankValuation(imported).annual_return);
    expect(adjusted.roi_percent).toBe(cityBankValuation(imported).roi_percent);
  });

  it("uses the actual term instead of a fixed 90 days", () => {
    const adjusted = applyImportedCityBankReturn(base, { ...imported, amount: 505_000_000, profit: 5_000_000, duration: 14 });
    expect(adjusted).toMatchObject({ frequency_days: 14, increment_cost: 500_000_000, benefit_value: 5_000_000 });
    expect(adjusted.annual_return).toBe(5_000_000 * 365 / 14);
  });

  it("uses the generic valuation only when imported data is absent", () => {
    const estimated = adjustCityBankRowForMerits(base, 10);
    expect(applyImportedCityBankReturn(estimated, null)).toBe(estimated);
    expect(applyImportedCityBankReturn(estimated, undefined)).toBe(estimated);
    expect(applyImportedCityBankReturn(target, imported)).toBe(target);
  });

  it("does not count TCI as a separate source of profit", () => {
    const included = applyImportedCityBankReturn(tci, imported);
    expect(included).toMatchObject({ annual_return: 0, roi_percent: 0, benefit_value: 0 });
    expect(included.increment_cost).toBe(tci.increment_cost);
    expect(bankReturnProtectedStockIds([base, tci, target], imported)).toEqual([9]);
    expect(bankReturnProtectedStockIds([base, tci, target], null)).toEqual([]);
  });

  it("keeps the original 2bn reserved and repeats 387.2m across planner and table", () => {
    const bankRow = applyImportedCityBankReturn(adjustCityBankRowForMerits(base, 10), imported);
    const snapshot = { refreshed_at: START, stocks: [{ stock_id: 9, shares: 1, bonus: null }], city_bank: imported };
    const result = buildStockStrategyTimeline({ rows: [bankRow, target, tci], ownedSnapshot: snapshot, cityBankActive: true,
      budget: 0, additionalIncomePerWeek: 0, asOf: START, affordableOnly: false, minimumRoi: null }, 1);
    expect(result.issues).toEqual([]);
    const purchase = result.timeline[0];
    expect(purchase.purchase_at).toBe(imported.until + 90 * DAY);
    expect(purchase.funding?.payouts.map((event) => event.amount)).toEqual([bankRow.benefit_value, bankRow.benefit_value]);
    expect(purchase.funding?.sales).toEqual([]);
    expect(purchase.funding).toMatchObject({ investment_income: 774_400_000, total_available: 774_400_000, ending_cash: 74_400_000 });
    expect(result.weekly_investment_income).toBeCloseTo(bankRow.annual_return * 7 / 365);
    expect(purchase.funding?.investment_income_sources[0]).toMatchObject({ confirmed_amount: 387_200_000, estimated_amount: 387_200_000 });
  });

  it("does not replace a confirmed zero profit with the generic positive return", () => {
    const investment = { ...imported, amount: 2_000_000_000, profit: 0, interest_rate: 0 };
    const bankRow = applyImportedCityBankReturn(base, investment);
    expect(bankRow.annual_return).toBe(0);
    expect(bankRow.days_to_break_even).toBe(Infinity);
    const result = buildStockStrategyTimeline({ rows: [base, target], ownedSnapshot: { refreshed_at: START, stocks: [], city_bank: investment },
      cityBankActive: true, budget: 0, additionalIncomePerWeek: 0, asOf: START, affordableOnly: false, minimumRoi: null }, 1);
    expect(result.weekly_investment_income).toBe(0);
    expect(result.timeline[0].status).toBe("unfunded");
  });
});
