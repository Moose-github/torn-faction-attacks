import { describe, expect, it } from "vitest";
import { compareHalloween, DEFAULT_HALLOWEEN, simulateHalloween, validateHalloween, type HalloweenSettings } from "./halloweenProfit";

const settings = (overrides: Partial<HalloweenSettings> = {}): HalloweenSettings => ({ ...DEFAULT_HALLOWEEN, ...overrides });
const source = (result: ReturnType<typeof simulateHalloween>, name: string) => result.sources.find(row => row.name === name);

describe("Halloween profit model", () => {
  it("compares each book with each booster exactly once", () => {
    const rows = compareHalloween(settings());
    expect(rows).toHaveLength(40);
    expect(new Set(rows.map(row => row.id)).size).toBe(40);
    expect(rows.every(row => Number.isFinite(row.profit))).toBe(true);
  });
  it("conserves money, energy and treats including recursive reward returns", () => {
    for (const weapon of ["scary", "revitalize"] as const) {
      const result = simulateHalloween(settings({ weapon, attackCost: 3000 }), "fuel", "can25");
      expect(result.revenue).toBeCloseTo(result.exchangedTreats * 750000, 3);
      expect(result.cost).toBeCloseTo(result.sources.reduce((sum, row) => sum + row.cost, 0), 3);
      expect(result.profit).toBeCloseTo(result.revenue - result.cost, 3);
      expect(result.sources.reduce((sum, row) => sum + row.energy, 0)).toBeCloseTo(result.attacks * 25 + result.unusedEnergy, 5);
      expect(result.earnedTreats + result.cashbackTreats + result.inflationTreats).toBeCloseTo(result.exchangedTreats, 5);
      expect(result.timeline.at(-1)?.profit).toBe(result.profit);
    }
  });
  it("applies a flat treat price without adding Freebie cash again", () => {
    const first = simulateHalloween(settings(), "fuel", "can30");
    const second = simulateHalloween(settings({ treatPrice: 1500000 }), "fuel", "can30");
    expect(second.revenue).toBeCloseTo(first.revenue * 2, 3);
    expect(second.cost).toBe(first.cost);
    expect(second.attacks).toBe(first.attacks);
  });
  it("includes eight calendar-day refills and can exclude the first day", () => {
    const result = simulateHalloween(settings(), "ugly", "none");
    expect(source(result, "Daily point refills")).toMatchObject({ count: 8, energy: 2000, cost: 8 * 30 * 35000 });
    expect(source(simulateHalloween(settings({ firstRefill: false }), "none", "none"), "Daily point refills")?.count).toBe(7);
  });
  it("does not stack books or apply can-only bonuses to FHCs", () => {
    const base = simulateHalloween(settings(), "none", "fhc");
    for (const book of ["self", "fuel"] as const) {
      const row = simulateHalloween(settings({ company: "grocery7" }), book, "fhc");
      expect(source(row, "FHCs")).toEqual(source(base, "FHCs"));
    }
    const ugly = simulateHalloween(settings(), "ugly", "fhc");
    expect(source(ugly, "FHCs")?.energy).toBe(ugly.boosterCount * 250);
    expect(source(ugly, "Natural regeneration")?.energy).toBe(5040);
    expect(source(simulateHalloween(settings(), "higher", "none"), "Natural regeneration")?.energy).toBe(6048);
  });
  it("shares cooldown with eggs and allows only one item to cross the ceiling", () => {
    const base = simulateHalloween(settings(), "none", "can20");
    const eggs = simulateHalloween(settings({ greenEggs: 1 }), "none", "can20");
    expect(base.boosterCount).toBe(108);
    expect(eggs.boosterCount).toBe(105);
    expect(source(eggs, "Green Easter eggs")?.energy).toBe(500);
    expect(simulateHalloween(settings(), "self", "can20").boosterCount).toBe(216);
    expect(simulateHalloween(settings({ startingCooldown: 48 }), "none", "can20").boosterCount).toBe(84);
  });
  it("applies company can perks and job-point limits without stacking companies", () => {
    const grocery = simulateHalloween(settings({ company: "grocery7", jobPoints: 1000 }), "fuel", "can20");
    expect(source(grocery, "20E cans")?.energy).toBe(grocery.boosterCount * 66);
    expect(source(grocery, "Company job points")).toBeUndefined();
    const farm = simulateHalloween(settings({ company: "farm10", jobPoints: 1000 }), "none", "can20");
    expect(source(farm, "Company job points")).toMatchObject({ count: 800, energy: 5600 });
    expect(source(farm, "20E cans")?.energy).toBe(farm.boosterCount * 30);
  });
  it("removes the scary finishing bonus when using Revitalize", () => {
    const row = simulateHalloween(settings({ weapon: "revitalize", revitalize: 24 }), "none", "none");
    const expectedRate = 0.9 * 1.2 * 1.2 * 1.15 * 1.04 + 0.002;
    expect((row.earnedTreats - 168) / row.attacks).toBeCloseTo(expectedRate, 10);
    expect(source(row, "Revitalize returns")?.energy).toBeCloseTo(row.attacks * 25 * 0.24, 7);
  });
  it("models inactive energy caps and values final treats without post-event attacks", () => {
    const idle = simulateHalloween(settings({ sleepStart: 10, sleepHours: 8 }), "none", "none");
    const active = simulateHalloween(settings(), "none", "none");
    expect(idle.wastedRegeneration).toBeGreaterThan(0);
    expect(idle.unusedEnergy).toBeGreaterThan(0);
    expect(idle.attacks).toBeLessThan(active.attacks);
    expect(idle.earnedTreats + idle.inflationTreats + idle.cashbackTreats).toBeCloseTo(idle.exchangedTreats, 5);
    expect(idle.sources.reduce((sum, row) => sum + row.energy, 0)).toBeCloseTo(idle.attacks * 25 + idle.unusedEnergy, 5);
  });
  it("loses Dark Power energy with infrequent exchanges", () => {
    const frequent = simulateHalloween(settings(), "fuel", "can30");
    const delayed = simulateHalloween(settings({ exchangeHours: 24 }), "fuel", "can30");
    expect(frequent.wastedDarkEnergy).toBe(0);
    expect(delayed.wastedDarkEnergy).toBeGreaterThan(0);
    expect(delayed.attacks).toBeLessThan(frequent.attacks);
    expect(delayed.inflationTreats).toBeGreaterThan(frequent.inflationTreats);
  });
  it("values prices as costs and keeps purchases independent of reward valuations", () => {
    const base = simulateHalloween(settings(), "fuel", "can25");
    const expensive = simulateHalloween(settings({ canPrices: [250000, 500000, 800000, 1250000, 2750000, 3000000] }), "fuel", "can25");
    expect(expensive.profit).toBeCloseTo(base.profit - base.boosterCount * 1000000, 3);
    expect(expensive.exchangedTreats).toBe(base.exchangedTreats);
  });
  it("rejects invalid inputs instead of producing misleading results", () => {
    expect(validateHalloween(settings({ treatPrice: NaN }))).toContain("treat price");
    expect(validateHalloween(settings({ specialRefills: 1.5 }))).toContain("whole numbers");
    expect(() => simulateHalloween(settings({ drugInterval: 0 }), "none", "none")).toThrow();
    expect(() => simulateHalloween(settings(), "none", "made-up")).toThrow();
  });
});
