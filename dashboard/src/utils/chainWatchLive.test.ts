import { describe, expect, it } from "vitest";
import type { ChainWatchLiveResponse } from "../../../shared/chainWatchLive";
import { chainWatchLiveDisplay } from "./chainWatchLive";

const now = 1800000000;
function live(): ChainWatchLiveResponse {
  return { ok: true, now, faction_id: 8803,
    demand: { active: true, watch_id: "watch", war_id: null },
    computed: { active: true, alert_eligible: true, remaining_seconds: 150, dropped: false },
    state: { faction_id: 8803, enabled: 1, source: "stored", current_chain: 251, timeout_at: now + 150,
      last_hit_at: now - 150, last_hit_attacker_name: "Alice", last_hit_defender_name: "Target",
      drop_sent_at: null, last_checked_at: now, last_error: null } };
}

describe("live chain panel status", () => {
  it("counts down from server time and escalates at 60 and 30 seconds", () => {
    const data = live();
    expect(chainWatchLiveDisplay(data, now, false)).toMatchObject({ status: "Monitoring", countdown: "2:30", current: true });
    expect(chainWatchLiveDisplay(data, now + 90, false)).toMatchObject({ status: "Warning", countdown: "1:00" });
    expect(chainWatchLiveDisplay(data, now + 120, false)).toMatchObject({ status: "Critical", countdown: "0:30" });
  });
  it("does not label local timer expiry as a confirmed drop", () => {
    const data = live(); data.state!.timeout_at = now;
    expect(chainWatchLiveDisplay(data, now, false)).toMatchObject({ status: "Awaiting update", countdown: "Checking…" });
    data.state!.drop_sent_at = now;
    expect(chainWatchLiveDisplay(data, now, false).status).toBe("Dropped");
  });
  it("hides stale countdowns from delayed monitoring, upstream failure or failed page refresh", () => {
    const data = live();
    expect(chainWatchLiveDisplay(data, now + 121, false)).toMatchObject({ status: "Stale data", countdown: "—" });
    data.state!.last_error = "Torn unavailable";
    expect(chainWatchLiveDisplay(data, now, false)).toMatchObject({ status: "Stale data", countdown: "—" });
    expect(chainWatchLiveDisplay(live(), now, true)).toMatchObject({ status: "Updates unavailable", countdown: "—" });
  });
  it("shows a stopped monitor without presenting its old timer as live", () => {
    const data = live(); data.demand.active = false;
    expect(chainWatchLiveDisplay(data, now, false)).toMatchObject({ status: "Stopped", countdown: "—" });
  });
  it("handles first activation and waiting for a new chain", () => {
    const data = live(); data.state = null; data.computed.active = false;
    expect(chainWatchLiveDisplay(data, now, false).status).toBe("Starting");
    const idle = live(); idle.state!.source = "dropped"; idle.state!.current_chain = 0; idle.state!.timeout_at = null;
    expect(chainWatchLiveDisplay(idle, now, false).status).toBe("Waiting for chain");
  });
  it("does not signal warning thresholds for chains at or below 100", () => {
    const data = live(); data.state!.current_chain = 100; data.state!.timeout_at = now + 20; data.computed.alert_eligible = false;
    expect(chainWatchLiveDisplay(data, now, false)).toMatchObject({ status: "Monitoring", countdown: "0:20", current: true });
  });
});
