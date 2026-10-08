import { describe, expect, it } from "vitest";
import { originalRankedTarget, previewFinalScore, previewTargetsForLead, rankedFinishAt, rankedTargetAt, rankedTargetFraction } from "./warProgress";

const start = 1_000_000;
const at = (hours: number) => start + hours * 3600;
describe("ranked war fixed-score finishes", () => {
  it("starts whole hourly reductions at hour 24, without compounding or rounding", () => {
    expect(rankedTargetFraction(start, at(24) - 1)).toBe(1);
    expect(rankedTargetFraction(start, at(24))).toBe(.99);
    expect(rankedTargetFraction(start, at(25) - 1)).toBe(.99);
    expect(rankedTargetFraction(start, at(25))).toBe(.98);
    expect(rankedTargetAt(12345.67, start, at(24))).toBeCloseTo(12222.2133, 6);
    expect(rankedTargetFraction(start, at(48))).toBe(.75);
    expect(rankedTargetFraction(start, at(122))).toBe(.01);
    expect(rankedTargetFraction(start, at(123))).toBe(0);
    expect(rankedTargetFraction(start, at(124))).toBe(0);
    expect(rankedTargetFraction(start, at(125))).toBe(0);
  });
  it("recovers an original target from an already-decayed target", () => {
    expect(originalRankedTarget(9108, start, at(24))).toBe(9200);
    expect(originalRankedTarget(7500, start, at(48))).toBe(10000);
    expect(originalRankedTarget(123.4567, start, at(122))).toBeCloseTo(12345.67);
    expect(originalRankedTarget(0, start, at(123))).toBeNull();
  });
  it("finds the first hourly intersection for either winning side", () => {
    expect(rankedFinishAt(10000, start, 9900, at(23))).toBe(at(24));
    expect(rankedFinishAt(10000, start, 5000, at(48))).toBe(at(73));
    expect(rankedFinishAt(10000, start, 6500, at(48))).toBe(at(58));
    expect(rankedFinishAt(10000, start, -5300, at(48))).toBe(at(70));
    expect(rankedFinishAt(10000, start, 6400.1, at(48))).toBe(at(59));
    expect(rankedFinishAt(10000, start, .1, at(48))).toBe(at(123));
  });
  it("matches the Karma Chameleons decay threshold and finish", () => {
    const warStart = Date.parse("2026-09-26T19:00:00Z") / 1000;
    const observedAt = Date.parse("2026-09-28T18:30:00Z") / 1000;
    const finish = Date.parse("2026-09-28T19:00:00Z") / 1000;
    expect(rankedTargetAt(9200, warStart, finish)).toBe(6900);
    expect(rankedFinishAt(9200, warStart, 6880, observedAt)).toBe(finish + 3600);
    expect(rankedFinishAt(9200, warStart, 6928, observedAt)).toBe(finish);
  });
  it("handles reached targets, scheduled wars, ties, and absent targets", () => {
    expect(rankedFinishAt(10000, start, 8000, at(48.5))).toBe(at(48.5));
    expect(rankedFinishAt(10000, start, 10000, at(-2))).toBe(start);
    expect(rankedFinishAt(10000, start, 0, at(124))).toBeNull();
    expect(rankedFinishAt(null, start, 5000, at(48))).toBeNull();
  });
  it("uses current scores for blank or exceeded targets and rejects invalid input", () => {
    expect(previewFinalScore(8200, "")).toBe(8200);
    expect(previewFinalScore(8200, "1000")).toBe(8200);
    expect(previewFinalScore(8200, "9700.25")).toBe(9700.25);
    expect(previewFinalScore(8200, "-1")).toBeNull();
    expect(previewFinalScore(8200, "Infinity")).toBeNull();
    expect(previewFinalScore(8200, "1e308")).toBeNull();
  });
});

describe("dragging planned net respect", () => {
  it("allows either faction to lead before the war without negative targets", () => {
    expect(previewTargetsForLead(0, 0, 0, 0, -5000)).toEqual({ home: 0, enemy: 5000 });
    expect(previewTargetsForLead(0, 0, 0, 0, 5000)).toEqual({ home: 5000, enemy: 0 });
  });

  it("raises the enemy target once lowering home would pass its current score", () => {
    expect(previewTargetsForLead(8200, 3200, 9700, 3200, -2000)).toEqual({ home: 8200, enemy: 10200 });
    expect(previewTargetsForLead(8200, 3200, 9700, 3200, 0)).toEqual({ home: 8200, enemy: 8200 });
  });

  it("preserves shared planned respect and reverses without inflating targets", () => {
    const enemyLead = previewTargetsForLead(8200, 3200, 9700, 4200, -2000);
    expect(enemyLead).toEqual({ home: 9200, enemy: 11200 });
    expect(previewTargetsForLead(8200, 3200, enemyLead.home, enemyLead.enemy, 5500)).toEqual({ home: 9700, enemy: 4200 });
  });

  it("respects fractional current scores and safe numeric limits", () => {
    const targets = previewTargetsForLead(8200.25, 3200.5, 8200.25, 3200.5, -100);
    expect(targets).toEqual({ home: 8200.25, enemy: 8300.25 });
    const extreme = previewTargetsForLead(100, 200, 300, 400, Number.MAX_SAFE_INTEGER);
    expect(extreme.home).toBe(Number.MAX_SAFE_INTEGER);
    expect(extreme.enemy).toBe(200);
  });
});
