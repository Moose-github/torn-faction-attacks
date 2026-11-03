import type { Env } from "../types";
import { claimDailyBatchGate } from "../scheduledGates";
import { deleteSyncState, readSyncTimestamp } from "../syncState";
import { nowSeconds } from "../utils";
import { personalStatsAttentionCte, personalStatsAttentionParams } from "./attentionPolicy";
import { utcDateKey } from "./dates";
import { HOME_FACTION_ID } from "../constants";

const COMPLETE = "daily_stats_attention_audit";
const LOCK = "daily_stats_attention_audit_lock";

/** Maintenance retries this gate every 15m; only one successful audit per day.
 * Start after the six-hour gym retry window and the 06:10 personal batch.
 */
export async function auditDailyStatsAttention(env: Env, now = nowSeconds()) {
  const today = utcDateKey(now);
  const auditAt = Date.parse(`${today}T06:15:00Z`) / 1000;
  const skipped = { writeStatements: 0, changedRows: 0, details: { skipped: true } };
  if (now < auditAt) return skipped;
  const gate = await claimDailyBatchGate(env, {
    completeStateName: COMPLETE, completeAfter: auditAt,
    lockStateName: LOCK, now, lockSeconds: 300,
  });
  if (gate.completed || !gate.locked) return skipped;

  try {
    // Another run may finish between the gate's completion read and our lock
    // claim. Recheck while owning the lock before doing the audit.
    if (await readSyncTimestamp(env, COMPLETE) >= auditAt) {
      await deleteSyncState(env, LOCK);
      return skipped;
    }
    // A batch is transactional: a failed audit keeps the previous gaps and can
    // retry. Never delete gaps outside the seven completed UTC dates audited.
    const results = await env.DB.batch([
      env.DB.prepare(`DELETE FROM daily_stats_attention_gaps
        WHERE snapshot_date >= date(?, '-7 days') AND snapshot_date < ?
          AND (EXISTS (
            SELECT 1 FROM member_lifestyle_stat_snapshots snapshots
            WHERE snapshots.member_id = daily_stats_attention_gaps.member_id
              AND snapshots.snapshot_date = daily_stats_attention_gaps.snapshot_date
              AND snapshots.personal_ready = 1
          ) OR NOT EXISTS (
            SELECT 1 FROM home_faction_members members
            WHERE members.member_id = daily_stats_attention_gaps.member_id
              AND members.faction_id = ? AND members.is_current = 1 AND members.report_exempt = 0
              AND (members.current_join_date IS NULL OR daily_stats_attention_gaps.snapshot_date >= members.current_join_date)
          ))`).bind(today, today, HOME_FACTION_ID),
      env.DB.prepare(`${personalStatsAttentionCte("week")}
        INSERT OR IGNORE INTO daily_stats_attention_gaps (member_id, snapshot_date)
        SELECT member_id, snapshot_date FROM missing_stats`).bind(...personalStatsAttentionParams(now)),
      env.DB.prepare(`INSERT INTO sync_state (name, last_started) VALUES (?, ?)
        ON CONFLICT(name) DO UPDATE SET last_started = excluded.last_started, updated_at = CURRENT_TIMESTAMP`)
        .bind(COMPLETE, now),
      env.DB.prepare("DELETE FROM sync_state WHERE name = ?").bind(LOCK),
    ]);
    return {
      writeStatements: 5, // Includes the lock claim.
      changedRows: 1 + results.reduce((sum, result) => sum + Number(result.meta.changes ?? 0), 0),
      details: { skipped: false, days: 7 },
    };
  } catch (error) {
    await deleteSyncState(env, LOCK);
    throw error;
  }
}
