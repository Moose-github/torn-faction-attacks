import { describe, expect, it } from "vitest";
import type { StockInvestmentRoiRow } from "../api/types";
import {
  adjustCityBankRowForMerits,
  buildFhgTciHybridRow,
  buildStockCapitalMilestones,
  buildStockRebalanceRecommendations,
  buildStockSuggestedActions,
  buildStockStrategyPlan,
  hasFhgTciHybridBackingShares,
  recommendBestStockBuy,
  recommendStockBuys,
  stockBuyRecommendationFromRow,
  stockInvestmentRowMetrics,
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

  it("applies minimum ROI after recalculating partially owned blocks", () => {
    const result = recommendBestStockBuy({
      rows: [
        stockRow({
          row_id: "stock:1:1",
          stock_id: 1,
          latest_price: 10,
          total_shares_required: 100,
          increment_cost: 1_000,
          annual_return: 100,
          roi_percent: 10,
        }),
      ],
      ownedSnapshot: {
        refreshed_at: 1_800_000_000,
        stocks: [{ stock_id: 1, shares: 90, bonus: null }],
      },
      cityBankActive: false,
      budget: null,
      affordableOnly: false,
      minimumRoi: 50,
    });

    expect(result?.row.row_id).toBe("stock:1:1");
    expect(result?.estimated_cost).toBe(100);
    expect(result?.roi_percent).toBe(100);
  });

  it("ranks partial completions by committed increment capital", () => {
    const results = recommendStockBuys({
      rows: [
        stockRow({
          row_id: "stock:1:1",
          stock_id: 1,
          acronym: "AAA",
          latest_price: 10,
          total_shares_required: 100,
          increment_cost: 1_000,
          annual_return: 100,
          roi_percent: 10,
        }),
        stockRow({
          row_id: "stock:2:1",
          stock_id: 2,
          acronym: "BBB",
          latest_price: 10,
          total_shares_required: 100,
          increment_cost: 1_000,
          annual_return: 200,
          roi_percent: 20,
        }),
      ],
      ownedSnapshot: {
        refreshed_at: 1_800_000_000,
        stocks: [{ stock_id: 1, shares: 90, bonus: null }],
      },
      cityBankActive: false,
      budget: null,
      affordableOnly: false,
      minimumRoi: null,
    }, 2);

    expect(results.map((recommendation) => ({
      row_id: recommendation.row.row_id,
      roi_percent: recommendation.roi_percent,
      ranking_roi_percent: recommendation.ranking_roi_percent,
    }))).toEqual([
      { row_id: "stock:2:1", roi_percent: 20, ranking_roi_percent: 20 },
      { row_id: "stock:1:1", roi_percent: 100, ranking_roi_percent: 10 },
    ]);
  });

  it("returns personalized table metrics for partially owned rows", () => {
    const metrics = stockInvestmentRowMetrics(stockRow({
      stock_id: 1,
      latest_price: 10,
      total_shares_required: 100,
      increment_cost: 1_000,
      annual_return: 100,
      roi_percent: 10,
      days_to_break_even: 3_650,
    }), {
      ownedShares: new Map([[1, 90]]),
      hasOwnedSnapshot: true,
    });

    expect(metrics).toMatchObject({
      estimated_cost: 100,
      days_to_break_even: 365,
      roi_percent: 100,
      owned_shares: 90,
      shares_needed: 10,
      personalized: true,
      covered: false,
    });
  });

  it("marks covered rows with zero remaining cost for table metrics", () => {
    const metrics = stockInvestmentRowMetrics(stockRow({
      stock_id: 1,
      total_shares_required: 100,
      increment_cost: 1_000,
      annual_return: 100,
      roi_percent: 10,
    }), {
      ownedShares: new Map([[1, 100]]),
      hasOwnedSnapshot: true,
    });

    expect(metrics).toMatchObject({
      estimated_cost: 0,
      days_to_break_even: 0,
      roi_percent: 10,
      owned_shares: 100,
      shares_needed: 0,
      personalized: true,
      covered: true,
    });
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

  it("adjusts TCI bank interest bonus rows with bank merits", () => {
    const tci = adjustCityBankRowForMerits(stockRow({
      row_id: "stock:9:1",
      stock_id: 9,
      acronym: "TCI",
      increment_cost: 1_350_000_000,
      total_cost: 1_350_000_000,
      benefit_key: "city_bank:tci_bonus",
      benefit_description: "10% City Bank interest bonus",
      benefit_value: 22_887_123.29,
      annual_return: 92_820_000,
      roi_percent: 6.8756,
    }), 10);

    expect(tci.benefit_value).toBeCloseTo(34_330_684.94);
    expect(tci.annual_return).toBe(139_230_000);
    expect(tci.roi_percent).toBeCloseTo(10.3133);
  });

  it("builds the FHG/TCI hybrid from FHG block one and TCI", () => {
    const hybrid = buildFhgTciHybridRow([
      stockRow({
        row_id: "stock:5:1",
        stock_id: 5,
        acronym: "FHG",
        latest_price: 3,
        required_shares: 300,
        total_shares_required: 300,
        increment_cost: 900,
        total_cost: 900,
        annual_return: 90,
        roi_percent: 10,
      }),
      stockRow({
        row_id: "stock:9:1",
        stock_id: 9,
        acronym: "TCI",
        latest_price: 2,
        required_shares: 500,
        total_shares_required: 500,
        increment_cost: 1_000,
        total_cost: 1_000,
        benefit_key: "city_bank:tci_bonus",
        annual_return: 50,
        roi_percent: 5,
      }),
    ]);

    expect(hybrid).toMatchObject({
      row_id: "synthetic:fhg_tci_hybrid",
      acronym: "FHG/TCI",
      name: "FHG/TCI Hybrid",
      increment_cost: 1_000,
      total_cost: 1_000,
      benefit_description: "TCI + 83/90 FHG",
      annual_return: 133,
      roi_percent: 13.3,
    });
    expect(hybrid?.components.fhg).toMatchObject({ stock_id: 5, required_shares: 300, cost: 900 });
    expect(hybrid?.components.tci).toMatchObject({ stock_id: 9, required_shares: 500, cost: 1_000 });
    expect(hybrid?.days_to_break_even).toBeCloseTo(1_000 / (133 / 365));
  });

  it("does not build the FHG/TCI hybrid without both component rows", () => {
    expect(buildFhgTciHybridRow([
      stockRow({ row_id: "stock:5:1", stock_id: 5, acronym: "FHG" }),
    ])).toBeNull();
    expect(buildFhgTciHybridRow([
      stockRow({ row_id: "stock:9:1", stock_id: 9, acronym: "TCI", benefit_key: "city_bank:tci_bonus" }),
    ])).toBeNull();
  });

  it("requires a full component share position before the FHG/TCI hybrid can be marked owned", () => {
    const hybrid = buildFhgTciHybridRow([
      stockRow({
        row_id: "stock:5:1",
        stock_id: 5,
        acronym: "FHG",
        latest_price: 3,
        required_shares: 300,
        total_shares_required: 300,
        increment_cost: 900,
        total_cost: 900,
        annual_return: 90,
        roi_percent: 10,
      }),
      stockRow({
        row_id: "stock:9:1",
        stock_id: 9,
        acronym: "TCI",
        latest_price: 2,
        required_shares: 500,
        total_shares_required: 500,
        increment_cost: 1_000,
        total_cost: 1_000,
        benefit_key: "city_bank:tci_bonus",
        annual_return: 50,
        roi_percent: 5,
      }),
    ]);
    expect(hybrid).not.toBeNull();

    expect(hasFhgTciHybridBackingShares(hybrid!, new Map([[9, 499]]))).toBe(false);
    expect(hasFhgTciHybridBackingShares(hybrid!, new Map([[9, 500]]))).toBe(true);
    expect(hasFhgTciHybridBackingShares(hybrid!, new Map([[5, 300]]))).toBe(true);
  });

  it("treats an active FHG/TCI hybrid as covered from full backing shares, not only full hybrid capital", () => {
    const hybrid = buildFhgTciHybridRow([
      stockRow({
        row_id: "stock:5:1",
        stock_id: 5,
        acronym: "FHG",
        latest_price: 3,
        required_shares: 300,
        total_shares_required: 300,
        increment_cost: 900,
        total_cost: 900,
        annual_return: 90,
        roi_percent: 10,
      }),
      stockRow({
        row_id: "stock:9:1",
        stock_id: 9,
        acronym: "TCI",
        latest_price: 3,
        required_shares: 500,
        total_shares_required: 500,
        increment_cost: 1_500,
        total_cost: 1_500,
        benefit_key: "city_bank:tci_bonus",
        annual_return: 50,
        roi_percent: 5,
      }),
    ]);
    expect(hybrid).not.toBeNull();

    expect(stockInvestmentRowMetrics(hybrid!, {
      ownedShares: new Map([[5, 300]]),
      hasOwnedSnapshot: true,
      fhgTciHybridActive: true,
    })).toMatchObject({
      estimated_cost: 0,
      covered: true,
    });
  });

  it("personalizes the FHG/TCI hybrid from the best reusable component holding", () => {
    const hybrid = buildFhgTciHybridRow([
      stockRow({
        row_id: "stock:5:1",
        stock_id: 5,
        acronym: "FHG",
        latest_price: 3,
        required_shares: 300,
        total_shares_required: 300,
        increment_cost: 900,
        total_cost: 900,
        annual_return: 90,
        roi_percent: 10,
      }),
      stockRow({
        row_id: "stock:9:1",
        stock_id: 9,
        acronym: "TCI",
        latest_price: 2,
        required_shares: 500,
        total_shares_required: 500,
        increment_cost: 1_000,
        total_cost: 1_000,
        benefit_key: "city_bank:tci_bonus",
        annual_return: 50,
        roi_percent: 5,
      }),
    ]);
    expect(hybrid).not.toBeNull();

    const partial = stockInvestmentRowMetrics(hybrid!, {
      ownedShares: new Map([[5, 100], [9, 200]]),
      hasOwnedSnapshot: true,
    });
    expect(partial).toMatchObject({
      estimated_cost: 600,
      personalized: true,
      covered: false,
    });
    expect(partial.roi_percent).toBeCloseTo((133 / 600) * 100);

    const reusable = stockInvestmentRowMetrics(hybrid!, {
      ownedShares: new Map([[9, 500]]),
      hasOwnedSnapshot: true,
    });
    expect(reusable).toMatchObject({
      estimated_cost: 0,
      personalized: true,
      covered: false,
    });
    expect(reusable.roi_percent).toBeCloseTo(13.3);

    expect(recommendStockBuys({
      rows: [hybrid!],
      ownedSnapshot: {
        refreshed_at: 1_800_000_000,
        stocks: [{ stock_id: 9, shares: 500, bonus: null }],
      },
      cityBankActive: false,
      budget: 0,
      affordableOnly: true,
      minimumRoi: null,
    })).toEqual([]);

    const recommendations = recommendStockBuys({
      rows: [hybrid!],
      ownedSnapshot: {
        refreshed_at: 1_800_000_000,
        stocks: [{ stock_id: 9, shares: 500, bonus: null }],
      },
      cityBankActive: true,
      budget: 0,
      affordableOnly: true,
      minimumRoi: null,
    });
    expect(recommendations[0]).toMatchObject({
      row: {
        row_id: "synthetic:fhg_tci_hybrid",
      },
      estimated_cost: 0,
      affordable: true,
      hybrid_conversion: {
        component_kind: "tci",
        annual_return_gain: 83,
      },
    });
  });

  it("keeps the FHG/TCI hybrid mutually exclusive with its component rows in the strategy path", () => {
    const fhg = stockRow({
      row_id: "stock:5:1",
      stock_id: 5,
      acronym: "FHG",
      latest_price: 3,
      required_shares: 300,
      total_shares_required: 300,
      increment_cost: 900,
      total_cost: 900,
      annual_return: 90,
      roi_percent: 10,
    });
    const tci = stockRow({
      row_id: "stock:9:1",
      stock_id: 9,
      acronym: "TCI",
      latest_price: 2,
      required_shares: 500,
      total_shares_required: 500,
      increment_cost: 1_000,
      total_cost: 1_000,
      benefit_key: "city_bank:tci_bonus",
      annual_return: 50,
      roi_percent: 5,
    });
    const hybrid = buildFhgTciHybridRow([fhg, tci]);
    const plan = buildStockStrategyPlan({
      rows: hybrid ? [fhg, tci, hybrid] : [fhg, tci],
      ownedSnapshot: null,
      cityBankActive: true,
      budget: null,
      affordableOnly: false,
      minimumRoi: null,
    }, 3);

    expect(plan.steps.map((step) => step.recommendation.row.row_id)).toEqual([
      "synthetic:fhg_tci_hybrid",
    ]);
  });

  it("converts reusable TCI capital into the FHG/TCI hybrid when inactive", () => {
    const fhg = stockRow({
      row_id: "stock:5:1",
      stock_id: 5,
      acronym: "FHG",
      latest_price: 2,
      required_shares: 500,
      total_shares_required: 500,
      increment_cost: 1_000,
      total_cost: 1_000,
      annual_return: 900,
      roi_percent: 90,
    });
    const tci = stockRow({
      row_id: "stock:9:1",
      stock_id: 9,
      acronym: "TCI",
      latest_price: 2,
      required_shares: 500,
      total_shares_required: 500,
      increment_cost: 1_000,
      total_cost: 1_000,
      benefit_key: "city_bank:tci_bonus",
      annual_return: 500,
      roi_percent: 50,
    });
    const biggerTarget = stockRow({
      row_id: "stock:3:1",
      stock_id: 3,
      acronym: "BIG",
      latest_price: 1,
      required_shares: 3_000,
      total_shares_required: 3_000,
      increment_cost: 3_000,
      total_cost: 3_000,
      annual_return: 3_600,
      roi_percent: 120,
    });
    const hybrid = buildFhgTciHybridRow([fhg, tci]);
    const plan = buildStockStrategyPlan({
      rows: hybrid ? [fhg, tci, hybrid, biggerTarget] : [fhg, tci, biggerTarget],
      ownedSnapshot: {
        refreshed_at: 1_800_000_000,
        stocks: [{ stock_id: 9, shares: 500, bonus: null }],
      },
      cityBankActive: true,
      budget: null,
      affordableOnly: false,
      minimumRoi: null,
    }, 3);

    expect(plan.steps[0]).toMatchObject({
      kind: "convert",
      extra_cash_needed: 0,
      recommendation: {
        row: {
          row_id: "synthetic:fhg_tci_hybrid",
        },
        estimated_cost: 0,
        hybrid_conversion: {
          component_kind: "tci",
          annual_return_gain: 830,
        },
      },
    });
    expect(plan.steps[1]).toMatchObject({
      kind: "rebalance",
      recommendation: {
        row: {
          row_id: "stock:3:1",
        },
      },
      sales: [
        {
          source_kind: "synthetic",
          source_row_id: "synthetic:fhg_tci_hybrid",
          stock_id: null,
          shares: 1,
          sale_value: 999,
          current_annual_return: 1_330,
        },
      ],
    });
  });

  it("marks the FHG/TCI hybrid covered only when explicitly active", () => {
    const hybrid = buildFhgTciHybridRow([
      stockRow({
        row_id: "stock:5:1",
        stock_id: 5,
        acronym: "FHG",
        latest_price: 2,
        required_shares: 500,
        total_shares_required: 500,
        increment_cost: 1_000,
        total_cost: 1_000,
        annual_return: 900,
        roi_percent: 90,
      }),
      stockRow({
        row_id: "stock:9:1",
        stock_id: 9,
        acronym: "TCI",
        latest_price: 2,
        required_shares: 500,
        total_shares_required: 500,
        increment_cost: 1_000,
        total_cost: 1_000,
        benefit_key: "city_bank:tci_bonus",
        annual_return: 500,
        roi_percent: 50,
      }),
    ]);
    expect(hybrid).not.toBeNull();

    expect(stockInvestmentRowMetrics(hybrid!, {
      ownedShares: new Map([[9, 500]]),
      hasOwnedSnapshot: true,
    })).toMatchObject({
      estimated_cost: 0,
      covered: false,
    });
    expect(stockInvestmentRowMetrics(hybrid!, {
      ownedShares: new Map([[9, 500]]),
      hasOwnedSnapshot: true,
      fhgTciHybridActive: true,
    })).toMatchObject({
      estimated_cost: 0,
      covered: true,
    });
    expect(recommendStockBuys({
      rows: [hybrid!],
      ownedSnapshot: {
        refreshed_at: 1_800_000_000,
        stocks: [{ stock_id: 9, shares: 500, bonus: null }],
      },
      cityBankActive: true,
      fhgTciHybridActive: true,
      budget: 0,
      affordableOnly: true,
      minimumRoi: null,
    })).toEqual([]);
  });

  it("allows higher FHG blocks after an active FHG/TCI hybrid reserves block one", () => {
    const fhgOne = stockRow({
      row_id: "stock:5:1",
      stock_id: 5,
      acronym: "FHG",
      latest_price: 1,
      required_shares: 500,
      total_shares_required: 500,
      increment_cost: 500,
      total_cost: 500,
      annual_return: 400,
      roi_percent: 80,
    });
    const fhgTwo = stockRow({
      row_id: "stock:5:2",
      stock_id: 5,
      acronym: "FHG",
      latest_price: 1,
      increment: 2,
      required_shares: 1_000,
      total_shares_required: 1_500,
      increment_cost: 1_000,
      total_cost: 1_500,
      annual_return: 900,
      roi_percent: 90,
    });
    const tci = stockRow({
      row_id: "stock:9:1",
      stock_id: 9,
      acronym: "TCI",
      latest_price: 1,
      required_shares: 500,
      total_shares_required: 500,
      increment_cost: 500,
      total_cost: 500,
      benefit_key: "city_bank:tci_bonus",
      annual_return: 100,
      roi_percent: 20,
    });
    const hybrid = buildFhgTciHybridRow([fhgOne, tci]);
    const recommendations = recommendStockBuys({
      rows: hybrid ? [fhgOne, fhgTwo, tci, hybrid] : [fhgOne, fhgTwo, tci],
      ownedSnapshot: {
        refreshed_at: 1_800_000_000,
        stocks: [{ stock_id: 9, shares: 500, bonus: null }],
      },
      cityBankActive: true,
      fhgTciHybridActive: true,
      budget: null,
      affordableOnly: false,
      minimumRoi: null,
    });

    expect(recommendations.map((recommendation) => recommendation.row.row_id)).toEqual(["stock:5:2"]);
    expect(recommendations[0]).toMatchObject({
      estimated_cost: 1_000,
      target_shares: 1_000,
      shares_needed: 1_000,
    });
  });

  it("reserves partial FHG capital reused by a cash-funded hybrid strategy step", () => {
    const fhg = stockRow({
      row_id: "stock:5:1",
      stock_id: 5,
      acronym: "FHG",
      latest_price: 1,
      required_shares: 100,
      total_shares_required: 100,
      increment_cost: 100,
      total_cost: 100,
      annual_return: 90,
      roi_percent: 90,
    });
    const tci = stockRow({
      row_id: "stock:9:1",
      stock_id: 9,
      acronym: "TCI",
      latest_price: 1,
      required_shares: 100,
      total_shares_required: 100,
      increment_cost: 100,
      total_cost: 100,
      benefit_key: "city_bank:tci_bonus",
      annual_return: 10,
      roi_percent: 10,
    });
    const nextTarget = stockRow({
      row_id: "stock:2:1",
      stock_id: 2,
      acronym: "NEXT",
      latest_price: 1,
      required_shares: 90,
      total_shares_required: 90,
      increment_cost: 90,
      total_cost: 90,
      annual_return: 72,
      roi_percent: 80,
    });
    const hybrid = buildFhgTciHybridRow([fhg, tci]);
    const plan = buildStockStrategyPlan({
      rows: hybrid ? [fhg, tci, hybrid, nextTarget] : [fhg, tci, nextTarget],
      ownedSnapshot: {
        refreshed_at: 1_800_000_000,
        stocks: [{ stock_id: 5, shares: 40, bonus: null }],
      },
      cityBankActive: true,
      budget: null,
      affordableOnly: false,
      minimumRoi: null,
    }, 2);

    expect(plan.steps[0]).toMatchObject({
      kind: "buy",
      recommendation: {
        row: {
          row_id: "synthetic:fhg_tci_hybrid",
        },
        estimated_cost: 60,
      },
    });
    expect(plan.steps[1]).toMatchObject({
      kind: "buy",
      recommendation: {
        row: {
          row_id: "stock:2:1",
        },
      },
      sales: [],
      extra_cash_needed: 90,
    });
  });

  it("returns no rebalance ideas without a holdings snapshot", () => {
    const results = buildStockRebalanceRecommendations({
      rows: [
        stockRow({ row_id: "stock:1:1", stock_id: 1 }),
        stockRow({ row_id: "stock:2:1", stock_id: 2, annual_return: 2_000_000 }),
      ],
      ownedSnapshot: null,
      cityBankActive: false,
      budget: 1_001,
      affordableOnly: false,
      minimumRoi: null,
    });

    expect(results).toEqual([]);
  });

  it("allows partial holdings to be sold with zero current return", () => {
    const results = buildStockRebalanceRecommendations({
      rows: [
        stockRow({ row_id: "stock:1:1", stock_id: 1, acronym: "AAA", latest_price: 10, total_shares_required: 1_000 }),
        stockRow({ row_id: "stock:2:1", stock_id: 2, acronym: "BBB", latest_price: 10, total_shares_required: 200, increment_cost: 2_000, total_cost: 2_000, annual_return: 2_000_000, roi_percent: 100_000 }),
      ],
      ownedSnapshot: {
        refreshed_at: 1_800_000_000,
        stocks: [{ stock_id: 1, shares: 50, bonus: null }],
      },
      cityBankActive: false,
      budget: 1_501,
      affordableOnly: false,
      minimumRoi: null,
    });

    expect(results[0]).toMatchObject({
      sell_stock_id: 1,
      sell_shares: 50,
      sale_value: 499.5,
      sale_fee: 0.5,
      current_annual_return: 0,
      current_roi_percent: null,
      annual_return_gain: 2_000_000,
    });
    expect(results[0].proposed.row.row_id).toBe("stock:2:1");
  });

  it("sells only enough shares to fund the rebalance gap", () => {
    const results = buildStockRebalanceRecommendations({
      rows: [
        stockRow({ row_id: "stock:1:1", stock_id: 1, acronym: "AAA", latest_price: 10, total_shares_required: 1_000 }),
        stockRow({ row_id: "stock:2:1", stock_id: 2, acronym: "BBB", latest_price: 10, total_shares_required: 200, increment_cost: 2_000, total_cost: 2_000, annual_return: 2_000_000, roi_percent: 100_000 }),
      ],
      ownedSnapshot: {
        refreshed_at: 1_800_000_000,
        stocks: [{ stock_id: 1, shares: 200, bonus: null }],
      },
      cityBankActive: false,
      budget: 1_500,
      affordableOnly: false,
      minimumRoi: null,
    });

    expect(results[0]).toMatchObject({
      sell_stock_id: 1,
      sell_shares: 51,
      sale_value: 509.49,
      sale_fee: 0.51,
      available_cash: 1_500,
      extra_cash_required: 0,
    });
  });

  it("keeps covered return when a partial sale still covers the block", () => {
    const results = buildStockRebalanceRecommendations({
      rows: [
        stockRow({ row_id: "stock:1:1", stock_id: 1, acronym: "AAA", latest_price: 10, total_shares_required: 100, annual_return: 500_000, roi_percent: 500 }),
        stockRow({ row_id: "stock:2:1", stock_id: 2, acronym: "BBB", latest_price: 10, total_shares_required: 200, increment_cost: 2_000, total_cost: 2_000, annual_return: 2_000_000, roi_percent: 100_000 }),
      ],
      ownedSnapshot: {
        refreshed_at: 1_800_000_000,
        stocks: [{ stock_id: 1, shares: 200, bonus: null }],
      },
      cityBankActive: false,
      budget: 1_500,
      affordableOnly: false,
      minimumRoi: null,
    });

    expect(results[0]).toMatchObject({
      sell_shares: 51,
      current_annual_return: 0,
      annual_return_gain: 2_000_000,
    });
  });

  it("sells excess covered shares before breaking lower ROI active blocks", () => {
    const results = buildStockRebalanceRecommendations({
      rows: [
        stockRow({ row_id: "stock:1:1", stock_id: 1, acronym: "HIGH", latest_price: 10, total_shares_required: 100, annual_return: 1_000, roi_percent: 100 }),
        stockRow({ row_id: "stock:2:1", stock_id: 2, acronym: "LOW", latest_price: 10, total_shares_required: 100, annual_return: 100, roi_percent: 10 }),
        stockRow({ row_id: "stock:3:1", stock_id: 3, acronym: "BUY", latest_price: 10, total_shares_required: 200, increment_cost: 2_000, total_cost: 2_000, annual_return: 2_000_000, roi_percent: 100_000 }),
      ],
      ownedSnapshot: {
        refreshed_at: 1_800_000_000,
        stocks: [
          { stock_id: 1, shares: 200, bonus: null },
          { stock_id: 2, shares: 100, bonus: null },
        ],
      },
      cityBankActive: false,
      budget: 1_500,
      affordableOnly: false,
      minimumRoi: null,
    });

    expect(results[0]).toMatchObject({
      sell_stock_id: 1,
      sell_shares: 51,
      current_annual_return: 0,
      annual_return_gain: 2_000_000,
    });
    expect(results[0].sales.map((sale) => sale.stock_id)).toEqual([1]);
  });

  it("subtracts covered holding return from rebalance gain", () => {
    const results = buildStockRebalanceRecommendations({
      rows: [
        stockRow({ row_id: "stock:1:1", stock_id: 1, acronym: "AAA", latest_price: 10, total_shares_required: 100, annual_return: 500_000, roi_percent: 500 }),
        stockRow({ row_id: "stock:2:1", stock_id: 2, acronym: "BBB", latest_price: 10, total_shares_required: 200, increment_cost: 2_000, total_cost: 2_000, annual_return: 2_000_000, roi_percent: 100_000 }),
      ],
      ownedSnapshot: {
        refreshed_at: 1_800_000_000,
        stocks: [{ stock_id: 1, shares: 100, bonus: null }],
      },
      cityBankActive: false,
      budget: 1_001,
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
      budget: 2_001,
      affordableOnly: false,
      minimumRoi: null,
    });

    expect(results[0]).toMatchObject({
      sale_value: 999,
      sale_fee: 1,
      available_cash: 2_001,
      available_capital: 3_000,
      extra_cash_required: 0,
    });
  });

  it("combines multiple sell sources to fund one rebalance target", () => {
    const results = buildStockRebalanceRecommendations({
      rows: [
        stockRow({ row_id: "stock:1:1", stock_id: 1, acronym: "AAA", latest_price: 10, total_shares_required: 1_000 }),
        stockRow({ row_id: "stock:2:1", stock_id: 2, acronym: "BBB", latest_price: 20, total_shares_required: 1_000 }),
        stockRow({ row_id: "stock:3:1", stock_id: 3, acronym: "CCC", latest_price: 10, total_shares_required: 250, increment_cost: 2_500, total_cost: 2_500, annual_return: 2_500_000, roi_percent: 100_000 }),
      ],
      ownedSnapshot: {
        refreshed_at: 1_800_000_000,
        stocks: [
          { stock_id: 1, shares: 100, bonus: null },
          { stock_id: 2, shares: 100, bonus: null },
        ],
      },
      cityBankActive: false,
      budget: 500,
      affordableOnly: false,
      minimumRoi: null,
    });

    expect(results[0]).toMatchObject({
      sell_stock_id: 1,
      sell_shares: 100,
      sale_value: 2_017.98,
      sale_fee: 2.02,
      available_cash: 500,
      available_capital: 2_517.98,
      extra_cash_required: 0,
      current_annual_return: 0,
      annual_return_gain: 2_500_000,
    });
    expect(results[0].sales).toEqual([
      {
        source_kind: "stock",
        source_row_id: null,
        stock_id: 1,
        acronym: "AAA",
        name: "Alpha",
        shares: 100,
        sale_value: 999,
        sale_fee: 1,
        current_annual_return: 0,
      },
      {
        source_kind: "stock",
        source_row_id: null,
        stock_id: 2,
        acronym: "BBB",
        name: "Alpha",
        shares: 51,
        sale_value: 1_018.98,
        sale_fee: 1.02,
        current_annual_return: 0,
      },
    ]);
    expect(results[0].proposed.row.row_id).toBe("stock:3:1");
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
      budget: 1_001,
      affordableOnly: false,
      minimumRoi: null,
    });

    expect(results).toEqual([]);
  });

  it("does not sell locked holdings for rebalance ideas", () => {
    const results = buildStockRebalanceRecommendations({
      rows: [
        stockRow({ row_id: "stock:1:1", stock_id: 1, acronym: "KEEP", latest_price: 10, total_shares_required: 1_000 }),
        stockRow({ row_id: "stock:2:1", stock_id: 2, acronym: "BUY", latest_price: 10, total_shares_required: 200, increment_cost: 2_000, total_cost: 2_000, annual_return: 2_000_000, roi_percent: 100_000 }),
      ],
      ownedSnapshot: {
        refreshed_at: 1_800_000_000,
        stocks: [{ stock_id: 1, shares: 200, bonus: null }],
      },
      cityBankActive: false,
      budget: 1_001,
      affordableOnly: false,
      minimumRoi: null,
      lockedStockIds: new Set([1]),
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
      budget: 1_001,
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

  it("surfaces best gain and best ROI rebalance ideas after filtering dominated options", () => {
    const results = buildStockRebalanceRecommendations({
      rows: [
        stockRow({ row_id: "stock:1:1", stock_id: 1, latest_price: 10, total_shares_required: 1_000 }),
        stockRow({ row_id: "stock:2:1", stock_id: 2, latest_price: 1, total_shares_required: 2_000, increment_cost: 2_000, total_cost: 2_000, annual_return: 2_000_000, roi_percent: 100_000 }),
        stockRow({ row_id: "stock:3:1", stock_id: 3, latest_price: 1, total_shares_required: 3_000, increment_cost: 3_000, total_cost: 3_000, annual_return: 3_000_000, roi_percent: 100_000 }),
        stockRow({ row_id: "stock:5:1", stock_id: 5, latest_price: 1, total_shares_required: 2_000, increment_cost: 2_000, total_cost: 2_000, annual_return: 2_500_000, roi_percent: 125_000 }),
        stockRow({ row_id: "stock:4:1", stock_id: 4, latest_price: 1, total_shares_required: 4_000, increment_cost: 4_000, total_cost: 4_000, annual_return: 3_000_000, roi_percent: 75_000 }),
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
      "stock:5:1",
    ]);
    expect(results.map((result) => result.highlight)).toEqual([
      "best_gain",
      "best_roi",
    ]);
  });

  it("builds a buy-only strategy path when no holdings are loaded", () => {
    const plan = buildStockStrategyPlan({
      rows: [
        stockRow({ row_id: "stock:1:1", stock_id: 1, annual_return: 100, roi_percent: 10 }),
        stockRow({ row_id: "stock:2:1", stock_id: 2, annual_return: 200, roi_percent: 20 }),
      ],
      ownedSnapshot: null,
      cityBankActive: false,
      budget: null,
      affordableOnly: false,
      minimumRoi: null,
    }, 2);

    expect(plan.starting_cash).toBe(0);
    expect(plan.steps.map((step) => ({
      kind: step.kind,
      row_id: step.recommendation.row.row_id,
    }))).toEqual([
      { kind: "buy", row_id: "stock:2:1" },
    ]);
  });

  it("starts the strategy path from the current budget", () => {
    const plan = buildStockStrategyPlan({
      rows: [
        stockRow({ row_id: "stock:1:1", stock_id: 1, latest_price: 10, total_shares_required: 100, annual_return: 1_000, roi_percent: 100 }),
      ],
      ownedSnapshot: null,
      cityBankActive: false,
      budget: 600,
      affordableOnly: false,
      minimumRoi: null,
    }, 1);

    expect(plan.steps[0]).toMatchObject({
      cash_required: 1_000,
      extra_cash_needed: 400,
      starting_cash: 600,
      ending_cash: 0,
    });
  });

  it("uses additional cost for partially owned strategy buys", () => {
    const plan = buildStockStrategyPlan({
      rows: [
        stockRow({ row_id: "stock:1:1", stock_id: 1, latest_price: 10, total_shares_required: 100, annual_return: 1_000, roi_percent: 100 }),
      ],
      ownedSnapshot: {
        refreshed_at: 1_800_000_000,
        stocks: [{ stock_id: 1, shares: 60, bonus: null }],
      },
      cityBankActive: false,
      budget: null,
      affordableOnly: false,
      minimumRoi: null,
    }, 1);

    expect(plan.steps[0].recommendation).toMatchObject({
      owned_shares: 60,
      shares_needed: 40,
      estimated_cost: 400,
    });
  });

  it("applies minimum ROI to personalized strategy buys", () => {
    const plan = buildStockStrategyPlan({
      rows: [
        stockRow({
          row_id: "stock:1:1",
          stock_id: 1,
          latest_price: 10,
          total_shares_required: 100,
          increment_cost: 1_000,
          annual_return: 100,
          roi_percent: 10,
        }),
      ],
      ownedSnapshot: {
        refreshed_at: 1_800_000_000,
        stocks: [{ stock_id: 1, shares: 90, bonus: null }],
      },
      cityBankActive: false,
      budget: null,
      affordableOnly: false,
      minimumRoi: 50,
    }, 1);

    expect(plan.steps[0].recommendation).toMatchObject({
      row: {
        row_id: "stock:1:1",
      },
      estimated_cost: 100,
      roi_percent: 100,
    });
  });

  it("includes rebalance milestones when sale value unlocks a higher-ROI option", () => {
    const plan = buildStockStrategyPlan({
      rows: [
        stockRow({ row_id: "stock:1:1", stock_id: 1, acronym: "AAA", latest_price: 10, total_shares_required: 1_000, annual_return: 100, roi_percent: 10 }),
        stockRow({ row_id: "stock:2:1", stock_id: 2, acronym: "BBB", latest_price: 10, total_shares_required: 200, annual_return: 2_000_000, roi_percent: 100_000 }),
      ],
      ownedSnapshot: {
        refreshed_at: 1_800_000_000,
        stocks: [{ stock_id: 1, shares: 100, bonus: null }],
      },
      cityBankActive: false,
      budget: null,
      affordableOnly: false,
      minimumRoi: null,
    }, 1);

    expect(plan.steps[0]).toMatchObject({
      kind: "rebalance",
      cash_required: 1_001,
      extra_cash_needed: 1_001,
      annual_return_gain: 2_000_000,
    });
    expect(plan.steps[0].rebalance?.sell_stock_id).toBe(1);
    expect(plan.steps[0].recommendation.row.row_id).toBe("stock:2:1");
  });

  it("does not add same-stock rebalance loops to the strategy path", () => {
    const plan = buildStockStrategyPlan({
      rows: [
        stockRow({ row_id: "stock:1:1", stock_id: 1, latest_price: 10, total_shares_required: 100, annual_return: 500_000 }),
        stockRow({ row_id: "stock:1:2", stock_id: 1, latest_price: 10, increment: 2, total_shares_required: 200, increment_cost: 1_000, total_cost: 2_000, annual_return: 3_000_000, roi_percent: 300_000 }),
      ],
      ownedSnapshot: {
        refreshed_at: 1_800_000_000,
        stocks: [{ stock_id: 1, shares: 100, bonus: null }],
      },
      cityBankActive: false,
      budget: null,
      affordableOnly: false,
      minimumRoi: null,
    }, 1);

    expect(plan.steps[0].kind).toBe("buy");
    expect(plan.steps[0].rebalance).toBeNull();
  });

  it("updates simulated holdings after each strategy step", () => {
    const plan = buildStockStrategyPlan({
      rows: [
        stockRow({ row_id: "stock:1:1", stock_id: 1, latest_price: 10, total_shares_required: 100, annual_return: 1_000, roi_percent: 100 }),
        stockRow({ row_id: "stock:1:2", stock_id: 1, latest_price: 10, increment: 2, total_shares_required: 200, increment_cost: 1_000, total_cost: 2_000, annual_return: 1_500, roi_percent: 75 }),
      ],
      ownedSnapshot: null,
      cityBankActive: false,
      budget: null,
      affordableOnly: false,
      minimumRoi: null,
    }, 2);

    expect(plan.steps.map((step) => ({
      row_id: step.recommendation.row.row_id,
      estimated_cost: step.recommendation.estimated_cost,
    }))).toEqual([
      { row_id: "stock:1:1", estimated_cost: 1_000 },
      { row_id: "stock:1:2", estimated_cost: 1_000 },
    ]);
  });

  it("keeps remaining simulated shares after a partial strategy rebalance", () => {
    const plan = buildStockStrategyPlan({
      rows: [
        stockRow({ row_id: "stock:1:1", stock_id: 1, acronym: "AAA", latest_price: 10, total_shares_required: 100, annual_return: 500_000, roi_percent: 500 }),
        stockRow({ row_id: "stock:2:1", stock_id: 2, acronym: "BBB", latest_price: 10, total_shares_required: 200, increment_cost: 2_000, total_cost: 2_000, annual_return: 2_000_000, roi_percent: 100_000 }),
      ],
      ownedSnapshot: {
        refreshed_at: 1_800_000_000,
        stocks: [{ stock_id: 1, shares: 200, bonus: null }],
      },
      cityBankActive: false,
      budget: 1_500,
      affordableOnly: false,
      minimumRoi: null,
    }, 2);

    expect(plan.steps[0]).toMatchObject({
      kind: "rebalance",
      sales: [
        {
          stock_id: 1,
          shares: 51,
        },
      ],
    });
    expect(plan.steps.map((step) => step.recommendation.row.row_id)).not.toContain("stock:1:1");
  });

  it("keeps a realistic locked-holding strategy snapshot stable", () => {
    const plan = buildStockStrategyPlan({
      rows: [
        stockRow({ row_id: "stock:1:1", stock_id: 1, acronym: "KEEP", latest_price: 10, total_shares_required: 100, annual_return: 500_000, roi_percent: 500 }),
        stockRow({ row_id: "stock:2:1", stock_id: 2, acronym: "BUY", latest_price: 10, total_shares_required: 200, increment_cost: 2_000, total_cost: 2_000, annual_return: 2_000_000, roi_percent: 100_000 }),
        stockRow({ row_id: "stock:4:1", stock_id: 4, acronym: "IDLE", latest_price: 1, total_shares_required: 10_000, increment_cost: 10_000, total_cost: 10_000, annual_return: 1, roi_percent: 0.01 }),
      ],
      ownedSnapshot: {
        refreshed_at: 1_800_000_000,
        stocks: [
          { stock_id: 1, shares: 100, bonus: null },
          { stock_id: 4, shares: 2_000, bonus: null },
        ],
      },
      cityBankActive: false,
      budget: 1_000,
      affordableOnly: false,
      minimumRoi: null,
      lockedStockIds: new Set([1]),
    }, 2);

    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]).toMatchObject({
      kind: "rebalance",
      recommendation: {
        row: {
          row_id: "stock:2:1",
        },
      },
      sales: [
        {
          stock_id: 4,
          shares: 1_002,
        },
      ],
    });
    expect(plan.steps[0].sales.map((sale) => sale.stock_id)).not.toContain(1);
    expect(plan.steps[0].sales[0].sale_value).toBeCloseTo(1_000.998);
    expect(plan.steps[0].rebalance?.sale_fee).toBeCloseTo(1.002);
    expect(plan.steps[0].ending_cash).toBeCloseTo(0.998);
  });

  it("builds stepping-stone buys before selling into a larger target", () => {
    const plan = buildStockStrategyPlan({
      rows: [
        stockRow({ row_id: "stock:1:1", stock_id: 1, acronym: "AAA", latest_price: 10, total_shares_required: 100, increment_cost: 1_000, total_cost: 1_000, annual_return: 120_000, roi_percent: 12_000 }),
        stockRow({ row_id: "stock:2:1", stock_id: 2, acronym: "BBB", latest_price: 10, total_shares_required: 200, increment_cost: 2_000, total_cost: 2_000, annual_return: 300_000, roi_percent: 15_000 }),
        stockRow({ row_id: "stock:3:1", stock_id: 3, acronym: "CCC", latest_price: 10, total_shares_required: 1_000, increment_cost: 10_000, total_cost: 10_000, annual_return: 2_000_000, roi_percent: 20_000 }),
      ],
      ownedSnapshot: null,
      cityBankActive: false,
      budget: null,
      affordableOnly: false,
      minimumRoi: null,
    }, 3);

    expect(plan.steps.map((step) => ({
      kind: step.kind,
      row_id: step.recommendation.row.row_id,
      cash_required: step.cash_required,
      sales: step.sales.map((sale) => sale.stock_id),
    }))).toEqual([
      { kind: "buy", row_id: "stock:1:1", cash_required: 1_000, sales: [] },
      { kind: "buy", row_id: "stock:2:1", cash_required: 2_000, sales: [] },
      { kind: "rebalance", row_id: "stock:3:1", cash_required: 7_003, sales: [1, 2] },
    ]);
  });

  it("prioritizes useful mid-tier strategy milestones over low-ROI ladder rungs", () => {
    const plan = buildStockStrategyPlan({
      rows: [
        stockRow({ row_id: "stock:1:1", stock_id: 1, acronym: "AAA", latest_price: 1, total_shares_required: 100, increment_cost: 100, total_cost: 100, annual_return: 30, roi_percent: 30 }),
        stockRow({ row_id: "stock:2:1", stock_id: 2, acronym: "BBB", latest_price: 1, total_shares_required: 200, increment_cost: 200, total_cost: 200, annual_return: 30, roi_percent: 15 }),
        stockRow({ row_id: "stock:3:1", stock_id: 3, acronym: "CCC", latest_price: 1, total_shares_required: 300, increment_cost: 300, total_cost: 300, annual_return: 30, roi_percent: 10 }),
        stockRow({ row_id: "stock:4:1", stock_id: 4, acronym: "PRN", latest_price: 1, total_shares_required: 600, increment_cost: 600, total_cost: 600, annual_return: 224, roi_percent: 37.333333333333336 }),
        stockRow({ row_id: "stock:5:1", stock_id: 5, acronym: "FHG", latest_price: 1, total_shares_required: 1_000, increment_cost: 1_000, total_cost: 1_000, annual_return: 500, roi_percent: 50 }),
      ],
      ownedSnapshot: null,
      cityBankActive: false,
      budget: null,
      affordableOnly: false,
      minimumRoi: null,
    }, 4);

    const rowIds = plan.steps.map((step) => step.recommendation.row.row_id);
    expect(rowIds[0]).toBe("stock:1:1");
    expect(rowIds).not.toContain("stock:2:1");
    expect(rowIds).not.toContain("stock:3:1");
    expect(rowIds.indexOf("stock:4:1")).toBeLessThan(rowIds.indexOf("stock:5:1"));
  });

  it("skips temporary strategy buys when the final target is too close", () => {
    const plan = buildStockStrategyPlan({
      rows: [
        stockRow({ row_id: "stock:1:1", stock_id: 1, acronym: "TMP", latest_price: 1, total_shares_required: 850, increment_cost: 850, total_cost: 850, annual_return: 382.5, roi_percent: 45 }),
        stockRow({ row_id: "stock:2:1", stock_id: 2, acronym: "BIG", latest_price: 1, total_shares_required: 1_000, increment_cost: 1_000, total_cost: 1_000, annual_return: 500, roi_percent: 50 }),
      ],
      ownedSnapshot: null,
      cityBankActive: false,
      budget: null,
      affordableOnly: false,
      minimumRoi: null,
    }, 3);

    expect(plan.steps[0].recommendation.row.row_id).toBe("stock:2:1");
  });

  it("orders available-now rebalances before future cash milestones", () => {
    const plan = buildStockStrategyPlan({
      rows: [
        stockRow({ row_id: "stock:1:1", stock_id: 1, acronym: "FHG", latest_price: 1, total_shares_required: 2_000, increment_cost: 2_000, total_cost: 2_000, annual_return: 1_000, roi_percent: 50 }),
        stockRow({ row_id: "stock:2:1", stock_id: 2, acronym: "TCT", latest_price: 1, total_shares_required: 100, increment_cost: 100, total_cost: 100, annual_return: 36, roi_percent: 36 }),
        stockRow({ row_id: "stock:3:1", stock_id: 3, acronym: "PRN", latest_price: 1, total_shares_required: 600, increment_cost: 600, total_cost: 600, annual_return: 224, roi_percent: 37.333333333333336 }),
        stockRow({ row_id: "stock:4:1", stock_id: 4, acronym: "GRN", latest_price: 1, total_shares_required: 150, increment_cost: 150, total_cost: 150, annual_return: 45, roi_percent: 30 }),
      ],
      ownedSnapshot: {
        refreshed_at: 1_800_000_000,
        stocks: [{ stock_id: 1, shares: 400, bonus: null }],
      },
      cityBankActive: false,
      budget: null,
      affordableOnly: false,
      minimumRoi: null,
    }, 4);

    const rowIds = plan.steps.map((step) => step.recommendation.row.row_id);
    expect(rowIds).toEqual([
      "stock:2:1",
      "stock:4:1",
      "stock:3:1",
      "stock:1:1",
    ]);
    expect(plan.steps[0]).toMatchObject({ kind: "rebalance", extra_cash_needed: 0 });
    expect(plan.steps[1]).toMatchObject({ kind: "rebalance", extra_cash_needed: 0 });
    expect(plan.steps[2].extra_cash_needed).toBeGreaterThan(0);
  });

  it("stops the strategy path early when the next ROI is not useful enough", () => {
    const plan = buildStockStrategyPlan({
      rows: [
        stockRow({ row_id: "stock:1:1", stock_id: 1, annual_return: 1_000, roi_percent: 100 }),
        stockRow({ row_id: "stock:2:1", stock_id: 2, annual_return: 600, roi_percent: 60 }),
        stockRow({ row_id: "stock:3:1", stock_id: 3, annual_return: 500, roi_percent: 50 }),
      ],
      ownedSnapshot: null,
      cityBankActive: false,
      budget: null,
      affordableOnly: false,
      minimumRoi: null,
    }, 10);

    expect(plan.steps.map((step) => step.recommendation.row.row_id)).toEqual(["stock:1:1"]);
  });

  it("sells idle partial target shares to buy a useful stepping stone", () => {
    const plan = buildStockStrategyPlan({
      rows: [
        stockRow({
          row_id: "stock:1:1",
          stock_id: 1,
          acronym: "FHG",
          latest_price: 1_000,
          total_shares_required: 2_000,
          increment_cost: 2_000_000,
          total_cost: 2_000_000,
          annual_return: 2_000_000,
          roi_percent: 100,
        }),
        stockRow({
          row_id: "stock:2:1",
          stock_id: 2,
          acronym: "TMP",
          latest_price: 1_000,
          total_shares_required: 100,
          increment_cost: 100_000,
          total_cost: 100_000,
          annual_return: 50_000,
          roi_percent: 50,
        }),
      ],
      ownedSnapshot: {
        refreshed_at: 1_800_000_000,
        stocks: [{ stock_id: 1, shares: 200, bonus: null }],
      },
      cityBankActive: false,
      budget: null,
      affordableOnly: false,
      minimumRoi: null,
    }, 2);

    expect(plan.steps[0]).toMatchObject({
      kind: "rebalance",
      recommendation: {
        row: {
          row_id: "stock:2:1",
        },
      },
      sales: [
        {
          stock_id: 1,
          shares: 101,
          sale_value: 100_899,
          current_annual_return: 0,
        },
      ],
    });
  });

  it("marks City Bank unavailable after it is added to the strategy path", () => {
    const plan = buildStockStrategyPlan({
      rows: [
        cityBankRow({ annual_return: 2_000, roi_percent: 100 }),
        stockRow({ row_id: "stock:1:1", stock_id: 1, annual_return: 1_000, roi_percent: 50 }),
      ],
      ownedSnapshot: null,
      cityBankActive: false,
      budget: null,
      affordableOnly: false,
      minimumRoi: null,
    }, 2);

    expect(plan.steps.map((step) => step.recommendation.row.row_id).filter((rowId) => rowId === "city_bank:90")).toHaveLength(1);
  });

  it("ranks strategy steps by ROI before annual return", () => {
    const plan = buildStockStrategyPlan({
      rows: [
        stockRow({ row_id: "stock:1:1", stock_id: 1, latest_price: 10, total_shares_required: 100, annual_return: 1_000, roi_percent: 100 }),
        stockRow({ row_id: "stock:2:1", stock_id: 2, latest_price: 10, total_shares_required: 100, annual_return: 900, roi_percent: 90 }),
      ],
      ownedSnapshot: null,
      cityBankActive: false,
      budget: null,
      affordableOnly: false,
      minimumRoi: null,
    }, 1);

    expect(plan.steps[0].recommendation.row.row_id).toBe("stock:1:1");
  });

  it("stops the strategy path at the configured step limit", () => {
    const plan = buildStockStrategyPlan({
      rows: [
        stockRow({ row_id: "stock:1:1", stock_id: 1, annual_return: 100, roi_percent: 10 }),
        stockRow({ row_id: "stock:2:1", stock_id: 2, annual_return: 290, roi_percent: 29 }),
        stockRow({ row_id: "stock:3:1", stock_id: 3, annual_return: 300, roi_percent: 30 }),
      ],
      ownedSnapshot: null,
      cityBankActive: false,
      budget: null,
      affordableOnly: false,
      minimumRoi: null,
    }, 2);

    expect(plan.steps).toHaveLength(2);
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
