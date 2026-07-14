import type { StockInvestmentRoiRow } from "../api/types";
import type { OwnedStockSnapshot } from "./ownedStocks";
import { ownedSharesMap, ownsStockIncrement } from "./ownedStocks";

const CITY_BANK_MERIT_STEP = 0.05;
const MIN_REBALANCE_ANNUAL_GAIN = 1_000_000;
const MIN_REBALANCE_ROI_GAIN = 5;
const MIN_STRATEGY_ROI_RETENTION = 0.75;
export const DEFAULT_STOCK_STRATEGY_STEP_LIMIT = 10;

type StockInvestmentStockRow = StockInvestmentRoiRow & {
  investment_type: "stock";
  stock_id: number;
  increment: number;
  required_shares: number;
  total_shares_required: number;
  latest_price: number;
};

export type StockBuyRecommendation = {
  row: StockInvestmentRoiRow;
  owned_shares: number;
  target_shares: number | null;
  shares_needed: number | null;
  estimated_cost: number;
  annual_return: number;
  roi_percent: number;
  affordable: boolean | null;
  personalized: boolean;
};

export type StockBuyRecommendationInput = {
  rows: StockInvestmentRoiRow[];
  ownedSnapshot: OwnedStockSnapshot | null;
  cityBankActive: boolean;
  budget: number | null;
  affordableOnly: boolean;
  minimumRoi: number | null;
};

export type StockSuggestedActionKind =
  | "closest_completion"
  | "best_affordable"
  | "best_roi"
  | "highest_return"
  | "city_bank";

export type StockSuggestedAction = {
  kind: StockSuggestedActionKind;
  title: string;
  reason: string;
  recommendation: StockBuyRecommendation;
};

export type StockCapitalMilestone = {
  capital: number;
  recommendation: StockBuyRecommendation;
};

export type StockRebalanceRecommendation = {
  sell_stock_id: number;
  sell_acronym: string | null;
  sell_name: string | null;
  sell_shares: number;
  sales: StockStrategySale[];
  sale_value: number;
  available_cash: number;
  available_capital: number;
  current_annual_return: number;
  current_roi_percent: number | null;
  proposed: StockBuyRecommendation;
  annual_return_gain: number;
  extra_cash_required: number;
};

export type StockStrategyStepKind = "buy" | "rebalance";

export type StockStrategySale = {
  stock_id: number;
  acronym: string | null;
  name: string | null;
  shares: number;
  sale_value: number;
  current_annual_return: number;
};

export type StockStrategyStep = {
  kind: StockStrategyStepKind;
  cash_required: number;
  extra_cash_needed: number;
  starting_cash: number;
  ending_cash: number;
  annual_return_gain: number;
  roi_percent: number;
  recommendation: StockBuyRecommendation;
  rebalance: StockRebalanceRecommendation | null;
  sales: StockStrategySale[];
};

export type StockStrategyPlan = {
  starting_cash: number;
  steps: StockStrategyStep[];
};

export function adjustCityBankRowForMerits(row: StockInvestmentRoiRow, bankMerits: number): StockInvestmentRoiRow {
  if (row.investment_type !== "city_bank") {
    return row;
  }

  const multiplier = 1 + clampBankMerits(bankMerits) * CITY_BANK_MERIT_STEP;
  const benefitValue = row.benefit_value * multiplier;
  const annualReturn = row.annual_return * multiplier;
  return {
    ...row,
    benefit_value: benefitValue,
    annual_return: annualReturn,
    roi_percent: (annualReturn / row.increment_cost) * 100,
    days_to_break_even: row.increment_cost / (annualReturn / 365),
  };
}

export function recommendBestStockBuy(input: StockBuyRecommendationInput): StockBuyRecommendation | null {
  return recommendStockBuys(input, 1)[0] ?? null;
}

export function recommendStockBuys(input: StockBuyRecommendationInput, limit = 5): StockBuyRecommendation[] {
  const ownedShares = ownedSharesMap(input.ownedSnapshot);
  const recommendations = input.rows
    .filter((row) => input.minimumRoi === null || row.roi_percent >= input.minimumRoi)
    .map((row) => stockBuyRecommendationFromRow(row, {
      ownedShares,
      hasOwnedSnapshot: input.ownedSnapshot !== null,
      cityBankActive: input.cityBankActive,
      budget: input.budget,
    }))
    .filter((recommendation): recommendation is StockBuyRecommendation => {
      if (!recommendation) {
        return false;
      }
      return !input.affordableOnly || recommendation.affordable !== false;
    });

  recommendations.sort(compareStockBuyRecommendations);
  return recommendations.slice(0, Math.max(0, limit));
}

export function buildStockSuggestedActions(input: StockBuyRecommendationInput, limit = 5): StockSuggestedAction[] {
  const recommendations = recommendStockBuys(input, Number.MAX_SAFE_INTEGER);
  const actions: StockSuggestedAction[] = [];
  const seenRows = new Set<string>();
  const pushAction = (action: StockSuggestedAction | null) => {
    if (!action || seenRows.has(action.recommendation.row.row_id) || actions.length >= limit) {
      return;
    }
    seenRows.add(action.recommendation.row.row_id);
    actions.push(action);
  };

  pushAction(actionFromRecommendation(
    "closest_completion",
    "Complete closest block",
    "Lowest additional cost among partially owned blocks.",
    closestCompletion(recommendations),
  ));

  if (input.budget !== null) {
    pushAction(actionFromRecommendation(
      "best_affordable",
      "Best affordable buy",
      "Highest ranked option within your investment amount.",
      recommendations.filter((recommendation) => recommendation.affordable === true).sort(compareStockBuyRecommendations)[0] ?? null,
    ));
  }

  pushAction(actionFromRecommendation(
    "best_roi",
    "Best ROI buy",
    "Highest ranked next buy after covered blocks and filters.",
    recommendations[0] ?? null,
  ));

  pushAction(actionFromRecommendation(
    "highest_return",
    "Highest annual return",
    "Largest annual return among currently eligible next buys.",
    [...recommendations].sort(compareByAnnualReturn)[0] ?? null,
  ));

  pushAction(actionFromRecommendation(
    "city_bank",
    "City Bank comparison",
    "Bank option with your current merit setting, if it is not marked active.",
    recommendations.find((recommendation) => recommendation.row.investment_type === "city_bank") ?? null,
  ));

  return actions;
}

export function buildStockCapitalMilestones(input: StockBuyRecommendationInput, limit = 5): StockCapitalMilestone[] {
  const candidates = recommendStockBuys({
    ...input,
    budget: null,
    affordableOnly: false,
  }, Number.MAX_SAFE_INTEGER)
    .sort((left, right) => left.estimated_cost - right.estimated_cost || compareStockBuyRecommendations(left, right));
  const milestones: StockCapitalMilestone[] = [];
  let lastRecommendationRowId: string | null = null;

  for (const candidate of candidates) {
    const bestAtCapital = candidates
      .filter((recommendation) => recommendation.estimated_cost <= candidate.estimated_cost)
      .sort(compareStockBuyRecommendations)[0] ?? null;
    if (!bestAtCapital || bestAtCapital.row.row_id === lastRecommendationRowId) {
      continue;
    }

    milestones.push({
      capital: candidate.estimated_cost,
      recommendation: bestAtCapital,
    });
    lastRecommendationRowId = bestAtCapital.row.row_id;
    if (milestones.length >= limit) {
      break;
    }
  }

  return milestones;
}

export function buildStockRebalanceRecommendations(input: StockBuyRecommendationInput, limit = 5): StockRebalanceRecommendation[] {
  const recommendations = buildRebalanceRecommendations(input, input.budget ?? 0, false);
  recommendations.sort(compareStockRebalanceRecommendations);
  return recommendations.slice(0, Math.max(0, limit));
}

export function buildStockStrategyPlan(input: StockBuyRecommendationInput, limit = DEFAULT_STOCK_STRATEGY_STEP_LIMIT): StockStrategyPlan {
  let simulatedSnapshot = cloneOwnedSnapshot(input.ownedSnapshot);
  let simulatedCityBankActive = input.cityBankActive;
  let currentCash = input.budget ?? 0;
  const steps: StockStrategyStep[] = [];

  for (let index = 0; index < limit; index += 1) {
    const stepInput = {
      ...input,
      ownedSnapshot: simulatedSnapshot,
      cityBankActive: simulatedCityBankActive,
      budget: null,
      affordableOnly: false,
    };
    const recommendations = recommendStockBuys(stepInput, Number.MAX_SAFE_INTEGER);
    const nextStep = nextStrategyStep(stepInput, recommendations, simulatedSnapshot, currentCash, steps, limit);
    if (!nextStep || !strategyStepIsWorthAdding(nextStep, steps)) {
      break;
    }

    steps.push(nextStep);
    currentCash = nextStep.ending_cash;
    simulatedSnapshot = applyStrategyStepToSnapshot(simulatedSnapshot, nextStep);
    if (nextStep.recommendation.row.investment_type === "city_bank") {
      simulatedCityBankActive = true;
    }
  }

  return {
    starting_cash: input.budget ?? 0,
    steps,
  };
}

function nextStrategyStep(
  input: StockBuyRecommendationInput,
  recommendations: StockBuyRecommendation[],
  snapshot: OwnedStockSnapshot,
  currentCash: number,
  previousSteps: StockStrategyStep[],
  limit: number,
): StockStrategyStep | null {
  const target = recommendations[0] ?? null;
  if (!target) {
    return null;
  }

  const targetSalePlan = buildStrategySalePlan(input.rows, snapshot, target, currentCash);
  const targetCashRequired = Math.max(0, target.estimated_cost - targetSalePlan.sale_value);
  const targetStep = strategySalePlanIsBeneficial(target, targetSalePlan)
    ? strategyRebalanceStep(target, targetSalePlan, currentCash)
    : strategyBuyStep(target, currentCash);
  const steppingStone = selectStrategySteppingStone(
    recommendations,
    target,
    targetCashRequired,
    previousSteps.length,
    strategyBestPreviousRoi(previousSteps),
  );

  if (!steppingStone) {
    return targetStep;
  }
  if (previousSteps.length >= limit - 1) {
    return targetStep;
  }
  if (targetStep.kind === "rebalance" && targetCashRequired <= steppingStone.estimated_cost) {
    return targetStep;
  }

  const steppingStoneSalePlan = buildStrategySalePlan(input.rows, snapshot, steppingStone, currentCash);
  return strategySalePlanIsBeneficial(steppingStone, steppingStoneSalePlan) && steppingStoneSalePlan.current_annual_return <= 0
    ? strategyRebalanceStep(steppingStone, steppingStoneSalePlan, currentCash)
    : strategyBuyStep(steppingStone, currentCash);
}

function selectStrategySteppingStone(
  recommendations: StockBuyRecommendation[],
  target: StockBuyRecommendation,
  targetCashRequired: number,
  stepIndex: number,
  previousBestRoi: number | null,
): StockBuyRecommendation | null {
  const steppingStones = buildStrategyMilestones(recommendations)
    .map((milestone) => milestone.recommendation)
    .filter((recommendation) =>
      recommendation.row.row_id !== target.row.row_id &&
      recommendation.estimated_cost < targetCashRequired
    );

  if (steppingStones.length === 0) {
    return null;
  }

  const bestSteppingStone = [...steppingStones].sort(compareStockBuyRecommendations)[0] ?? null;
  const qualityFloor = Math.max(
    bestSteppingStone ? bestSteppingStone.roi_percent * MIN_STRATEGY_ROI_RETENTION : 0,
    previousBestRoi !== null ? previousBestRoi * MIN_STRATEGY_ROI_RETENTION : 0,
  );
  const usefulSteppingStones = steppingStones.filter((recommendation) => recommendation.roi_percent >= qualityFloor);
  if (usefulSteppingStones.length === 0) {
    return null;
  }

  if (stepIndex === 0) {
    return usefulSteppingStones[0] ?? null;
  }

  return [...usefulSteppingStones].sort(compareStockBuyRecommendations)[0] ?? null;
}

function strategyStepIsWorthAdding(step: StockStrategyStep, previousSteps: StockStrategyStep[]): boolean {
  if (previousSteps.length === 0) {
    return true;
  }

  const bestPreviousRoi = strategyBestPreviousRoi(previousSteps) ?? 0;
  return step.roi_percent >= bestPreviousRoi * MIN_STRATEGY_ROI_RETENTION;
}

function strategyBestPreviousRoi(previousSteps: StockStrategyStep[]): number | null {
  return previousSteps.length > 0
    ? Math.max(...previousSteps.map((previousStep) => previousStep.roi_percent))
    : null;
}

function strategySalePlanIsBeneficial(
  recommendation: StockBuyRecommendation,
  salePlan: StockStrategySalePlan,
): boolean {
  return salePlan.sales.length > 0 && recommendation.annual_return > salePlan.current_annual_return;
}

function strategyBuyStep(recommendation: StockBuyRecommendation, currentCash: number): StockStrategyStep {
  const cashRequired = recommendation.estimated_cost;
  const extraCashNeeded = Math.max(0, cashRequired - currentCash);
  return {
    kind: "buy",
    cash_required: cashRequired,
    extra_cash_needed: extraCashNeeded,
    starting_cash: currentCash,
    ending_cash: Math.max(0, currentCash + extraCashNeeded - recommendation.estimated_cost),
    annual_return_gain: recommendation.annual_return,
    roi_percent: recommendation.roi_percent,
    recommendation,
    rebalance: null,
    sales: [],
  };
}

function strategyRebalanceStep(
  recommendation: StockBuyRecommendation,
  salePlan: StockStrategySalePlan,
  currentCash: number,
): StockStrategyStep {
  const cashRequired = Math.max(0, recommendation.estimated_cost - salePlan.sale_value);
  const extraCashNeeded = Math.max(0, cashRequired - currentCash);
  return {
    kind: "rebalance",
    cash_required: cashRequired,
    extra_cash_needed: extraCashNeeded,
    starting_cash: currentCash,
    ending_cash: Math.max(0, currentCash + extraCashNeeded + salePlan.sale_value - recommendation.estimated_cost),
    annual_return_gain: recommendation.annual_return - salePlan.current_annual_return,
    roi_percent: recommendation.roi_percent,
    recommendation,
    rebalance: salePlanToRebalanceRecommendation(recommendation, salePlan, currentCash),
    sales: salePlan.sales,
  };
}

function buildStrategyMilestones(recommendations: StockBuyRecommendation[]): StockCapitalMilestone[] {
  const candidates = [...recommendations]
    .sort((left, right) => left.estimated_cost - right.estimated_cost || compareStockBuyRecommendations(left, right));
  const milestones: StockCapitalMilestone[] = [];
  let lastRecommendationRowId: string | null = null;

  for (const candidate of candidates) {
    const bestAtCapital = candidates
      .filter((recommendation) => recommendation.estimated_cost <= candidate.estimated_cost)
      .sort(compareStockBuyRecommendations)[0] ?? null;
    if (!bestAtCapital || bestAtCapital.row.row_id === lastRecommendationRowId) {
      continue;
    }

    milestones.push({
      capital: candidate.estimated_cost,
      recommendation: bestAtCapital,
    });
    lastRecommendationRowId = bestAtCapital.row.row_id;
  }

  return milestones;
}

function buildRebalanceRecommendations(
  input: StockBuyRecommendationInput,
  availableCash: number,
  allowFutureCash: boolean,
): StockRebalanceRecommendation[] {
  if (!input.ownedSnapshot) {
    return [];
  }

  const stockRows = input.rows.filter(isStockInvestmentRow);
  const stockRowsById = stockRows.reduce((map, row) => {
    const rows = map.get(row.stock_id) ?? [];
    rows.push(row);
    map.set(row.stock_id, rows);
    return map;
  }, new Map<number, StockInvestmentStockRow[]>());
  const recommendations: StockRebalanceRecommendation[] = [];
  const totalSellableValue = input.ownedSnapshot.stocks.reduce((total, stock) => {
    const ownedRows = stockRowsById.get(stock.stock_id) ?? [];
    const priceRow = ownedRows.find((row) => row.latest_price > 0) ?? null;
    return total + (priceRow ? stock.shares * priceRow.latest_price : 0);
  }, 0);
  const candidates = recommendStockBuys({
    ...input,
    budget: allowFutureCash ? null : availableCash + totalSellableValue,
    affordableOnly: !allowFutureCash,
  }, Number.MAX_SAFE_INTEGER);

  for (const candidate of candidates) {
    const salePlan = buildStrategySalePlan(input.rows, input.ownedSnapshot, candidate, availableCash);
    if (salePlan.sales.length === 0) {
      continue;
    }

    const extraCashRequired = Math.max(0, candidate.estimated_cost - availableCash - salePlan.sale_value);
    if (!allowFutureCash && extraCashRequired > 0) {
      continue;
    }

    const currentRoiPercent = salePlan.current_annual_return > 0
      ? (salePlan.current_annual_return / salePlan.sale_value) * 100
      : null;
    const annualReturnGain = candidate.annual_return - salePlan.current_annual_return;
    if (annualReturnGain < MIN_REBALANCE_ANNUAL_GAIN) {
      continue;
    }
    if (currentRoiPercent !== null && candidate.roi_percent < currentRoiPercent + MIN_REBALANCE_ROI_GAIN) {
      continue;
    }

    const firstSale = salePlan.sales[0];
    recommendations.push({
      sell_stock_id: firstSale.stock_id,
      sell_acronym: firstSale.acronym,
      sell_name: firstSale.name,
      sell_shares: firstSale.shares,
      sales: salePlan.sales,
      sale_value: salePlan.sale_value,
      available_cash: availableCash,
      available_capital: Math.max(availableCash + salePlan.sale_value, candidate.estimated_cost),
      current_annual_return: salePlan.current_annual_return,
      current_roi_percent: currentRoiPercent,
      proposed: candidate,
      annual_return_gain: annualReturnGain,
      extra_cash_required: extraCashRequired,
    });
  }

  return recommendations;
}

export function stockBuyRecommendationFromRow(
  row: StockInvestmentRoiRow,
  options: {
    ownedShares: Map<number, number>;
    hasOwnedSnapshot: boolean;
    cityBankActive: boolean;
    budget: number | null;
  },
): StockBuyRecommendation | null {
  if (row.investment_type === "city_bank") {
    if (options.cityBankActive) {
      return null;
    }

    return {
      row,
      owned_shares: 0,
      target_shares: null,
      shares_needed: null,
      estimated_cost: row.increment_cost,
      annual_return: row.annual_return,
      roi_percent: row.roi_percent,
      affordable: affordability(row.increment_cost, options.budget),
      personalized: options.hasOwnedSnapshot,
    };
  }

  if (!isStockInvestmentRow(row)) {
    return null;
  }

  const owned = options.ownedShares.get(row.stock_id) ?? 0;
  if (ownsStockIncrement(owned, row.total_shares_required)) {
    return null;
  }

  const sharesNeeded = Math.max(0, row.total_shares_required - owned);
  const estimatedCost = options.hasOwnedSnapshot
    ? sharesNeeded * row.latest_price
    : row.increment_cost;
  if (estimatedCost <= 0) {
    return null;
  }

  return {
    row,
    owned_shares: owned,
    target_shares: row.total_shares_required,
    shares_needed: sharesNeeded,
    estimated_cost: estimatedCost,
    annual_return: row.annual_return,
    roi_percent: (row.annual_return / estimatedCost) * 100,
    affordable: affordability(estimatedCost, options.budget),
    personalized: options.hasOwnedSnapshot,
  };
}

function compareStockBuyRecommendations(left: StockBuyRecommendation, right: StockBuyRecommendation): number {
  if (left.roi_percent !== right.roi_percent) {
    return right.roi_percent - left.roi_percent;
  }
  if (left.annual_return !== right.annual_return) {
    return right.annual_return - left.annual_return;
  }
  return left.row.row_id.localeCompare(right.row.row_id, undefined, { numeric: true, sensitivity: "base" });
}

function compareByAnnualReturn(left: StockBuyRecommendation, right: StockBuyRecommendation): number {
  if (left.annual_return !== right.annual_return) {
    return right.annual_return - left.annual_return;
  }
  return compareStockBuyRecommendations(left, right);
}

function compareStockRebalanceRecommendations(left: StockRebalanceRecommendation, right: StockRebalanceRecommendation): number {
  if (left.annual_return_gain !== right.annual_return_gain) {
    return right.annual_return_gain - left.annual_return_gain;
  }
  if (left.proposed.roi_percent !== right.proposed.roi_percent) {
    return right.proposed.roi_percent - left.proposed.roi_percent;
  }
  if (left.extra_cash_required !== right.extra_cash_required) {
    return left.extra_cash_required - right.extra_cash_required;
  }
  return left.proposed.row.row_id.localeCompare(right.proposed.row.row_id, undefined, { numeric: true, sensitivity: "base" });
}

type StockStrategySalePlan = {
  sales: StockStrategySale[];
  sale_value: number;
  current_annual_return: number;
};

function buildStrategySalePlan(
  rows: StockInvestmentRoiRow[],
  snapshot: OwnedStockSnapshot,
  recommendation: StockBuyRecommendation,
  currentCash: number,
): StockStrategySalePlan {
  const cashNeeded = Math.max(0, recommendation.estimated_cost - currentCash);
  if (cashNeeded <= 0) {
    return { sales: [], sale_value: 0, current_annual_return: 0 };
  }

  const stockRowsById = rows.filter(isStockInvestmentRow).reduce((map, row) => {
    const stockRows = map.get(row.stock_id) ?? [];
    stockRows.push(row);
    map.set(row.stock_id, stockRows);
    return map;
  }, new Map<number, StockInvestmentStockRow[]>());
  const sources = snapshot.stocks
    .filter((stock) => stock.shares > 0 && stock.stock_id !== recommendation.row.stock_id)
    .map((stock) => {
      const ownedRows = stockRowsById.get(stock.stock_id) ?? [];
      const priceRow = ownedRows.find((row) => row.latest_price > 0) ?? null;
      if (!priceRow) {
        return null;
      }

      const fullSaleValue = stock.shares * priceRow.latest_price;
      const currentAnnualReturn = coveredAnnualReturn(ownedRows, stock.shares);
      return {
        stock,
        ownedRows,
        priceRow,
        fullSaleValue,
        currentAnnualReturn,
        currentRoiPercent: currentAnnualReturn > 0 ? (currentAnnualReturn / fullSaleValue) * 100 : 0,
      };
    })
    .filter((source): source is NonNullable<typeof source> => Boolean(source))
    .sort((left, right) =>
      left.currentRoiPercent - right.currentRoiPercent ||
      left.currentAnnualReturn - right.currentAnnualReturn ||
      left.priceRow.row_id.localeCompare(right.priceRow.row_id, undefined, { numeric: true, sensitivity: "base" })
    );
  const sales: StockStrategySale[] = [];
  let remainingCashNeeded = cashNeeded;

  for (const source of sources) {
    if (remainingCashNeeded <= 0) {
      break;
    }

    const sellShares = Math.min(source.stock.shares, Math.ceil(remainingCashNeeded / source.priceRow.latest_price));
    if (sellShares <= 0) {
      continue;
    }

    const saleValue = sellShares * source.priceRow.latest_price;
    const sharesAfterSale = Math.max(0, source.stock.shares - sellShares);
    sales.push({
      stock_id: source.stock.stock_id,
      acronym: source.priceRow.acronym,
      name: source.priceRow.name,
      shares: sellShares,
      sale_value: saleValue,
      current_annual_return: coveredAnnualReturn(source.ownedRows, source.stock.shares) - coveredAnnualReturn(source.ownedRows, sharesAfterSale),
    });
    remainingCashNeeded -= saleValue;
  }

  return {
    sales,
    sale_value: sales.reduce((sum, sale) => sum + sale.sale_value, 0),
    current_annual_return: sales.reduce((sum, sale) => sum + sale.current_annual_return, 0),
  };
}

function salePlanToRebalanceRecommendation(
  recommendation: StockBuyRecommendation,
  salePlan: StockStrategySalePlan,
  currentCash: number,
): StockRebalanceRecommendation | null {
  const firstSale = salePlan.sales[0] ?? null;
  if (!firstSale) {
    return null;
  }

  return {
    sell_stock_id: firstSale.stock_id,
    sell_acronym: firstSale.acronym,
    sell_name: firstSale.name,
    sell_shares: firstSale.shares,
    sales: salePlan.sales,
    sale_value: salePlan.sale_value,
    available_cash: currentCash,
    available_capital: Math.max(currentCash + salePlan.sale_value, recommendation.estimated_cost),
    current_annual_return: salePlan.current_annual_return,
    current_roi_percent: salePlan.current_annual_return > 0 ? (salePlan.current_annual_return / salePlan.sale_value) * 100 : null,
    proposed: recommendation,
    annual_return_gain: recommendation.annual_return - salePlan.current_annual_return,
    extra_cash_required: Math.max(0, recommendation.estimated_cost - currentCash - salePlan.sale_value),
  };
}

function coveredAnnualReturn(rows: StockInvestmentStockRow[], shares: number): number {
  return rows
    .filter((row) => ownsStockIncrement(shares, row.total_shares_required))
    .reduce((sum, row) => sum + row.annual_return, 0);
}

function cloneOwnedSnapshot(snapshot: OwnedStockSnapshot | null): OwnedStockSnapshot {
  return {
    refreshed_at: snapshot?.refreshed_at ?? 0,
    stocks: (snapshot?.stocks ?? []).map((stock) => ({
      stock_id: stock.stock_id,
      shares: stock.shares,
      bonus: stock.bonus ? { ...stock.bonus } : null,
    })),
  };
}

function applyStrategyStepToSnapshot(snapshot: OwnedStockSnapshot, step: StockStrategyStep): OwnedStockSnapshot {
  const soldSharesByStockId = new Map<number, number>();
  for (const sale of step.sales) {
    soldSharesByStockId.set(sale.stock_id, (soldSharesByStockId.get(sale.stock_id) ?? 0) + sale.shares);
  }

  const stocks = snapshot.stocks.flatMap((stock) => {
    const sellShares = soldSharesByStockId.get(stock.stock_id) ?? 0;
    const remainingShares = Math.max(0, stock.shares - sellShares);
    return remainingShares > 0
      ? [{
        stock_id: stock.stock_id,
        shares: remainingShares,
        bonus: stock.bonus ? { ...stock.bonus } : null,
      }]
      : [];
  });
  const row = step.recommendation.row;
  if (row.investment_type === "stock" && row.stock_id !== null && step.recommendation.target_shares !== null) {
    const existing = stocks.find((stock) => stock.stock_id === row.stock_id);
    if (existing) {
      existing.shares = Math.max(existing.shares, step.recommendation.target_shares);
    } else {
      stocks.push({
        stock_id: row.stock_id,
        shares: step.recommendation.target_shares,
        bonus: null,
      });
    }
  }

  return {
    refreshed_at: snapshot.refreshed_at,
    stocks,
  };
}

function closestCompletion(recommendations: StockBuyRecommendation[]): StockBuyRecommendation | null {
  return recommendations
    .filter((recommendation) =>
      recommendation.personalized &&
      recommendation.row.investment_type === "stock" &&
      recommendation.owned_shares > 0 &&
      recommendation.shares_needed !== null &&
      recommendation.shares_needed > 0
    )
    .sort((left, right) => left.estimated_cost - right.estimated_cost || compareStockBuyRecommendations(left, right))[0] ?? null;
}

function actionFromRecommendation(
  kind: StockSuggestedActionKind,
  title: string,
  reason: string,
  recommendation: StockBuyRecommendation | null,
): StockSuggestedAction | null {
  return recommendation ? { kind, title, reason, recommendation } : null;
}

function affordability(cost: number, budget: number | null): boolean | null {
  return budget === null ? null : cost <= budget;
}

function isStockInvestmentRow(row: StockInvestmentRoiRow): row is StockInvestmentStockRow {
  return (
    row.investment_type === "stock" &&
    row.stock_id !== null &&
    row.increment !== null &&
    row.required_shares !== null &&
    row.total_shares_required !== null &&
    row.latest_price !== null
  );
}

function clampBankMerits(value: unknown): number {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.min(10, Math.max(0, parsed));
}
