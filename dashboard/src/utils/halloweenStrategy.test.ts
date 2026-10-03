import { describe, expect, it } from "vitest";
import { activePostBookTrainingDaysAtDay, defaultBookStrategyInputs, statAfterTrainingEnergy } from "./bookStrategy";
import { calculateEnergyDrinkTier, type EnergyDrinkSettings } from "./energyDrinkStrategy";
import { calculateHalloweenTier, expectedHalloweenRewards, halloweenEnhancedStat, MAX_BASKET_TREATS_PER_ATTACK } from "./halloweenStrategy";

const settings: EnergyDrinkSettings = { factionPercent: 50, company: "none", maxCooldownHours: 48, startingCooldownHours: 0, spendingCap: null };
const inputs = { ...defaultBookStrategyInputs, enhancerUseMode: { kind: "targetDay", day: 31 } as const };
const tier = (changes: Partial<typeof defaultBookStrategyInputs> = {}, options: Partial<EnergyDrinkSettings> = {}, value = 700000) => calculateHalloweenTier({ ...inputs, ...changes }, 30, 3e6, { ...settings, ...options }, value)!;

describe("max-basket Halloween rewards", () => {
  it("uses every multiplier and the rare-treat expectation", () => {
    expect(MAX_BASKET_TREATS_PER_ATTACK).toBeCloseTo(1.72424, 10);
  });

  it("conserves energy and treats through Freebie, Cashback and Dark Power recycling", () => {
    const result = expectedHalloweenRewards(1000, 168);
    expect(result.attacks * 25).toBeCloseTo(1000 + result.returnedEnergy, 8);
    expect(result.rewardUnits).toBeCloseTo(result.exchangedTreats * 1.1, 8);
    expect(result.returnedEnergy).toBeCloseTo(result.rewardUnits * 5, 8);
    expect(result.earnedTreats + result.cashbackTreats).toBeCloseTo(result.exchangedTreats, 8);
    expect(result.earnedTreats).toBeCloseTo(result.attacks * MAX_BASKET_TREATS_PER_ATTACK + 168, 8);
  });

  it("does not create any rewards or energy from nothing", () => {
    expect(Object.values(expectedHalloweenRewards(0)).every((v) => v === 0)).toBe(true);
  });

  it("keeps can-funded incremental rewards independent of shared normal energy and passive treats", () => {
    const before = expectedHalloweenRewards(12340, 168);
    const after = expectedHalloweenRewards(12340 + 9630, 168);
    const extra = expectedHalloweenRewards(9630);
    for (const field of ["attacks", "rewardUnits", "earnedTreats", "returnedEnergy"] as const) {
      expect(after[field] - before[field]).toBeCloseTo(extra[field], 8);
    }
  });
});

describe("Halloween can strategies", () => {
  it("fully covers seven attacking days and trains the remaining 24", () => {
    const result = tier();
    expect(result.plan.totalFhcs).toBe(395);
    expect(result.eventCans).toBe(107);
    expect(result.eventCanEnergy).toBe(9630);
    expect(result.gymCanEnergy).toBe(25920);
    expect(result.eventCanEnergy + result.gymCanEnergy).toBe(result.plan.energy);
    expect(result.normalEventEnergy).toBe(1000 + 1620 * 7);
    expect(result.bookEnd.savingsStat).toBe(statAfterTrainingEnergy({ ...inputs, bookBonusPercent: 0 }, 1620 * 24));
    expect(result.bookEnd.cansStat).toBe(statAfterTrainingEnergy({ ...inputs, bookBonusPercent: 0 }, 1620 * 24 + 25920));
    expect(result.series.filter((p) => p.day < 7).every((p) => p.cansStat === inputs.startingStat && p.savingsStat === inputs.startingStat)).toBe(true);
  });

  it("gives both strategies normal rewards, with only the can difference counted as extra", () => {
    const result = tier();
    expect(result.baselineProceeds).toBeGreaterThan(0);
    expect(result.canProceeds - result.baselineProceeds).toBeCloseTo(result.extraProceeds, 5);
    expect(result.purchase.cansBalance).toBe(result.canProceeds);
    expect(result.purchase.savingsBalance).toBe(result.baselineProceeds + result.plan.cost);
    expect(result.netExtraCash).toBeCloseTo(result.extraProceeds - result.plan.cost, 5);
  });

  it("starts interest on proceeds at event end, never before the money exists", () => {
    const result = tier({ investmentEnabled: true, annualRoiPercent: 25 });
    expect(result.purchase.cansBalance).toBeCloseTo(result.canProceeds * 1.25 ** (24 / 365), 5);
    expect(result.purchase.savingsBalance).toBeCloseTo(result.plan.cost * 1.25 ** (31 / 365) + result.baselineProceeds * 1.25 ** (24 / 365), 5);
  });

  it("buys whole enhancers for both strategies with separately conserved cash", () => {
    const result = tier();
    const purchase = result.purchase;
    expect(purchase.day).toBe(31);
    for (const [balance, count, cash] of [
      [purchase.cansBalance!, purchase.cansEnhancers, purchase.cansCashLeft!],
      [purchase.savingsBalance!, purchase.savingsEnhancers, purchase.savingsCashLeft!],
    ]) {
      expect(Number.isInteger(count)).toBe(true);
      expect(cash).toBeGreaterThanOrEqual(0);
      expect(cash).toBeLessThan(inputs.statEnhancerPrice);
      expect(count * inputs.statEnhancerPrice + cash).toBeCloseTo(balance, 5);
    }
    const purchasePoints = result.series.filter((p) => p.day === 31);
    expect(purchasePoints).toHaveLength(2);
    expect(purchasePoints[1].cansStat).toBeCloseTo(halloweenEnhancedStat(purchasePoints[0].cansStat, purchase.cansEnhancers));
    expect(purchasePoints[1].savingsStat).toBeCloseTo(halloweenEnhancedStat(purchasePoints[0].savingsStat, purchase.savingsEnhancers));
  });

  it("keeps zero-can paths identical, even with shared income and investment", () => {
    const result = tier({ investmentEnabled: true }, { spendingCap: 0 });
    expect(result.extraProceeds).toBe(0);
    expect(result.extraRewards.attacks).toBe(0);
    expect(result.bookEndGymLead).toBe(0);
    expect(result.firstSavingOvertakeDay).toBeNull();
    expect(result.series.every((point) => point.difference === 0)).toBe(true);
    expect(result.purchase.cansEnhancers).toBe(result.purchase.savingsEnhancers);
  });

  it("assigns a small spending cap to the opening Halloween cans without inventing later cans", () => {
    const result = tier({}, { spendingCap: 10e6 });
    expect(result.plan.totalFhcs).toBe(3);
    expect(result.plan.cost).toBe(9e6);
    expect(result.eventCans).toBe(3);
    expect(result.gymCanEnergy).toBe(0);
    expect(result.bookEndGymLead).toBe(0);
  });

  it("accounts for company cooldown and energy effects", () => {
    const grocery = tier({}, { company: "grocery7" });
    const restaurant = tier({}, { company: "restaurant10" });
    expect(grocery.eventCans).toBe(119);
    expect(grocery.eventCanEnergy).toBe(119 * 99);
    expect(restaurant.eventCans).toBe(143);
    expect(restaurant.eventCanEnergy).toBe(143 * 90);
  });

  it("does not add the gym book bonus or double count returned energy as training", () => {
    const result = tier({ bookBonusPercent: 100 });
    const zeroValue = tier({}, {}, 0);
    expect(result.bookEnd).toEqual(zeroValue.bookEnd);
    expect(result.extraRewards.returnedEnergy).toBeGreaterThan(0);
    expect(result.gymGainsForgone).toBeGreaterThan(0);
    expect(result.bookEnd.cansStat).toBe(tier().bookEnd.cansStat);
    expect(zeroValue.extraProceeds).toBe(0);
  });

  it("retains the existing post-book training rotation", () => {
    const result = tier({ postBookTrainingMonthsOutOfFour: 1, enhancerUseMode: { kind: "targetDay", day: 200 } });
    expect(activePostBookTrainingDaysAtDay(result.inputs, 124)).toBe(0);
    const at31 = result.series.find((p) => p.day === 31)!;
    const at124 = result.series.find((p) => p.day === 124)!;
    expect(at124.cansStat).toBe(at31.cansStat);
    expect(at124.savingsStat).toBe(at31.savingsStat);
  });

  it("uses a stated day-31 fallback if saving cannot overtake", () => {
    const result = tier({ enhancerUseMode: { kind: "earliestOvertake" } }, {}, 10e6);
    expect(result.firstSavingOvertakeDay).toBeNull();
    expect(result.purchase.day).toBe(31);
    expect(result.purchase.cansEnhancers).toBeGreaterThan(result.purchase.savingsEnhancers);
  });

  it("supports target-stat timing and an unreachable target", () => {
    const result = tier({ enhancerUseMode: { kind: "targetStat", stat: 2e9 } });
    expect(result.purchase.day).toBeGreaterThan(31);
    const event = result.series.find((p) => p.day === result.purchase.day);
    if (event) expect(event.savingsStat).toBeGreaterThanOrEqual(2e9);
    const unreachable = tier({ dailyEnergy: 0, enhancerUseMode: { kind: "targetStat", stat: 2e9 } });
    expect(unreachable.purchase.day).toBeNull();
    expect(unreachable.purchase.cansEnhancers).toBe(0);
    expect(unreachable.series.every((p) => Number.isFinite(p.cansStat) && Number.isFinite(p.savingsStat))).toBe(true);
  });

  it("applies the enhancer gain cap", () => {
    expect(halloweenEnhancedStat(600e12, 3)).toBe(615e12);
    expect(halloweenEnhancedStat(499e12, 2)).toBeCloseTo(499e12 * 1.01 + 5e12);
  });

  it("rejects invalid inputs without hanging or producing nonfinite projections", () => {
    expect(calculateHalloweenTier(inputs, 30, 0, settings, 700000)).toBeNull();
    expect(calculateHalloweenTier(inputs, 30, 3e6, settings, NaN)).toBeNull();
    expect(calculateHalloweenTier(inputs, 30, 3e6, { ...settings, startingCooldownHours: 100 }, 700000)).toBeNull();
    expect(tier({ statEnhancerPrice: 1 })).toBeNull();
  });

  it("does not alter the training-only book scenario", () => {
    const training = calculateEnergyDrinkTier(inputs, 30, 3e6, settings)!;
    expect(training.plan.energy).toBe(35550);
    expect(training.strategy.bookEnd.strategyOneStat).toBeGreaterThan(tier().bookEnd.cansStat);
  });
});
