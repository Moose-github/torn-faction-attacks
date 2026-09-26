import { describe, expect, it } from "vitest";
import { originalRankedTarget, previewFinalScore, rankedFinishAt, rankedTargetAt, rankedTargetFraction } from "./warProgress";

const start = 1_000_000;
const at = (hours: number) => start + hours * 3600;
describe("ranked war fixed-score finishes", () => {
  it("uses whole hourly reductions after the first 24 hours, without compounding or rounding", () => {
    expect(rankedTargetFraction(start, at(24))).toBe(1);
    expect(rankedTargetFraction(start, at(25) - 1)).toBe(1);
    expect(rankedTargetAt(12345.67, start, at(25))).toBeCloseTo(12222.2133, 6);
    expect(rankedTargetFraction(start, at(48))).toBe(.76);
    expect(rankedTargetFraction(start, at(123))).toBe(.01);
    expect(rankedTargetFraction(start, at(124))).toBe(0);
    expect(rankedTargetFraction(start, at(125))).toBe(0);
  });
  it("recovers an original target from an already-decayed target", () => {
    expect(originalRankedTarget(7600, start, at(48))).toBe(10000);
    expect(originalRankedTarget(123.4567, start, at(123))).toBeCloseTo(12345.67);
    expect(originalRankedTarget(0, start, at(124))).toBeNull();
  });
  it("finds the first hourly intersection for either winning side", () => {
    expect(rankedFinishAt(10000, start, 5000, at(48))).toBe(at(74));
    expect(rankedFinishAt(10000, start, 6500, at(48))).toBe(at(59));
    expect(rankedFinishAt(10000, start, -5300, at(48))).toBe(at(71));
    expect(rankedFinishAt(10000, start, 6400.1, at(48))).toBe(at(60));
    expect(rankedFinishAt(10000, start, .1, at(48))).toBe(at(124));
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
