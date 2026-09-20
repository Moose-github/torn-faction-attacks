import { describe, expect, it } from "vitest";
import { personalStatsIssueCutoffDate } from "./attentionPolicy";

describe("personal stats grace period", () => {
  it.each([
    ["2026-09-20T00:00:00Z", "2026-09-18"],
    ["2026-09-20T23:59:59Z", "2026-09-18"],
    ["2026-09-21T00:00:00Z", "2026-09-19"],
    ["2026-09-21T00:30:00+01:00", "2026-09-18"],
    ["2026-03-01T00:00:00Z", "2026-02-27"],
    ["2028-03-01T00:00:00Z", "2028-02-28"],
    ["2027-01-01T00:00:00Z", "2026-12-30"],
  ])("uses UTC calendar days at %s", (now, cutoff) => {
    expect(personalStatsIssueCutoffDate(Date.parse(now) / 1000)).toBe(cutoff);
  });
});
