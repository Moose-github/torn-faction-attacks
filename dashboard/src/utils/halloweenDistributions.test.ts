import { describe, expect, it } from "vitest";
import { getHalloweenProfitDistribution, getHalloweenTreatSources } from "./halloweenDistributions";
import { DEFAULT_HALLOWEEN, estimateHalloween, simulateHalloween } from "./halloweenProfit";

describe("Halloween treat sources", () => {
  it.each(Array.from({ length: 8 }, (_, bits) => ({
    mortalCoil: Boolean(bits & 1), cashback: Boolean(bits & 2), freebie: Boolean(bits & 4),
  })))("reconciles whole exchange traces and averages with %j", upgrades => {
    const input = { ...DEFAULT_HALLOWEEN, ...upgrades, weapon: "revitalize" as const };
    const single = simulateHalloween(input, "fuel", "can25");
    const sources = getHalloweenTreatSources(single);
    expect(sources.mortalCoil).toBe(upgrades.mortalCoil ? 168 : 0);
    expect(sources.cashback).toBe(single.exchanges.reduce((sum, exchange) => sum + exchange.cashbackTreats, 0));
    expect(sources.freebie).toBe(single.exchanges.reduce((sum, exchange) => sum + exchange.freebieTreats, 0));
    for (const row of [single, estimateHalloween(input, "fuel", "can25")]) {
      const parts = getHalloweenTreatSources(row);
      expect(parts.mortalCoil).toBe(upgrades.mortalCoil ? 168 : 0);
      if (!upgrades.cashback) expect(parts.cashback).toBe(0);
      if (!upgrades.freebie) expect(parts.freebie).toBe(0);
      expect(parts.attacks + parts.mortalCoil + parts.cashback).toBeCloseTo(row.exchangedTreats + row.unexchangedTreats, 8);
      expect(parts.attacks + parts.mortalCoil + parts.cashback + parts.freebie - row.unexchangedTreats).toBeCloseTo(row.rewardTreats, 8);
    }
  });
});

describe("Halloween profit distribution", () => {
  it("counts each boundary value once, including the maximum and negative profits", () => {
    const samples = [-4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12];
    const original = [...samples];
    const result = getHalloweenProfitDistribution(samples);
    expect(result.median).toBe(3.5);
    expect(result.bins.map(bin => [bin.lower, bin.upper, bin.count])).toEqual([
      [-4, 0, 4], [0, 4, 4], [4, 8, 4], [8, 12, 4],
    ]);
    expect(result.bins.reduce((sum, bin) => sum + bin.count, 0)).toBe(samples.length);
    expect(result.bins.reduce((sum, bin) => sum + bin.percentage, 0)).toBe(100);
    expect(samples).toEqual(original);
  });
  it.each([0, -500000000, 2000000000])("handles identical profits of %s without inventing a spread", profit => {
    const result = getHalloweenProfitDistribution(Array(128).fill(profit));
    expect(result).toEqual({ minimum: profit, maximum: profit, median: profit,
      bins: [{ lower: profit, upper: profit, midpoint: profit, count: 128, percentage: 100 }] });
    expect(getHalloweenProfitDistribution([profit]).bins[0].count).toBe(1);
  });
  it("retains empty bins and calculates a median independently of the bins", () => {
    const result = getHalloweenProfitDistribution([-100, -100, -100, -100, 100, 100, 100, 100, 100]);
    expect(result.median).toBe(100);
    expect(result.bins.map(bin => bin.count)).toEqual([4, 0, 5]);
  });
  it("rejects missing or invalid samples", () => {
    for (const samples of [[], [NaN], [1, Infinity]]) expect(() => getHalloweenProfitDistribution(samples)).toThrow();
  });
});
