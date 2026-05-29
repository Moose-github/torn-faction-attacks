import { describe, expect, it } from "vitest";
import { rankStockPaperSignals, rankWhaleFlowSignals } from "./stockPaperTrading";

type Market = Parameters<typeof rankStockPaperSignals>[0];
type MarketStock = Market[number];

describe("rankStockPaperSignals", () => {
  it("ranks stocks by relative momentum after average-score adjustment", () => {
    const observedAt = 10_000;
    const market: Market = [
      stockWithPrices(1, "UP", observedAt, [100, 102, 105, 110, 112]),
      stockWithPrices(2, "FLAT", observedAt, [100, 100, 100, 100, 100]),
    ];

    const signals = rankStockPaperSignals(market, observedAt, { sell_fee_rate: 0 });

    expect(signals).toHaveLength(2);
    expect(signals[0]).toMatchObject({ stock_id: 1, acronym: "UP", rank: 1 });
    expect(signals[1]).toMatchObject({ stock_id: 2, acronym: "FLAT", rank: 2 });
    expect(signals[0].expected_return).toBeGreaterThan(0);
    expect(signals[1].expected_return).toBeLessThan(0);
  });

  it("skips stocks without the full six-hour history window", () => {
    const observedAt = 10_000;
    const market: Market = [
      {
        stock_id: 1,
        acronym: "SHORT",
        name: "Short History",
        points: [
          { stock_id: 1, observed_at: observedAt - 60 * 60, price: 100 },
          { stock_id: 1, observed_at: observedAt, price: 105 },
        ],
      },
    ];

    expect(rankStockPaperSignals(market, observedAt)).toEqual([]);
  });
});

describe("rankWhaleFlowSignals", () => {
  it("scores a one-minute positive flow move above the minimum baseline threshold", () => {
    const observedAt = 10_000;
    const stockId = 7;
    const points = [
      ...Array.from({ length: 6 }, (_, index) => ({
        stock_id: stockId,
        observed_at: observedAt - 60 * 60 + index * 10 * 60,
        price: 100,
        market_cap: 1_000_000,
        total_shares: 100_000,
        investors: 1_000,
      })),
      {
        stock_id: stockId,
        observed_at: observedAt - 60,
        price: 100,
        market_cap: 1_000_000,
        total_shares: 100_000,
        investors: 1_000,
      },
      {
        stock_id: stockId,
        observed_at: observedAt,
        price: 101,
        market_cap: 1_010_000,
        total_shares: 99_000,
        investors: 1_000,
      },
    ];

    const signals = rankWhaleFlowSignals([
      {
        stock_id: stockId,
        acronym: "FLOW",
        name: "Flow Stock",
        points,
      },
    ], observedAt, { sell_fee_rate: 0 });

    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ stock_id: stockId, rank: 1 });
    expect(signals[0].flow_1m).toBeGreaterThan(signals[0].flow_threshold ?? 0);
    expect(signals[0].expected_return).toBeGreaterThan(0);
  });
});

function stockWithPrices(
  stockId: number,
  acronym: string,
  observedAt: number,
  prices: [number, number, number, number, number],
): MarketStock {
  const offsets = [6 * 60 * 60, 3 * 60 * 60, 60 * 60, 30 * 60, 0];
  return {
    stock_id: stockId,
    acronym,
    name: `${acronym} Stock`,
    points: prices.map((price, index) => ({
      stock_id: stockId,
      observed_at: observedAt - offsets[index],
      price,
    })),
  };
}
