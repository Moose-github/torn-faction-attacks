export type PracticalPhaseStatus = "scheduled" | "active" | "completed" | "skipped" | "cancelled";

export type PracticalPhase = {
  id: string;
  war_id: number;
  target: number | null;
  scheduled_start: number;
  start_time: number | null;
  finish_time: number | null;
  status: PracticalPhaseStatus;
  reason: string | null;
  removed_at: number | null;
  effects_pending: number;
};

export type PracticalPhaseSummary = {
  practical_revision: number;
  practical_phases: PracticalPhase[];
  practical_duration_seconds: number;
  pending_practical_phase: PracticalPhase | null;
  practical_rebuild_pending: number;
};

export function isPracticalAttack(
  attack: { started?: number | null; ended?: number | null },
  phases: PracticalPhase[],
  officialEnd: number | null = null,
): boolean {
  const finish = attack.ended ?? attack.started;
  if (attack.started == null) return phases.some((p) => p.reason === "legacy" && p.removed_at === null &&
    (p.status === "active" || p.status === "completed"));
  if (attack.started == null || finish == null || (officialEnd !== null && finish > officialEnd)) return false;
  return phases.some((phase) => phase.removed_at === null && phase.start_time !== null &&
    (phase.status === "active" || phase.status === "completed") &&
    attack.started! >= phase.start_time && (phase.finish_time === null || finish <= phase.finish_time));
}

export function practicalDuration(phases: PracticalPhase[], now: number): number {
  return phases.reduce((total, phase) => total + (
    phase.removed_at === null && phase.start_time !== null &&
    (phase.status === "active" || phase.status === "completed")
      ? Math.max(0, (phase.finish_time ?? now) - phase.start_time) : 0
  ), 0);
}

export function validatePhaseTimeline(phases: PracticalPhase[], start: number, end: number | null): void {
  const retained = phases.filter((phase) => phase.removed_at === null);
  if (retained.filter((p) => p.status === "active").length > 1 ||
      retained.filter((p) => p.status === "scheduled").length > 1) throw new Error("Only one active and one scheduled phase are allowed");
  const windows = retained.filter((p) => p.status === "active" || p.status === "completed")
    .sort((a, b) => a.start_time! - b.start_time!);
  for (const [index, phase] of windows.entries()) {
    if (phase.start_time === null || !Number.isInteger(phase.start_time) || phase.start_time < start ||
        (phase.status === "completed" && phase.finish_time === null) ||
        (phase.finish_time !== null && (!Number.isInteger(phase.finish_time) || phase.finish_time < phase.start_time)) ||
        (end !== null && (phase.finish_time === null || phase.finish_time > end))) throw new Error("Phase must fit inside the official war");
    if (index > 0 && (windows[index - 1].finish_time === null || windows[index - 1].finish_time! >= phase.start_time)) {
      throw new Error("Practical phases must not overlap or share an attack boundary");
    }
  }
  const pending = retained.find((p) => p.status === "scheduled");
  if (pending && (pending.scheduled_start < start ||
      (end !== null && pending.scheduled_start >= end) ||
      windows.some((p) => p.finish_time === null || p.finish_time >= pending.scheduled_start))) {
    throw new Error("Reopening must follow the previous practical phase and precede official end");
  }
}

export type PhaseScoreEvidence = {
  score: number;
  observed_at: number;
  crossing_at: number | null;
  complete: boolean;
};

// A current score alone cannot date a historical crossing. Never guess which side
// of the scheduled boundary a hit occurred on when attack history is incomplete.
export function resolvePhase(phase: PracticalPhase, evidence: PhaseScoreEvidence, now: number, officialEnd: number | null): PracticalPhase {
  const needsFinalReconciliation = phase.status === "completed" && phase.reason === "awaiting_reconciliation";
  if (phase.status !== "scheduled" && phase.status !== "active" && !needsFinalReconciliation) return phase;
  if (phase.status === "active" && officialEnd !== null && phase.start_time !== null && phase.start_time >= officialEnd) {
    return { ...phase, status: "cancelled", start_time: null, finish_time: null, reason: "official_end", effects_pending: 0 };
  }
  if (phase.status === "scheduled" && officialEnd !== null && phase.scheduled_start >= officialEnd) {
    return { ...phase, status: "cancelled", reason: "official_end", effects_pending: 0 };
  }
  if (phase.scheduled_start > now) return phase;
  if (phase.target === null) return officialEnd !== null && phase.start_time !== null
    ? { ...phase, status: "completed", finish_time: officialEnd, reason: "target_required", effects_pending: 1 }
    : { ...phase, reason: "target_required" };
  const reached = evidence.score >= phase.target;
  if (!evidence.complete || evidence.observed_at < phase.scheduled_start || (reached && evidence.crossing_at === null)) {
    if (officialEnd !== null && phase.start_time !== null) return {
      ...phase, status: "completed", finish_time: officialEnd, reason: "awaiting_reconciliation",
      effects_pending: needsFinalReconciliation ? phase.effects_pending : 1,
    };
    return { ...phase, reason: "awaiting_reconciliation" };
  }
  if (phase.status === "scheduled" && reached && evidence.crossing_at! <= phase.scheduled_start) {
    return { ...phase, status: "skipped", reason: "target_already_met", effects_pending: 0 };
  }
  const start = phase.start_time ?? phase.scheduled_start;
  const finish = reached ? Math.max(start, evidence.crossing_at!) : officialEnd;
  return { ...phase, start_time: start, finish_time: finish === null ? null : Math.min(finish, officialEnd ?? finish),
    status: finish === null ? "active" : "completed", reason: reached ? "target_reached" : officialEnd !== null ? "official_end" : null,
    effects_pending: phase.status === "scheduled" || finish !== null ? 1 : phase.effects_pending };
}
