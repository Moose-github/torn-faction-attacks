import { afterEach, describe, expect, it, vi } from "vitest";
import { warDataTtlSeconds } from "../src/responseCache";
import { resolveWarPhase } from "../shared/warPhase";
import type { PracticalPhase } from "../shared/practicalPhases";

afterEach(() => vi.useRealTimers());

describe("backend cache phase consumers", () => {
  it("treats an ended status as final even when global/current data is stale", () => {
    const war = { id: 1, war_type: "real", status: "ended", practical_start_time: 100,
      practical_finish_time: null, official_end_time: null };
    expect(warDataTtlSeconds(300, 86400, 55)({ war })).toBe(86400);
    expect(resolveWarPhase(war, 200, { activeWarId: 1, warState: "current" }).isCurrent).toBe(false);
  });

  it("resumes active cache timing for a confirmed reopened practical phase", () => {
    vi.useFakeTimers(); vi.setSystemTime(300 * 1000);
    const open: PracticalPhase = { id: "reopened", war_id: 1, status: "active", start_time: 250,
      scheduled_start: 250, finish_time: null, removed_at: null, target: 1000, reason: null, effects_pending: 0 };
    const war = { id: 1, war_type: "termed", status: "active", practical_start_time: 100,
      practical_finish_time: 200, official_end_time: null, practical_phases: [open] };
    expect(warDataTtlSeconds(300, 86400, 55)({ war })).toBe(55);
  });

  it("retains the existing cache treatment for events", () => {
    expect(warDataTtlSeconds(300, 86400, 55)({ war: { war_type: "event", status: "active", official_end_time: null, practical_finish_time: null } })).toBe(55);
  });
});
