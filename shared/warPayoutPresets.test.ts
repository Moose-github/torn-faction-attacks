import { describe, expect, it } from "vitest";
import { parseWarPayoutPresetConfig, parseWarPayoutPresetName, type WarPayoutPresetConfig } from "./warPayoutPresets";

const config: WarPayoutPresetConfig = {
  schemaVersion: 1, mode: "points", respectBasis: "adjusted",
  pointRules: [], flatPaymentRules: [], bonusRules: [],
};

describe("payout preset validation", () => {
  it("preserves empty rule sets without requiring a respect cap", () => {
    expect(parseWarPayoutPresetConfig(config)).toEqual(config);
  });
  it.each(["", "0", "200", "invalid"])("discards legacy respect cap %s", respectLimit => {
    expect(parseWarPayoutPresetConfig({ ...config, respectLimit })).toEqual(config);
  });
  it.each(["NaN", "Infinity", "abc", "0x10", "-1", "1e99"])("rejects invalid flat payment %s", amount => {
    expect(() => parseWarPayoutPresetConfig({ ...config, flatPaymentRules: [{ id: "flat", metric: "friendly_hosps", amount }] })).toThrow();
  });
  it("accepts empty adjustment fields and preserves bonus and penalty tiers", () => {
    const rule = { id: "one", metric: "average_fair_fight", operator: ">=", type: "bonus", threshold: "", percent: "" };
    const parsed = parseWarPayoutPresetConfig({ ...config, bonusRules: [rule, { ...rule, id: "two", type: "penalty", threshold: "2.5", percent: "10" }] });
    expect(parsed.bonusRules).toHaveLength(2);
    expect(parsed.bonusRules[0].threshold).toBe("");
    expect(parsed.bonusRules[1].percent).toBe("10");
  });
  it("rejects duplicate rule IDs, malformed arrays and excessive rule counts", () => {
    const rule = { id: "one", metric: "respect_gained", points: "1" };
    expect(() => parseWarPayoutPresetConfig({ ...config, pointRules: [rule, { ...rule, metric: "outside_hits" }] })).toThrow(/rule ID/);
    expect(() => parseWarPayoutPresetConfig({ ...config, pointRules: null })).toThrow();
    expect(() => parseWarPayoutPresetConfig({ ...config, bonusRules: Array(101).fill({}) })).toThrow(/100/);
  });
  it("trims names and rejects blank, overlong, or control-character names", () => {
    expect(parseWarPayoutPresetName("  Example  ")).toBe("Example");
    for (const name of ["", " ", "a".repeat(81), "a\nb", null]) expect(() => parseWarPayoutPresetName(name)).toThrow();
  });
});
