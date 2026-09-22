import { describe, expect, it } from "vitest";
import { WATCH_HOUR, watchSlotStatus, type ChainWatchSlot } from "./chainWatchSchedule";

const start = 1_800_000_000;
const slot: ChainWatchSlot = {
  watch_id: "watch", sheet_id: "sheet", start_at: start, assigned_to: 1,
  member_name: "Watcher", cancelled: 0, check_in_confirmed_at: null,
};

describe("shared watch coverage status", () => {
  it("only shows on watch after confirmation and within the slot's hour", () => {
    expect(watchSlotStatus(slot, start - 1)).toMatchObject({ label: "Scheduled", current: false });
    expect(watchSlotStatus(slot, start)).toMatchObject({ label: "Not checked in", tone: "warning", icon: "🟠", current: true });
    const ready = { ...slot, check_in_confirmed_at: start - 120 };
    expect(watchSlotStatus(ready, start - 1)).toMatchObject({ label: "Ready ✅", current: false, icon: "" });
    expect(watchSlotStatus(ready, start)).toMatchObject({ label: "On watch", tone: "ready", icon: "🟢", current: true });
    expect(watchSlotStatus(ready, start + WATCH_HOUR)).toMatchObject({ label: "Ended", current: false, icon: "" });
    expect(watchSlotStatus({ ...ready, cancelled: 1 }, start)).toMatchObject({ label: "Cancelled", current: false, icon: "" });
  });

  it("never signals coverage for an unfilled slot, even if stale confirmation data is present", () => {
    const unfilled = { ...slot, assigned_to: null, check_in_confirmed_at: start - 120 };
    expect(watchSlotStatus(unfilled, start - 1)).toMatchObject({ label: "Open for sign-up", tone: "quiet", current: false });
    expect(watchSlotStatus(unfilled, start)).toMatchObject({ label: "Cover needed", tone: "critical", icon: "🔴", current: true });
    expect(watchSlotStatus(unfilled, start + WATCH_HOUR)).toMatchObject({ label: "Ended", current: false });
  });
});
