import { describe, expect, it } from "vitest";
import { calculateBookStrategy, defaultBookStrategyInputs, statAfterTrainingEnergy } from "./bookStrategy";
import { calculateDrinkPlan, calculateEnergyDrinkTier, drinkEnergy, ENERGY_DRINK_TIERS, type EnergyDrinkSettings } from "./energyDrinkStrategy";

const settings: EnergyDrinkSettings = { factionPercent: 50, company: "none", maxCooldownHours: 48, startingCooldownHours: 0, spendingCap: null };

describe("energy drink book strategy", () => {
  it("doubles can energy with faction bonuses for every tier", () => {
    expect(ENERGY_DRINK_TIERS.map((tier) => drinkEnergy(tier.energy, settings, true))).toEqual([15, 30, 45, 60, 75, 90]);
    expect(drinkEnergy(30, { ...settings, company: "grocery7" }, true)).toBe(99);
    expect(drinkEnergy(15, settings, false)).toBe(23);
  });

  it("fills a 48-hour starting window, excludes expiry, and observes initial cooldown", () => {
    const plan = calculateDrinkPlan(30, 3e6, settings);
    expect(plan.totalFhcs).toBe(395);
    expect(plan.initialFhcs).toBe(24);
    expect(plan.energy).toBe(35550);
    expect(plan.cost).toBe(1185e6);
    expect(plan.useTimesHours?.at(-1)).toBe(742);
    expect(calculateDrinkPlan(30, 3e6, { ...settings, startingCooldownHours: 48 }).totalFhcs).toBe(371);
    expect(calculateDrinkPlan(30, 3e6, { ...settings, maxCooldownHours: 24 }).totalFhcs).toBe(383);
  });

  it("uses fractional company cooldown without discarding spare opening capacity", () => {
    const plan = calculateDrinkPlan(30, 3e6, { ...settings, company: "grocery7" });
    expect(plan.totalFhcs).toBe(439);
    expect(plan.useTimesHours?.[26]).toBeCloseTo(0.6);
    let cooldown = 0;
    let previous = 0;
    for (const time of plan.useTimesHours ?? []) {
      cooldown = Math.max(0, cooldown - (time - previous)) + 1.8;
      expect(cooldown).toBeLessThanOrEqual(48 + 1e-8);
      expect(time).toBeLessThan(744);
      previous = time;
    }
    expect(calculateDrinkPlan(30, 3e6, { ...settings, company: "restaurant10" }).totalFhcs).toBe(527);
  });

  it("caps whole cans and matches the saved budget to actual spend", () => {
    const result = calculateEnergyDrinkTier(defaultBookStrategyInputs, 30, 3e6, { ...settings, spendingCap: 10e6 })!;
    expect(result.plan.totalFhcs).toBe(3);
    expect(result.plan.cost).toBe(9e6);
    expect(result.unspentCap).toBe(1e6);
    expect(result.strategy.endpoint.investmentBalance).toBe(9e6);
    expect(result.strategy.enhancerUse.day).toBeNull();
  });

  it("removes the gym-book bonus and reports only the book's incremental contribution", () => {
    const result = calculateEnergyDrinkTier(defaultBookStrategyInputs, 30, 3e6, settings)!;
    const differentBook = calculateEnergyDrinkTier({ ...defaultBookStrategyInputs, bookBonusPercent: 100 }, 30, 3e6, settings)!;
    expect(result.strategy.bookEnd).toEqual(differentBook.strategy.bookEnd);
    const baselineEnergy = 1000 + 1620 * 31;
    expect(result.strategy.bookEnd.strategyTwoStat).toBe(statAfterTrainingEnergy({ ...defaultBookStrategyInputs, bookBonusPercent: 0 }, baselineEnergy));
    const unboostedCans = statAfterTrainingEnergy(result.inputs, baselineEnergy + 395 * 45);
    expect(result.bookOnlyGain).toBe(result.strategy.bookEnd.strategyOneStat - unboostedCans);
    expect(result.bookOnlyGain).toBeLessThan(result.strategy.bookEnd.lead);
    expect(result.gainPerBillion).toBeCloseTo(result.strategy.bookEnd.lead / 1.185);
  });

  it("keeps the book-end totals and graph on the same can schedule", () => {
    const result = calculateEnergyDrinkTier(defaultBookStrategyInputs, 15, 1e6, { ...settings, company: "grocery7" })!;
    const end = result.strategy.series.find((point) => point.day === 31)!;
    expect(end.strategyOneStat).toBe(result.strategy.bookEnd.strategyOneStat);
    expect(end.strategyTwoBeforeEnhancers).toBe(result.strategy.bookEnd.strategyTwoStat);
    expect(result.strategy.series.every((p) => Number.isFinite(p.strategyOneStat) && Number.isFinite(p.strategyTwoStat))).toBe(true);
  });

  it("applies whole enhancers on the chosen day and reports the remainder", () => {
    const result = calculateEnergyDrinkTier({ ...defaultBookStrategyInputs, enhancerUseMode: { kind: "targetDay", day: 31 } }, 30, 3e6, settings)!;
    expect(result.strategy.enhancerUse.enhancersUsed).toBe(2);
    expect(result.strategy.enhancerUse.strategyTwoAfterEnhancers).toBeCloseTo(result.strategy.bookEnd.strategyTwoStat * 1.01 ** 2);
    expect(result.strategy.enhancerUse.investmentBalance! - 2 * 450e6).toBe(285e6);
  });

  it("supports investment and chosen-stat timing using the common simulation", () => {
    const result = calculateEnergyDrinkTier({ ...defaultBookStrategyInputs, investmentEnabled: true, enhancerUseMode: { kind: "targetStat", stat: 2e9 } }, 30, 3e6, settings)!;
    expect(result.strategy.enhancerUse.day).toBeGreaterThan(31);
    expect(result.strategy.enhancerUse.investmentBalance).toBeGreaterThan(result.plan.cost);
    expect(result.strategy.enhancerUse.strategyTwoBeforeEnhancers).toBeGreaterThanOrEqual(2e9);
  });

  it("handles a budget below one can without invented energy or enhancers", () => {
    const result = calculateEnergyDrinkTier(defaultBookStrategyInputs, 30, 3e6, { ...settings, spendingCap: 1 })!;
    expect(result.plan.totalFhcs).toBe(0);
    expect(result.strategy.bookEnd.lead).toBe(0);
    expect(result.bookOnlyGain).toBe(0);
    expect(result.strategy.endpoint.difference).toBe(0);
    expect(result.gainPerBillion).toBe(0);
  });

  it("rejects invalid prices and unrealistic enhancer purchase counts", () => {
    for (const price of [0, -1, NaN, Infinity]) expect(calculateEnergyDrinkTier(defaultBookStrategyInputs, 30, price, settings)).toBeNull();
    expect(calculateEnergyDrinkTier({ ...defaultBookStrategyInputs, statEnhancerPrice: 1 }, 30, 3e6, settings)).toBeNull();
  });

  it("leaves the existing FHC default result unchanged", () => {
    const result = calculateBookStrategy(defaultBookStrategyInputs);
    expect(result.fhcPlan.totalFhcs).toBe(131);
    expect(result.enhancerUse.day).toBeCloseTo(409.1, 1);
  });
});
