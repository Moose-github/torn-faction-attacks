import type { PracticalPhase } from "./practicalPhases";

// Persisted lifecycle state. Preparation and official completion are derived,
// not additional values to write into sync_state.
export type GlobalWarState = "none" | "upcoming" | "current" | "practically_finished";
export type WarPhase = "none" | "upcoming" | "preparation" | "current" | "practically_finished" | "officially_ended";
export type WarTrackingMode = "live" | "pre-live" | "inactive";
export const WAR_PREPARATION_SECONDS = 2 * 60 * 60;

export type WarPhaseSource = {
  id?: number;
  war_type?: string | null;
  status?: string | null;
  practical_start_time?: number | null;
  practical_finish_time?: number | null;
  official_start_time?: number | null;
  official_end_time?: number | null;
  practical_phases?: readonly PracticalPhase[];
};

export type GlobalWarContext = { activeWarId: number | null; warState: GlobalWarState };
export type ResolvedWarPhase = {
  phase: WarPhase;
  isSelectedGlobalWar: boolean;
  isCurrent: boolean;
  memberTrackingActive: boolean;
  memberTrackingLive: boolean;
  trackingMode: WarTrackingMode;
  nextTransitionAt: number | null;
};

export function normalizeGlobalWarState(value: unknown): GlobalWarState {
  return value === "upcoming" || value === "current" || value === "practically_finished" ? value : "none";
}

export function validateGlobalWarStateUpdate(state: GlobalWarState, warId: number | null): number | null {
  if (state !== "none" && normalizeGlobalWarState(state) === "none") throw new Error("Invalid global war state");
  if (state === "none") return null;
  if (warId === null || !Number.isInteger(warId) || warId <= 0) {
    throw new Error(`active_war_id is required for war state ${state}`);
  }
  return warId;
}

/** Pure detection only: this never activates a scheduled war or reopening. */
export function resolveWarPhase(
  war: WarPhaseSource | null | undefined,
  nowSeconds: number,
  context?: GlobalWarContext,
): ResolvedWarPhase {
  const isSelectedGlobalWar = Boolean(war && context && context.activeWarId !== null && war.id === context.activeWarId);
  const globalState = isSelectedGlobalWar ? context?.warState : undefined;
  const start = war?.official_start_time ?? war?.practical_start_time;
  const validStart = typeof start === "number" && Number.isFinite(start) && start > 0;
  const validClock = Number.isFinite(nowSeconds);
  const phases = war?.war_type === "termed" ? war.practical_phases?.filter(p => p.removed_at === null) : undefined;
  const active = phases?.filter(p => p.status === "active");
  const completed = phases?.filter(p => p.status === "completed" && p.start_time !== null && p.finish_time !== null);
  const confirmedActive = active?.length === 1 && active[0].start_time !== null &&
    active[0].start_time <= nowSeconds && active[0].finish_time === null;
  const invalidActive = Boolean(active?.length && !confirmedActive);
  const awaitingActivation = Boolean(phases?.length && war?.status !== "scheduled" &&
    phases.every(p => p.status !== "active" && p.status !== "completed"));
  const timelineClosed = !confirmedActive && (awaitingActivation || Boolean(completed?.some(p => p.finish_time! < nowSeconds)));
  const finish = confirmedActive ? null : war?.practical_finish_time;
  const validFinish = finish == null || (Number.isFinite(finish) && validStart && finish >= start!);
  const pastFinish = finish != null && nowSeconds > finish;
  const officiallyEnded = war?.official_end_time != null || war?.status === "ended";
  const scheduled = war?.status === "scheduled" || (globalState === "upcoming" && !confirmedActive);
  const knownStatus = war?.status == null || ["scheduled", "active", "ended"].includes(war.status);

  let phase: WarPhase;
  if (!war) phase = "none";
  else if (officiallyEnded) phase = "officially_ended";
  else if (timelineClosed || (!confirmedActive && (pastFinish || globalState === "practically_finished"))) phase = "practically_finished";
  else if (confirmedActive || (!scheduled && (war.status === "active" || globalState === "current" || (validStart && nowSeconds >= start!)))) phase = "current";
  else phase = validStart && nowSeconds >= start! - WAR_PREPARATION_SECONDS ? "preparation" : "upcoming";

  const eligible = Boolean(war && validStart && validClock && validFinish && knownStatus && !invalidActive &&
    (phase === "preparation" || phase === "current") &&
    (!context || (isSelectedGlobalWar && (globalState === "upcoming" || globalState === "current"))));
  // Keep the existing inclusive practical-finish boundary for legacy windows.
  const memberTrackingActive = eligible && nowSeconds >= start! - WAR_PREPARATION_SECONDS;
  const memberTrackingLive = memberTrackingActive && nowSeconds >= start!;
  // Lifecycle confirmation governs UI actions; clock-based tracking can start
  // before the next ingestion run confirms a scheduled war as current.
  const isCurrent = eligible && phase === "current" && (!context || globalState === "current");
  const boundaries = validStart && !officiallyEnded && !timelineClosed
    ? [start! - WAR_PREPARATION_SECONDS, start!, ...(finish != null ? [finish + 1] : [])]
      .filter(at => Number.isFinite(at) && at > nowSeconds)
    : [];
  return {
    phase, isSelectedGlobalWar, isCurrent, memberTrackingActive, memberTrackingLive,
    trackingMode: isCurrent ? "live" : memberTrackingActive ? "pre-live" : "inactive",
    nextTransitionAt: boundaries.length ? Math.min(...boundaries) : null,
  };
}

// Event scheduling is deliberately kept on its existing timestamp rules.
function eventTracking(war: WarPhaseSource, timestamp: number, preparation: boolean): boolean {
  const start = war.official_start_time ?? war.practical_start_time;
  return start != null && timestamp >= start - (preparation ? WAR_PREPARATION_SECONDS : 0) &&
    (war.practical_finish_time == null || timestamp <= war.practical_finish_time);
}

export function isWarRoomMemberTrackingActive(war: WarPhaseSource | null, timestamp: number): boolean {
  return war?.war_type === "event" ? eventTracking(war, timestamp, true) : resolveWarPhase(war, timestamp).memberTrackingActive;
}

export function isWarRoomMemberTrackingLive(war: WarPhaseSource | null, timestamp: number): boolean {
  return war?.war_type === "event" ? eventTracking(war, timestamp, false) : resolveWarPhase(war, timestamp).memberTrackingLive;
}
