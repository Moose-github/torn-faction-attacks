import type { CityBankInvestment } from "./ownedStocks";
import { applyImportedCityBankReturn, bankReturnProtectedStockIds, TCI_BANK_BENEFIT } from "./cityBankValuation";
import type { StockInvestmentRecommendationRow } from "./stockRecommendations";

/** Current bank context for recommendations and owned-income summaries, without changing future bank assumptions. */
export function stockBankPlannerContext(input: {
  rows: StockInvestmentRecommendationRow[];
  cityBankActive: boolean;
  bankInvestment: CityBankInvestment | null | undefined;
  lockedStockIds?: ReadonlySet<number>;
  excludedPurchaseRowIds?: ReadonlySet<string>;
}) {
  const cityBankActive = input.bankInvestment === undefined ? input.cityBankActive : input.bankInvestment !== null;
  const rows = input.rows.map((row) => {
    const valued = applyImportedCityBankReturn(row, input.bankInvestment);
    return !cityBankActive && row.benefit_key === TCI_BANK_BENEFIT
      ? { ...valued, benefit_value: 0, annual_return: 0, roi_percent: 0, days_to_break_even: Infinity }
      : valued;
  });
  const excludedPurchaseRowIds = new Set(input.excludedPurchaseRowIds);
  if (!cityBankActive || input.bankInvestment) for (const row of rows) {
    if (row.benefit_key === TCI_BANK_BENEFIT) excludedPurchaseRowIds.add(row.row_id);
  }
  const lockedStockIds = new Set([...(input.lockedStockIds ?? []), ...bankReturnProtectedStockIds(rows, input.bankInvestment)]);
  return { rows, cityBankActive, excludedPurchaseRowIds, lockedStockIds };
}
