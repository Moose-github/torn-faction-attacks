import { WATCH_HOUR } from "../shared/chainWatchSchedule";
import type { Env } from "./types";

export type ChainWatchThresholdAssignment = {
  watch_id: string; slot_start_at: number; assigned_to: number | null; assignment_revision: number;
};

export type ChainWatchThresholdEventJob = {
  factionId: number; resetAt: number; timeoutAt: number; chainLength: number; observedAt: number;
  // Captured by the existing watcher-mention lookup, without adding an awaited
  // database request to the alert path. Undefined means that lookup failed.
  assignment?: ChainWatchThresholdAssignment | null;
};

// Run only in the alarm's retained background task, after the Discord attempt.
// The confirmed timer and assignment are snapshots: a later hit, handover or
// reassignment must not discard the event or move it to a different watcher.
export async function recordChainWatchThresholdEvents(env: Env, job: ChainWatchThresholdEventJob): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (job.assignment === undefined) {
        job.assignment = await env.DB.prepare(`SELECT w.id AS watch_id, s.start_at AS slot_start_at,
            s.assigned_to, s.check_in_revision AS assignment_revision
          FROM chain_watch_schedules w JOIN chain_watch_slots s ON s.watch_id = w.id
          WHERE w.guild_id = ? AND w.start_at <= ? AND (w.finish_at IS NULL OR w.finish_at > ?)
            AND s.start_at = ? AND s.cancelled = 0 LIMIT 1`)
          .bind(env.DISCORD_GUILD_ID ?? null, job.observedAt, job.observedAt,
            Math.floor(job.observedAt / WATCH_HOUR) * WATCH_HOUR).first<ChainWatchThresholdAssignment>();
      }
      const assignment = job.assignment;
      await env.DB.prepare(`WITH thresholds(stage, seconds) AS (VALUES ('warning_60', 60), ('warning_30', 30))
        INSERT INTO chain_watch_threshold_events
          (faction_id, reset_at, stage, timeout_at, chain_length, observed_at,
           watch_id, slot_start_at, assigned_to, assignment_revision)
        SELECT ?, ?, stage, ?, ?, ?, ?, ?, ?, ? FROM thresholds
        WHERE ? > ? AND ? - seconds <= ?
        ON CONFLICT(faction_id, reset_at, stage) DO UPDATE SET
          timeout_at = excluded.timeout_at, chain_length = excluded.chain_length,
          observed_at = excluded.observed_at, watch_id = excluded.watch_id,
          slot_start_at = excluded.slot_start_at, assigned_to = excluded.assigned_to,
          assignment_revision = excluded.assignment_revision
        WHERE excluded.observed_at < chain_watch_threshold_events.observed_at`)
        .bind(job.factionId, job.resetAt, job.timeoutAt, job.chainLength, job.observedAt,
          assignment?.watch_id ?? null, assignment?.slot_start_at ?? null,
          assignment?.assigned_to ?? null, assignment?.assignment_revision ?? null,
          job.timeoutAt, job.observedAt, job.timeoutAt, job.observedAt).run();
      return;
    } catch {
      // Retry only persistence, never the alert. Keep the captured assignment.
      if (attempt === 2) console.warn("Chain Watch threshold recording failed after 3 attempts");
    }
  }
}
