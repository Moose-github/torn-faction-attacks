import { describe, expect, it } from "vitest";
import type { StockInvestmentRoiRow } from "../api/types";
import {
  adjustCityBankRowForMerits,
  buildStockCapitalMilestones,
  buildStockRebalanceRecommendations,
  buildStockSuggestedActions,
  recommendBestStockBuy,
  recommendStockBuys,
  stockBuyRecommendationFromRow,
} from "./stockRecommendations";

describe("stock buy recommendations", () => {
  it("returns the generic best row when no holdings are loaded", () => {
    const result = recommendBestStockBuy({
      rows: [
        stockRow({ row_id: "stock:1:1", stock_id: 1, acronym: "AAA", roi_percent: 10, annual_return: 100 }),
        stockRow({ row_id: "stock:2:1", stock_id: 2, acronym: "BBB", roi_percent: 20, annual_return: 200 }),
      ],
      ownedSnapshot: null,
      cityBankActive: false,
      budget: null,
      affordableOnly: false,
      minimumRoi: null,
    });

    expect(result?.row.row_id).toBe("stock:2:1");
    expect(result?.estimated_cost).toBe(1_000);
    expect(result?.personalized).toBe(false);
  });

  it("skips owned stock blocks", () => {
    const result = recommendBestStockBuy({
      rows: [
        stockRow({ row_id: "stock:1:1", stock_id: 1, acronym: "AAA", roi_percent: 30, annual_return: 300, total_shares_required: 100 }),
        stockRow({ row_id: "stock:2:1", stock_id: 2, acronym: "BBB", roi_percent: 20, annual_return: 200, total_shares_required: 100 }),
      ],
      ownedSnapshot: {
        refreshed_at: 1_800_000_000,
        stocks: [{ stock_id: 1, shares: 100, bonus: null }],
      },
      cityBankActive: false,
      budget: null,
      affordableOnly: false,
      minimumRoi: null,
    });

    expect(result?.row.row_id).toBe("stock:2:1");
  });

  it("returns a limited ranked list of next buys", () => {
    const results = recommendStockBuys({
      rows: [
        stockRow({ row_id: "stock:1:1", stock_id: 1, roi_percent: 10, annual_return: 100 }),
        stockRow({ row_id: "stock:2:1", stock_id: 2, roi_percent: 20, annual_return: 200 }),
        stockRow({ row_id: "stock:3:1", stock_id: 3, roi_percent: 15, annual_return: 150 }),
      ],
      ownedSnapshot: null,
      cityBankActive: false,
      budget: null,
      affordableOnly: false,
      minimumRoi: null,
    }, 2);

    expect(results.map((recommendation) => recommendation.row.row_id)).toEqual([
      "stock:2:1",
      "stock:3:1",
    ]);
  });

  it("uses additional shares and cost for partially owned blocks", () => {
    const row = stockRow({
      stock_id: 3,
      latest_price: 5,
      total_shares_required: 1_000,
      increment_cost: 5_000,
      annual_return: 1_000,
    });

    const result = stockBuyRecommendationFromRow(row, {
      ownedShares: new Map([[3, 600]]),
      hasOwnedSnapshot: true,
      cityBankActive: false,
      budget: null,
    });

    expect(result).toMatchObject({
      owned_shares: 600,
      target_shares: 1_000,
      shares_needed: 400,
      estimated_cost: 2_000,
    });
    expect(result?.roi_percent).toBe(50);
  });

  it("builds deduped suggested actions from meaningful categories", () => {
    const actions = buildStockSuggestedActions({
      rows: [
        stockRow({
          row_id: "stock:1:1",
          stock_id: 1,
          acronym: "AAA",
          total_shares_required: 1_000,
          latest_price: 10,
          increment_cost: 10_000,
          annual_return: 1_000,
          roi_percent: 10,
        }),
        stockRow({
          row_id: "stock:2:1",
          stock_id: 2,
          acronym: "BBB",
          total_shares_required: 1_000,
          latest_price: 10,
          increment_cost: 10_000,
          annual_return: 2_000,
          roi_percent: 20,
        }),
      ],
      ownedSnapshot: {
        refreshed_at: 1_800_000_000,
        stocks: [{ stock_id: 1, shares: 900, bonus: null }],
      },
      cityBankActive: false,
      budget: 2_000,
      affordableOnly: false,
      minimumRoi: null,
    }, 5);

    expect(actions.map((action) => action.kind)).toEqual([
      "closest_completion",
      "highest_return",
    ]);
    expect(actions[0].recommendation.row.row_id).toBe("stock:1:1");
    expect(actions[0].recommendation.estimated_cost).toBe(1_000);
  });

  it("builds capital milestones when better buys become affordable", () => {
    const milestones = buildStockCapitalMilestones({
      rows: [
        stockRow({ row_id: "stock:1:1", stock_id: 1, increment_cost: 100, total_cost: 100, roi_percent: 10, annual_return: 10 }),
        stockRow({ row_id: "stock:2:1", stock_id: 2, increment_cost: 500, total_cost: 500, roi_percent: 20, annual_return: 100 }),
        stockRow({ row_id: "stock:3:1", stock_id: 3, increment_cost: 800, total_cost: 800, roi_percent: 15, annual_return: 200 }),
      ],
      ownedSnapshot: null,
      cityBankActive: false,
      budget: null,
      affordableOnly: false,
      minimumRoi: null,
    }, 5);

    expect(milestones.map((milestone) => ({
      capital: milestone.capital,
      row_id: milestone.recommendation.row.row_id,
    }))).toEqual([
      { capital: 100, row_id: "stock:1:1" },
      { capital: 500, row_id: "stock:2:1" },
      { capital: 800, row_id: "stock:3:1" },
    ]);
  });

  it("respects affordable-only against additional cost", () => {
    const result = recommendBestStockBuy({
      rows: [
        stockRow({
          row_id: "stock:1:1",
          stock_id: 1,
          latest_price: 10,
          total_shares_required: 1_000,
          increment_cost: 10_000,
          annual_return: 1_000,
          roi_percent: 10,
        }),
        stockRow({
          row_id: "stock:2:1",
          stock_id: 2,
          latest_price: 10,
          total_shares_required: 1_000,
          increment_cost: 10_000,
          annual_return: 500,
          roi_percent: 5,
        }),
      ],
      ownedSnapshot: {
        refreshed_at: 1_800_000_000,
        stocks: [
          { stock_id: 1, shares: 950, bonus: null },
          { stock_id: 2, shares: 0, bonus: null },
        ],
      },
      cityBankActive: false,
      budget: 600,
      affordableOnly: true,
      minimumRoi: null,
    });

    expect(result?.row.row_id).toBe("stock:1:1");
    expect(result?.estimated_cost).toBe(500);
  });

  it("skips City Bank when it is active", () => {
    const result = recommendBestStockBuy({
      rows: [
        cityBankRow({ roi_percent: 90, annual_return: 900 }),
        stockRow({ row_id: "stock:1:1", roi_percent: 10, annual_return: 100 }),
      ],
      ownedSnapshot: null,
      cityBankActive: true,
      budget: null,
      affordableOnly: false,
      minimumRoi: null,
    });

    expect(result?.row.row_id).toBe("stock:1:1");
  });

  it("keeps merit-adjusted City Bank comparable when inactive", () => {
    const bank = adjustCityBankRowForMerits(cityBankRow({
      increment_cost: 2_000,
      benefit_value: 250,
      annual_return: 1_000,
    }), 10);

    const result = recommendBestStockBuy({
      rows: [
        bank,
        stockRow({ row_id: "stock:1:1", increment_cost: 2_000, annual_return: 1_200, roi_percent: 60 }),
      ],
      ownedSnapshot: null,
      cityBankActive: false,
      budget: null,
      affordableOnly: false,
      minimumRoi: null,
    });

    expect(bank.annual_return).toBe(1_500);
    expect(bank.roi_percent).toBe(75);
    expect(result?.row.row_id).toBe("city_bank:90");
  });

  it("returns no rebalance ideas without a holdings snapshot", () => {
    const results = buildStockRebalanceRecommendations({
      rows: [
        stockRow({ row_id: "stock:1:1", stock_id: 1 }),
        stockRow({ row_id: "stock:2:1", stock_id: 2, annual_return: 2_000_000 }),
      ],
      ownedSnapshot: null,
      cityBankActive: false,
      budget: 1_000,
      affordableOnly: false,
      minimumRoi: null,
    });

    expect(results).toEqual([]);
  });

  it("allows partial holdings to be sold with zero current return", () => {
    const results = buildStockRebalanceRecommendations({
      rows: [
        stockRow({ row_id: "stock:1:1", stock_id: 1, acronym: "AAA", latest_price: 10, total_shares_required: 1_000 }),
        stockRow({ row_id: "stock:2:1", stock_id: 2, acronym: "BBB", increment_cost: 2_000, total_cost: 2_000, annual_return: 2_000_000, roi_percent: 100_000 }),
      ],
      ownedSnapshot: {
        refreshed_at: 1_800_000_000,
        stocks: [{ stock_id: 1, shares: 50, bonus: null }],
      },
      cityBankActive: false,
      budget: 1_500,
      affordableOnly: false,
      minimumRoi: null,
    });

    expect(results[0]).toMatchObject({
      sell_stock_id: 1,
      sale_value: 500,
      current_annual_return: 0,
      current_roi_percent: null,
      annual_return_gain: 2_000_000,
    });
    expect(results[0].proposed.row.row_id).toBe("stock:2:1");
  });

  it("subtracts covered holding return from rebalance gain", () => {
    const results = buildStockRebalanceRecommendations({
      rows: [
        stockRow({ row_id: "stock:1:1", stock_id: 1, acronym: "AAA", latest_price: 10, total_shares_required: 100, annual_return: 500_000, roi_percent: 500 }),
        stockRow({ row_id: "stock:2:1", stock_id: 2, acronym: "BBB", increment_cost: 2_000, total_cost: 2_000, annual_return: 2_000_000, roi_percent: 100_000 }),
      ],
      ownedSnapshot: {
        refreshed_at: 1_800_000_000,
        stocks: [{ stock_id: 1, shares: 100, bonus: null }],
      },
      cityBankActive: false,
      budget: 1_000,
      affordableOnly: false,
      minimumRoi: null,
    });

    expect(results[0].current_annual_return).toBe(500_000);
    expect(results[0].annual_return_gain).toBe(1_500_000);
  });

  it("combines budget with sale value for rebalance affordability", () => {
    const results = buildStockRebalanceRecommendations({
      rows: [
        stockRow({ row_id: "stock:1:1", stock_id: 1, latest_price: 10, total_shares_required: 1_000 }),
        stockRow({ row_id: "stock:2:1", stock_id: 2, latest_price: 10, total_shares_required: 300, increment_cost: 3_000, total_cost: 3_000, annual_return: 2_000_000, roi_percent: 66_666 }),
      ],
      ownedSnapshot: {
        refreshed_at: 1_800_000_000,
        stocks: [{ stock_id: 1, shares: 100, bonus: null }],
      },
      cityBankActive: false,
      budget: 2_000,
      affordableOnly: false,
      minimumRoi: null,
    });

    expect(results[0]).toMatchObject({
      sale_value: 1_000,
      available_cash: 2_000,
      available_capital: 3_000,
      extra_cash_required: 2_000,
    });
  });

  it("skips same-stock rebalance loops", () => {
    const results = buildStockRebalanceRecommendations({
      rows: [
        stockRow({ row_id: "stock:1:1", stock_id: 1, latest_price: 10, total_shares_required: 100, annual_return: 500_000 }),
        stockRow({ row_id: "stock:1:2", stock_id: 1, latest_price: 10, increment: 2, total_shares_required: 200, increment_cost: 1_000, total_cost: 2_000, annual_return: 3_000_000, roi_percent: 300_000 }),
      ],
      ownedSnapshot: {
        refreshed_at: 1_800_000_000,
        stocks: [{ stock_id: 1, shares: 100, bonus: null }],
      },
      cityBankActive: false,
      budget: 1_000,
      affordableOnly: false,
      minimumRoi: null,
    });

    expect(results).toEqual([]);
  });

  it("skips active City Bank and compares inactive City Bank", () => {
    const input = {
      rows: [
        stockRow({ row_id: "stock:1:1", stock_id: 1, latest_price: 10, total_shares_required: 1_000 }),
        cityBankRow({ increment_cost: 2_000, total_cost: 2_000, annual_return: 2_500_000, roi_percent: 125_000 }),
      ],
      ownedSnapshot: {
        refreshed_at: 1_800_000_000,
        stocks: [{ stock_id: 1, shares: 100, bonus: null }],
      },
      budget: 1_000,
      affordableOnly: false,
      minimumRoi: null,
    };

    expect(buildStockRebalanceRecommendations({ ...input, cityBankActive: true })).toEqual([]);
    expect(buildStockRebalanceRecommendations({ ...input, cityBankActive: false })[0].proposed.row.row_id).toBe("city_bank:90");
  });

  it("filters small conservative rebalance improvements", () => {
    const results = buildStockRebalanceRecommendations({
      rows: [
        stockRow({ row_id: "stock:1:1", stock_id: 1, latest_price: 10, total_shares_required: 1_000 }),
        stockRow({ row_id: "stock:2:1", stock_id: 2, increment_cost: 2_000, total_cost: 2_000, annual_return: 999_999, roi_percent: 49_999 }),
      ],
      ownedSnapshot: {
        refreshed_at: 1_800_000_000,
        stocks: [{ stock_id: 1, shares: 100, bonus: null }],
      },
      cityBankActive: false,
      budget: 1_000,
      affordableOnly: false,
      minimumRoi: null,
    });

    expect(results).toEqual([]);
  });

  it("sorts rebalance ideas by annual gain then proposed ROI", () => {
    const results = buildStockRebalanceRecommendations({
      rows: [
        stockRow({ row_id: "stock:1:1", stock_id: 1, latest_price: 10, total_shares_required: 1_000 }),
        stockRow({ row_id: "stock:2:1", stock_id: 2, increment_cost: 2_000, total_cost: 2_000, annual_return: 2_000_000, roi_percent: 100_000 }),
        stockRow({ row_id: "stock:3:1", stock_id: 3, increment_cost: 3_000, total_cost: 3_000, annual_return: 3_000_000, roi_percent: 100_000 }),
        stockRow({ row_id: "stock:4:1", stock_id: 4, increment_cost: 4_000, total_cost: 4_000, annual_return: 3_000_000, roi_percent: 75_000 }),
      ],
      ownedSnapshot: {
        refreshed_at: 1_800_000_000,
        stocks: [{ stock_id: 1, shares: 400, bonus: null }],
      },
      cityBankActive: false,
      budget: null,
      affordableOnly: false,
      minimumRoi: null,
    }, 3);

    expect(results.map((result) => result.proposed.row.row_id)).toEqual([
      "stock:3:1",
      "stock:4:1",
      "stock:2:1",
    ]);
  });
});

function stockRow(overrides: Partial<StockInvestmentRoiRow> = {}): StockInvestmentRoiRow {
  return {
    investment_type: "stock",
    row_id: "stock:1:1",
    stock_id: 1,
    acronym: "AAA",
    name: "Alpha",
    increment: 1,
    required_shares: 100,
    total_shares_required: 100,
    latest_price: 10,
    increment_cost: 1_000,
    total_cost: 1_000,
    benefit_key: "item:test",
    benefit_description: "1x Test",
    valuation_source: "custom",
    frequency_days: 7,
    benefit_value: 20,
    annual_return: 100,
    days_to_break_even: 10,
    roi_percent: 10,
    ...overrides,
  };
}

function cityBankRow(overrides: Partial<StockInvestmentRoiRow> = {}): StockInvestmentRoiRow {
  return {
    investment_type: "city_bank",
    row_id: "city_bank:90",
    stock_id: null,
    acronym: "BANK",
    name: "City Bank",
    increment: null,
    required_shares: null,
    total_shares_required: null,
    latest_price: null,
    increment_cost: 2_000,
    total_cost: 2_000,
    benefit_key: "city_bank:90",
    benefit_description: "City Bank interest",
    valuation_source: "cash",
    frequency_days: 90,
    benefit_value: 250,
    annual_return: 1_000,
    days_to_break_even: 2,
    roi_percent: 50,
    ...overrides,
  };
}
