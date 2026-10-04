import { describe, expect, it } from "vitest";
import { compareHalloween, estimateHalloween, rollHalloweenTreats, getHalloweenProfitRange, getSimulatedTreatsPerAttack, HALLOWEEN_SIMULATION_RUNS, HALLOWEEN_TREAT_OUTCOMES, HALLOWEEN_BOOKS, HALLOWEEN_BOOSTERS, DEFAULT_HALLOWEEN, simulateHalloween, validateHalloween, type HalloweenSettings, type HalloweenBasket } from "./halloweenProfit";

const settings = (overrides: Partial<HalloweenSettings> = {}): HalloweenSettings => ({ ...DEFAULT_HALLOWEEN, ...overrides });
const source = (result: ReturnType<typeof simulateHalloween>, name: string) => result.sources.find(row => row.name === name);
const compareSingleRuns = (s: HalloweenSettings) => HALLOWEEN_BOOKS.flatMap(book => HALLOWEEN_BOOSTERS.map(booster => simulateHalloween(s, book.id, booster.id)));

describe("Halloween profit model", () => {
  it("keeps 128 runs by default and supports the audited 1,024-run refinement", () => {
    const input = settings();
    expect(estimateHalloween(input, "fuel", "can30")).toEqual(estimateHalloween(input, "fuel", "can30", 128));
    const refined = estimateHalloween(input, "fuel", "can30", 1024);
    expect(refined.simulationRuns).toBe(1024);
    // Independent development benchmark on c8b4e2b with these same nested seeds.
    expect(refined.profit).toBeCloseTo(2094822709.517046, 3);
    expect(refined.profitRange.low).toBeCloseTo(1963534090.9090905, 3);
    expect(refined.profitRange.high).toBeCloseTo(2235579545.454545, 3);
    expect(refined.timeline.at(-1)!.profit).toBe(refined.profit);
  });
  it("passes the requested run count to every strategy and reports progress", () => {
    const progress: number[][] = [];
    const rows = compareHalloween(settings(), 1, (completed, total) => progress.push([completed, total]));
    expect(progress).toEqual(Array.from({ length: 40 }, (_, index) => [index + 1, 40]));
    expect(rows.every(row => row.simulationRuns === 1)).toBe(true);
    const first = simulateHalloween(settings(), "none", "none");
    expect(rows[0].profit).toBe(first.profit);
    expect(rows[0].profitRange).toEqual({ low: first.profit, high: first.profit });
    for (const runs of [0, -1, 1.5, 1025, NaN, Infinity]) {
      expect(() => estimateHalloween(settings(), "none", "none", runs)).toThrow("Simulation count");
    }
  });
  it("calculates the middle 80% with numeric sorting and interpolated percentiles", () => {
    const profits = [300, -100, 700, 0, 600, 100, 800, 200, 500, 400];
    const original = [...profits];
    const range = getHalloweenProfitRange(profits);
    expect(range.low).toBeCloseTo(-10, 8);
    expect(range.high).toBeCloseTo(710, 8);
    expect(profits).toEqual(original);
    expect(getHalloweenProfitRange([-50])).toEqual({ low: -50, high: -50 });
    expect(getHalloweenProfitRange([0, 0, 0])).toEqual({ low: 0, high: 0 });
    expect(() => getHalloweenProfitRange([])).toThrow();
  });
  it.each(["scary", "revitalize"] as const)("derives the %s profit range from the same event runs as the mean", weapon => {
    const input = settings({ weapon });
    const row = estimateHalloween(input, "none", "can25");
    const profits = Array.from({ length: HALLOWEEN_SIMULATION_RUNS }, (_, run) =>
      simulateHalloween(input, "none", "can25", (0x6d2b79f5 + Math.imul(run, 0x9e3779b9)) >>> 0).profit);
    expect(row.profit).toBeCloseTo(profits.reduce((sum, value) => sum + value, 0) / profits.length, 3);
    expect(row.profitRange).toEqual(getHalloweenProfitRange(profits));
    expect(row.profitRange.high).toBeGreaterThan(row.profitRange.low);
    const moreValuable = estimateHalloween({ ...input, treatPrice: input.treatPrice * 2 }, "none", "can25");
    expect(moreValuable.profitRange.low + row.cost).toBeCloseTo(2 * (row.profitRange.low + row.cost), 3);
    expect(moreValuable.profitRange.high + row.cost).toBeCloseTo(2 * (row.profitRange.high + row.cost), 3);
    const worthless = estimateHalloween({ ...input, treatPrice: 0 }, "none", "can25");
    expect(worthless.profitRange).toEqual({ low: -row.cost, high: -row.cost });
  });
  it("rolls all multiplier combinations independently, including misses and boundary rolls", () => {
    const thresholds = [0.2, 0.1, 0.05, 0.01];
    const factors = [2, 3, 4, 5];
    let weightedMean = 0;
    for (let bits = 0; bits < 16; bits++) {
      const rolls = thresholds.map((threshold, index) => bits & (1 << index) ? threshold - 0.00001 : threshold);
      const multiplier = factors.reduce((product, factor, index) => product * (bits & (1 << index) ? factor : 1), 1);
      const probability = thresholds.reduce((product, threshold, index) => product * (bits & (1 << index) ? threshold : 1 - threshold), 1);
      weightedMean += multiplier * probability;
      for (const success of [false, true]) {
        const draws = [success ? 0.89999 : 0.9, ...rolls];
        let calls = 0;
        expect(rollHalloweenTreats(0.9, () => draws[calls++])).toBe(success ? multiplier : 0);
        expect(calls).toBe(5);
      }
    }
    expect(weightedMean).toBeCloseTo(1.72224, 10);
    expect(rollHalloweenTreats(0, () => 0)).toBe(0);
    expect(rollHalloweenTreats(1, () => 0)).toBe(120);
  });
  it.each(["scary", "revitalize"] as const)("records each attack exactly once in the %s drop distribution", weapon => {
    for (const mortalCoil of [false, true]) {
      const row = simulateHalloween(settings({ weapon, mortalCoil }), "fuel", "can30");
      expect(row.treatDrops.map(drop => drop.treats)).toEqual([0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 24, 30, 40, 60, 120]);
      expect(row.treatDrops.every(drop => Number.isInteger(drop.attacks) && drop.attacks >= 0)).toBe(true);
      expect(row.treatDrops.reduce((sum, drop) => sum + drop.attacks, 0)).toBe(row.attacks);
      expect(row.treatDrops.reduce((sum, drop) => sum + drop.treats * drop.attacks, 0)).toBe(row.earnedTreats - (mortalCoil ? 168 : 0));
      const misses = row.treatDrops.find(drop => drop.treats === 0)!.attacks;
      if (weapon === "scary") expect(misses).toBe(0);
      else expect(misses).toBeGreaterThan(0);
      expect(row.profitSamples).toEqual([row.profit]);
    }
    const combinations = new Set([0]);
    for (let bits = 0; bits < 16; bits++) {
      combinations.add([2, 3, 4, 5].reduce((product, factor, index) => product * (bits & (1 << index) ? factor : 1), 1));
    }
    expect([...combinations].sort((a, b) => a - b)).toEqual(HALLOWEEN_TREAT_OUTCOMES);
  });
  it.each([1, 128, 1024])("preserves the actual drop and profit samples across %s runs", runs => {
    const input = settings({ weapon: "revitalize" });
    const row = estimateHalloween(input, "none", "can25", runs);
    const samples = Array.from({ length: runs }, (_, run) => simulateHalloween(input, "none", "can25", (0x6d2b79f5 + Math.imul(run, 0x9e3779b9)) >>> 0));
    expect(row.profitSamples).toEqual(samples.map(sample => sample.profit));
    expect(getHalloweenProfitRange(row.profitSamples)).toEqual(row.profitRange);
    expect(row.profitSamples.reduce((sum, profit) => sum + profit, 0) / runs).toBeCloseTo(row.profit, 3);
    expect(row.treatDrops).toEqual(HALLOWEEN_TREAT_OUTCOMES.map((treats, index) => ({ treats,
      attacks: samples.reduce((sum, sample) => sum + sample.treatDrops[index].attacks, 0) / runs })));
    expect(row.treatDrops.reduce((sum, drop) => sum + drop.attacks, 0)).toBeCloseTo(row.attacks, 8);
    expect(row.treatDrops.reduce((sum, drop) => sum + drop.treats * drop.attacks, 0)).toBeCloseTo(row.earnedTreats - 168, 8);
    const attackTreats = samples.reduce((sum, sample) => sum + sample.earnedTreats - 168, 0);
    const attacks = samples.reduce((sum, sample) => sum + sample.attacks, 0);
    expect(getSimulatedTreatsPerAttack(row)).toBeCloseTo(attackTreats / attacks, 12);
  });
  it.each(["scary", "revitalize"] as const)("averages whole random treats near the theoretical rate with %s", weapon => {
    const input = settings({ weapon, darkPower: false, mortalCoil: false, specialRefills: 100 });
    const mean = estimateHalloween(input, "fuel", "can30");
    expect(mean.simulationRuns).toBe(HALLOWEEN_SIMULATION_RUNS);
    expect(Math.abs(mean.earnedTreats / mean.attacks - mean.treatsPerAttack)).toBeLessThan(0.02);
    expect(getSimulatedTreatsPerAttack(mean)).toBeCloseTo(mean.earnedTreats / mean.attacks, 12);
    const totals = [1, 2, 3, 4].map(seed => simulateHalloween(input, "fuel", "can30", seed).earnedTreats);
    expect(totals.every(Number.isInteger)).toBe(true);
    expect(new Set(totals).size).toBeGreaterThan(1);
    expect(mean.revenue).toBeCloseTo(mean.rewardTreats * input.treatPrice / 1.1, 4);
  });
  it("keeps treat rolls separate from Revitalize rolls and aligned across books", () => {
    const input = settings({ weapon: "revitalize", darkPower: false, mortalCoil: false });
    const highChance = simulateHalloween(input, "none", "none", 57);
    const lowChance = simulateHalloween({ ...input, scaryClothing: false }, "none", "none", 57);
    expect(source(lowChance, "Revitalize returns")).toEqual(source(highChance, "Revitalize returns"));
    expect(lowChance.attacks).toBe(highChance.attacks);
    expect(lowChance.earnedTreats).toBeLessThan(highChance.earnedTreats);
    const noEffectBook = simulateHalloween(input, "fuel", "none", 57);
    expect(noEffectBook.earnedTreats).toBe(highChance.earnedTreats);
    expect(noEffectBook.exchanges).toEqual(highChance.exchanges);
  });
  it("uses repeatable treat drops and 25E Revitalize procs without randomizing prices", () => {
    const input = settings({ weapon: "revitalize", revitalize: 12 });
    const row = simulateHalloween(input, "none", "none", 123);
    expect(simulateHalloween(input, "none", "none", 123)).toEqual(row);
    const returns = source(row, "Revitalize returns")!;
    expect(Number.isInteger(returns.count)).toBe(true);
    expect(returns.energy).toBe(returns.count * 25);
    expect(returns.count).toBeGreaterThan(0);
    expect(returns.count).toBeLessThan(row.attacks);
    expect(Number.isInteger(row.earnedTreats)).toBe(true);
    const changedPrices = simulateHalloween({ ...input, treatPrice: input.treatPrice * 2, drugPrice: 1 }, "none", "none", 123);
    expect(changedPrices.attacks).toBe(row.attacks);
    expect(changedPrices.exchanges).toEqual(row.exchanges);
    expect(source(changedPrices, "Revitalize returns")).toEqual(returns);
    expect(changedPrices.revenue).toBe(row.revenue * 2);
    const procCounts = [1, 2, 3, 4].map(seed => source(simulateHalloween(input, "none", "none", seed), "Revitalize returns")!.count);
    expect(new Set(procCounts).size).toBeGreaterThan(1);
    expect(source(simulateHalloween({ ...input, weapon: "scary" }, "none", "none"), "Revitalize returns")).toBeUndefined();
  });
  it.each([10, 12, 24])("averages repeatable Revitalize runs at %s%% while conserving energy and money", revitalize => {
    const input = settings({ weapon: "revitalize", revitalize, darkPower: false });
    const row = estimateHalloween(input, "none", "can25");
    expect(row.simulationRuns).toBe(HALLOWEEN_SIMULATION_RUNS);
    expect(row.exchanges).toEqual([]); // An average does not have one valid exchange trace.
    const returns = source(row, "Revitalize returns")!;
    expect(Math.abs(returns.count / row.attacks - revitalize / 100)).toBeLessThan(0.005);
    expect(returns.energy).toBeCloseTo(returns.count * 25, 6);
    expect(row.sources.reduce((sum, item) => sum + item.energy, 0)).toBeCloseTo(row.attacks * 25 + row.unusedEnergy, 5);
    expect(row.cost).toBeCloseTo(row.sources.reduce((sum, item) => sum + item.cost, 0), 4);
    expect(row.profit).toBe(row.revenue - row.cost);
    expect(row.timeline.at(-1)!.profit).toBe(row.profit);
    expect(row.earnedTreats + row.cashbackTreats).toBeCloseTo(row.exchangedTreats + row.unexchangedTreats, 5);
    expect(row.revenue).toBeCloseTo(row.rewardTreats * input.treatPrice / 1.1, 4);
    const breakEven = estimateHalloween({ ...input, treatPrice: row.breakEvenTreatPrice }, "none", "can25");
    expect(Math.abs(breakEven.profit)).toBeLessThan(0.001);
    expect(estimateHalloween(input, "none", "can25")).toEqual(row);
  });
  it.each(["scary", "revitalize"] as const)("uses matching repeatable averages for %s comparisons", weapon => {
    const input = settings({ weapon });
    const rows = compareHalloween(input);
    expect(rows.every(row => row.simulationRuns === HALLOWEEN_SIMULATION_RUNS)).toBe(true);
    expect(rows.find(row => row.id === "none:none")).toEqual(estimateHalloween(input, "none", "none"));
    expect(rows.find(row => row.id === "fuel:can25")).toEqual(estimateHalloween(input, "fuel", "can25"));
  });
  it.each(["scary", "revitalize"] as const)("requires the full 25E before attacking with %s", weapon => {
    const input = settings({ weapon, revitalize: 17.3, darkPower: false, mortalCoil: false, drugDelay: 168 });
    // A 24E remainder must wait for more energy; it cannot fund an attack on its own.
    const empty = simulateHalloween({ ...input, startingEnergy: 0 }, "none", "none");
    const short = simulateHalloween({ ...input, startingEnergy: 24 }, "none", "none");
    const full = simulateHalloween({ ...input, startingEnergy: 25 }, "none", "none");
    expect(full.attacks).toBe(empty.attacks + 1);
    expect(short.refills[0]).toMatchObject({ minute: 719, energyBefore: 9, energyAdded: 141 });
    for (const row of [empty, short, full]) {
      expect(Number.isInteger(row.attacks)).toBe(true);
      expect(row.sources.reduce((sum, item) => sum + item.energy, 0)).toBeCloseTo(row.attacks * 25 + row.unusedEnergy, 6);
      expect(row.unusedEnergy).toBeGreaterThanOrEqual(0);
      expect(row.unusedEnergy).toBeLessThan(25);
    }
  });
  it.each(["scary", "revitalize"] as const)("carries energy between claims and charges only whole attacks with %s", weapon => {
    const input = settings({ weapon, revitalize: 17.3, darkPower: false, mortalCoil: false,
      startingEnergy: 0, drugDelay: 168, attackCost: 3000 });
    const row = simulateHalloween(input, "none", "can5");
    expect(Number.isInteger(row.attacks)).toBe(true);
    expect(row.unusedEnergy).toBeGreaterThanOrEqual(0);
    expect(row.unusedEnergy).toBeLessThan(25);
    expect(source(row, "Attack supplies")).toMatchObject({ count: row.attacks, cost: row.attacks * 3000 });
    const externalEnergy = row.sources.filter(item => item.name !== "Revitalize returns").reduce((sum, item) => sum + item.energy, 0);
    const procs = source(row, "Revitalize returns")?.count ?? 0;
    const affordable = Math.floor(externalEnergy / 25) + procs;
    expect(row.attacks).toBe(affordable);
    expect(row.unusedEnergy).toBeCloseTo(externalEnergy + procs * 25 - row.attacks * 25, 6);
    expect(source(row, "5E cans")!.energy).toBe(row.boosterCount * 8);
    // Individual 8E cans cannot fund attacks alone: their remainders must accumulate.
    const noCans = simulateHalloween(input, "none", "none");
    expect(row.attacks).toBeGreaterThan(noCans.attacks);
  });
  it("tops up special refills and FHCs instead of adding a full bar over carried energy", () => {
    const input = settings({ startingEnergy: 24, darkPower: false, mortalCoil: false, drugDelay: 168, specialRefills: 1 });
    const row = simulateHalloween(input, "none", "fhc");
    expect(row.refills[0]).toMatchObject({ source: "FHCs", minute: 0, energyBefore: 24, energyAdded: 126 });
    expect(source(row, "Special refills")).toMatchObject({ count: 1, energy: 150 });
    expect(source(row, "FHCs")!.energy).toBeLessThan(row.boosterCount * 150);
    expect(row.sources.reduce((sum, item) => sum + item.energy, 0)).toBeCloseTo(row.attacks * 25 + row.unusedEnergy, 6);
  });
  it("waits for natural energy to fund a whole attack before refilling at zero", () => {
    const row = simulateHalloween(settings({ startingEnergy: 10, darkPower: false, mortalCoil: false,
      drugDelay: 168, specialRefills: 1 }), "none", "none");
    expect(row.refills.slice(0, 2)).toEqual([
      { source: "Special refills", minute: 29, energyBefore: 0, energyAdded: 150 },
      { source: "Daily point refills", minute: 29, energyBefore: 0, energyAdded: 150 },
    ]);
    expect(source(row, "Daily point refills")!.count).toBe(8);
  });
  it("uses available can energy to reach zero before claiming a daily refill", () => {
    const row = simulateHalloween(settings({ startingEnergy: 9, darkPower: false, mortalCoil: false,
      drugDelay: 168 }), "none", "can5");
    expect(row.refills[0]).toMatchObject({ source: "Daily point refills", minute: 0, energyBefore: 0, energyAdded: 150 });
    expect(row.boosterCount).toBe(108);
  });
  it("falls back at midnight when zero is unreachable", () => {
    // Fractional starting energy cannot reach exactly zero using integer energy sources.
    const row = simulateHalloween(settings({ startingEnergy: 0.5, darkPower: false, mortalCoil: false,
      drugDelay: 168 }), "none", "none");
    expect(row.refills).toHaveLength(8);
    // The first fallback resets the fractional remainder; all later days can reach zero.
    expect(row.refills[0]).toMatchObject({ minute: 719, energyBefore: 10.5, energyAdded: 139.5 });
    expect(row.refills.at(-1)!.minute).toBeLessThan(10080);
  });
  it.each([
    { book: "none" as const, booster: "none", specialRefills: 1, startingEnergy: 1 },
    { book: "higher" as const, booster: "none", specialRefills: 100, startingEnergy: 1000 },
    { book: "ugly" as const, booster: "can25", specialRefills: 100, startingEnergy: 1000 },
  ])("exhausts special refills before daily refills, including midnight top-ups ($book/$booster)", input => {
    for (const seed of [0x6d2b79f5, 14, 1853147974]) {
      const row = simulateHalloween(settings(input), input.book, input.booster, seed);
      let specialsUsed = 0;
      for (const refill of row.refills) {
        if (refill.source === "Special refills") specialsUsed++;
        if (refill.source === "Daily point refills") expect(specialsUsed).toBe(input.specialRefills);
      }
      expect(specialsUsed).toBe(input.specialRefills);
      const daily = row.refills.filter(refill => refill.source === "Daily point refills");
      expect(daily.map(refill => Math.floor((720 + refill.minute) / 1440))).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
      expect(row.sources.reduce((sum, item) => sum + item.energy, 0)).toBeCloseTo(row.attacks * 25 + row.unusedEnergy, 6);
    }
  });
  it("caps one-off energy claims and excludes the overflow from attacks", () => {
    // Production run 39 leaves 5E after attacking the starting stack. The next
    // 1,000E claim must supply 995E, rather than creating an impossible 1,005E bar.
    const row = simulateHalloween(settings({ extraEnergy: 1000 }), "none", "none", 2275345700);
    expect(source(row, "Other one-off energy")?.energy).toBe(995);
    expect(row.wastedClaimEnergy).toBe(5);
    expect(row.attacks).toBe(1002); // The uncapped claim incorrectly funded attack 1,003.
    expect(row.sources.reduce((sum, item) => sum + item.energy, 0)).toBe(row.attacks * 25 + row.unusedEnergy);
    expect(row.exchanges.every(batch => batch.energyBefore + batch.energyReturned <= 1000)).toBe(true);
    const fits = simulateHalloween(settings({ extraEnergy: 995 }), "none", "none", 2275345700);
    expect(fits.wastedClaimEnergy).toBe(0);
    expect(fits.attacks).toBe(row.attacks);
    expect(fits.profit).toBe(row.profit);
  });
  it("averages lost claim energy and preserves the accepted energy ledger", () => {
    const input = settings({ extraEnergy: 1000 });
    const row = estimateHalloween(input, "none", "none");
    const losses = Array.from({ length: HALLOWEEN_SIMULATION_RUNS }, (_, run) =>
      simulateHalloween(input, "none", "none", (0x6d2b79f5 + Math.imul(run, 0x9e3779b9)) >>> 0).wastedClaimEnergy);
    expect(row.wastedClaimEnergy).toBeGreaterThan(0);
    expect(row.wastedClaimEnergy).toBe(losses.reduce((sum, value) => sum + value, 0) / losses.length);
    expect(source(row, "Other one-off energy")!.energy + row.wastedClaimEnergy).toBe(1000);
    expect(row.sources.reduce((sum, item) => sum + item.energy, 0)).toBeCloseTo(row.attacks * 25 + row.unusedEnergy, 6);
  });
  it.each(["scary", "revitalize"] as const)("preserves FHC uses and caps while seeking zero energy with %s", weapon => {
    for (const book of HALLOWEEN_BOOKS) {
      for (const startingCooldown of [0, 48]) {
        const row = simulateHalloween(settings({ weapon, startingCooldown }), book.id, "fhc");
        const cap = book.id === "ugly" ? 250 : 150;
        expect(row.boosterCount).toBe(startingCooldown === 0 ? 36 : 28);
        expect(source(row, "Daily point refills")!.count).toBe(8);
        expect(row.refills.some(refill => refill.energyBefore === 0)).toBe(true);
        for (const refill of row.refills) {
          expect(refill.energyBefore).toBeGreaterThanOrEqual(0);
          expect(refill.energyBefore).toBeLessThan(25);
          expect(refill.energyAdded + refill.energyBefore).toBe(cap);
        }
        expect(row.sources.reduce((sum, item) => sum + item.energy, 0)).toBeCloseTo(row.attacks * 25 + row.unusedEnergy, 6);
      }
    }
  });
  it.each([
    { maxCooldown: 48, startingCooldown: 0, greenEggs: 0, initialFhcs: 8 },
    { maxCooldown: 48, startingCooldown: 48, greenEggs: 0, initialFhcs: 0 },
    { maxCooldown: 24, startingCooldown: 0, greenEggs: 0, initialFhcs: 4 },
    { maxCooldown: 48, startingCooldown: 0, greenEggs: 2, initialFhcs: 6 },
  ])("uses FHCs on cooldown after draining energy ($maxCooldown max, $startingCooldown starting, $greenEggs eggs)", input => {
    const expectedMinutes = [
      ...Array<number>(input.initialFhcs).fill(0),
      ...Array.from({ length: 28 }, (_, index) => 1 + index * 360),
    ];
    for (const weapon of ["scary", "revitalize"] as const) {
      for (const book of HALLOWEEN_BOOKS) {
        const row = simulateHalloween(settings({ ...input, weapon, startingEnergy: 24 }), book.id, "fhc");
        const fhcs = row.refills.filter(refill => refill.source === "FHCs");
        expect(fhcs.map(refill => refill.minute)).toEqual(expectedMinutes);
        expect(fhcs.every(refill => refill.energyBefore >= 0 && refill.energyBefore < 25)).toBe(true);
        expect(row.boosterCount).toBe(expectedMinutes.length);
      }
    }
  });
  it.each(Array.from({ length: 8 }, (_, bits) => ({
    darkPower: Boolean(bits & 1), freebie: Boolean(bits & 2), cashback: Boolean(bits & 4),
  })))("conserves rewards and energy with Dark Power=$darkPower Freebie=$freebie Cashback=$cashback", upgrades => {
    for (const weapon of ["scary", "revitalize"] as const) {
      for (const [book, booster] of [["none", "none"], ["fuel", "can30"]] as const) {
        const input = settings({ ...upgrades, weapon });
        const row = simulateHalloween(input, book, booster);
        const externalEnergy = row.sources.filter(item => !["Dark Power returns", "Revitalize returns"].includes(item.name))
          .reduce((total, item) => total + item.energy, 0);
        const rewardTreats = row.exchanges.reduce((sum, batch) => sum + batch.treats + batch.freebieTreats, 0);
        const darkEnergy = upgrades.darkPower ? rewardTreats * 5 - row.wastedDarkEnergy : 0;
        const revitalizeEnergy = source(row, "Revitalize returns")?.energy ?? 0;
        expect(revitalizeEnergy % 25).toBe(0);
        expect(revitalizeEnergy).toBe((source(row, "Revitalize returns")?.count ?? 0) * 25);
        const attacksWithRemainder = (externalEnergy + darkEnergy + revitalizeEnergy - row.unusedEnergy) / 25;
        expect(row.attacks).toBeCloseTo(attacksWithRemainder, 6);
        expect(Number.isInteger(row.attacks)).toBe(true);
        expect(row.exchangedTreats + row.unexchangedTreats).toBeCloseTo(row.earnedTreats + row.cashbackTreats, 6);
        expect(row.cashbackTreats).toBe(row.exchanges.reduce((sum, batch) => sum + (upgrades.cashback ? Math.floor(batch.treats / 10) : 0), 0));
        expect(source(row, "Dark Power returns")?.energy ?? 0).toBe(darkEnergy);
        expect(row.revenue).toBeCloseTo(rewardTreats * input.treatPrice / 1.1, 3);
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
    expect(disabled.revenue).toBeCloseTo(disabled.exchangedTreats * 750000 / 1.1, 3);
    const freebieRewards = enabled.exchanges.reduce((sum, batch) => sum + batch.freebieTreats, 0);
    expect(enabled.revenue - disabled.revenue).toBeCloseTo(freebieRewards * 750000 / 1.1, 3);
    disabled.timeline.forEach((point, index) => expect(point.profit).toBeLessThanOrEqual(enabled.timeline[index].profit));
  });
  it.each([false, true])("honours disabled Dark Power and Cashback=$cashback during delayed and final exchanges", cashback => {
    const row = simulateHalloween(settings({ darkPower: false, freebie: false, cashback, exchangeHours: 24, sleepHours: 16 }), "none", "none");
    expect(source(row, "Dark Power returns")).toBeUndefined();
    expect(row.wastedDarkEnergy).toBe(0);
    expect(row.exchangedTreats + row.unexchangedTreats).toBeCloseTo(row.earnedTreats + row.cashbackTreats, 6);
    expect(row.cashbackTreats).toBe(row.exchanges.reduce((sum, batch) => sum + (cashback ? Math.floor(batch.treats / 10) : 0), 0));
    expect(row.revenue).toBeCloseTo(row.exchangedTreats * 750000 / 1.1, 3);
  });
  it.each(["scary", "revitalize"] as const)("toggles Mortal Coil's hourly treats and recycled energy with %s", weapon => {
    // Disable energy feedback to isolate the deterministic hourly treats from random drops.
    const enabled = compareSingleRuns(settings({ weapon, mortalCoil: true, darkPower: false }));
    const disabled = compareSingleRuns(settings({ weapon, mortalCoil: false, darkPower: false }));
    expect(DEFAULT_HALLOWEEN.mortalCoil).toBe(true);
    enabled.forEach((row, index) => {
      const without = disabled[index];
      expect(row.earnedTreats - without.earnedTreats).toBe(168);
      expect(row.treatsPerAttack).toBe(without.treatsPerAttack);
      expect(row.cost).toBe(without.cost);
      expect(row.boosterCount).toBe(without.boosterCount);
      expect(row.exchangedTreats).toBeGreaterThan(without.exchangedTreats);
      expect(source(row, "Dark Power returns")).toBeUndefined();
      expect(row.attacks).toBe(without.attacks);
      expect(row.profit).toBeGreaterThan(without.profit);
      expect(without.earnedTreats + without.cashbackTreats).toBeCloseTo(without.exchangedTreats + without.unexchangedTreats, 5);
    });
  });
  it.each([
    { basketLevel: "spooky", rates: [0.947232, 0.775008, 0.775008, 0.602784] },
    { basketLevel: "creepy", rates: [1.033344, 0.86112, 0.86112, 0.688896] },
    { basketLevel: "freaky", rates: [1.119456, 0.947232, 0.947232, 0.775008] },
    { basketLevel: "frightful", rates: [1.205568, 1.033344, 1.033344, 0.86112] },
    { basketLevel: "haunting", rates: [1.29168, 1.119456, 1.119456, 0.947232] },
    { basketLevel: "shocking", rates: [1.377792, 1.205568, 1.205568, 1.033344] },
    { basketLevel: "terrifying", rates: [1.463904, 1.29168, 1.29168, 1.119456] },
    { basketLevel: "horrifying", rates: [1.550016, 1.377792, 1.377792, 1.205568] },
    { basketLevel: "petrifying", rates: [1.636128, 1.463904, 1.463904, 1.29168] },
    { basketLevel: "nightmarish", rates: [1.72224, 1.550016, 1.550016, 1.377792] },
    { basketLevel: "apocalyptic", rates: [1.72224, 1.550016, 1.550016, 1.377792] },
  ] as { basketLevel: HalloweenBasket; rates: number[] }[])("keeps $basketLevel treat rates fixed for the full event", ({ basketLevel, rates }) => {
    const variants = [
      { weapon: "scary", scaryClothing: true }, { weapon: "revitalize", scaryClothing: true },
      { weapon: "scary", scaryClothing: false }, { weapon: "revitalize", scaryClothing: false },
    ] as const;
    variants.forEach((variant, index) => {
      const row = simulateHalloween(settings({ ...variant, basketLevel, specialRefills: 100 }), "fuel", "can30");
      expect(row.treatsPerAttack).toBeCloseTo(rates[index], 10);
      // Enough earned treats to cross early basket thresholds, but the rate never changes.
      expect(row.earnedTreats).toBeGreaterThan(500);
      expect(Number.isInteger(row.earnedTreats)).toBe(true);
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
    const rows = compareSingleRuns(settings());
    expect(rows).toHaveLength(40);
    expect(new Set(rows.map(row => row.id)).size).toBe(40);
    expect(rows.every(row => Number.isFinite(row.profit))).toBe(true);
  });
  it("conserves money, energy and treats including recursive reward returns", () => {
    for (const weapon of ["scary", "revitalize"] as const) {
      const result = simulateHalloween(settings({ weapon, attackCost: 3000 }), "fuel", "can25");
      expect(result.revenue).toBeCloseTo(result.exchangedTreats * result.effectiveTreatPrice, 3);
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
    for (const result of compareSingleRuns(settings())) {
      expect(source(result, "Daily point refills")).toMatchObject({ count: 8, cost: 0 });
      const cap = result.book === "ugly" ? 250 : 150;
      expect(source(result, "Daily point refills")!.energy).toBeGreaterThan(8 * (cap - 25));
      expect(source(result, "Daily point refills")!.energy).toBeLessThanOrEqual(8 * cap);
      expect(source(result, "Starting energy")?.energy).toBe(1000);
      expect(source(result, "Xanax")).toMatchObject({ count: 21, energy: 5250, cost: 21 * 875000 });
    }
  });
  it("still uses all daily refills when an entire partial event day is inactive", () => {
    for (const sleepStart of [0, 10]) {
      const result = simulateHalloween(settings({ sleepStart, sleepHours: 16 }), "ugly", "none");
      expect(source(result, "Daily point refills")).toMatchObject({ count: 8, cost: 0 });
      expect(source(result, "Daily point refills")!.energy).toBeGreaterThan(8 * 225);
      expect(source(result, "Daily point refills")!.energy).toBeLessThanOrEqual(2000);
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
    expect(source(ugly, "FHCs")!.energy).toBeGreaterThan(ugly.boosterCount * 225);
    expect(source(ugly, "FHCs")!.energy).toBeLessThanOrEqual(ugly.boosterCount * 250);
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
    expect(row.treatsPerAttack).toBeCloseTo(expectedRate, 10);
    expect(source(row, "Revitalize returns")?.energy).toBe(source(row, "Revitalize returns")!.count * 25);
    expect(source(row, "Revitalize returns")!.count).toBeLessThan(row.attacks);
  });
  it.each([
    { weapon: "scary" as const, scaryClothing: true, expectedRate: 1.72224 },
    { weapon: "revitalize" as const, scaryClothing: true, expectedRate: 1.550016 },
    { weapon: "scary" as const, scaryClothing: false, expectedRate: 1.550016 },
    { weapon: "revitalize" as const, scaryClothing: false, expectedRate: 1.377792 },
  ])("excludes Cat in Hell with $weapon and scary clothing $scaryClothing", ({ weapon, scaryClothing, expectedRate }) => {
    const row = simulateHalloween(settings({ weapon, scaryClothing }), "none", "none");
    expect(row.treatsPerAttack).toBeCloseTo(expectedRate, 10);
    expect(row.treatsPerAttack).toBeCloseTo(expectedRate, 10);
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
  it.each([false, true])("prefers multiples of ten until 120 and respects the energy cap (Freebie=$freebie)", freebie => {
    for (const weapon of ["scary", "revitalize"] as const) {
      for (const row of compareSingleRuns(settings({ freebie, weapon, greenEggs: 2, extraEnergy: 1000 }))) {
        expect(row.exchanges.length).toBeGreaterThan(0);
        let exchanged = 0, cashback = 0, darkEnergy = 0;
        for (const batch of row.exchanges) {
          expect(batch.treats).toBeGreaterThan(0);
          expect(Number.isInteger(batch.treats)).toBe(true);
          if (batch.minute < 10020) {
            expect(batch.treats).toBeGreaterThanOrEqual(100);
            if (batch.treats < 120) expect(batch.treats % 10).toBe(0);
          } else if (batch.minute < 10079) {
            expect(batch.treats).toBeGreaterThanOrEqual(10);
            if (batch.treats < 120 && batch.treats % 10 !== 0) expect(batch.energyBefore).toBeLessThan(25);
          }
          expect(batch.freebieTreats).toBe(freebie ? Math.floor(batch.treats / 10) : 0);
          expect(batch.cashbackTreats).toBe(Math.floor(batch.treats / 10));
          expect(batch.energyReturned + batch.energyWasted).toBe((batch.treats + batch.freebieTreats) * 5);
          if (batch.energyWasted && !batch.afterEvent) {
            expect((batch.treats + batch.freebieTreats) * 5).toBeGreaterThan(1000);
            expect(batch.energyBefore).toBeLessThan(25);
          }
          expect(batch.energyBefore).toBeGreaterThanOrEqual(0);
          expect(batch.energyBefore + batch.energyReturned).toBeLessThanOrEqual(1000);
          exchanged += batch.treats; cashback += batch.cashbackTreats; darkEnergy += batch.energyReturned;
        }
        expect(exchanged).toBe(row.exchangedTreats);
        expect(cashback).toBe(row.cashbackTreats);
        expect(darkEnergy).toBe(source(row, "Dark Power returns")?.energy);
        expect(row.unexchangedTreats).toBeGreaterThanOrEqual(0);
        expect(row.unexchangedTreats, row.id).toBeLessThan(200);
        expect(row.earnedTreats + cashback).toBeCloseTo(exchanged + row.unexchangedTreats, 6);
      }
    }
  });
  it("accounts for the energy already held when exchanging a stacked basket", () => {
    // A stacked claim can require spending more energy before the whole basket fits.
    const row = simulateHalloween(settings({ extraEnergy: 1000 }), "none", "none");
    const first = row.exchanges[0];
    expect(first.treats).toBeGreaterThanOrEqual(100);
    expect(first.energyBefore).toBeGreaterThan(0);
    expect(first.energyBefore + first.energyReturned).toBeLessThanOrEqual(1000);
    expect(first.cashbackTreats).toBe(Math.floor(first.treats / 10));
    expect(first.freebieTreats).toBe(Math.floor(first.treats / 10));
    expect(first.energyReturned).toBe((first.treats + first.freebieTreats) * 5);
  });
  it.each([false, true])("recovers from oversized random drops and records only unavoidable cap waste (Freebie=$freebie)", freebie => {
    let foundOverflow = false;
    for (let seed = 0; seed < 256 && !foundOverflow; seed++) {
      const row = simulateHalloween(settings({ freebie, specialRefills: 100 }), "fuel", "can30", seed);
      const index = row.exchanges.findIndex(batch => batch.energyWasted > 0);
      if (index < 0) continue;
      foundOverflow = true;
      const batch = row.exchanges[index];
      const nominalEnergy = (batch.treats + batch.freebieTreats) * 5;
      expect(nominalEnergy).toBeGreaterThan(1000);
      expect(batch.energyBefore).toBeGreaterThanOrEqual(0);
      expect(batch.energyBefore).toBeLessThan(25);
      expect(batch.energyBefore + batch.energyReturned).toBe(1000);
      expect(batch.energyWasted).toBe(nominalEnergy - batch.energyReturned);
      expect(row.exchanges.length).toBeGreaterThan(index + 1); // No permanently blocked basket.
      expect(row.wastedDarkEnergy).toBe(row.exchanges.reduce((sum, item) => sum + item.energyWasted, 0));
      expect(source(row, "Dark Power returns")!.energy + row.wastedDarkEnergy).toBe(row.rewardTreats * 5);
      expect(row.sources.reduce((sum, item) => sum + item.energy, 0)).toBe(row.attacks * 25 + row.unusedEnergy);
      expect(row.earnedTreats + row.cashbackTreats).toBe(row.exchangedTreats + row.unexchangedTreats);
    }
    expect(foundOverflow).toBe(true);
  });
  it("tries 100 and 110 before exchanging overshoots of 120 without waiting for 130", () => {
    let skippedTarget = false;
    for (const row of compareSingleRuns(settings())) {
      expect(row.exchanges.filter(batch => batch.minute < 10020).every(batch => batch.treats >= 120 || [100, 110].includes(batch.treats))).toBe(true);
      if (row.exchanges.some(batch => batch.treats > 120 && batch.treats % 10 !== 0)) skippedTarget = true;
      expect(row.unexchangedTreats).toBeGreaterThanOrEqual(0);
      expect(row.unexchangedTreats, row.id).toBeLessThan(120);
    }
    expect(skippedTarget).toBe(true);
  });
  it.each([
    { book: "none" as const, booster: "none", treats: 201, waste: 105, attacks: 2042, fhcs: 0 },
    { book: "ugly" as const, booster: "fhc", treats: 196, waste: 75, attacks: 3431, fhcs: 36 },
  ])("exchanges an overflowing basket before adding more refills ($book/$booster)", input => {
    // Production run 89 previously spent the remaining refills before exchanging,
    // wasting 3,940E / 8,675E. Only the original oversized drop should be clipped.
    const row = simulateHalloween(settings({ specialRefills: 100 }), input.book, input.booster, 1853147974);
    const overflows = row.exchanges.filter(batch => batch.energyWasted > 0);
    expect(overflows).toHaveLength(1);
    expect(overflows[0]).toMatchObject({ treats: input.treats, energyBefore: 0,
      energyReturned: 1000, energyWasted: input.waste, afterEvent: false });
    expect(row.wastedDarkEnergy).toBe(input.waste);
    expect(row.attacks).toBe(input.attacks);
    expect(source(row, "Special refills")?.count).toBe(100);
    expect(source(row, "Daily point refills")?.count).toBe(8);
    expect(row.boosterCount).toBe(input.fhcs);
    expect(row.sources.reduce((sum, item) => sum + item.energy, 0)).toBe(row.attacks * 25 + row.unusedEnergy);
  });
  it("cashes out leftover treats and Cashback without attacking after the event", () => {
    const row = simulateHalloween(settings({ sleepStart: 10, sleepHours: 8 }), "none", "none");
    expect(row.unexchangedTreats).toBe(0);
    const cashouts = row.exchanges.filter(batch => batch.afterEvent);
    expect(cashouts.length).toBeGreaterThan(0);
    for (const batch of cashouts) {
      expect(batch.minute).toBe(10080);
      expect(batch.attacksBefore).toBe(row.attacks);
    }
    expect(cashouts.at(-1)!.cashbackTreats).toBe(0);
    expect(row.revenue).toBeCloseTo(row.exchangedTreats * row.effectiveTreatPrice, 5);
    expect(Number.isInteger(row.earnedTreats)).toBe(true);
    expect(row.sources.reduce((sum, item) => sum + item.energy, 0)).toBeCloseTo(row.attacks * 25 + row.unusedEnergy, 5);
    expect(row.exchanges.filter(batch => batch.afterEvent).reduce((sum, batch) => sum + batch.energyReturned, 0))
      .toBeLessThanOrEqual(row.unusedEnergy);
  });
  it("uses smaller final-hour batches to fund more attacks, then clears tiny baskets", () => {
    const row = simulateHalloween(settings(), "none", "none");
    const cleanup = row.exchanges.filter(batch => batch.minute >= 10020 && batch.minute < 10079);
    expect(cleanup.some(batch => batch.treats < 100)).toBe(true);
    expect(cleanup.some(batch => batch.energyReturned >= 25 && row.attacks > batch.attacksBefore)).toBe(true);
    expect(row.exchanges.some(batch => batch.minute === 10079 && batch.treats < 10)).toBe(true);
    expect(row.unexchangedTreats).toBe(0);
    expect(row.exchangedTreats).toBe(row.earnedTreats + row.cashbackTreats);
    expect(row.timeline.at(-1)!.profit).toBe(row.profit);
  });
  it.each(Array.from({ length: 8 }, (_, bits) => ({
    darkPower: Boolean(bits & 1), freebie: Boolean(bits & 2), cashback: Boolean(bits & 4),
  })))("finishes cleanup with whole rounded rewards (Dark Power=$darkPower Freebie=$freebie Cashback=$cashback)", upgrades => {
    const row = simulateHalloween(settings({ ...upgrades, weapon: "revitalize" }), "fuel", "can25");
    expect(row.unexchangedTreats).toBe(0);
    let rewards = 0, returnedEnergy = 0;
    for (const batch of row.exchanges) {
      expect(batch.freebieTreats).toBe(upgrades.freebie ? Math.floor(batch.treats / 10) : 0);
      expect(batch.cashbackTreats).toBe(upgrades.cashback ? Math.floor(batch.treats / 10) : 0);
      expect(batch.energyBefore + batch.energyReturned).toBeLessThanOrEqual(1000);
      rewards += batch.treats + batch.freebieTreats;
      returnedEnergy += batch.energyReturned;
    }
    expect(row.rewardTreats).toBe(rewards);
    expect(row.revenue).toBeCloseTo(rewards * DEFAULT_HALLOWEEN.treatPrice / 1.1, 4);
    expect(source(row, "Dark Power returns")?.energy ?? 0).toBe(returnedEnergy);
    expect(row.sources.reduce((sum, item) => sum + item.energy, 0)).toBe(row.attacks * 25 + row.unusedEnergy);
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
