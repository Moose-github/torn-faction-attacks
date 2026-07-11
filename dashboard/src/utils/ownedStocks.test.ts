import { describe, expect, it } from "vitest";
import {
  ownedSharesMap,
  ownsStockIncrement,
  parseOwnedStocksResponse,
  parseStoredOwnedStockSnapshot,
} from "./ownedStocks";

describe("owned stock parsing", () => {
  it("parses Torn user stock holdings", () => {
    const snapshot = parseOwnedStocksResponse({
      stocks: [
        {
          id: 13,
          shares: 1_000_000,
          transactions: [],
          bonus: {
            available: true,
            increment: 1,
            progress: 7,
            frequency: 7,
          },
        },
        {
          id: 15,
          shares: 376_210,
          transactions: [],
          bonus: {
            available: false,
            increment: null,
            progress: null,
            frequency: null,
          },
        },
      ],
    }, 1_800_000_000);

    expect(snapshot).toEqual({
      refreshed_at: 1_800_000_000,
      stocks: [
        {
          stock_id: 13,
          shares: 1_000_000,
          bonus: {
            available: true,
            increment: 1,
            progress: 7,
            frequency: 7,
          },
        },
        {
          stock_id: 15,
          shares: 376_210,
          bonus: {
            available: false,
            increment: null,
            progress: null,
            frequency: null,
          },
        },
      ],
    });
  });

  it("maps owned shares and only marks covered increments", () => {
    const shares = ownedSharesMap({
      refreshed_at: 1_800_000_000,
      stocks: [
        { stock_id: 13, shares: 1_000_000, bonus: null },
        { stock_id: 15, shares: 376_210, bonus: null },
      ],
    });

    expect(shares.get(13)).toBe(1_000_000);
    expect(shares.get(99)).toBeUndefined();
    expect(ownsStockIncrement(1_000_000, 1_000_000)).toBe(true);
    expect(ownsStockIncrement(376_210, 500_000)).toBe(false);
    expect(ownsStockIncrement(0, 1)).toBe(false);
  });

  it("turns Torn API errors into friendly errors", () => {
    expect(() => parseOwnedStocksResponse({
      error: { code: 2, error: "Incorrect key" },
    }, 1_800_000_000)).toThrow("Incorrect key");
  });

  it("validates stored owned stock snapshots", () => {
    expect(parseStoredOwnedStockSnapshot({
      refreshed_at: 1_800_000_000,
      stocks: [{ stock_id: 13, shares: 1_000_000 }],
    })).toEqual({
      refreshed_at: 1_800_000_000,
      stocks: [{ stock_id: 13, shares: 1_000_000, bonus: null }],
    });
    expect(parseStoredOwnedStockSnapshot({
      refreshed_at: 1_800_000_000,
      stocks: [{ id: 15, shares: 376_210 }],
    })).toEqual({
      refreshed_at: 1_800_000_000,
      stocks: [{ stock_id: 15, shares: 376_210, bonus: null }],
    });
    expect(parseStoredOwnedStockSnapshot({ stocks: [] })).toBeNull();
  });
});
