import type { StockInvestmentRoiRow } from "../api/types";
import type { OwnedStockPosition, OwnedStockSnapshot } from "./ownedStocks";
import { ownedSharesMap, ownsStockIncrement } from "./ownedStocks";

const CITY_BANK_MERIT_STEP = 0.05;
const TCI_BANK_INTEREST_BONUS_KEY = "city_bank:tci_bonus";
const FHG_TCI_HYBRID_ROW_ID = "synthetic:fhg_tci_hybrid";
const FHG_TCI_HYBRID_BENEFIT_KEY = "synthetic:fhg_tci_hybrid";
const FHG_ACRONYM = "FHG";
const FHG_TCI_HYBRID_FHG_DAYS = 83;
const FHG_TCI_HYBRID_TCI_DAYS = 7;
const FHG_TCI_HYBRID_CYCLE_DAYS = 90;
const MIN_REBALANCE_ANNUAL_GAIN = 1_000_000;
const MIN_REBALANCE_ROI_GAIN = 5;
const MIN_STRATEGY_ROI_RETENTION = 0.75;
const MIN_STRATEGY_TEMP_TARGET_GAP_RATIO = 0.25;
const MIN_STRATEGY_TEMP_HOLD_SCORE = 5;
export const DEFAULT_STOCK_STRATEGY_STEP_LIMIT = 10;
export const STOCK_SELL_FEE_RATE = 0.001;

type StockInvestmentStockRow = StockInvestmentRoiRow & {
  investment_type: "stock";
  stock_id: number;
  increment: number;
  required_shares: number;
  total_shares_required: number;
  latest_price: number;
};

type FhgTciHybridComponent = {
  stock_id: number;
  acronym: string | null;
  name: string | null;
  required_shares: number;
  latest_price: number;
  cost: number;
  annual_return: number;
  row_id: string;
};

export type FhgTciHybridRow = StockInvestmentRoiRow & {
  row_id: typeof FHG_TCI_HYBRID_ROW_ID;
  synthetic_kind: "fhg_tci_hybrid";
  components: {
    fhg: FhgTciHybridComponent;
    tci: FhgTciHybridComponent;
  };
  hold_days: {
    fhg: typeof FHG_TCI_HYBRID_FHG_DAYS;
    tci: typeof FHG_TCI_HYBRID_TCI_DAYS;
    cycle: typeof FHG_TCI_HYBRID_CYCLE_DAYS;
  };
};

export type FhgTciHybridConversion = {
  component_kind: "fhg" | "tci";
  stock_id: number;
  acronym: string | null;
  name: string | null;
  shares: number;
  capital: number;
  annual_return_loss: number;
  annual_return_gain: number;
};

export type StockInvestmentRecommendationRow = StockInvestmentRoiRow | FhgTciHybridRow;

export type StockBuyRecommendation = {
  row: StockInvestmentRecommendationRow;
  owned_shares: number;
  target_shares: number | null;
  shares_needed: number | null;
  estimated_cost: number;
  annual_return: number;
  roi_percent: number;
  ranking_roi_percent: number;
  affordable: boolean | null;
  personalized: boolean;
  hybrid_conversion?: FhgTciHybridConversion;
};

export type StockInvestmentRowMetrics = {
  estimated_cost: number;
  annual_return: number;
  days_to_break_even: number;
  roi_percent: number;
  ranking_roi_percent: number;
  owned_shares: number;
  target_shares: number | null;
  shares_needed: number | null;
  personalized: boolean;
  covered: boolean;
};

export type StockBuyRecommendationInput = {
  rows: StockInvestmentRecommendationRow[];
  ownedSnapshot: OwnedStockSnapshot | null;
  cityBankActive: boolean;
  fhgTciHybridActive?: boolean;
  budget: number | null;
  affordableOnly: boolean;
  minimumRoi: number | null;
  lockedStockIds?: ReadonlySet<number>;
  fhgTciHybridBaselineShares?: ReadonlyMap<number, number>;
  fhgTciHybridReservedShares?: ReadonlyMap<number, number>;
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
  sell_stock_id: number | null;
  sell_acronym: string | null;
  sell_name: string | null;
  sell_shares: number;
  sales: StockStrategySale[];
  sale_value: number;
  sale_fee: number;
  available_cash: number;
  available_capital: number;
  current_annual_return: number;
  current_roi_percent: number | null;
  proposed: StockBuyRecommendation;
  annual_return_gain: number;
  extra_cash_required: number;
  highlight?: "best_gain" | "best_roi" | "best_gain_and_roi";
};

export type StockStrategyStepKind = "buy" | "rebalance" | "convert";

export type StockStrategySale = {
  source_kind: "stock" | "synthetic";
  stock_id: number | null;
  source_row_id: string | null;
  acronym: string | null;
  name: string | null;
  shares: number;
  sale_value: number;
  sale_fee: number;
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
  if (row.investment_type !== "city_bank" && row.benefit_key !== TCI_BANK_INTEREST_BONUS_KEY) {
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

export function buildFhgTciHybridRow(rows: StockInvestmentRoiRow[]): FhgTciHybridRow | null {
  const fhg = rows.find((row): row is StockInvestmentStockRow =>
    isStockInvestmentRow(row) &&
    row.increment === 1 &&
    (row.acronym ?? "").toUpperCase() === FHG_ACRONYM &&
    row.increment_cost > 0 &&
    row.annual_return > 0
  ) ?? null;
  const tci = rows.find((row): row is StockInvestmentStockRow =>
    isStockInvestmentRow(row) &&
    row.benefit_key === TCI_BANK_INTEREST_BONUS_KEY &&
    row.increment_cost > 0 &&
    row.annual_return > 0
  ) ?? null;
  if (!fhg || !tci) {
    return null;
  }

  const annualReturn = fhg.annual_return * (FHG_TCI_HYBRID_FHG_DAYS / FHG_TCI_HYBRID_CYCLE_DAYS) + tci.annual_return;
  const capitalRequired = Math.max(fhg.increment_cost, tci.increment_cost);
  const benefitValue = annualReturn * (FHG_TCI_HYBRID_CYCLE_DAYS / 365);
  return {
    investment_type: "stock",
    row_id: FHG_TCI_HYBRID_ROW_ID,
    stock_id: null,
    acronym: "FHG/TCI",
    name: "FHG/TCI Hybrid",
    increment: null,
    required_shares: null,
    total_shares_required: null,
    latest_price: null,
    increment_cost: capitalRequired,
    total_cost: capitalRequired,
    benefit_key: FHG_TCI_HYBRID_BENEFIT_KEY,
    benefit_description: "TCI + 83/90 FHG",
    valuation_source: "cash",
    frequency_days: FHG_TCI_HYBRID_CYCLE_DAYS,
    benefit_value: benefitValue,
    annual_return: annualReturn,
    days_to_break_even: capitalRequired / (annualReturn / 365),
    roi_percent: (annualReturn / capitalRequired) * 100,
    synthetic_kind: "fhg_tci_hybrid",
    components: {
      fhg: rowToFhgTciHybridComponent(fhg),
      tci: rowToFhgTciHybridComponent(tci),
    },
    hold_days: {
      fhg: FHG_TCI_HYBRID_FHG_DAYS,
      tci: FHG_TCI_HYBRID_TCI_DAYS,
      cycle: FHG_TCI_HYBRID_CYCLE_DAYS,
    },
  };
}

export function hasFhgTciHybridBackingShares(
  row: FhgTciHybridRow,
  ownedShares: ReadonlyMap<number, number>,
): boolean {
  return fhgTciHybridBackingReservedShares(row, ownedShares).size > 0;
}

export function fhgTciHybridBackingReservedShares(
  row: FhgTciHybridRow,
  ownedShares: ReadonlyMap<number, number>,
): ReadonlyMap<number, number> {
  const componentUse = bestFhgTciHybridBackingComponent(row, ownedShares);
  return componentUse
    ? new Map([[componentUse.component.stock_id, componentUse.shares]])
    : new Map<number, number>();
}

export function stockInvestmentRowMetrics(
  row: StockInvestmentRecommendationRow,
  options: {
    ownedShares: Map<number, number>;
    hasOwnedSnapshot: boolean;
    fhgTciHybridActive?: boolean;
    fhgTciHybridBaselineShares?: ReadonlyMap<number, number>;
    fhgTciHybridReservedShares?: ReadonlyMap<number, number>;
  },
): StockInvestmentRowMetrics {
  if (isFhgTciHybridRow(row)) {
    return fhgTciHybridRowMetrics(row, options);
  }

  const baselineShares = isStockInvestmentRow(row)
    ? options.fhgTciHybridBaselineShares?.get(row.stock_id) ?? 0
    : 0;
  const reservedShares = isStockInvestmentRow(row)
    ? options.fhgTciHybridReservedShares?.get(row.stock_id) ?? 0
    : 0;
  const targetShares = isStockInvestmentRow(row)
    ? Math.max(0, row.total_shares_required - baselineShares)
    : null;
  const requiredShares = isStockInvestmentRow(row)
    ? Math.min(row.required_shares, targetShares ?? row.required_shares)
    : null;
  const rowRoiPercent = row.increment_cost > 0
    ? (row.annual_return / row.increment_cost) * 100
    : row.roi_percent;
  const rowDaysToBreakEven = row.annual_return > 0
    ? row.increment_cost / (row.annual_return / 365)
    : row.days_to_break_even;
  const baseMetrics: StockInvestmentRowMetrics = {
    estimated_cost: row.increment_cost,
    annual_return: row.annual_return,
    days_to_break_even: rowDaysToBreakEven,
    roi_percent: rowRoiPercent,
    ranking_roi_percent: rowRoiPercent,
    owned_shares: 0,
    target_shares: targetShares,
    shares_needed: requiredShares,
    personalized: false,
    covered: false,
  };

  if (!options.hasOwnedSnapshot || !isStockInvestmentRow(row)) {
    return baseMetrics;
  }

  const owned = Math.max(0, (options.ownedShares.get(row.stock_id) ?? 0) - reservedShares);
  const adjustedTargetShares = targetShares ?? row.total_shares_required;
  const covered = adjustedTargetShares <= 0 || ownsStockIncrement(owned, adjustedTargetShares);
  const sharesNeeded = Math.max(0, adjustedTargetShares - owned);
  if (covered || sharesNeeded <= 0) {
    return {
      ...baseMetrics,
      estimated_cost: 0,
      days_to_break_even: 0,
      owned_shares: owned,
      shares_needed: 0,
      personalized: true,
      covered: true,
    };
  }

  const estimatedCost = sharesNeeded * row.latest_price;
  if (estimatedCost <= 0) {
    return {
      ...baseMetrics,
      owned_shares: owned,
      shares_needed: sharesNeeded,
      personalized: true,
    };
  }

  return {
    ...baseMetrics,
    estimated_cost: estimatedCost,
    days_to_break_even: row.annual_return > 0 ? estimatedCost / (row.annual_return / 365) : row.days_to_break_even,
    roi_percent: (row.annual_return / estimatedCost) * 100,
    ranking_roi_percent: stockIncrementRankingRoiPercent(row, owned, baselineShares),
    owned_shares: owned,
    shares_needed: sharesNeeded,
    personalized: true,
  };
}

function fhgTciHybridRowMetrics(
  row: FhgTciHybridRow,
  options: {
    ownedShares: Map<number, number>;
    hasOwnedSnapshot: boolean;
    fhgTciHybridActive?: boolean;
  },
): StockInvestmentRowMetrics {
  const baseMetrics: StockInvestmentRowMetrics = {
    estimated_cost: row.increment_cost,
    annual_return: row.annual_return,
    days_to_break_even: row.days_to_break_even,
    roi_percent: row.roi_percent,
    ranking_roi_percent: row.roi_percent,
    owned_shares: 0,
    target_shares: null,
    shares_needed: null,
    personalized: false,
    covered: false,
  };
  if (!options.hasOwnedSnapshot) {
    return baseMetrics;
  }

  const reusableCapital = Math.max(
    ownedComponentValue(row.components.fhg, options.ownedShares),
    ownedComponentValue(row.components.tci, options.ownedShares),
  );
  const activeHolding = Boolean(options.fhgTciHybridActive && bestFhgTciHybridBackingComponent(row, options.ownedShares));
  const estimatedCost = Math.max(0, row.increment_cost - reusableCapital);
  if (activeHolding) {
    return {
      ...baseMetrics,
      estimated_cost: 0,
      days_to_break_even: 0,
      personalized: true,
      covered: true,
    };
  }
  if (estimatedCost <= 0) {
    return {
      ...baseMetrics,
      estimated_cost: 0,
      days_to_break_even: 0,
      personalized: true,
    };
  }

  return {
    ...baseMetrics,
    estimated_cost: estimatedCost,
    days_to_break_even: row.annual_return > 0 ? estimatedCost / (row.annual_return / 365) : row.days_to_break_even,
    roi_percent: (row.annual_return / estimatedCost) * 100,
    ranking_roi_percent: row.roi_percent,
    personalized: true,
  };
}

export function recommendBestStockBuy(input: StockBuyRecommendationInput): StockBuyRecommendation | null {
  return recommendStockBuys(input, 1)[0] ?? null;
}

export function recommendStockBuys(input: StockBuyRecommendationInput, limit = 5): StockBuyRecommendation[] {
  const ownedShares = ownedSharesMap(input.ownedSnapshot);
  const baselineShares = fhgTciHybridBaselineShares(input);
  const reservedShares = fhgTciHybridReservedShares(input);
  const recommendations = input.rows
    .map((row) => stockBuyRecommendationFromRow(row, {
      ownedShares,
      hasOwnedSnapshot: input.ownedSnapshot !== null,
      cityBankActive: input.cityBankActive,
      fhgTciHybridActive: input.fhgTciHybridActive ?? false,
      fhgTciHybridBaselineShares: baselineShares,
      fhgTciHybridReservedShares: reservedShares,
      budget: input.budget,
    }))
    .filter((recommendation): recommendation is StockBuyRecommendation => {
      if (!recommendation) {
        return false;
      }
      if (input.minimumRoi !== null && recommendation.roi_percent < input.minimumRoi) {
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
  const usefulRecommendations = filterDominatedRebalanceRecommendations(recommendations);
  return rankStockRebalanceRecommendations(usefulRecommendations, Math.max(0, limit));
}

export function buildStockStrategyPlan(input: StockBuyRecommendationInput, limit = DEFAULT_STOCK_STRATEGY_STEP_LIMIT): StockStrategyPlan {
  let simulatedSnapshot = cloneOwnedSnapshot(input.ownedSnapshot);
  let simulatedCityBankActive = input.cityBankActive;
  let simulatedHybridHolding = input.fhgTciHybridActive
    ? initialFhgTciHybridHolding(input.rows, simulatedSnapshot)
    : null;
  let currentCash = input.budget ?? 0;
  const steps: StockStrategyStep[] = [];

  for (let index = 0; index < limit; index += 1) {
    const baselineShares = simulatedHybridHolding
      ? fhgTciHybridBaselineSharesForRow(simulatedHybridHolding.row)
      : undefined;
    const reservedShares = simulatedHybridHolding?.actualReservedShares;
    const stepInput = {
      ...input,
      ownedSnapshot: simulatedSnapshot,
      cityBankActive: simulatedCityBankActive,
      fhgTciHybridActive: Boolean(simulatedHybridHolding),
      fhgTciHybridBaselineShares: baselineShares,
      fhgTciHybridReservedShares: reservedShares,
      budget: null,
      affordableOnly: false,
      lockedStockIds: lockedStockIds(input),
    };
    const recommendations = filterFhgTciHybridStrategyConflicts(
      recommendStockBuys(stepInput, Number.MAX_SAFE_INTEGER),
      steps,
      simulatedHybridHolding,
    );
    const nextStep = nextStrategyStep(stepInput, recommendations, simulatedSnapshot, currentCash, steps, limit, simulatedHybridHolding);
    if (!nextStep || !strategyStepIsWorthAdding(nextStep, steps)) {
      break;
    }

    steps.push(nextStep);
    currentCash = nextStep.ending_cash;
    simulatedSnapshot = applyStrategyStepToSnapshot(simulatedSnapshot, nextStep, simulatedHybridHolding);
    if (nextStep.sales.some((sale) => sale.source_kind === "synthetic" && sale.source_row_id === simulatedHybridHolding?.row.row_id)) {
      simulatedHybridHolding = null;
    }
    if (isFhgTciHybridRow(nextStep.recommendation.row) && (nextStep.kind === "buy" || nextStep.kind === "convert")) {
      simulatedHybridHolding = fhgTciHybridHoldingFromStep(nextStep, simulatedSnapshot);
    }
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
  hybridHolding: FhgTciHybridHolding | null,
): StockStrategyStep | null {
  const target = recommendations[0] ?? null;
  if (!target) {
    return null;
  }

  const targetSalePlan = buildStrategySalePlan(input.rows, snapshot, target, currentCash, lockedStockIds(input), hybridHolding);
  const targetCashRequired = Math.max(0, target.estimated_cost - targetSalePlan.sale_value);
  const targetStep = strategySalePlanIsBeneficial(target, targetSalePlan)
    ? strategyRebalanceStep(target, targetSalePlan, currentCash)
    : strategyEntryStep(target, currentCash);
  const previousBestRoi = strategyBestPreviousRoi(previousSteps);
  const immediateStep = selectImmediateStrategyStep(input, recommendations, snapshot, currentCash, target, targetCashRequired, previousBestRoi, hybridHolding);
  if (immediateStep) {
    return immediateStep;
  }

  const steppingStone = selectStrategySteppingStone(
    recommendations,
    target,
    targetCashRequired,
    previousSteps.length,
    previousBestRoi,
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

  const steppingStoneSalePlan = buildStrategySalePlan(input.rows, snapshot, steppingStone, currentCash, lockedStockIds(input), hybridHolding);
  return strategySalePlanIsBeneficial(steppingStone, steppingStoneSalePlan) && steppingStoneSalePlan.current_annual_return <= 0
    ? strategyRebalanceStep(steppingStone, steppingStoneSalePlan, currentCash)
    : strategyEntryStep(steppingStone, currentCash);
}

function selectImmediateStrategyStep(
  input: StockBuyRecommendationInput,
  recommendations: StockBuyRecommendation[],
  snapshot: OwnedStockSnapshot,
  currentCash: number,
  target: StockBuyRecommendation,
  targetCashRequired: number,
  previousBestRoi: number | null,
  hybridHolding: FhgTciHybridHolding | null,
): StockStrategyStep | null {
  for (const recommendation of recommendations) {
    if (recommendation.estimated_cost <= currentCash) {
      if (!strategyTemporaryRecommendationIsWorthHolding(recommendation, target, targetCashRequired, previousBestRoi)) {
        continue;
      }
      return strategyEntryStep(recommendation, currentCash);
    }

    const salePlan = buildStrategySalePlan(input.rows, snapshot, recommendation, currentCash, lockedStockIds(input), hybridHolding);
    const rebalanceStep = strategySalePlanIsBeneficial(recommendation, salePlan) && salePlan.current_annual_return <= 0
      ? strategyRebalanceStep(recommendation, salePlan, currentCash)
      : null;
    if (rebalanceStep && rebalanceStep.extra_cash_needed <= 0) {
      if (!strategyTemporaryRecommendationIsWorthHolding(recommendation, target, targetCashRequired, previousBestRoi)) {
        continue;
      }
      return rebalanceStep;
    }
  }

  return null;
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
      recommendation.estimated_cost < targetCashRequired &&
      strategyTemporaryRecommendationIsWorthHolding(recommendation, target, targetCashRequired, previousBestRoi)
    );

  if (steppingStones.length === 0) {
    return null;
  }

  const bestSteppingStone = [...steppingStones].sort(compareStockBuyRecommendations)[0] ?? null;
  const qualityFloor = Math.max(
    bestSteppingStone ? bestSteppingStone.ranking_roi_percent * MIN_STRATEGY_ROI_RETENTION : 0,
    previousBestRoi !== null ? previousBestRoi * MIN_STRATEGY_ROI_RETENTION : 0,
  );
  const usefulSteppingStones = steppingStones.filter((recommendation) => recommendation.ranking_roi_percent >= qualityFloor);
  if (usefulSteppingStones.length === 0) {
    return null;
  }

  if (stepIndex === 0) {
    return usefulSteppingStones[0] ?? null;
  }

  return [...usefulSteppingStones].sort(compareStockBuyRecommendations)[0] ?? null;
}

function strategyTemporaryRecommendationIsWorthHolding(
  recommendation: StockBuyRecommendation,
  target: StockBuyRecommendation,
  targetCashRequired: number,
  previousBestRoi: number | null,
): boolean {
  if (recommendation.row.row_id === target.row.row_id) {
    return true;
  }
  if (recommendation.annual_return <= 0) {
    return false;
  }
  if (previousBestRoi !== null && recommendation.ranking_roi_percent < previousBestRoi * MIN_STRATEGY_ROI_RETENTION) {
    return false;
  }

  const targetCapital = Math.max(target.estimated_cost, targetCashRequired);
  if (targetCapital <= recommendation.estimated_cost) {
    return false;
  }

  const targetGapRatio = (targetCapital - recommendation.estimated_cost) / targetCapital;
  if (targetGapRatio < MIN_STRATEGY_TEMP_TARGET_GAP_RATIO) {
    return false;
  }

  return recommendation.ranking_roi_percent * targetGapRatio >= MIN_STRATEGY_TEMP_HOLD_SCORE;
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

function strategyEntryStep(recommendation: StockBuyRecommendation, currentCash: number): StockStrategyStep {
  if (recommendation.hybrid_conversion && recommendation.estimated_cost <= 0) {
    return strategyConvertStep(recommendation, currentCash);
  }
  return strategyBuyStep(recommendation, currentCash);
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
    roi_percent: recommendation.ranking_roi_percent,
    recommendation,
    rebalance: null,
    sales: [],
  };
}

function strategyConvertStep(recommendation: StockBuyRecommendation, currentCash: number): StockStrategyStep {
  return {
    kind: "convert",
    cash_required: 0,
    extra_cash_needed: 0,
    starting_cash: currentCash,
    ending_cash: currentCash,
    annual_return_gain: recommendation.annual_return,
    roi_percent: recommendation.ranking_roi_percent,
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
    roi_percent: recommendation.ranking_roi_percent,
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

  const hybridHolding = input.fhgTciHybridActive
    ? initialFhgTciHybridHolding(input.rows, input.ownedSnapshot)
    : null;
  const stockRows = input.rows.filter(isStockInvestmentRow);
  const stockRowsById = stockRows.reduce((map, row) => {
    const rows = map.get(row.stock_id) ?? [];
    rows.push(row);
    map.set(row.stock_id, rows);
    return map;
  }, new Map<number, StockInvestmentStockRow[]>());
  const recommendations: StockRebalanceRecommendation[] = [];
  const lockedIds = lockedStockIds(input);
  const totalSellableValue = input.ownedSnapshot.stocks.reduce((total, stock) => {
    if (lockedIds.has(stock.stock_id)) {
      return total;
    }
    const reservedShares = hybridHolding?.actualReservedShares.get(stock.stock_id) ?? 0;
    const ownedRows = stockRowsById.get(stock.stock_id) ?? [];
    const priceRow = ownedRows.find((row) => row.latest_price > 0) ?? null;
    return total + (priceRow ? netSaleValue(Math.max(0, stock.shares - reservedShares) * priceRow.latest_price) : 0);
  }, 0);
  const hybridSellableValue = hybridHolding ? netSaleValue(hybridHolding.gross_value) : 0;
  const candidates = recommendStockBuys({
    ...input,
    fhgTciHybridBaselineShares: hybridHolding ? fhgTciHybridBaselineSharesForRow(hybridHolding.row) : input.fhgTciHybridBaselineShares,
    fhgTciHybridReservedShares: hybridHolding ? hybridHolding.actualReservedShares : input.fhgTciHybridReservedShares,
    budget: allowFutureCash ? null : availableCash + totalSellableValue + hybridSellableValue,
    affordableOnly: !allowFutureCash,
  }, Number.MAX_SAFE_INTEGER);

  for (const candidate of candidates) {
    const salePlan = buildStrategySalePlan(input.rows, input.ownedSnapshot, candidate, availableCash, lockedIds, hybridHolding);
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
    if (currentRoiPercent !== null && candidate.ranking_roi_percent < currentRoiPercent + MIN_REBALANCE_ROI_GAIN) {
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
      sale_fee: salePlan.sale_fee,
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
  row: StockInvestmentRecommendationRow,
  options: {
    ownedShares: Map<number, number>;
    hasOwnedSnapshot: boolean;
    cityBankActive: boolean;
    fhgTciHybridActive?: boolean;
    fhgTciHybridBaselineShares?: ReadonlyMap<number, number>;
    fhgTciHybridReservedShares?: ReadonlyMap<number, number>;
    budget: number | null;
  },
): StockBuyRecommendation | null {
  if (isFhgTciHybridRow(row)) {
    if (!options.cityBankActive) {
      return null;
    }

    const metrics = stockInvestmentRowMetrics(row, {
      ownedShares: options.ownedShares,
      hasOwnedSnapshot: options.hasOwnedSnapshot,
      fhgTciHybridActive: options.fhgTciHybridActive,
    });
    if (metrics.covered) {
      return null;
    }

    const conversion = fhgTciHybridConversion(row, options.ownedShares);
    if (metrics.estimated_cost <= 0 && !conversion) {
      return null;
    }
    const annualReturn = conversion?.annual_return_gain ?? metrics.annual_return;
    const roiPercent = conversion
      ? (annualReturn / row.increment_cost) * 100
      : metrics.roi_percent;
    return {
      row,
      owned_shares: 0,
      target_shares: null,
      shares_needed: null,
      estimated_cost: metrics.estimated_cost,
      annual_return: annualReturn,
      roi_percent: roiPercent,
      ranking_roi_percent: conversion ? roiPercent : metrics.ranking_roi_percent,
      affordable: affordability(metrics.estimated_cost, options.budget),
      personalized: metrics.personalized,
      hybrid_conversion: conversion ?? undefined,
    };
  }

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
      ranking_roi_percent: row.roi_percent,
      affordable: affordability(row.increment_cost, options.budget),
      personalized: options.hasOwnedSnapshot,
    };
  }

  if (!isStockInvestmentRow(row)) {
    return null;
  }

  const metrics = stockInvestmentRowMetrics(row, {
    ownedShares: options.ownedShares,
    hasOwnedSnapshot: options.hasOwnedSnapshot,
    fhgTciHybridBaselineShares: options.fhgTciHybridBaselineShares,
    fhgTciHybridReservedShares: options.fhgTciHybridReservedShares,
  });
  if (metrics.covered) {
    return null;
  }
  if (metrics.estimated_cost <= 0) {
    return null;
  }

  return {
    row,
    owned_shares: metrics.owned_shares,
    target_shares: metrics.target_shares,
    shares_needed: metrics.shares_needed,
    estimated_cost: metrics.estimated_cost,
    annual_return: metrics.annual_return,
    roi_percent: metrics.roi_percent,
    ranking_roi_percent: metrics.ranking_roi_percent,
    affordable: affordability(metrics.estimated_cost, options.budget),
    personalized: metrics.personalized,
  };
}

function compareStockBuyRecommendations(left: StockBuyRecommendation, right: StockBuyRecommendation): number {
  if (left.ranking_roi_percent !== right.ranking_roi_percent) {
    return right.ranking_roi_percent - left.ranking_roi_percent;
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

function rankStockRebalanceRecommendations(recommendations: StockRebalanceRecommendation[], limit: number): StockRebalanceRecommendation[] {
  if (limit <= 0) {
    return [];
  }

  const byGain = [...recommendations].sort(compareStockRebalanceByGain);
  const byRoi = [...recommendations].sort(compareStockRebalanceByRoi);
  const bestGain = byGain[0] ?? null;
  const bestRoi = byRoi[0] ?? null;
  const ranked: StockRebalanceRecommendation[] = [];
  const addRecommendation = (recommendation: StockRebalanceRecommendation | null) => {
    if (!recommendation || ranked.some((existing) => existing === recommendation) || ranked.length >= limit) {
      return;
    }
    ranked.push(recommendation);
  };

  addRecommendation(bestGain);
  addRecommendation(bestRoi);
  for (const recommendation of byGain) {
    addRecommendation(recommendation);
  }
  for (const recommendation of byRoi) {
    addRecommendation(recommendation);
  }

  return ranked.map((recommendation) => {
    const isBestGain = recommendation === bestGain;
    const isBestRoi = recommendation === bestRoi;
    return {
      ...recommendation,
      highlight: isBestGain && isBestRoi
        ? "best_gain_and_roi"
        : isBestGain
          ? "best_gain"
          : isBestRoi
            ? "best_roi"
            : undefined,
    };
  });
}

function compareStockRebalanceByGain(left: StockRebalanceRecommendation, right: StockRebalanceRecommendation): number {
  if (left.annual_return_gain !== right.annual_return_gain) {
    return right.annual_return_gain - left.annual_return_gain;
  }
  if (left.proposed.ranking_roi_percent !== right.proposed.ranking_roi_percent) {
    return right.proposed.ranking_roi_percent - left.proposed.ranking_roi_percent;
  }
  if (left.extra_cash_required !== right.extra_cash_required) {
    return left.extra_cash_required - right.extra_cash_required;
  }
  return left.proposed.row.row_id.localeCompare(right.proposed.row.row_id, undefined, { numeric: true, sensitivity: "base" });
}

function compareStockRebalanceByRoi(left: StockRebalanceRecommendation, right: StockRebalanceRecommendation): number {
  if (left.proposed.ranking_roi_percent !== right.proposed.ranking_roi_percent) {
    return right.proposed.ranking_roi_percent - left.proposed.ranking_roi_percent;
  }
  if (left.extra_cash_required !== right.extra_cash_required) {
    return left.extra_cash_required - right.extra_cash_required;
  }
  if (left.annual_return_gain !== right.annual_return_gain) {
    return right.annual_return_gain - left.annual_return_gain;
  }
  return left.proposed.row.row_id.localeCompare(right.proposed.row.row_id, undefined, { numeric: true, sensitivity: "base" });
}

function filterDominatedRebalanceRecommendations(recommendations: StockRebalanceRecommendation[]): StockRebalanceRecommendation[] {
  return recommendations.filter((candidate) =>
    !recommendations.some((other) => other !== candidate && rebalanceRecommendationDominates(other, candidate))
  );
}

function rebalanceRecommendationDominates(left: StockRebalanceRecommendation, right: StockRebalanceRecommendation): boolean {
  const hasAtLeastEqualGain = left.annual_return_gain >= right.annual_return_gain;
  const hasAtLeastEqualRoi = left.proposed.ranking_roi_percent >= right.proposed.ranking_roi_percent;
  const isStrictlyBetter = left.annual_return_gain > right.annual_return_gain ||
    left.proposed.ranking_roi_percent > right.proposed.ranking_roi_percent;
  return hasAtLeastEqualGain && hasAtLeastEqualRoi && isStrictlyBetter;
}

type StockStrategySalePlan = {
  sales: StockStrategySale[];
  sale_value: number;
  sale_fee: number;
  current_annual_return: number;
};

type StockStrategyStockSaleSource = {
  source_kind: "stock";
  stock: OwnedStockPosition;
  ownedRows: StockInvestmentStockRow[];
  priceRow: StockInvestmentStockRow;
  reservedShares: number;
  remainingShares: number;
};

type StockStrategySyntheticSaleSource = {
  source_kind: "synthetic";
  holding: FhgTciHybridHolding;
  remainingShares: number;
};

type StockStrategySaleSource = StockStrategyStockSaleSource | StockStrategySyntheticSaleSource;

type StockStrategySaleChunk = {
  source: StockStrategySaleSource;
  shares: number;
  sale_value: number;
  sale_fee: number;
  current_annual_return: number;
};

function hybridTargetReservedShares(
  recommendation: StockBuyRecommendation,
  snapshot: OwnedStockSnapshot,
): ReadonlyMap<number, number> {
  const row = recommendation.row;
  if (!isFhgTciHybridRow(row)) {
    return new Map<number, number>();
  }

  const componentUse = recommendation.hybrid_conversion
    ? conversionToComponentUse(row, recommendation.hybrid_conversion)
    : bestReusableHybridComponent(row, ownedSharesMap(snapshot), false);
  return componentUse
    ? new Map([[componentUse.component.stock_id, componentUse.shares]])
    : new Map<number, number>();
}

function buildStrategySalePlan(
  rows: StockInvestmentRecommendationRow[],
  snapshot: OwnedStockSnapshot,
  recommendation: StockBuyRecommendation,
  currentCash: number,
  lockedIds: ReadonlySet<number>,
  hybridHolding: FhgTciHybridHolding | null,
): StockStrategySalePlan {
  const cashNeeded = Math.max(0, recommendation.estimated_cost - currentCash);
  if (cashNeeded <= 0) {
    return { sales: [], sale_value: 0, sale_fee: 0, current_annual_return: 0 };
  }

  const stockRowsById = rows.filter(isStockInvestmentRow).reduce((map, row) => {
    const stockRows = map.get(row.stock_id) ?? [];
    stockRows.push(row);
    map.set(row.stock_id, stockRows);
    return map;
  }, new Map<number, StockInvestmentStockRow[]>());
  const targetReservedShares = hybridTargetReservedShares(recommendation, snapshot);
  const sources: StockStrategySaleSource[] = snapshot.stocks
    .filter((stock) =>
      stock.shares > 0 &&
      stock.stock_id !== recommendation.row.stock_id &&
      !lockedIds.has(stock.stock_id)
    )
    .map((stock) => {
      const ownedRows = stockRowsById.get(stock.stock_id) ?? [];
      const priceRow = ownedRows.find((row) => row.latest_price > 0) ?? null;
      if (!priceRow) {
        return null;
      }

      const reservedShares = (hybridHolding?.actualReservedShares.get(stock.stock_id) ?? 0) +
        (targetReservedShares.get(stock.stock_id) ?? 0);
      const remainingShares = Math.max(0, stock.shares - reservedShares);
      if (remainingShares <= 0) {
        return null;
      }

      return {
        source_kind: "stock" as const,
        stock,
        ownedRows,
        priceRow,
        reservedShares,
        remainingShares,
      };
    })
    .filter((source): source is StockStrategyStockSaleSource => Boolean(source));
  if (
    hybridHolding &&
    !isFhgTciHybridRow(recommendation.row) &&
    !isFhgTciHybridComponentRow(recommendation.row) &&
    !isFhgTciHybridComponentStockRow(recommendation.row, hybridHolding.row)
  ) {
    sources.push({
      source_kind: "synthetic",
      holding: hybridHolding,
      remainingShares: 1,
    });
  }

  const salesBySourceKey = new Map<string, StockStrategySale>();
  let remainingCashNeeded = cashNeeded;

  while (remainingCashNeeded > 0) {
    const chunk = sources
      .map(nextStrategySaleChunk)
      .filter((saleChunk): saleChunk is StockStrategySaleChunk => Boolean(saleChunk))
      .sort(compareStrategySaleChunks)[0] ?? null;
    if (!chunk) {
      break;
    }

    if (chunk.source.source_kind === "synthetic") {
      const saleKey = `synthetic:${chunk.source.holding.row.row_id}`;
      if (!salesBySourceKey.has(saleKey)) {
        salesBySourceKey.set(saleKey, {
          source_kind: "synthetic",
          source_row_id: chunk.source.holding.row.row_id,
          stock_id: null,
          acronym: chunk.source.holding.row.acronym,
          name: chunk.source.holding.row.name,
          shares: 1,
          sale_value: chunk.sale_value,
          sale_fee: chunk.sale_fee,
          current_annual_return: chunk.current_annual_return,
        });
      }
      chunk.source.remainingShares = 0;
      remainingCashNeeded -= chunk.sale_value;
    } else {
      const netPricePerShare = netSaleValue(chunk.source.priceRow.latest_price);
      const sellShares = chunk.current_annual_return <= 0 && chunk.sale_value > remainingCashNeeded
        ? Math.min(chunk.shares, Math.ceil(remainingCashNeeded / netPricePerShare))
        : chunk.shares;
      if (sellShares <= 0) {
        break;
      }

      const grossSaleValue = sellShares * chunk.source.priceRow.latest_price;
      const saleFee = grossSaleValue * STOCK_SELL_FEE_RATE;
      const saleValue = grossSaleValue - saleFee;
      const saleKey = `stock:${chunk.source.stock.stock_id}`;
      const existingSale = salesBySourceKey.get(saleKey);
      if (existingSale) {
        existingSale.shares += sellShares;
        existingSale.sale_value += saleValue;
        existingSale.sale_fee += saleFee;
        existingSale.current_annual_return += chunk.current_annual_return;
      } else {
        salesBySourceKey.set(saleKey, {
          source_kind: "stock",
          source_row_id: null,
          stock_id: chunk.source.stock.stock_id,
          acronym: chunk.source.priceRow.acronym,
          name: chunk.source.priceRow.name,
          shares: sellShares,
          sale_value: saleValue,
          sale_fee: saleFee,
          current_annual_return: chunk.current_annual_return,
        });
      }
      chunk.source.remainingShares = Math.max(0, chunk.source.remainingShares - sellShares);
      remainingCashNeeded -= saleValue;
    }
  }

  const sales = [...salesBySourceKey.values()];
  return {
    sales,
    sale_value: sales.reduce((sum, sale) => sum + sale.sale_value, 0),
    sale_fee: sales.reduce((sum, sale) => sum + sale.sale_fee, 0),
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
    sale_fee: salePlan.sale_fee,
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

function nextStrategySaleChunk(source: StockStrategySaleSource): StockStrategySaleChunk | null {
  const shares = source.remainingShares;
  if (shares <= 0) {
    return null;
  }

  if (source.source_kind === "synthetic") {
    const grossSaleValue = source.holding.gross_value;
    const saleFee = grossSaleValue * STOCK_SELL_FEE_RATE;
    return {
      source,
      shares: 1,
      sale_value: grossSaleValue - saleFee,
      sale_fee: saleFee,
      current_annual_return: source.holding.row.annual_return,
    };
  }

  const totalShares = source.remainingShares + source.reservedShares;
  const currentAnnualReturn = coveredAnnualReturn(source.ownedRows, totalShares);
  const highestCoveredThreshold = highestCoveredStockThreshold(source.ownedRows, totalShares);
  let sellShares: number;
  let lostAnnualReturn = 0;
  if (currentAnnualReturn <= 0 || highestCoveredThreshold === null) {
    sellShares = shares;
  } else if (totalShares > highestCoveredThreshold) {
    sellShares = Math.min(shares, totalShares - highestCoveredThreshold);
  } else {
    sellShares = 1;
    lostAnnualReturn = currentAnnualReturn - coveredAnnualReturn(source.ownedRows, totalShares - 1);
  }

  if (sellShares <= 0) {
    return null;
  }

  const grossSaleValue = sellShares * source.priceRow.latest_price;
  const saleFee = grossSaleValue * STOCK_SELL_FEE_RATE;
  return {
    source,
    shares: sellShares,
    sale_value: grossSaleValue - saleFee,
    sale_fee: saleFee,
    current_annual_return: lostAnnualReturn,
  };
}

function compareStrategySaleChunks(left: StockStrategySaleChunk, right: StockStrategySaleChunk): number {
  const leftLossRatio = left.sale_value > 0 ? left.current_annual_return / left.sale_value : Number.POSITIVE_INFINITY;
  const rightLossRatio = right.sale_value > 0 ? right.current_annual_return / right.sale_value : Number.POSITIVE_INFINITY;
  if (leftLossRatio !== rightLossRatio) {
    return leftLossRatio - rightLossRatio;
  }
  if (left.current_annual_return !== right.current_annual_return) {
    return left.current_annual_return - right.current_annual_return;
  }
  return saleSourceSortKey(left.source).localeCompare(saleSourceSortKey(right.source), undefined, { numeric: true, sensitivity: "base" });
}

function saleSourceSortKey(source: StockStrategySaleSource): string {
  return source.source_kind === "synthetic"
    ? source.holding.row.row_id
    : source.priceRow.row_id;
}

function highestCoveredStockThreshold(rows: StockInvestmentStockRow[], shares: number): number | null {
  const thresholds = rows
    .filter((row) => ownsStockIncrement(shares, row.total_shares_required))
    .map((row) => row.total_shares_required);
  return thresholds.length > 0 ? Math.max(...thresholds) : null;
}

function stockIncrementRankingRoiPercent(row: StockInvestmentStockRow, ownedShares: number, baselineShares = 0): number {
  const committedCost = stockIncrementCommittedCost(row, ownedShares, baselineShares);
  return committedCost > 0 ? (row.annual_return / committedCost) * 100 : row.roi_percent;
}

function stockIncrementCommittedCost(row: StockInvestmentStockRow, ownedShares: number, baselineShares = 0): number {
  const targetShares = Math.max(0, row.total_shares_required - baselineShares);
  const previousTargetShares = Math.max(0, targetShares - row.required_shares);
  if (ownedShares < previousTargetShares) {
    const catchUpCost = Math.max(0, targetShares - ownedShares) * row.latest_price;
    return catchUpCost > 0 ? catchUpCost : row.increment_cost;
  }

  const ownedTowardIncrement = Math.min(
    row.required_shares,
    Math.max(0, ownedShares - previousTargetShares),
  );
  const sharesNeeded = Math.max(0, targetShares - ownedShares);
  const committedShares = Math.min(row.required_shares, ownedTowardIncrement + sharesNeeded);
  const committedCost = committedShares * row.latest_price;
  return committedCost > 0 ? committedCost : row.increment_cost;
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

function applyStrategyStepToSnapshot(
  snapshot: OwnedStockSnapshot,
  step: StockStrategyStep,
  hybridHolding: FhgTciHybridHolding | null,
): OwnedStockSnapshot {
  const soldSharesByStockId = new Map<number, number>();
  for (const sale of step.sales) {
    if (sale.stock_id === null) {
      continue;
    }
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
    const targetShares = strategyStepActualTargetShares(step, hybridHolding);
    const existing = stocks.find((stock) => stock.stock_id === row.stock_id);
    if (existing) {
      existing.shares = Math.max(existing.shares, targetShares);
    } else {
      stocks.push({
        stock_id: row.stock_id,
        shares: targetShares,
        bonus: null,
      });
    }
  }

  return {
    refreshed_at: snapshot.refreshed_at,
    stocks,
  };
}

function strategyStepActualTargetShares(
  step: StockStrategyStep,
  hybridHolding: FhgTciHybridHolding | null,
): number {
  const row = step.recommendation.row;
  if (
    !isStockInvestmentRow(row) ||
    step.recommendation.target_shares === null ||
    !hybridHolding ||
    strategyStepSellsHybridHolding(step, hybridHolding)
  ) {
    return step.recommendation.target_shares ?? 0;
  }

  return step.recommendation.target_shares + (hybridHolding.actualReservedShares.get(row.stock_id) ?? 0);
}

function strategyStepSellsHybridHolding(step: StockStrategyStep, hybridHolding: FhgTciHybridHolding): boolean {
  return step.sales.some((sale) =>
    sale.source_kind === "synthetic" &&
    sale.source_row_id === hybridHolding.row.row_id
  );
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

function lockedStockIds(input: StockBuyRecommendationInput): ReadonlySet<number> {
  return input.lockedStockIds ?? new Set<number>();
}

type FhgTciHybridComponentUse = {
  component_kind: "fhg" | "tci";
  component: FhgTciHybridComponent;
  shares: number;
  capital: number;
  annual_return_loss: number;
};

type FhgTciHybridHolding = {
  row: FhgTciHybridRow;
  gross_value: number;
  actualReservedShares: ReadonlyMap<number, number>;
};

function rowToFhgTciHybridComponent(row: StockInvestmentStockRow): FhgTciHybridComponent {
  return {
    stock_id: row.stock_id,
    acronym: row.acronym,
    name: row.name,
    required_shares: row.total_shares_required,
    latest_price: row.latest_price,
    cost: row.increment_cost,
    annual_return: row.annual_return,
    row_id: row.row_id,
  };
}

function ownedComponentValue(component: FhgTciHybridComponent, ownedShares: ReadonlyMap<number, number>): number {
  const owned = Math.min(ownedShares.get(component.stock_id) ?? 0, component.required_shares);
  return Math.max(0, owned * component.latest_price);
}

function bestFhgTciHybridBackingComponent(
  row: FhgTciHybridRow,
  ownedShares: ReadonlyMap<number, number>,
): FhgTciHybridComponentUse | null {
  return fhgTciHybridComponentUses(row, ownedShares)
    .filter((candidate) => candidate.shares >= candidate.component.required_shares)
    .sort(compareFhgTciHybridComponentUses)[0] ?? null;
}

function bestReusableHybridComponent(
  row: FhgTciHybridRow,
  ownedShares: ReadonlyMap<number, number>,
  requireFull: boolean,
): FhgTciHybridComponentUse | null {
  return fhgTciHybridComponentUses(row, ownedShares)
    .filter((candidate) =>
      candidate.capital > 0 &&
      (!requireFull || candidate.capital >= row.increment_cost)
    )
    .sort(compareFhgTciHybridComponentUses)[0] ?? null;
}

function fhgTciHybridComponentUses(
  row: FhgTciHybridRow,
  ownedShares: ReadonlyMap<number, number>,
): FhgTciHybridComponentUse[] {
  return ([
    ["fhg", row.components.fhg],
    ["tci", row.components.tci],
  ] as const).map(([componentKind, component]) => {
    const shares = Math.min(ownedShares.get(component.stock_id) ?? 0, component.required_shares);
    const capital = Math.max(0, shares * component.latest_price);
    return {
      component_kind: componentKind,
      component,
      shares,
      capital,
      annual_return_loss: component.annual_return,
    };
  });
}

function compareFhgTciHybridComponentUses(left: FhgTciHybridComponentUse, right: FhgTciHybridComponentUse): number {
  return right.capital - left.capital ||
    left.annual_return_loss - right.annual_return_loss ||
    left.component.row_id.localeCompare(right.component.row_id, undefined, { numeric: true, sensitivity: "base" });
}

function fhgTciHybridConversion(row: FhgTciHybridRow, ownedShares: Map<number, number>): FhgTciHybridConversion | null {
  const componentUse = bestReusableHybridComponent(row, ownedShares, true);
  if (!componentUse) {
    return null;
  }

  const annualReturnGain = row.annual_return - componentUse.annual_return_loss;
  if (annualReturnGain <= 0) {
    return null;
  }

  return {
    component_kind: componentUse.component_kind,
    stock_id: componentUse.component.stock_id,
    acronym: componentUse.component.acronym,
    name: componentUse.component.name,
    shares: componentUse.shares,
    capital: Math.min(componentUse.capital, row.increment_cost),
    annual_return_loss: componentUse.annual_return_loss,
    annual_return_gain: annualReturnGain,
  };
}

function initialFhgTciHybridHolding(
  rows: StockInvestmentRecommendationRow[],
  snapshot: OwnedStockSnapshot,
): FhgTciHybridHolding | null {
  const row = rows.find(isFhgTciHybridRow) ?? null;
  if (!row) {
    return null;
  }

  const componentUse = bestFhgTciHybridBackingComponent(row, ownedSharesMap(snapshot));
  if (!componentUse) {
    return null;
  }

  return fhgTciHybridHolding(row, componentUse);
}

function fhgTciHybridHoldingFromStep(
  step: StockStrategyStep,
  snapshot: OwnedStockSnapshot,
): FhgTciHybridHolding | null {
  const row = step.recommendation.row;
  if (!isFhgTciHybridRow(row)) {
    return null;
  }

  const conversion = step.recommendation.hybrid_conversion;
  const componentUse = conversion
    ? conversionToComponentUse(row, conversion)
    : bestReusableHybridComponent(row, ownedSharesMap(snapshot), false);
  return fhgTciHybridHolding(row, componentUse);
}

function conversionToComponentUse(row: FhgTciHybridRow, conversion: FhgTciHybridConversion): FhgTciHybridComponentUse {
  const component = conversion.component_kind === "fhg"
    ? row.components.fhg
    : row.components.tci;
  return {
    component_kind: conversion.component_kind,
    component,
    shares: conversion.shares,
    capital: conversion.capital,
    annual_return_loss: conversion.annual_return_loss,
  };
}

function fhgTciHybridHolding(
  row: FhgTciHybridRow,
  componentUse: FhgTciHybridComponentUse | null,
): FhgTciHybridHolding {
  return {
    row,
    gross_value: row.increment_cost,
    actualReservedShares: componentUse
      ? new Map([[componentUse.component.stock_id, componentUse.shares]])
      : new Map<number, number>(),
  };
}

function fhgTciHybridBaselineShares(input: StockBuyRecommendationInput): ReadonlyMap<number, number> | undefined {
  if (input.fhgTciHybridBaselineShares) {
    return input.fhgTciHybridBaselineShares;
  }
  if (!input.fhgTciHybridActive) {
    return undefined;
  }

  const row = input.rows.find(isFhgTciHybridRow) ?? null;
  if (!row || !input.ownedSnapshot || !hasFhgTciHybridBackingShares(row, ownedSharesMap(input.ownedSnapshot))) {
    return undefined;
  }

  return fhgTciHybridBaselineSharesForRow(row);
}

function fhgTciHybridReservedShares(input: StockBuyRecommendationInput): ReadonlyMap<number, number> | undefined {
  if (input.fhgTciHybridReservedShares) {
    return input.fhgTciHybridReservedShares;
  }
  if (!input.fhgTciHybridActive || !input.ownedSnapshot) {
    return undefined;
  }

  const row = input.rows.find(isFhgTciHybridRow) ?? null;
  if (!row) {
    return undefined;
  }

  const reservedShares = fhgTciHybridBackingReservedShares(row, ownedSharesMap(input.ownedSnapshot));
  return reservedShares.size > 0 ? reservedShares : undefined;
}

export function fhgTciHybridBaselineSharesForRow(row: FhgTciHybridRow): ReadonlyMap<number, number> {
  return new Map([
    [row.components.fhg.stock_id, row.components.fhg.required_shares],
    [row.components.tci.stock_id, row.components.tci.required_shares],
  ]);
}

function filterFhgTciHybridStrategyConflicts(
  recommendations: StockBuyRecommendation[],
  previousSteps: StockStrategyStep[],
  hybridHolding: FhgTciHybridHolding | null,
): StockBuyRecommendation[] {
  if (previousSteps.length === 0 && !hybridHolding) {
    return recommendations;
  }

  const hasHybridHolding = Boolean(hybridHolding);
  const hasHybridStep = previousSteps.some((step) => isFhgTciHybridRow(step.recommendation.row));
  const hasComponentStep = previousSteps.some((step) => isFhgTciHybridComponentRow(step.recommendation.row));
  return recommendations.filter((recommendation) => {
    if ((hasHybridHolding || hasHybridStep) && (isFhgTciHybridRow(recommendation.row) || isFhgTciHybridComponentRow(recommendation.row))) {
      return false;
    }
    if (hasComponentStep && isFhgTciHybridRow(recommendation.row)) {
      return false;
    }
    return true;
  });
}

function netSaleValue(grossSaleValue: number): number {
  return grossSaleValue * (1 - STOCK_SELL_FEE_RATE);
}

export function isFhgTciHybridRow(row: StockInvestmentRecommendationRow): row is FhgTciHybridRow {
  return "synthetic_kind" in row && row.synthetic_kind === "fhg_tci_hybrid";
}

function isFhgTciHybridComponentRow(row: StockInvestmentRecommendationRow): boolean {
  return isFhgBlockOneRow(row) || row.benefit_key === TCI_BANK_INTEREST_BONUS_KEY;
}

function isFhgTciHybridComponentStockRow(row: StockInvestmentRecommendationRow, hybridRow: FhgTciHybridRow): boolean {
  return isStockInvestmentRow(row) &&
    (row.stock_id === hybridRow.components.fhg.stock_id || row.stock_id === hybridRow.components.tci.stock_id);
}

function isFhgBlockOneRow(row: StockInvestmentRecommendationRow): boolean {
  return isStockInvestmentRow(row) && row.increment === 1 && (row.acronym ?? "").toUpperCase() === FHG_ACRONYM;
}

function isStockInvestmentRow(row: StockInvestmentRecommendationRow): row is StockInvestmentStockRow {
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
