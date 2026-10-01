import { describe, expect, it } from "vitest";
import { parseNumber } from "./numberInput";
import { parseNumber as bookStrategyParseNumber } from "../views/BookStrategy.helpers";

describe("shared shorthand number inputs", () => {
  it.each([
    ["100m", 100_000_000], ["2.3b", 2_300_000_000], ["900K", 900_000], ["1.5T", 1_500_000_000_000],
    [" $ 2.3 B ", 2_300_000_000], ["100,000,000", 100_000_000], ["2_300_000_000", 2_300_000_000],
    ["0", 0], ["0m", 0], [".5m", 500_000], ["-2m", -2_000_000], ["5%", 5],
  ])("parses %s as %s", (value, expected) => {
    expect(parseNumber(value, Number.NaN)).toBe(expected);
    expect(bookStrategyParseNumber(value, Number.NaN)).toBe(expected);
  });

  it.each(["", "   ", "$", "m", "2.3bb", "12abc", "Infinity", "1.2.3m"])("retains the caller's fallback for invalid input %s", value => {
    expect(parseNumber(value, 42)).toBe(42);
    expect(parseNumber(value, Number.NaN)).toBeNaN();
  });
});
