import type { StockInvestmentRecommendationRow, StockStrategyPlan, StockStrategySale, StockStrategyStep } from "./stockRecommendations";

export type StockStrategyIncomeSource = {
  id: string;
  label: string;
  weekly_income: number;
};

export type StockStrategyFunding = {
  starting_cash: number;
  sales: StockStrategySale[];
  investment_income: number;
  investment_income_sources: { id: string; label: string; amount: number }[];
  additional_income: number;
  total_available: number;
  purchase_cost: number;
  ending_cash: number;
};

export type StockStrategyTiming = {
  step: StockStrategyStep;
  wait_weeks: number | null;
  elapsed_weeks: number | null;
  weekly_investment_income_after: number | null;
  weekly_total_income_after: number | null;
  funding: StockStrategyFunding | null;
};

export function annualIncomeToWeekly(annualIncome: number): number {
  return annualIncome * 7 / 365;
}

export function stockStrategyIncomeSource(row: StockInvestmentRecommendationRow, annualIncome = row.annual_return): StockStrategyIncomeSource {
  return {
    id: row.stock_id !== null ? `stock:${row.stock_id}` : row.row_id,
    label: row.investment_type === "city_bank" ? "City Bank interest"
      : row.investment_type === "private_island" ? "Private Island rental income"
        : `${row.acronym ?? row.name ?? `Stock ${row.stock_id}`} income`,
    weekly_income: annualIncomeToWeekly(annualIncome),
  };
}

/** Average payouts continuously and reinvest all income; prices stay fixed. */
export function buildStockStrategyTimeline(
  plan: StockStrategyPlan,
  income: {
    investmentIncomePerWeek: number;
    additionalIncomePerWeek: number;
    investmentSources?: StockStrategyIncomeSource[];
    investmentIncomeOverridden?: boolean;
  },
): StockStrategyTiming[] {
  let weeklyInvestmentIncome = nonNegativeIncome(income.investmentIncomePerWeek);
  const weeklyAdditionalIncome = nonNegativeIncome(income.additionalIncomePerWeek);
  let elapsedWeeks: number | null = 0;
  const sources = new Map<string, StockStrategyIncomeSource>();
  for (const source of income.investmentSources ?? []) {
    adjustIncomeSource(sources, source.id, source.label, nonNegativeIncome(source.weekly_income));
  }
  const sourceTotal = [...sources.values()].reduce((sum, source) => sum + source.weekly_income, 0);
  const adjustmentId = income.investmentIncomeOverridden ? "manual-adjustment" : "existing-income";
  const adjustmentLabel = income.investmentIncomeOverridden ? "Manual investment income adjustment" : "Other investment income";
  adjustIncomeSource(sources, adjustmentId, adjustmentLabel, weeklyInvestmentIncome - sourceTotal);

  return plan.steps.map((step) => {
    const weeklyIncome = weeklyInvestmentIncome + weeklyAdditionalIncome;
    const waitWeeks = step.extra_cash_needed <= 0
      ? 0
      : weeklyIncome > 0 ? step.extra_cash_needed / weeklyIncome : null;
    if (elapsedWeeks === null || waitWeeks === null || !Number.isFinite(elapsedWeeks + waitWeeks)) {
      // A hypothetical later purchase cannot provide income to fund an unreachable step.
      elapsedWeeks = null;
      return {
        step,
        wait_weeks: null,
        elapsed_weeks: null,
        weekly_investment_income_after: null,
        weekly_total_income_after: null,
        funding: null,
      };
    }

    elapsedWeeks += waitWeeks;
    const investmentIncome = weeklyInvestmentIncome * waitWeeks;
    const additionalIncome = weeklyAdditionalIncome * waitWeeks;
    const funding: StockStrategyFunding = {
      starting_cash: step.starting_cash,
      sales: step.sales,
      investment_income: investmentIncome,
      investment_income_sources: [...sources.values()]
        .map((source) => ({ id: source.id, label: source.label, amount: source.weekly_income * waitWeeks }))
        .filter((source) => Math.abs(source.amount) > 0.000001),
      additional_income: additionalIncome,
      total_available: step.starting_cash + investmentIncome + additionalIncome + step.sales.reduce((sum, sale) => sum + sale.sale_value, 0),
      purchase_cost: step.recommendation.estimated_cost,
      ending_cash: step.ending_cash,
    };

    // Holdings keep earning during the saving period; sales occur at purchase.
    for (const sale of step.sales) {
      const sourceId = sale.source_kind === "synthetic" ? sale.source_row_id : `stock:${sale.stock_id}`;
      const existingSource = sourceId ? sources.get(sourceId) : undefined;
      adjustIncomeSource(sources, existingSource?.id ?? adjustmentId, existingSource?.label ?? adjustmentLabel, -annualIncomeToWeekly(sale.current_annual_return));
    }
    const conversion = step.recommendation.hybrid_conversion;
    if (conversion) {
      const existingSource = sources.get(`stock:${conversion.stock_id}`);
      adjustIncomeSource(sources, existingSource?.id ?? adjustmentId, existingSource?.label ?? adjustmentLabel, -annualIncomeToWeekly(conversion.annual_return_loss));
    }
    const purchaseSource = stockStrategyIncomeSource(step.recommendation.row,
      step.recommendation.annual_return + (conversion?.annual_return_loss ?? 0));
    adjustIncomeSource(sources, purchaseSource.id, purchaseSource.label, purchaseSource.weekly_income);
    // Net gain includes the income lost from any holdings sold at this step.
    weeklyInvestmentIncome = Math.max(0, weeklyInvestmentIncome + annualIncomeToWeekly(step.annual_return_gain));
    const updatedSourceTotal = [...sources.values()].reduce((sum, source) => sum + source.weekly_income, 0);
    adjustIncomeSource(sources, adjustmentId, adjustmentLabel, weeklyInvestmentIncome - updatedSourceTotal);
    return {
      step,
      wait_weeks: waitWeeks,
      elapsed_weeks: elapsedWeeks,
      weekly_investment_income_after: weeklyInvestmentIncome,
      weekly_total_income_after: weeklyInvestmentIncome + weeklyAdditionalIncome,
      funding,
    };
  });
}

function adjustIncomeSource(sources: Map<string, StockStrategyIncomeSource>, id: string, label: string, delta: number): void {
  const weeklyIncome = (sources.get(id)?.weekly_income ?? 0) + delta;
  sources.set(id, { id, label, weekly_income: weeklyIncome });
}

function nonNegativeIncome(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
