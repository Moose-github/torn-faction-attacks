import { describe, expect, it } from "vitest";
import { DEFAULT_HALLOWEEN, simulateHalloween, rollHalloweenTreats } from "./halloweenProfit";
import { HALLOWEEN_UPGRADE_PATH, HALLOWEEN_PROGRESSION_STARTS, HalloweenUpgradeProgress } from "./halloweenUpgradePath";
import { calculateProgressionRecommendations, chooseProgression, estimateProgression, progressionBoosterLimit, progressionSettings, type ProgressionCandidate } from "./halloweenProgression";

describe("Halloween progression", () => {
  it("uses the agreed order, total costs and grouped starting milestones", () => {
    expect(HALLOWEEN_UPGRADE_PATH.reduce((sum, row) => sum + row.cost, 0)).toBe(2771);
    expect(HALLOWEEN_PROGRESSION_STARTS.map(row => row.step)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 16, 17, 18, 19, 20]);
    const progress = new HalloweenUpgradeProgress(0);
    progress.collectAttack(189);
    expect(progress.purchase(189)).toBe(31);
    expect(progress.step).toBe(5); // Enough to buy Cat in Hell, but its basket gate is not unlocked.
    progress.collectAttack(1);
    expect(progress.purchase(32)).toBe(19);
    expect(progress.step).toBe(6);
  });
  it("uses Shadow once to buy the grouped upgrades, with basket evolution on the next drop", () => {
    const progress = new HalloweenUpgradeProgress(7);
    progress.collectAttack(1000);
    const wallet = progress.purchase(1000);
    expect(wallet).toBe(15);
    expect(progress.step).toBe(16);
    expect(progress.collected).toBe(2371);
    expect(progress.shadowTreats).toBe(1100);
    expect(progress.basketIndex).toBe(7);
    progress.collectAttack(0);
    expect(progress.basketIndex).toBe(7);
    progress.collectAttack(1);
    expect(progress.basketIndex).toBe(8);
    expect(progress.purchase(wallet + 1)).toBe(16);
    expect(progress.shadowTreats).toBe(1100);
    const owned = new HalloweenUpgradeProgress(16);
    expect(owned.shadowTreats).toBe(0);
    expect(owned.purchase(0)).toBe(0);
  });
  it("rolls only purchased multipliers while keeping the random stream aligned", () => {
    for (const [enabled, expected] of [
      [[false, false, false, false], 1], [[true, false, false, false], 2],
      [[true, true, false, false], 6], [[true, true, true, true], 120],
    ] as const) {
      let draws = 0;
      expect(rollHalloweenTreats(.5, () => { draws++; return 0; }, enabled)).toBe(expected);
      expect(draws).toBe(5);
    }
  });
  it("keeps all treats for upgrades before completion, including the final cashout", () => {
    const row = simulateHalloween(DEFAULT_HALLOWEEN, "none", "none", undefined, false, { step: 0, boosterLimit: 0 });
    expect(row.progression!.completed).toBe(false);
    expect(row.exchanges).toEqual([]);
    expect(row.revenue).toBe(0);
    expect(row.progression!.treatsCollected).toBe(row.earnedTreats + row.progression!.shadowTreats);
    const purchased = HALLOWEEN_UPGRADE_PATH.slice(0, row.progression!.step).reduce((sum, upgrade) => sum + upgrade.cost, 0);
    expect(row.unexchangedTreats + purchased).toBe(row.progression!.treatsCollected);
  });
  it("unlocks exchanges during the event and excludes historical Shadow treats", () => {
    for (const step of [7, 16, 20]) {
      const row = simulateHalloween({ ...DEFAULT_HALLOWEEN, specialRefills: 100 }, "none", "can30", undefined, false, { step, boosterLimit: 108 });
      expect(row.progression!.completed).toBe(true);
      expect(row.progression!.shadowTreats).toBe(step === 7 ? 1100 : 0);
      expect(row.exchanges.some(exchange => !exchange.afterEvent)).toBe(true);
      expect(row.revenue).toBeGreaterThan(0);
      expect(row.progression!.treatsCollected).toBe(row.earnedTreats + row.cashbackTreats + row.progression!.shadowTreats);
      const upgradeCost = HALLOWEEN_UPGRADE_PATH.slice(step).reduce((sum, upgrade) => sum + upgrade.cost, 0);
      expect(row.progression!.treatsCollected).toBe(row.exchangedTreats + row.unexchangedTreats + upgradeCost);
    }
  });
  it.each(["fhc", "can5", "can25"])("limits %s to whole quantities and charges only boosters actually used", booster => {
    const zero = simulateHalloween(DEFAULT_HALLOWEEN, "none", booster, undefined, false, { step: 20, boosterLimit: 0 });
    const baseline = simulateHalloween(DEFAULT_HALLOWEEN, "none", "none", undefined, false, { step: 20, boosterLimit: 0 });
    expect(zero.profit).toBe(baseline.profit);
    expect(zero.attacks).toBe(baseline.attacks);
    const limited = estimateProgression(DEFAULT_HALLOWEEN, 0, booster, 3, 2);
    expect(limited.used).toBe(3);
    const price = booster === "fhc" ? DEFAULT_HALLOWEEN.fhcPrice : DEFAULT_HALLOWEEN.canPrices[booster === "can5" ? 0 : 4];
    expect(limited.boosterSpend).toBe(3 * price);
    expect(limited.profit).toBe(-limited.cost);
    const compact = simulateHalloween(DEFAULT_HALLOWEEN, "none", booster, undefined, false, { step: 20, boosterLimit: 3, compact: true });
    const traced = simulateHalloween(DEFAULT_HALLOWEEN, "none", booster, undefined, false, { step: 20, boosterLimit: 3 });
    expect(compact.profit).toBe(traced.profit);
    expect(compact.progression).toEqual(traced.progression);
  });
  it("matches maximum quantities with shared cooldown and eggs", () => {
    for (const company of ["none", "grocery7", "restaurant10"] as const) for (const booster of ["can25", "fhc"]) {
      const settings = { ...DEFAULT_HALLOWEEN, company, greenEggs: 2, startingCooldown: 13 };
      const maximum = progressionBoosterLimit(settings, booster);
      const row = simulateHalloween(settings, "none", booster, undefined, false, { step: 0, boosterLimit: 999 });
      expect(maximum).toBe(row.boosterCount);
    }
    expect(progressionBoosterLimit({ ...DEFAULT_HALLOWEEN, greenEggs: 100 }, "can25")).toBe(0);
  });
  it("holds the specified weapon, clothes and book assumptions regardless of main selections", () => {
    const changed = { ...DEFAULT_HALLOWEEN, weapon: "revitalize" as const, revitalize: 24, basketLevel: "creepy" as const,
      mortalCoil: true, scaryClothing: false, darkPower: false, freebie: false, cashback: false };
    expect(progressionSettings(changed)).toEqual(progressionSettings(DEFAULT_HALLOWEEN));
    expect(estimateProgression(changed, 20, "none", 0, 1)).toEqual(estimateProgression(DEFAULT_HALLOWEEN, 20, "none", 0, 1));
  });
  it("ranks collected treats within a baseline-relative allowance, including negative baselines", () => {
    const candidate = (profit: number, collected: number): ProgressionCandidate => ({ booster: "can25", quantity: collected,
      used: 0, boosterSpend: 0, collected, profit, revenue: 0, cost: -profit, completion: 0, attacks: 0 });
    for (const initial of [-100e6, 100e6]) {
      const baseline = candidate(initial, 100);
      const bestProfit = candidate(initial + 10e6, 120);
      const atLimit = candidate(initial - 25e6, 140);
      const overLimit = candidate(initial - 25e6 - 1, 160);
      const result = chooseProgression([bestProfit, atLimit, overLimit], baseline, 25e6);
      expect(result.profit).toBe(bestProfit);
      expect(result.progression).toBe(atLimit);
      expect(chooseProgression([], baseline, 0).progression).toBe(baseline);
    }
  });
  it("returns every starting milestone when owned eggs fill the entire booster schedule", () => {
    const updates: number[] = [];
    const report = calculateProgressionRecommendations({ ...DEFAULT_HALLOWEEN, greenEggs: 100 }, 0, 128, progress => updates.push(progress.completed));
    expect(report.rows).toHaveLength(13);
    expect(updates.at(-1)).toBe(13);
    for (const row of report.rows) {
      expect(row.profit).toEqual(row.baseline);
      expect(row.progression).toEqual(row.baseline);
      expect(row.baseline.boosterSpend).toBe(0);
    }
  });
});
