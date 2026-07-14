import type { StockInvestmentRoiRow } from "../api/types";
import type { OwnedStockSnapshot } from "./ownedStocks";
import { ownedSharesMap, ownsStockIncrement } from "./ownedStocks";

const CITY_BANK_MERIT_STEP = 0.05;

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

function affordability(cost: number, budget: number | null): boolean | null {
  return budget === null ? null : cost <= budget;
}

function isStockInvestmentRow(row: StockInvestmentRoiRow): row is StockInvestmentRoiRow & {
  investment_type: "stock";
  stock_id: number;
  increment: number;
  required_shares: number;
  total_shares_required: number;
  latest_price: number;
} {
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
