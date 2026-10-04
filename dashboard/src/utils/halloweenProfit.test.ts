import { describe, expect, it } from "vitest";
import { compareHalloween, DEFAULT_HALLOWEEN, simulateHalloween, validateHalloween, type HalloweenSettings, type HalloweenBasket } from "./halloweenProfit";

const settings = (overrides: Partial<HalloweenSettings> = {}): HalloweenSettings => ({ ...DEFAULT_HALLOWEEN, ...overrides });
const source = (result: ReturnType<typeof simulateHalloween>, name: string) => result.sources.find(row => row.name === name);

describe("Halloween profit model", () => {
  it.each(Array.from({ length: 8 }, (_, bits) => ({
    darkPower: Boolean(bits & 1), freebie: Boolean(bits & 2), cashback: Boolean(bits & 4),
  })))("conserves rewards and energy with Dark Power=$darkPower Freebie=$freebie Cashback=$cashback", upgrades => {
    for (const weapon of ["scary", "revitalize"] as const) {
      for (const [book, booster] of [["none", "none"], ["fuel", "can30"]] as const) {
        const input = settings({ ...upgrades, weapon });
        const row = simulateHalloween(input, book, booster);
        const returnedRate = upgrades.cashback ? 0.1 : 0;
        const energyPerTreat = upgrades.darkPower ? (upgrades.freebie ? 5.5 : 5) : 0;
        const externalEnergy = row.sources.filter(item => !["Dark Power returns", "Revitalize returns"].includes(item.name))
          .reduce((total, item) => total + item.energy, 0);
        const energyPerAttack = 25 * (1 - (weapon === "revitalize" ? input.revitalize / 100 : 0));
        // The continuous feedback loop is an upper bound; unexchanged treats explain the gap.
        const expectedAttacks = (externalEnergy + energyPerTreat * 168 / (1 - returnedRate))
          / (energyPerAttack - energyPerTreat * row.treatsPerAttack / (1 - returnedRate));
        expect(row.attacks).toBeLessThanOrEqual(expectedAttacks + 1e-6);
        const attacksWithRemainder = (externalEnergy + energyPerTreat * (168 - row.unexchangedTreats) / (1 - returnedRate))
          / (energyPerAttack - energyPerTreat * row.treatsPerAttack / (1 - returnedRate));
        expect(row.attacks).toBeCloseTo(attacksWithRemainder, 6);
        expect(row.exchangedTreats).toBeCloseTo((row.earnedTreats - row.unexchangedTreats) / (1 - returnedRate), 6);
        expect(row.cashbackTreats).toBeCloseTo(row.exchangedTreats * returnedRate, 6);
        expect(source(row, "Dark Power returns")?.energy ?? 0).toBeCloseTo(row.exchangedTreats * energyPerTreat, 5);
        expect(row.revenue).toBeCloseTo(row.exchangedTreats * input.treatPrice * (upgrades.freebie ? 1 : 1 / 1.1), 3);
        expect(row.profit).toBeCloseTo(row.revenue - row.cost, 3);
        expect(row.timeline.at(-1)?.profit).toBe(row.profit);
        expect(row.sources.reduce((total, item) => total + item.energy, 0)).toBeCloseTo(row.attacks * 25 + row.unusedEnergy, 5);
        const breakEven = simulateHalloween({ ...input, treatPrice: row.breakEvenTreatPrice }, book, booster);
        expect(Math.abs(breakEven.profit)).toBeLessThan(0.001);
      }
    }
  });
  it("removes Freebie item value from every graph point without altering the entered price", () => {
    const input = settings({ darkPower: false, freebie: true, drugPrice: 0 });
    const enabled = simulateHalloween(input, "none", "none");
    const disabled = simulateHalloween({ ...input, freebie: false }, "none", "none");
    expect(input.treatPrice).toBe(750000);
    expect(disabled.effectiveTreatPrice).toBeCloseTo(750000 / 1.1, 6);
    expect(disabled.attacks).toBe(enabled.attacks);
    expect(disabled.exchangedTreats).toBe(enabled.exchangedTreats);
    disabled.timeline.forEach((point, index) => expect(point.profit).toBeCloseTo(enabled.timeline[index].profit / 1.1, 3));
  });
  it.each([false, true])("honours disabled Dark Power and Cashback=$cashback during delayed and final exchanges", cashback => {
    const row = simulateHalloween(settings({ darkPower: false, freebie: false, cashback, exchangeHours: 24, sleepHours: 16 }), "none", "none");
    expect(source(row, "Dark Power returns")).toBeUndefined();
    expect(row.wastedDarkEnergy).toBe(0);
    expect(row.exchangedTreats).toBeCloseTo((row.earnedTreats - row.unexchangedTreats) / (cashback ? 0.9 : 1), 6);
    expect(row.cashbackTreats).toBeCloseTo(cashback ? row.exchangedTreats * 0.1 : 0, 6);
    expect(row.revenue).toBeCloseTo(row.exchangedTreats * 750000 / 1.1, 3);
  });
  it.each(["scary", "revitalize"] as const)("toggles Mortal Coil's hourly treats and recycled energy with %s", weapon => {
    const enabled = compareHalloween(settings({ weapon, mortalCoil: true }));
    const disabled = compareHalloween(settings({ weapon, mortalCoil: false }));
    expect(DEFAULT_HALLOWEEN.mortalCoil).toBe(true);
    enabled.forEach((row, index) => {
      const without = disabled[index];
      expect(row.earnedTreats - row.attacks * row.treatsPerAttack).toBeCloseTo(168, 6);
      expect(without.earnedTreats).toBeCloseTo(without.attacks * without.treatsPerAttack, 6);
      expect(row.treatsPerAttack).toBe(without.treatsPerAttack);
      expect(row.cost).toBe(without.cost);
      expect(row.boosterCount).toBe(without.boosterCount);
      expect(row.exchangedTreats).toBeGreaterThan(without.exchangedTreats);
      expect(source(row, "Dark Power returns")!.energy).toBeGreaterThan(source(without, "Dark Power returns")!.energy);
      expect(row.attacks).toBeGreaterThan(without.attacks);
      expect(row.profit).toBeGreaterThan(without.profit);
      expect(without.earnedTreats + without.cashbackTreats).toBeCloseTo(without.exchangedTreats + without.unexchangedTreats, 5);
    });
  });
  it.each([
    { basketLevel: "horrifying", rates: [1.550016, 1.377792, 1.377792, 1.205568] },
    { basketLevel: "petrifying", rates: [1.636128, 1.463904, 1.463904, 1.29168] },
    { basketLevel: "nightmarish", rates: [1.72224, 1.550016, 1.550016, 1.377792] },
  ] as { basketLevel: HalloweenBasket; rates: number[] }[])("keeps $basketLevel treat rates fixed for the full event", ({ basketLevel, rates }) => {
    const variants = [
      { weapon: "scary", scaryClothing: true }, { weapon: "revitalize", scaryClothing: true },
      { weapon: "scary", scaryClothing: false }, { weapon: "revitalize", scaryClothing: false },
    ] as const;
    variants.forEach((variant, index) => {
      const row = simulateHalloween(settings({ ...variant, basketLevel, specialRefills: 100 }), "fuel", "can30");
      expect(row.treatsPerAttack).toBeCloseTo(rates[index], 10);
      // Enough earned treats to cross basket thresholds, but the rate never changes.
      expect(row.earnedTreats).toBeGreaterThan(2500);
      expect(row.earnedTreats - 168).toBeCloseTo(row.attacks * rates[index], 6);
    });
  });
  it("propagates basket level through returned energy, attacks and profit without changing spending", () => {
    const rows = (["horrifying", "petrifying", "nightmarish"] as const)
      .map(basketLevel => simulateHalloween(settings({ basketLevel }), "fuel", "can30"));
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].cost).toBe(rows[0].cost);
      expect(rows[i].boosterCount).toBe(rows[0].boosterCount);
      expect(rows[i].exchangedTreats).toBeGreaterThan(rows[i - 1].exchangedTreats);
      expect(source(rows[i], "Dark Power returns")!.energy).toBeGreaterThan(source(rows[i - 1], "Dark Power returns")!.energy);
      expect(rows[i].attacks).toBeGreaterThan(rows[i - 1].attacks);
      expect(rows[i].profit).toBeGreaterThan(rows[i - 1].profit);
    }
  });
  it("defaults to Nightmarish and rejects unknown basket levels", () => {
    expect(DEFAULT_HALLOWEEN.basketLevel).toBe("nightmarish");
    expect(validateHalloween(settings({ basketLevel: "unknown" as HalloweenBasket }))).toBe("Select a valid basket level.");
  });
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
      expect(result.earnedTreats + result.cashbackTreats).toBeCloseTo(result.exchangedTreats + result.unexchangedTreats, 5);
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
  it("includes eight free calendar-day refills, a 1,000E stack and Xanax in every strategy", () => {
    for (const result of compareHalloween(settings())) {
      expect(source(result, "Daily point refills")).toMatchObject({ count: 8, energy: result.book === "ugly" ? 2000 : 1200, cost: 0 });
      expect(source(result, "Starting energy")?.energy).toBe(1000);
      expect(source(result, "Xanax")).toMatchObject({ count: 21, energy: 5250, cost: 21 * 875000 });
    }
  });
  it("still uses all daily refills when an entire partial event day is inactive", () => {
    for (const sleepStart of [0, 10]) {
      const result = simulateHalloween(settings({ sleepStart, sleepHours: 16 }), "ugly", "none");
      expect(source(result, "Daily point refills")).toMatchObject({ count: 8, energy: 2000, cost: 0 });
      expect(result.sources.reduce((sum, row) => sum + row.energy, 0)).toBeCloseTo(result.attacks * 25 + result.unusedEnergy, 5);
    }
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
    const expectedRate = 0.9 * 1.2 * 1.2 * 1.15 * 1.04;
    expect((row.earnedTreats - 168) / row.attacks).toBeCloseTo(expectedRate, 10);
    expect(source(row, "Revitalize returns")?.energy).toBeCloseTo(row.attacks * 25 * 0.24, 7);
  });
  it.each([
    { weapon: "scary" as const, scaryClothing: true, expectedRate: 1.72224 },
    { weapon: "revitalize" as const, scaryClothing: true, expectedRate: 1.550016 },
    { weapon: "scary" as const, scaryClothing: false, expectedRate: 1.550016 },
    { weapon: "revitalize" as const, scaryClothing: false, expectedRate: 1.377792 },
  ])("excludes Cat in Hell with $weapon and scary clothing $scaryClothing", ({ weapon, scaryClothing, expectedRate }) => {
    const row = simulateHalloween(settings({ weapon, scaryClothing }), "none", "none");
    expect(row.treatsPerAttack).toBeCloseTo(expectedRate, 10);
    expect((row.earnedTreats - 168) / row.attacks).toBeCloseTo(expectedRate, 10);
  });
  it("models inactive energy caps and values final treats without post-event attacks", () => {
    const idle = simulateHalloween(settings({ sleepStart: 10, sleepHours: 8 }), "none", "none");
    const active = simulateHalloween(settings(), "none", "none");
    expect(idle.wastedRegeneration).toBeGreaterThan(0);
    expect(idle.unusedEnergy).toBeGreaterThan(0);
    expect(idle.attacks).toBeLessThan(active.attacks);
    expect(idle.earnedTreats + idle.cashbackTreats).toBeCloseTo(idle.exchangedTreats + idle.unexchangedTreats, 5);
    expect(idle.sources.reduce((sum, row) => sum + row.energy, 0)).toBeCloseTo(idle.attacks * 25 + idle.unusedEnergy, 5);
  });
  it("uses safe frequent batches even with a legacy exchange interval", () => {
    const frequent = simulateHalloween(settings(), "fuel", "can30");
    const delayed = simulateHalloween(settings({ exchangeHours: 24 }), "fuel", "can30");
    expect(frequent.wastedDarkEnergy).toBe(0);
    expect(delayed).toEqual(frequent);
  });
  it.each([false, true])("exchanges whole baskets in multiples of ten without exceeding the energy cap (Freebie=$freebie)", freebie => {
    for (const weapon of ["scary", "revitalize"] as const) {
      for (const row of compareHalloween(settings({ freebie, weapon, greenEggs: 2, extraEnergy: 1000 }))) {
        expect(row.exchanges.length).toBeGreaterThan(0);
        expect(row.wastedDarkEnergy).toBe(0);
        let exchanged = 0, cashback = 0, darkEnergy = 0;
        for (const batch of row.exchanges) {
          expect(batch.treats).toBeGreaterThanOrEqual(100);
          expect(batch.treats % 10).toBe(0);
          expect(batch.freebieTreats).toBe(freebie ? batch.treats / 10 : 0);
          expect(batch.cashbackTreats).toBe(batch.treats / 10);
          expect(batch.energyReturned).toBe((batch.treats + batch.freebieTreats) * 5);
          expect(batch.energyBefore).toBeGreaterThanOrEqual(0);
          expect(batch.energyBefore + batch.energyReturned).toBeLessThanOrEqual(1000);
          exchanged += batch.treats; cashback += batch.cashbackTreats; darkEnergy += batch.energyReturned;
        }
        expect(exchanged).toBe(row.exchangedTreats);
        expect(cashback).toBe(row.cashbackTreats);
        expect(darkEnergy).toBe(source(row, "Dark Power returns")?.energy);
        expect(row.unexchangedTreats).toBeGreaterThanOrEqual(0);
        expect(row.unexchangedTreats).toBeLessThan(110);
        expect(row.earnedTreats + cashback).toBeCloseTo(exchanged + row.unexchangedTreats, 6);
      }
    }
  });
  it("accounts for the energy already held when exchanging a stacked basket", () => {
    // A second 1,000E claim leaves too much energy at both 100 and 110 treats.
    // Keep attacking until the whole basket reaches the next safe multiple of ten.
    const row = simulateHalloween(settings({ extraEnergy: 1000 }), "none", "none");
    const first = row.exchanges[0];
    expect(first.treats).toBe(120);
    expect(first.energyBefore).toBeGreaterThan(200);
    expect(first.energyBefore + first.energyReturned).toBeLessThanOrEqual(1000);
    expect(first.cashbackTreats).toBe(12);
    expect(first.freebieTreats).toBe(12);
    expect(first.energyReturned).toBe(660);
  });
  it("uses 100-treat exchanges for standard strategies and leaves the final remainder unexchanged", () => {
    for (const row of compareHalloween(settings())) {
      expect(row.exchanges.every(batch => batch.treats === 100)).toBe(true);
      expect(row.unexchangedTreats).toBeGreaterThanOrEqual(0);
      expect(row.unexchangedTreats).toBeLessThan(100);
    }
  });
  it("excludes leftover treats from revenue and never attacks energy received after the event", () => {
    const row = simulateHalloween(settings({ sleepStart: 10, sleepHours: 8 }), "none", "none");
    expect(row.unexchangedTreats).toBeGreaterThan(0);
    expect(row.revenue).toBe(row.exchangedTreats * row.effectiveTreatPrice);
    expect(row.earnedTreats - 168).toBeCloseTo(row.attacks * row.treatsPerAttack, 6);
    expect(row.sources.reduce((sum, item) => sum + item.energy, 0)).toBeCloseTo(row.attacks * 25 + row.unusedEnergy, 5);
    expect(row.exchanges.filter(batch => batch.afterEvent).reduce((sum, batch) => sum + batch.energyReturned, 0))
      .toBeLessThanOrEqual(row.unusedEnergy);
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
