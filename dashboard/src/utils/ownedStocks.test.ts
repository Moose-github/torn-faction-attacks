import { describe, expect, it } from "vitest";
import {
  ownedSharesMap,
  ownedStockBenefitProgress,
  ownsStockIncrement,
  type OwnedStockPosition,
  parseBankMeritsResponse,
  parseCityBankResponse,
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

  it("preserves zero payout progress in API and saved snapshots without treating missing progress as zero", () => {
    const snapshot = parseOwnedStocksResponse({ stocks: [
      { id: 1, shares: 100, bonus: { available: false, increment: 1, progress: 0, frequency: 7 } },
      { id: 2, shares: 100, bonus: { progress: null } },
      { id: 3, shares: 100, bonus: {} },
      { id: 4, shares: 100, bonus: { progress: -1 } },
    ] }, 1_800_000_000);
    expect(snapshot.stocks.map((stock) => stock.bonus?.progress)).toEqual([0, null, null, null]);
    expect(parseStoredOwnedStockSnapshot(snapshot)).toEqual(snapshot);
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

describe("City Bank imports", () => {
  const investment = {
    amount: 2_000_000_000, profit: 340_000_000, duration: 90,
    interest_rate: 17, until: 1_800_000_000, invested_at: 1_792_224_000,
  };

  it("retains only the City Bank investment from the money response", () => {
    expect(parseCityBankResponse({ money: {
      wallet: 123_456, vault: 789_012, faction: { money: 99 },
      city_bank: { ...investment, unrelated: "discard" },
    } })).toEqual(investment);
  });

  it("distinguishes no investment from unavailable bank information", () => {
    expect(parseCityBankResponse({ money: { city_bank: null } })).toBeNull();
    expect(() => parseCityBankResponse({ money: {} })).toThrow("incomplete");
    expect(() => parseCityBankResponse({})).toThrow("did not include");
    expect(() => parseCityBankResponse({ error: { code: 16, error: "Access level too low" } })).toThrow("Access level too low");
  });

  it.each([
    { profit: null }, { profit: -1 }, { amount: "2000000000" },
    { until: undefined }, { duration: 0 }, { interest_rate: Number.NaN },
  ])("rejects incomplete or invalid bank fields: %j", (invalid) => {
    expect(() => parseCityBankResponse({ money: { city_bank: { ...investment, ...invalid } } })).toThrow("incomplete");
  });

  it("allows zero profit and rates", () => {
    expect(parseCityBankResponse({ money: { city_bank: { ...investment, profit: 0, interest_rate: 0 } } }))
      .toEqual({ ...investment, profit: 0, interest_rate: 0 });
  });

  it("restores imported bank data and keeps old stock-only snapshots compatible", () => {
    const snapshot = { refreshed_at: 1_799_000_000, stocks: [] };
    expect(parseStoredOwnedStockSnapshot({ ...snapshot, city_bank: investment }))
      .toEqual({ ...snapshot, city_bank: investment });
    expect(parseStoredOwnedStockSnapshot({ ...snapshot, city_bank: null }))
      .toEqual({ ...snapshot, city_bank: null });
    expect(parseStoredOwnedStockSnapshot(snapshot)).toEqual(snapshot);
    expect(parseStoredOwnedStockSnapshot({ ...snapshot, city_bank: { until: 123 } })).toEqual(snapshot);
  });
});

describe("owned stock payout progress", () => {
  const position: OwnedStockPosition = {
    stock_id: 1, shares: 300,
    bonus: { available: false, increment: 1, progress: 3, frequency: 7 },
  };
  const input = { position, requiredShares: 100, increment: 1, passive: false };

  it.each([[0, 7], [3, 7], [30, 31]])("reports %s days through a %s-day cycle", (days, frequency) => {
    expect(ownedStockBenefitProgress({ ...input, position: { ...position, bonus: { ...position.bonus!, progress: days, frequency } } }))
      .toEqual({ state: "progress", days, frequency });
  });

  it("uses the API availability flag for a ready payout", () => {
    expect(ownedStockBenefitProgress({ ...input, position: { ...position, bonus: { ...position.bonus!, available: true } } }))
      .toEqual({ state: "ready" });
  });

  it("does not show the current dividend as ready for a newly added block", () => {
    expect(ownedStockBenefitProgress({ ...input, requiredShares: 300, increment: 2,
      position: { ...position, bonus: { ...position.bonus!, available: true } },
    })).toEqual({ state: "next_cycle" });
  });

  it("does not borrow another block's timing for manually marked ownership", () => {
    expect(ownedStockBenefitProgress({ ...input, requiredShares: 700, increment: 3 })).toEqual({ state: "unavailable" });
    expect(ownedStockBenefitProgress({ ...input, position: undefined })).toEqual({ state: "unavailable" });
  });

  it("keeps missing timing unavailable", () => {
    for (const bonus of [null, { ...position.bonus!, progress: null }, { ...position.bonus!, frequency: null }, { ...position.bonus!, increment: null }, { ...position.bonus!, progress: 8 }]) {
      expect(ownedStockBenefitProgress({ ...input, position: { ...position, bonus } })).toEqual({ state: "unavailable" });
    }
  });

  it("does not infer a claimable reward from completed progress alone", () => {
    expect(ownedStockBenefitProgress({ ...input, position: { ...position, bonus: { ...position.bonus!, progress: 7 } } }))
      .toEqual({ state: "progress", days: 7, frequency: 7 });
  });

  it("handles passive activation without a dividend increment", () => {
    expect(ownedStockBenefitProgress({ ...input, passive: true,
      position: { ...position, bonus: { available: true, increment: null, progress: null, frequency: null } },
    })).toEqual({ state: "ready" });
  });
});

describe("bank merits parsing", () => {
  it("parses bank interest merits from Torn v2 upgrade id 7", () => {
    expect(parseBankMeritsResponse({
      merits: {
        upgrades: [
          { id: 3, level: 10 },
          { id: 4, level: 3 },
          { id: 7, level: 10 },
          { id: 8, level: 10 },
        ],
        available: 3,
        used: 427,
        medals: 183,
        honors: 240,
      },
    })).toBe(10);
  });

  it("parses bank interest merits from keyed Torn response objects", () => {
    expect(parseBankMeritsResponse({
      merits: {
        bank_interest: 7,
      },
    })).toBe(7);
    expect(parseBankMeritsResponse({
      merits: {
        "Bank Interest": { upgrades: 10 },
      },
    })).toBe(10);
  });

  it("parses bank interest merits from merit lists", () => {
    expect(parseBankMeritsResponse({
      merits: [
        { name: "Nerve Bar", level: 3 },
        { name: "Bank Interest", level: 6 },
      ],
    })).toBe(6);
    expect(parseBankMeritsResponse({
      merits: [
        { key: "bank_interest", value: 12 },
      ],
    })).toBe(10);
  });

  it("returns null when bank interest merits are not present", () => {
    expect(parseBankMeritsResponse({
      merits: [
        { name: "Nerve Bar", level: 3 },
      ],
    })).toBeNull();
  });

  it("turns Torn merits API errors into friendly errors", () => {
    expect(() => parseBankMeritsResponse({
      error: { code: 2, error: "Incorrect key" },
    })).toThrow("Incorrect key");
  });
});
