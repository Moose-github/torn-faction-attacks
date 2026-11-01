import { bumpWarCacheVersionById } from "./cacheVersions";
import { ensureEventCompetitionStarted } from "./eventCompetition";
import { finishEventTracking } from "./warLifecycle";
import { applyIncrementalEventSummaries } from "./warStats";
import { EVENT_ATTACK_MATCH_SQL } from "./sql";
import type { Env } from "./types";
import { nowSeconds } from "./utils";

// Links change when attacks are inserted or completed; event edits are handled by
// the wars triggers. Checking recent attacks keeps each maintenance run small.
const EVENT_LINK_AUDIT_SECONDS = 6 * 60 * 60;

/** Run after deploying the new worker, never while applying the additive schema. */
export async function initializeIndependentEvents(env: Env): Promise<void> {
  const name = "independent_event_tracking:v1";
  if (await env.DB.prepare("SELECT name FROM sync_state WHERE name = ?").bind(name).first()) return;
  await env.DB.batch([
    env.DB.prepare(`UPDATE attacks SET war_id = NULL
      WHERE war_id IN (SELECT id FROM wars WHERE war_type = 'event')`),
    env.DB.prepare(`UPDATE sync_state SET active_war_id = NULL, war_state = 'none'
      WHERE name = 'attacks' AND active_war_id IN (SELECT id FROM wars WHERE war_type = 'event')`),
    env.DB.prepare("INSERT INTO sync_state (name, last_started) VALUES (?, ?) ON CONFLICT(name) DO NOTHING")
      .bind(name, nowSeconds()),
  ]);
}

/** Events have their own clock and never claim the global active-war slot. */
export async function refreshEventTracking(env: Env, now = nowSeconds()): Promise<void> {
  const events = await env.DB.prepare(`SELECT id, status, practical_finish_time FROM wars
    WHERE war_type = 'event' AND practical_start_time <= ?
      AND (status IN ('scheduled', 'active') OR (status = 'ended'
        AND EXISTS (SELECT 1 FROM war_stats_dirty WHERE war_id = wars.id)))
    ORDER BY practical_start_time, id`).bind(now)
    .all<{ id: number; status: string; practical_finish_time: number | null }>();
  for (const event of events.results ?? []) {
    if (event.status !== "ended" && event.practical_finish_time !== null && event.practical_finish_time <= now) {
      await finishEventTracking(env, { warId: event.id, finishAt: event.practical_finish_time });
      continue;
    }
    if (event.status !== "ended") {
      await env.DB.prepare("UPDATE wars SET status = 'active' WHERE id = ? AND status = 'scheduled'")
        .bind(event.id).run();
      await ensureEventCompetitionStarted(env, event.id, now);
    }
    if (await applyIncrementalEventSummaries(env, event.id)) await bumpWarCacheVersionById(env, event.id);
  }
}

/** Fails, surfacing in maintenance health, when a recent attack's event_id disagrees with the event windows. */
export async function auditRecentEventAttackLinks(env: Env, now = nowSeconds()) {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS checked,
      COALESCE(SUM(a.event_id IS NOT (SELECT w.id FROM wars w WHERE ${EVENT_ATTACK_MATCH_SQL}
        ORDER BY w.id LIMIT 1)), 0) AS mismatched
    FROM attacks a INDEXED BY idx_attacks_started
    WHERE a.started >= ?`).bind(now - EVENT_LINK_AUDIT_SECONDS)
    .first<{ checked: number; mismatched: number }>();
  const checked = Number(row?.checked ?? 0);
  const mismatched = Number(row?.mismatched ?? 0);
  if (mismatched > 0) throw new Error(`${mismatched} of ${checked} recent attacks have the wrong event_id`);
  return { writeStatements: 0, changedRows: 0, details: { checked, mismatched } };
}
