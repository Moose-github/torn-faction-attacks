import { describe, expect, it } from "vitest";
import {
  calendarDateDiffDays,
  dailyRefreshReadyAt,
  dateDiffDays,
  dateKeyFromMs,
  enumerateDateRange,
  normalizeDateParam,
  recentCompletedPersonalStatsDates,
  timestampForDailyPoll,
  utcDateKey,
} from "./dates";

describe("lifestyle stats date helpers", () => {
  it("normalizes only valid yyyy-mm-dd UTC dates", () => {
    expect(normalizeDateParam("2026-06-06")).toBe("2026-06-06");
    expect(normalizeDateParam("2026-6-6")).toBeNull();
    expect(normalizeDateParam("not-a-date")).toBeNull();
    expect(normalizeDateParam(null)).toBeNull();
  });

  it("distinguishes calendar day distance from minimum report day distance", () => {
    expect(calendarDateDiffDays("2026-06-06", "2026-06-06")).toBe(0);
    expect(dateDiffDays("2026-06-06", "2026-06-06")).toBe(1);
    expect(calendarDateDiffDays("2026-06-01", "2026-06-06")).toBe(5);
    expect(dateDiffDays("2026-06-01", "2026-06-06")).toBe(5);
  });

  it("reports daily refresh readiness at the configured UTC poll time", () => {
    const beforeReady = Date.parse("2026-06-06T00:09:59.000Z") / 1000;
    const atReady = Date.parse("2026-06-06T00:10:00.000Z") / 1000;
    const afterReady = Date.parse("2026-06-06T15:30:00.000Z") / 1000;

    expect(dailyRefreshReadyAt(beforeReady)).toBeNull();
    expect(dailyRefreshReadyAt(atReady)).toBe(atReady);
    expect(dailyRefreshReadyAt(afterReady)).toBe(atReady);
  });

  it("returns the two previous completed personalstats bucket dates", () => {
    const timestamp = Date.parse("2026-06-06T13:45:00.000Z") / 1000;
    expect(recentCompletedPersonalStatsDates(timestamp)).toEqual([
      "2026-06-04",
      "2026-06-05",
    ]);
  });

  it("converts between epoch timestamps and date keys", () => {
    const date = "2026-06-06";
    const seconds = timestampForDailyPoll(date);

    expect(seconds).toBe(Date.parse("2026-06-06T00:00:00.000Z") / 1000);
    expect(utcDateKey(seconds)).toBe(date);
    expect(dateKeyFromMs(seconds * 1000)).toBe(date);
  });

  it("enumerates inclusive UTC date ranges", () => {
    expect(enumerateDateRange("2026-06-04", "2026-06-06")).toEqual([
      "2026-06-04",
      "2026-06-05",
      "2026-06-06",
    ]);
    expect(enumerateDateRange("2026-06-06", "2026-06-04")).toEqual([]);
  });
});
