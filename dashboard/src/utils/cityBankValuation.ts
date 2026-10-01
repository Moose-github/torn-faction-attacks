import { cityBankPrincipal, type CityBankInvestment } from "./ownedStocks";
import type { StockInvestmentRecommendationRow } from "./stockRecommendations";

export const TCI_BANK_BENEFIT = "city_bank:tci_bonus";

/** The imported profit is all-in. Use its original principal and term everywhere. */
export function cityBankValuation(investment: CityBankInvestment) {
  const principal = cityBankPrincipal(investment);
  const annualReturn = investment.profit * 365 / investment.duration;
  return {
    principal,
    profit: investment.profit,
    duration: investment.duration,
    annual_return: annualReturn,
    weekly_income: investment.profit * 7 / investment.duration,
    roi_percent: annualReturn / principal * 100,
    days_to_break_even: investment.profit > 0 ? principal / (investment.profit / investment.duration) : Infinity,
  };
}

export function applyImportedCityBankReturn<T extends StockInvestmentRecommendationRow>(
  row: T,
  investment: CityBankInvestment | null | undefined,
): T {
  if (!investment) return row;
  if (row.benefit_key === TCI_BANK_BENEFIT) {
    // The API does not identify which perks contributed to the original deposit.
    // Do not attribute an additional cash return to TCI on top of imported profit.
    return { ...row, benefit_value: 0, annual_return: 0, roi_percent: 0, days_to_break_even: Infinity };
  }
  if (row.investment_type !== "city_bank") return row;
  const value = cityBankValuation(investment);
  return {
    ...row, increment_cost: value.principal, total_cost: value.principal,
    frequency_days: value.duration, benefit_value: value.profit,
    annual_return: value.annual_return, roi_percent: value.roi_percent, days_to_break_even: value.days_to_break_even,
  };
}

/** Preserve bonus-bearing holdings while assuming the imported bank return repeats. */
export function bankReturnProtectedStockIds(
  rows: StockInvestmentRecommendationRow[],
  investment: CityBankInvestment | null | undefined,
): number[] {
  return investment ? rows.filter((row) => row.benefit_key === TCI_BANK_BENEFIT && row.stock_id !== null)
    .map((row) => row.stock_id!) : [];
}
