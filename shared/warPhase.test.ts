import { describe, expect, it } from "vitest";
import { resolveWarPhase, validateGlobalWarStateUpdate, type WarPhaseSource, type GlobalWarContext } from "./warPhase";
import type { PracticalPhase } from "./practicalPhases";
import { isWarRoomMemberTrackingActive as backendActive, isWarRoomMemberTrackingLive as backendLive } from "../src/war/roomTracking";
import { isWarRoomMemberTrackingActive as frontendActive, isWarRoomMemberTrackingLive as frontendLive } from "../dashboard/src/utils/warTracking";

const start = 100_000;
const finish = start + 10_000;
const war: WarPhaseSource = { id: 1, war_type: "real", status: "scheduled", official_start_time: start,
  practical_start_time: start, practical_finish_time: null, official_end_time: null };
const upcoming: GlobalWarContext = { activeWarId: 1, warState: "upcoming" };
const current: GlobalWarContext = { activeWarId: 1, warState: "current" };
const ended: GlobalWarContext = { activeWarId: 1, warState: "practically_finished" };
function phase(overrides: Partial<PracticalPhase> = {}): PracticalPhase {
  return { id: "first", war_id: 1, target: 1000, scheduled_start: start, start_time: start,
    finish_time: null, status: "active", reason: null, removed_at: null, effects_pending: 0, ...overrides };
}

describe("shared war phase detection", () => {
  it.each([
    [start - 7201, "upcoming", false, false],
    [start - 7200, "preparation", true, false],
    [start - 1, "preparation", true, false],
    [start, "preparation", true, true],
    [start + 1, "preparation", true, true],
  ])("keeps preparation and clock tracking separate from activation at %s", (now, expected, active, live) => {
    expect(resolveWarPhase(war, now as number, upcoming)).toMatchObject({ phase: expected,
      memberTrackingActive: active, memberTrackingLive: live, isCurrent: false });
  });

  it("requires lifecycle confirmation for live UI actions", () => {
    expect(resolveWarPhase({ ...war, status: "active" }, start, current)).toMatchObject({ phase: "current", isCurrent: true, trackingMode: "live" });
  });

  it.each([finish - 1, finish, finish + 1])("retains inclusive legacy tracking boundaries at %s", now => {
    const sample = { ...war, status: "active", practical_finish_time: finish };
    expect(resolveWarPhase(sample, now, current)).toMatchObject({
      phase: now <= finish ? "current" : "practically_finished", memberTrackingActive: now <= finish,
    });
  });

  it("handles finish, pending reopening, active reopening, and another finish", () => {
    const first = phase({ status: "completed", finish_time: finish });
    const pending = phase({ id: "second", status: "scheduled", scheduled_start: finish + 500, start_time: null });
    const termed = { ...war, war_type: "termed", status: "active", practical_finish_time: finish, practical_phases: [first, pending] };
    // Passing the scheduled timestamp must not activate the next practical phase.
    expect(resolveWarPhase(termed, finish + 501, ended)).toMatchObject({ phase: "practically_finished", memberTrackingActive: false });
    const reopened = { ...pending, status: "active" as const, start_time: finish + 500 };
    expect(resolveWarPhase({ ...termed, practical_phases: [first, reopened] }, finish + 501, current))
      .toMatchObject({ phase: "current", memberTrackingActive: true, isCurrent: true });
    expect(resolveWarPhase({ ...termed, practical_phases: [first, { ...reopened, status: "completed", finish_time: finish + 600 }] }, finish + 601, ended))
      .toMatchObject({ phase: "practically_finished", memberTrackingActive: false });
  });

  it.each(["cancelled", "skipped"] as const)("does not reopen for a %s phase", status => {
    expect(resolveWarPhase({ ...war, war_type: "termed", status: "active", practical_finish_time: finish,
      practical_phases: [phase({ status: "completed", finish_time: finish }), phase({ id: "second", status, start_time: null })],
    }, finish + 1, ended).memberTrackingActive).toBe(false);
  });

  it("honors corrected timelines and ignores removed phases", () => {
    const corrected = { ...war, war_type: "termed", status: "active", practical_phases: [
      phase({ status: "completed", finish_time: finish }), phase({ id: "removed", removed_at: finish + 1 }),
    ] };
    expect(resolveWarPhase(corrected, finish + 2, current).phase).toBe("practically_finished");
  });

  it.each([{ official_end_time: finish }, { status: "ended" }])("gives official completion precedence over stale state: %j", completion => {
    expect(resolveWarPhase({ ...war, status: "active", war_type: "termed", practical_phases: [phase()], ...completion }, finish, current))
      .toMatchObject({ phase: "officially_ended", isCurrent: false, memberTrackingActive: false, nextTransitionAt: null });
  });

  it("keeps a selected war's phase but disables tracking when another war is current", () => {
    expect(resolveWarPhase({ ...war, status: "active" }, start + 1, { ...current, activeWarId: 2 }))
      .toMatchObject({ phase: "current", isSelectedGlobalWar: false, isCurrent: false, memberTrackingActive: false });
  });

  it("supports legacy records and exposes the next clock boundary", () => {
    const legacy = { practical_start_time: start, official_start_time: null, practical_finish_time: finish };
    expect(resolveWarPhase(legacy, start - 7201)).toMatchObject({ phase: "upcoming", nextTransitionAt: start - 7200 });
    expect(resolveWarPhase(legacy, start - 7200)).toMatchObject({ phase: "preparation", nextTransitionAt: start });
    expect(resolveWarPhase(legacy, start)).toMatchObject({ phase: "current", nextTransitionAt: finish + 1 });
  });

  it.each([null, {}, { ...war, official_start_time: NaN }, { ...war, practical_finish_time: start - 1 }, { ...war, status: "unknown" }])
    ("does not enable operations for invalid data: %j", sample => {
      expect(resolveWarPhase(sample, start, current)).toMatchObject({ memberTrackingActive: false, isCurrent: false });
    });

  it("does not activate a malformed or future active phase", () => {
    expect(resolveWarPhase({ ...war, war_type: "termed", practical_phases: [phase({ start_time: start + 1 })] }, start, current).isCurrent).toBe(false);
    expect(resolveWarPhase(war, NaN, current).memberTrackingActive).toBe(false);
  });

  it("does not let a stale active war flag activate a pending-only timeline", () => {
    expect(resolveWarPhase({ ...war, status: "active", war_type: "termed",
      practical_phases: [phase({ status: "scheduled", start_time: null })],
    }, start + 1, current)).toMatchObject({ phase: "practically_finished", isCurrent: false, memberTrackingActive: false });
  });

  it("uses identical tracking rules in frontend and backend, preserving event behavior", () => {
    for (const war_type of ["real", "termed", "event"]) {
      for (const now of [start - 7201, start - 7200, start - 1, start, finish, finish + 1]) {
        const sample = { ...war, war_type, status: "active", practical_finish_time: finish };
        const expected = now >= start - 7200 && now <= finish;
        expect(backendActive(sample, now)).toBe(expected);
        expect(frontendActive(sample, now)).toBe(expected);
        expect(backendLive(sample, now)).toBe(now >= start && now <= finish);
        expect(frontendLive(sample, now)).toBe(backendLive(sample, now));
      }
    }
  });

  it("validates writes but lets none clear the active identity", () => {
    expect(validateGlobalWarStateUpdate("none", 1)).toBeNull();
    expect(validateGlobalWarStateUpdate("current", 1)).toBe(1);
    for (const id of [null, 0, -1, 1.5]) expect(() => validateGlobalWarStateUpdate("current", id)).toThrow();
  });
});
