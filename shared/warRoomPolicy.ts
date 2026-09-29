import type { ResolvedWarPhase, WarPhase } from "./warPhase";

type WarKind = "real" | "termed";
type PanelRule = {
  title: string;
  phases: readonly WarPhase[];
  warTypes: readonly WarKind[];
  tracking?: "active" | "inactive";
};
const beforeOfficialEnd = ["upcoming", "preparation", "current", "practically_finished"] as const;
const allPhases = [...beforeOfficialEnd, "officially_ended"] as const;
const fightingPhases = ["preparation", "current"] as const;
const both = ["real", "termed"] as const;

// The visibility table lives here. Collapsing a panel and enabling its actions
// are separate concerns and must not change these rules.
export const WAR_ROOM_PANEL_POLICY = {
  header: { title: "War header / countdown", phases: allPhases, warTypes: both },
  enemyStatus: { title: "Enemy status summary", phases: fightingPhases, warTypes: both, tracking: "active" },
  chainWatch: { title: "Chain Watch", phases: ["preparation", "current", "practically_finished"], warTypes: both },
  warProgress: { title: "War progress", phases: allPhases, warTypes: both },
  hospitalMonitor: { title: "Hospital monitor", phases: fightingPhases, warTypes: ["real"], tracking: "active" },
  warControl: { title: "War control (WIP)", phases: fightingPhases, warTypes: ["real"], tracking: "active" },
  enemyPushPressure: { title: "Enemy push pressure (WIP)", phases: fightingPhases, warTypes: ["real"], tracking: "active" },
  revivableMembers: { title: "Revivable members", phases: fightingPhases, warTypes: ["real"], tracking: "active" },
  enemyTravel: { title: "Enemy travel tracker", phases: fightingPhases, warTypes: both, tracking: "active" },
  scoutingComparison: { title: "Stats comparison", phases: allPhases, warTypes: both },
  liveTrackingInactive: { title: "War-room tracking paused", phases: beforeOfficialEnd, warTypes: both, tracking: "inactive" },
  activityHeatmaps: { title: "Activity heatmaps", phases: allPhases, warTypes: both },
  practicalPhases: { title: "Practical phases", phases: ["preparation", "current", "practically_finished", "officially_ended"], warTypes: ["termed"] },
  enemyScouting: { title: "Enemy faction scouting", phases: allPhases, warTypes: both },
  enemyBigHitters: { title: "Enemy big hitters", phases: allPhases, warTypes: both },
  enemyHitTrends: { title: "Members to watch", phases: allPhases, warTypes: both },
  trackingCadence: { title: "Tracking cadence", phases: allPhases, warTypes: both },
} as const satisfies Record<string, PanelRule>;

export type WarRoomPanelId = keyof typeof WAR_ROOM_PANEL_POLICY;

export function warRoomPanelVisibility(
  state: ResolvedWarPhase,
  war: { war_type?: string | null; enemy_faction_id?: number | null } | null,
): Record<WarRoomPanelId, boolean> {
  const type = war?.war_type ?? "real";
  const roomAvailable = war != null && war.enemy_faction_id != null && (type === "real" || type === "termed");
  return Object.fromEntries(Object.entries(WAR_ROOM_PANEL_POLICY).map(([id, rule]: [string, PanelRule]) => [id,
    roomAvailable && rule.phases.includes(state.phase) && rule.warTypes.includes(type as WarKind) &&
    (rule.tracking !== "active" || state.memberTrackingActive) &&
    (rule.tracking !== "inactive" || !state.memberTrackingActive),
  ])) as Record<WarRoomPanelId, boolean>;
}
