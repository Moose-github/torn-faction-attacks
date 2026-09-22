import { describe, expect, it } from "vitest";
import { WATCH_HOUR } from "./chainWatchSchedule";
import { groupWatchShifts, remainingWatchShift, watchShiftConfirmations } from "./chainWatchShifts";

const start = Date.UTC(2030, 0, 1, 23) / 1000;
function hour(offset: number, overrides = {}) {
  return { watch_id: "watch", start_at: start + offset * WATCH_HOUR, assigned_to: 1 as number | null, cancelled: 0,
    check_in_confirmed_at: null as number | null, check_in_closed_at: null as number | null, check_in_end_at: null as number | null,
    ...overrides };
}

describe("shared chain watch shifts", () => {
  it("keeps adjacent hours together across midnight, but separates owners and watches", () => {
    const slots = [hour(0), hour(1), hour(2, { assigned_to: 2 }), hour(3, { watch_id: "other" })];
    const snapshot = structuredClone(slots);
    const shifts = groupWatchShifts(slots);
    expect(shifts.map(shift => [shift.start_at, shift.end_at, shift.slots.length])).toEqual([
      [start, start + 2 * WATCH_HOUR, 2],
      [start + 2 * WATCH_HOUR, start + 3 * WATCH_HOUR, 1],
      [start + 3 * WATCH_HOUR, start + 4 * WATCH_HOUR, 1],
    ]);
    expect(shifts[0].first).toBe(slots[0]);
    expect(slots).toEqual(snapshot);
  });

  it("treats gaps, empty hours and cancellations as breaks even when the owner returns", () => {
    const slots = [hour(0), hour(2), hour(3, { assigned_to: null }), hour(4), hour(5, { cancelled: 1 }), hour(6)];
    expect(groupWatchShifts(slots).map(shift => shift.slots)).toEqual([[slots[0]], [slots[1]], [slots[3]], [slots[5]]]);
  });

  it("takes readiness only from the first hour and never extends a closed check-in", () => {
    const slots = [hour(0, { check_in_confirmed_at: start - 60, check_in_closed_at: start + WATCH_HOUR, check_in_end_at: start + WATCH_HOUR }),
      hour(1, { check_in_confirmed_at: start + 10 }), hour(2, { cancelled: 1 }),
      hour(3), hour(4, { check_in_confirmed_at: start + 10 })];
    const readiness = watchShiftConfirmations(slots);
    expect(slots.map(slot => readiness.get(slot) ?? null)).toEqual([start - 60, null, null, null, null]);
  });

  it("extends an open confirmation to an appended consecutive hour", () => {
    const slots = [hour(0, { check_in_confirmed_at: start - 60, check_in_end_at: start + WATCH_HOUR }), hour(1)];
    expect([...watchShiftConfirmations(slots).values()]).toEqual([start - 60, start - 60]);
  });

  it.each([
    [start - 30, start],
    [start, start],
    [start + WATCH_HOUR - 1, start],
    [start + WATCH_HOUR, start + WATCH_HOUR],
    [start + WATCH_HOUR + 10, start + WATCH_HOUR],
  ])("keeps completed hours out of a takeover at %s", (now, expectedStart) => {
    expect(remainingWatchShift({ start_at: start, end_at: start + 2 * WATCH_HOUR }, now))
      .toEqual({ start_at: expectedStart, end_at: start + 2 * WATCH_HOUR });
  });
});
