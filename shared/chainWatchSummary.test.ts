import { describe, expect, it } from "vitest";
import { WATCH_DAY, WATCH_HOUR, type ChainWatchSlot } from "./chainWatchSchedule";
import { summarizeWatchers } from "./chainWatchSummary";

describe("shared chain watch summary", () => {
  it("combines days by player ID and pays only ended, non-cancelled assignments", () => {
    const now = 10 * WATCH_DAY;
    const slot = (id: number | null, start: number, cancelled = 0, name: string | null = "Watcher"): ChainWatchSlot => ({
      watch_id: "watch", sheet_id: String(Math.floor(start / WATCH_DAY)), start_at: start, assigned_to: id, member_name: name, cancelled, check_in_confirmed_at: null,
    });
    expect(summarizeWatchers([
      slot(1, now - WATCH_HOUR), slot(1, now - WATCH_DAY), slot(2, now - 2 * WATCH_HOUR),
      slot(null, now - 3 * WATCH_HOUR), slot(2, now - 4 * WATCH_HOUR, 1), slot(2, now),
      slot(2, now + WATCH_HOUR), slot(3, now - 5 * WATCH_HOUR, 0, null),
    ], now)).toEqual([
      { id: 1, name: "Watcher", count: 2, payment: 20_000_000 },
      { id: 3, name: "Player 3", count: 1, payment: 10_000_000 },
      { id: 2, name: "Watcher", count: 1, payment: 10_000_000 },
    ]);
  });
});
