import { describe, expect, it } from "vitest";
import { HalloweenTreatOriginTracker, HALLOWEEN_RETURN_ROUNDS } from "./halloweenTreatOrigins";
import { DEFAULT_HALLOWEEN, estimateHalloween, simulateHalloween } from "./halloweenProfit";

describe("Halloween treat origin tracking", () => {
  it("tracks successive Cashback and Dark Power rounds without counting unspent returned energy", () => {
    const tracker = new HalloweenTreatOriginTracker();
    tracker.addDirectEnergy(25);
    tracker.recordAttack(10, 0);
    tracker.recordExchange(10, 1, 55);
    tracker.recordAttack(2, 0);
    tracker.recordExchange(3, 0, 15);
    expect(tracker.result()).toEqual({ energyRounds: [10, 3, 0, 0, 0, 0, 0], mortalCoil: 0, energyFreebieRewards: 0 });
    // FIFO spends the remaining 30E from round one before the round-two lot.
    tracker.recordAttack(1, 0);
    tracker.recordExchange(1, 0, 0);
    tracker.addDirectEnergy(5);
    tracker.recordAttack(5, 0); // 5E round one, 15E round two, 5E original energy.
    tracker.recordExchange(5, 0, 0);
    expect(tracker.result()).toEqual({ energyRounds: [11, 5, 3, 0, 0, 0, 0], mortalCoil: 0, energyFreebieRewards: 0 });
  });

  it("attributes Revitalize returns even after zero-treat attacks and retains late generations", () => {
    const tracker = new HalloweenTreatOriginTracker();
    tracker.addDirectEnergy(25);
    tracker.recordAttack(0, 25);
    for (let i = 0; i < 7; i++) {
      tracker.recordAttack(1, 25);
      tracker.recordExchange(1, 0, 0);
    }
    expect(tracker.result()).toEqual({ energyRounds: [0, 1, 1, 1, 1, 1, 2], mortalCoil: 0, energyFreebieRewards: 0 });
  });

  it("splits already-rounded exchange bonuses and accepted energy without rounding origins separately", () => {
    const tracker = new HalloweenTreatOriginTracker();
    tracker.addDirectEnergy(25);
    tracker.recordAttack(9, 0);
    tracker.addMortalCoilTreat();
    tracker.recordExchange(10, 1, 25, 1); // Only 25E accepted, even if more was generated.
    tracker.recordAttack(10, 25);
    tracker.recordExchange(11, 0, 0, 1);
    tracker.recordAttack(10, 0);
    tracker.recordExchange(10, 0, 0, 1);
    const result = tracker.result();
    expect(result.energyRounds[0]).toBe(9);
    expect(result.energyRounds[1]).toBeCloseTo(9.9, 12);
    expect(result.energyRounds[2]).toBeCloseTo(9, 12);
    expect(result.mortalCoil).toBeCloseTo(3.1, 12);
    expect(result.energyFreebieRewards).toBeCloseTo(2.7, 12); // 0.9 of each rounded bonus belongs to energy.
    expect(result.energyRounds.reduce((a, b) => a + b, result.mortalCoil)).toBeCloseTo(31, 12);
  });

  it("keeps pure Mortal Coil and its descendants separate from supplied energy", () => {
    const tracker = new HalloweenTreatOriginTracker();
    for (let i = 0; i < 10; i++) tracker.addMortalCoilTreat();
    tracker.recordExchange(10, 1, 55, 1);
    tracker.recordAttack(2, 25);
    tracker.recordExchange(3, 0, 15);
    tracker.recordAttack(1, 0);
    tracker.recordExchange(1, 0, 0);
    expect(tracker.result()).toEqual({ energyRounds: [0, 0, 0, 0, 0, 0, 0], mortalCoil: 14, energyFreebieRewards: 0 });
  });

  it("carries fractional energy across lots and fails if simulator actions lack an origin", () => {
    const tracker = new HalloweenTreatOriginTracker();
    tracker.addDirectEnergy(0.5);
    tracker.addDirectEnergy(24.5);
    tracker.recordAttack(1, 0);
    tracker.recordExchange(1, 0, 0);
    expect(tracker.result().energyRounds[0]).toBe(1);
    expect(() => tracker.recordAttack(1, 0)).toThrow("energy is missing");
    expect(() => new HalloweenTreatOriginTracker().recordExchange(1, 0, 0)).toThrow("missing their origin");
  });

  it.each(["scary", "revitalize"] as const)("reconciles every upgrade combination with %s", weapon => {
    for (let bits = 0; bits < 16; bits++) {
      const input = { ...DEFAULT_HALLOWEEN, weapon, mortalCoil: Boolean(bits & 1), darkPower: Boolean(bits & 2),
        cashback: Boolean(bits & 4), freebie: Boolean(bits & 8) };
      const row = simulateHalloween(input, "ugly", "fhc", 14, true);
      const { energyRounds, mortalCoil, energyFreebieRewards } = row.treatOrigins!;
      expect(energyRounds.every(value => Number.isFinite(value) && value >= 0)).toBe(true);
      expect(energyRounds.reduce((a, b) => a + b, mortalCoil)).toBeCloseTo(row.exchangedTreats, 8);
      if (!input.mortalCoil) expect(mortalCoil).toBe(0);
      const totalFreebie = row.rewardTreats - row.exchangedTreats;
      expect(energyFreebieRewards).toBeGreaterThanOrEqual(0);
      expect(energyFreebieRewards).toBeLessThanOrEqual(totalFreebie + 1e-8);
      if (!input.freebie) expect(energyFreebieRewards).toBe(0);
      if (!input.mortalCoil) expect(energyFreebieRewards).toBeCloseTo(totalFreebie, 8);
      if (!input.darkPower && !input.cashback && weapon === "scary") {
        expect(energyRounds.slice(1).every(value => value === 0)).toBe(true);
        expect(mortalCoil).toBe(input.mortalCoil ? 168 : 0);
      }
    }
  });

  it.each([1, 128, 1024])("averages the same recorded origins across %s runs", runs => {
    const input = { ...DEFAULT_HALLOWEEN, weapon: "revitalize" as const, startingEnergy: 0.5 };
    const row = estimateHalloween(input, "fuel", "can25", runs, true);
    const sums = Array(HALLOWEEN_RETURN_ROUNDS + 2).fill(0);
    for (let run = 0; run < runs; run++) {
      const one = simulateHalloween(input, "fuel", "can25", (0x6d2b79f5 + Math.imul(run, 0x9e3779b9)) >>> 0, true);
      [...one.treatOrigins!.energyRounds, one.treatOrigins!.mortalCoil, one.treatOrigins!.energyFreebieRewards].forEach((value, i) => { sums[i] += value; });
    }
    expect([...row.treatOrigins!.energyRounds, row.treatOrigins!.mortalCoil, row.treatOrigins!.energyFreebieRewards]).toEqual(sums.map(value => value / runs));
    expect(row.treatOrigins!.energyRounds.reduce((a, b) => a + b, row.treatOrigins!.mortalCoil)).toBeCloseTo(row.exchangedTreats, 8);
    // Lazy tracing must reuse precisely the same simulation outcomes as the table.
    const { treatOrigins, ...untraced } = row;
    expect(treatOrigins).toBeDefined();
    expect(untraced).toEqual(estimateHalloween(input, "fuel", "can25", runs));
  });
});
