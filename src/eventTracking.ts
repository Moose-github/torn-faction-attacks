import { bumpWarCacheVersionById } from "./cacheVersions";
import { ensureEventCompetitionStarted } from "./eventCompetition";
import { finishEventTracking } from "./warLifecycle";
import { rebuildWarStatsFromRaw } from "./warStats";
import type { Env } from "./types";
import { nowSeconds } from "./utils";

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
    WHERE war_type = 'event' AND status IN ('scheduled', 'active') AND practical_start_time <= ?
    ORDER BY practical_start_time, id`).bind(now)
    .all<{ id: number; status: string; practical_finish_time: number | null }>();
  for (const event of events.results ?? []) {
    if (event.practical_finish_time !== null && event.practical_finish_time <= now) {
      await finishEventTracking(env, { warId: event.id, finishAt: event.practical_finish_time });
      continue;
    }
    await env.DB.prepare("UPDATE wars SET status = 'active' WHERE id = ? AND status = 'scheduled'")
      .bind(event.id).run();
    await ensureEventCompetitionStarted(env, event.id, now);
    await rebuildWarStatsFromRaw(env, { scope: "single-war", warId: event.id, reason: "cron" });
    await bumpWarCacheVersionById(env, event.id);
  }
}
