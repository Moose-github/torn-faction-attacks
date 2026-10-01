import type { StockStrategyPlan, StockStrategyStep } from "./stockRecommendations";

export type StockStrategyTiming = {
  step: StockStrategyStep;
  wait_weeks: number | null;
  elapsed_weeks: number | null;
  weekly_investment_income_after: number | null;
  weekly_total_income_after: number | null;
};

export function annualIncomeToWeekly(annualIncome: number): number {
  return annualIncome * 7 / 365;
}

/** Average payouts continuously and reinvest all income; prices stay fixed. */
export function buildStockStrategyTimeline(
  plan: StockStrategyPlan,
  income: { investmentIncomePerWeek: number; additionalIncomePerWeek: number },
): StockStrategyTiming[] {
  let weeklyInvestmentIncome = nonNegativeIncome(income.investmentIncomePerWeek);
  const weeklyAdditionalIncome = nonNegativeIncome(income.additionalIncomePerWeek);
  let elapsedWeeks: number | null = 0;

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
      };
    }

    elapsedWeeks += waitWeeks;
    // Net gain includes the income lost from any holdings sold at this step.
    weeklyInvestmentIncome = Math.max(0, weeklyInvestmentIncome + annualIncomeToWeekly(step.annual_return_gain));
    return {
      step,
      wait_weeks: waitWeeks,
      elapsed_weeks: elapsedWeeks,
      weekly_investment_income_after: weeklyInvestmentIncome,
      weekly_total_income_after: weeklyInvestmentIncome + weeklyAdditionalIncome,
    };
  });
}

function nonNegativeIncome(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
