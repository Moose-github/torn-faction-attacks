import { describe, expect, it } from "vitest";
import {
  boolToInt,
  cleanText,
  d1Changes,
  finiteNumber,
  normalizeAttacks,
  parseLimit,
} from "./utils";

describe("parseLimit", () => {
  it("uses the fallback for missing, invalid, and non-positive values", () => {
    expect(parseLimit(null, 50, 100)).toBe(50);
    expect(parseLimit("abc", 50, 100)).toBe(50);
    expect(parseLimit("0", 50, 100)).toBe(50);
    expect(parseLimit("-3", 50, 100)).toBe(50);
  });

  it("floors valid values and caps them at the max", () => {
    expect(parseLimit("12.9", 50, 100)).toBe(12);
    expect(parseLimit("500", 50, 100)).toBe(100);
  });
});

describe("small utility normalizers", () => {
  it("converts optional booleans to D1-friendly integers", () => {
    expect(boolToInt(true)).toBe(1);
    expect(boolToInt(false)).toBe(0);
    expect(boolToInt(undefined)).toBeNull();
  });

  it("parses finite numbers and rejects non-numeric values", () => {
    expect(finiteNumber("42.5")).toBe(42.5);
    expect(finiteNumber(Number.POSITIVE_INFINITY)).toBeNull();
    expect(finiteNumber("not a number")).toBeNull();
  });

  it("cleans text into trimmed non-empty strings", () => {
    expect(cleanText("  MatzStonks  ")).toBe("MatzStonks");
    expect(cleanText("   ")).toBeNull();
    expect(cleanText(2566807)).toBeNull();
  });

  it("reads D1 changes from result metadata", () => {
    expect(d1Changes({ meta: { changes: 3 } })).toBe(3);
    expect(d1Changes({ meta: { changes: "3" } })).toBe(0);
    expect(d1Changes(null)).toBe(0);
  });
});

describe("normalizeAttacks", () => {
  it("normalizes missing, array, and keyed Torn attack payloads", () => {
    const attack = { id: 1, started: 100 };
    const secondAttack = { id: 2, started: 200 };

    expect(normalizeAttacks(undefined)).toEqual([]);
    expect(normalizeAttacks([attack])).toEqual([attack]);
    expect(normalizeAttacks({ one: attack, two: secondAttack })).toEqual([attack, secondAttack]);
  });
});
