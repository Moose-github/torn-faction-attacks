import { describe, expect, it } from "vitest";
import { defaultBookStrategyInputs, gainPerTrain, perkProduct } from "./bookStrategy";
import {
  cashPerEnergyAtBreakEven, compareEnhancerEfficiency, findEnhancerBreakEvenStat,
  graphPositionForStat, gymGainPerEnergy, MAX_RANGE_STAT, statAtGraphPosition,
} from "./statEnhancerRange";

const settings = defaultBookStrategyInputs;

describe("stat enhancer range", () => {
  it("uses the same unboosted gym gain per energy as Book Strategy", () => {
    for (const stat of [1, 100_000, 49_999_999, 50_000_000, 1e9, 1e12]) {
      expect(gymGainPerEnergy(stat, settings)).toBeCloseTo(
        gainPerTrain(stat, settings, perkProduct(settings), false) / settings.energyPerTrain, 8,
      );
    }
  });

  it("compares cash-funded one-percent gains against gym gains", () => {
    const result = compareEnhancerEfficiency(1e9, 100_000, settings);
    expect(result.gym).toBeCloseTo(3698.5927108818923, 6);
    expect(result.enhancer).toBeCloseTo(2222.222222222222, 6);
    expect(result.winner).toBe("gym");
    expect(result.advantagePercent).toBeCloseTo(66.43667198968516, 6);
    expect(compareEnhancerEfficiency(1e9, 200_000, settings).winner).toBe("enhancer");
  });

  it("puts equality on the boundary and the SE region above it", () => {
    for (const stat of [1, 1e6, 5e7, 1e9, MAX_RANGE_STAT]) {
      const cash = cashPerEnergyAtBreakEven(stat, settings);
      expect(compareEnhancerEfficiency(stat, cash, settings).winner).toBe("equal");
      expect(compareEnhancerEfficiency(stat, cash * 1.001, settings).winner).toBe("enhancer");
      expect(compareEnhancerEfficiency(stat, cash * 0.999, settings).winner).toBe("gym");
    }
  });

  it("finds the crossover even outside the default plotted range", () => {
    expect(findEnhancerBreakEvenStat(100_000, settings)).toBeCloseTo(1_974_309_352.26148, 2);
    for (const stat of [1, 1e5, 5e7, 1e9, 1e13]) {
      const result = findEnhancerBreakEvenStat(cashPerEnergyAtBreakEven(stat, settings), settings)!;
      expect(result / stat).toBeCloseTo(1, 9);
    }
    expect(findEnhancerBreakEvenStat(1, settings)).toBeNull();
  });

  it("handles zero earnings without infinite percentages or a false crossover", () => {
    const result = compareEnhancerEfficiency(1e9, 0, settings);
    expect(result.winner).toBe("gym");
    expect(result.enhancer).toBe(0);
    expect(result.advantagePercent).toBeNull();
    expect(findEnhancerBreakEvenStat(0, settings)).toBeNull();
  });

  it("raises the required cash with higher prices, gym dots, or perks", () => {
    const baseline = cashPerEnergyAtBreakEven(1e9, settings);
    expect(cashPerEnergyAtBreakEven(1e9, { ...settings, statEnhancerPrice: settings.statEnhancerPrice * 2 })).toBeCloseTo(baseline * 2, 6);
    expect(cashPerEnergyAtBreakEven(1e9, { ...settings, gymMultiplier: 4 })).toBeCloseTo(baseline / 2, 6);
    expect(cashPerEnergyAtBreakEven(1e9, { ...settings, customPerksPercent: 20 })).toBeCloseTo(baseline * 1.2, 6);
  });

  it("maps logarithmic graph positions back to stats for marker interaction", () => {
    for (const position of [0, 0.1, 0.5, 0.9, 1]) {
      const stat = statAtGraphPosition(position, 1e8, 1e11);
      expect(graphPositionForStat(stat, 1e8, 1e11)).toBeCloseTo(position, 12);
    }
    expect(statAtGraphPosition(-1, 1e8, 1e11)).toBe(1e8);
    expect(statAtGraphPosition(2, 1e8, 1e11)).toBe(1e11);
  });
});
