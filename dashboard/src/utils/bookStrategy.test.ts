import { describe, expect, it } from "vitest";
import {
  calculateBookStrategy,
  calculateFhcPlan,
  defaultBookStrategyInputs,
  perkProduct,
} from "./bookStrategy";

describe("book strategy calculator", () => {
  it("calculates the default FHC stack and multiplicative perks", () => {
    const fhcs = calculateFhcPlan(defaultBookStrategyInputs);

    expect(fhcs).toEqual({
      initialFhcs: 8,
      furtherFhcs: 123,
      totalFhcs: 131,
      energy: 19_650,
      cost: 1_834_000_000,
    });
    expect(defaultBookStrategyInputs.investmentEnabled).toBe(false);
    expect(perkProduct(defaultBookStrategyInputs)).toBeCloseTo(1.22779236, 8);
  });

  it("matches the 500m book-end example without investment growth", () => {
    const result = calculateBookStrategy({
      ...defaultBookStrategyInputs,
      investmentEnabled: false,
    });

    expect(result.bookEnd.strategyOneStat).toBeCloseTo(817_700_000, -5);
    expect(result.bookEnd.strategyTwoStat).toBeCloseTo(727_400_000, -5);
    expect(result.bookEnd.lead).toBeCloseTo(90_300_000, -5);
    expect(result.enhancerUse.strategyTwoBeforeEnhancers).toBeCloseTo(3_411_000_000, -7);
    expect(result.enhancerUse.day).toBeCloseTo(409.1, 1);
    expect(result.enhancerUse.enhancersUsed).toBe(4);
  });

  it("matches the 500m investment-assisted five-enhancer example", () => {
    const result = calculateBookStrategy({
      ...defaultBookStrategyInputs,
      investmentEnabled: true,
    });

    expect(result.enhancerUse.day).toBeCloseTo(334.39, 1);
    expect(result.enhancerUse.enhancersUsed).toBe(5);
    expect(result.enhancerUse.strategyOneStat ?? 0).toBeCloseTo(2_914_600_000, -6);
    expect(result.enhancerUse.strategyTwoBeforeEnhancers ?? 0).toBeCloseTo(2_787_100_000, -6);
    expect(result.enhancerUse.strategyTwoAfterEnhancers ?? 0).toBeCloseTo(2_929_200_000, -6);
    expect(result.enhancerUse.lead ?? 0).toBeCloseTo(14_600_000, -5);
  });

  it("moves the earliest overtake when FHC price funds enhancers sooner", () => {
    const result = calculateBookStrategy({
      ...defaultBookStrategyInputs,
      fhcPrice: 15_000_000,
      investmentEnabled: true,
    });

    expect(result.fhcPlan.cost).toBe(1_965_000_000);
    expect(result.enhancerUse.day).toBeCloseTo(277.81, 1);
    expect(result.enhancerUse.enhancersUsed).toBe(5);
    expect(result.enhancerUse.lead ?? 0).toBeGreaterThan(0);
  });

  it("matches the 4b example without investment growth", () => {
    const result = calculateBookStrategy({
      ...defaultBookStrategyInputs,
      startingStat: 4_000_000_000,
      investmentEnabled: false,
    });

    expect(result.bookEnd.strategyOneStat).toBeCloseTo(4_548_700_000, -6);
    expect(result.bookEnd.strategyTwoStat).toBeCloseTo(4_393_100_000, -6);
    expect(result.enhancerUse.enhancersUsed).toBe(4);
    expect(result.enhancerUse.day).toBeCloseTo(31, 4);
    expect(result.enhancerUse.strategyTwoAfterEnhancers ?? 0).toBeCloseTo(4_571_500_000, -6);
    expect(result.enhancerUse.lead ?? 0).toBeCloseTo(22_800_000, -5);
  });

  it("carries energy that is not divisible by train cost", () => {
    const result = calculateBookStrategy({
      ...defaultBookStrategyInputs,
      startingEnergy: 100,
      graphDurationDays: 31,
      investmentEnabled: false,
    });

    expect(result.bookEnd.strategyTwoStat).toBeLessThan(723_500_000);
    expect(result.bookEnd.strategyOneStat).toBeLessThan(813_700_000);
  });

  it("handles insufficient enhancer funds", () => {
    const result = calculateBookStrategy({
      ...defaultBookStrategyInputs,
      fhcPrice: 1,
      investmentEnabled: false,
    });

    expect(result.fhcPlan.cost).toBe(131);
    expect(result.enhancerUse.enhancersUsed).toBe(0);
    expect(result.enhancerUse.day).toBeNull();
  });
});
