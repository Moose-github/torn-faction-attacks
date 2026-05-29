import { describe, expect, it } from "vitest";
import {
  boundedInteger,
  boundedNumber,
  cleanString,
  finitePositiveNumber,
  isRecord,
  positiveCurrencyOrNull,
  positiveInteger,
  positiveIntegerOrNull,
  readJsonObject,
  validPositiveId,
} from "./request";

describe("readJsonObject", () => {
  it("returns parsed JSON objects and ignores non-object bodies", async () => {
    await expect(readJsonObject(jsonRequest({ ok: true }))).resolves.toEqual({ ok: true });
    await expect(readJsonObject(jsonRequest(["nope"]))).resolves.toEqual({});
  });

  it("returns an empty object for non-json or invalid bodies", async () => {
    await expect(readJsonObject(new Request("https://example.test", { method: "POST", body: "plain" }))).resolves.toEqual({});
    await expect(readJsonObject(new Request("https://example.test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    }))).resolves.toEqual({});
  });
});

describe("request primitive parsers", () => {
  it("identifies records without accepting arrays or null", () => {
    expect(isRecord({ value: 1 })).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
  });

  it("parses positive integers with null or fallback variants", () => {
    expect(positiveInteger("12.9", 1)).toBe(12);
    expect(positiveInteger("bad", 1)).toBe(1);
    expect(positiveIntegerOrNull("7")).toBe(7);
    expect(positiveIntegerOrNull("0")).toBeNull();
  });

  it("parses positive numeric values", () => {
    expect(positiveCurrencyOrNull("42.25")).toBe(42.25);
    expect(positiveCurrencyOrNull("-1")).toBeNull();
    expect(finitePositiveNumber(3)).toBe(3);
    expect(finitePositiveNumber(Number.NaN)).toBeNull();
  });

  it("bounds numbers and validates IDs", () => {
    expect(boundedInteger("12.8", 1, 10, 5)).toBe(10);
    expect(boundedInteger("bad", 1, 10, 5)).toBe(5);
    expect(boundedNumber("0.5", 1, 10, 5)).toBe(1);
    expect(validPositiveId(42)).toBe(true);
    expect(validPositiveId(0)).toBe(false);
  });

  it("cleans strings", () => {
    expect(cleanString("  hello  ")).toBe("hello");
    expect(cleanString("   ")).toBeNull();
    expect(cleanString(3)).toBeNull();
  });
});

function jsonRequest(body: unknown): Request {
  return new Request("https://example.test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
