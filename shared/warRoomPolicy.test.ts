import { describe, expect, it } from "vitest";
import { resolveWarPhase, type GlobalWarState, type WarPhaseSource } from "./warPhase";
import { warRoomPanelVisibility } from "./warRoomPolicy";

const start = 100_000;
const stable = ["header", "warProgress", "scoutingComparison", "activityHeatmaps", "enemyScouting", "enemyBigHitters", "enemyHitTrends", "trackingCadence"];
const tracked = ["enemyStatus", "enemyTravel"];
const realOnly = ["hospitalMonitor", "warControl", "enemyPushPressure", "revivableMembers"];
const cases: Array<{ name: string; now: number; state: GlobalWarState; war: Partial<WarPhaseSource>; tracking: boolean }> = [
  { name: "upcoming", now: start - 7201, state: "upcoming", war: { status: "scheduled" }, tracking: false },
  { name: "preparation", now: start - 7200, state: "upcoming", war: { status: "scheduled" }, tracking: true },
  { name: "current", now: start, state: "current", war: { status: "active" }, tracking: true },
  { name: "practically finished", now: start + 101, state: "practically_finished", war: { status: "active", practical_finish_time: start + 100 }, tracking: false },
  { name: "officially ended", now: start + 201, state: "none", war: { status: "ended", practical_finish_time: start + 100, official_end_time: start + 200 }, tracking: false },
];

describe("War Room visibility matches the panel table", () => {
  for (const war_type of ["real", "termed"]) {
    for (const sample of cases) {
      it(`${war_type}: ${sample.name}`, () => {
        const war = { id: 1, war_type, enemy_faction_id: 99, official_start_time: start, practical_start_time: start,
          practical_finish_time: null, official_end_time: null, ...sample.war };
        const state = resolveWarPhase(war, sample.now, { activeWarId: 1, warState: sample.state });
        const visibility = warRoomPanelVisibility(state, war);
        const officiallyEnded = sample.name === "officially ended";
        const expected = [...stable, ...(officiallyEnded ? [] : ["chainWatch"]),
          ...(war_type === "termed" ? ["practicalPhases"] : []),
          ...(sample.tracking ? [...tracked, ...(war_type === "real" ? realOnly : [])] : officiallyEnded ? [] : ["liveTrackingInactive"])];
        expect(Object.keys(visibility)).toHaveLength(17);
        expect(Object.entries(visibility).filter(([, visible]) => visible).map(([id]) => id).sort()).toEqual(expected.sort());
      });
    }
  }

  it("keeps historical panels but disables tracking for another selected war", () => {
    const war = { id: 1, war_type: "real", status: "active", enemy_faction_id: 99, practical_start_time: start };
    const state = resolveWarPhase(war, start, { activeWarId: 2, warState: "current" });
    expect(warRoomPanelVisibility(state, war)).toMatchObject({ enemyStatus: false, hospitalMonitor: false, liveTrackingInactive: true, warProgress: true });
  });

  it("requires a selected war and enemy link and leaves events to their existing layout", () => {
    for (const war of [null, { war_type: "real", enemy_faction_id: null }, { war_type: "event", enemy_faction_id: 99 }]) {
      expect(Object.values(warRoomPanelVisibility(resolveWarPhase(war, start), war)).every(value => !value)).toBe(true);
    }
  });
});
