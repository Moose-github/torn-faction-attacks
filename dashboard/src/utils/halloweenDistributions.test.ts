import { describe, expect, it } from "vitest";
import { getHalloweenProfitDistribution, getHalloweenTreatSources, getHalloweenTreatReturnBreakdown } from "./halloweenDistributions";
import { DEFAULT_HALLOWEEN, estimateHalloween, simulateHalloween } from "./halloweenProfit";
import { HALLOWEEN_RETURN_ROUNDS } from "./halloweenTreatOrigins";

describe("Halloween simulated return breakdown", () => {
  const supplied = (energy: number) => [{ name: "Starting energy", energy, count: 1, cost: 0 }];
  const example = () => ({ sources: [...supplied(100),
    { name: "Dark Power returns", energy: 40, count: 1, cost: 0 },
    { name: "Revitalize returns", energy: 25, count: 1, cost: 0 }],
    treatOrigins: { energyRounds: [8, 4, 2, 1, 0.5, 0.125, 0.125], mortalCoil: 4.25, energyFreebieRewards: 1.5 },
    exchangedTreats: 20, rewardTreats: 22 });

  it("divides by supplied energy, excluding returned energy, and keeps Freebie separate", () => {
    const data = getHalloweenTreatReturnBreakdown(example());
    expect(data.suppliedEnergy).toBe(100);
    expect(data.exchangedPer25).toBe(3.9375);
    expect(data.rewardsPer25).toBe(4.3125);
    expect(data.parts.reduce((sum, part) => sum + part.per25!, 0)).toBe(data.exchangedPer25);
    expect(data.parts).toHaveLength(7);
    expect(data.parts[5].label).toBe("Fifth returns");
    expect(data.parts[6].label).toBe("Later returns");
    // Increasing unrelated hourly treats and their rewards must not increase either energy yield.
    const moreHourly = { ...example(),
      treatOrigins: { ...example().treatOrigins, mortalCoil: 10000 }, exchangedTreats: 10015.75, rewardTreats: 11017.25,
    };
    expect(getHalloweenTreatReturnBreakdown(moreHourly)).toEqual(data);
  });

  it("gives each origin its proportional area, with no gaps or overlapping blocks", () => {
    const data = getHalloweenTreatReturnBreakdown(example());
    expect(data.regions.reduce((sum, r) => sum + r.width * r.height, 0)).toBeCloseTo(1, 12);
    for (const r of data.regions) {
      expect(r.width * r.height).toBeCloseTo(r.treats / 15.75, 12);
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.width).toBeLessThanOrEqual(1 + 1e-12);
      expect(r.y + r.height).toBeLessThanOrEqual(1 + 1e-12);
      for (const other of data.regions.filter(other => other.id > r.id)) {
        const overlapWidth = Math.max(0, Math.min(r.x + r.width, other.x + other.width) - Math.max(r.x, other.x));
        const overlapHeight = Math.max(0, Math.min(r.y + r.height, other.y + other.height) - Math.max(r.y, other.y));
        expect(overlapWidth * overlapHeight).toBeCloseTo(0, 12);
      }
    }
  });

  it.each([0, 5, 6])("fills the square when only origin %s produces exchanged treats", id => {
    const input = example();
    input.treatOrigins.energyRounds = Array(HALLOWEEN_RETURN_ROUNDS).fill(0);
    input.treatOrigins.energyRounds[id] = 20;
    const data = getHalloweenTreatReturnBreakdown(input);
    expect(data.regions).toHaveLength(1);
    expect(data.regions[0]).toMatchObject({ id, x: 0, y: 0, width: 1, height: 1 });
  });

  it("shows no energy yield or blocks when all treats came from Mortal Coil and its returns", () => {
    const data = getHalloweenTreatReturnBreakdown({ sources: supplied(100),
      treatOrigins: { energyRounds: Array(HALLOWEEN_RETURN_ROUNDS).fill(0), mortalCoil: 200, energyFreebieRewards: 0 } });
    expect(data.exchangedPer25).toBe(0);
    expect(data.rewardsPer25).toBe(0);
    expect(data.regions).toEqual([]);
  });

  it("handles no supplied energy, no treats, and missing traces explicitly", () => {
    const data = getHalloweenTreatReturnBreakdown({ sources: supplied(0),
      treatOrigins: { energyRounds: Array(HALLOWEEN_RETURN_ROUNDS).fill(0), mortalCoil: 0, energyFreebieRewards: 0 } });
    expect(data.exchangedPer25).toBeNull();
    expect(data.rewardsPer25).toBeNull();
    expect(data.regions).toEqual([]);
    expect(() => getHalloweenTreatReturnBreakdown({ ...example(), treatOrigins: undefined })).toThrow("must be traced");
  });
});

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
