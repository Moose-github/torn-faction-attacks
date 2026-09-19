import { SOURCE_NAME } from "./constants";
import type { Env } from "./types";
import { nowSeconds } from "./utils";

// Activation policy is separate from the faction monitor. A running schedule
// needs no war; the legacy war toggle remains an additional consumer.
export async function readChainWatchDemand(env: Env, now = nowSeconds()) {
  const watch = await env.DB.prepare(`SELECT id FROM chain_watch_schedules
    WHERE is_open = 1 AND start_at <= ? AND (finish_at IS NULL OR finish_at > ?)
    LIMIT 1`).bind(now, now).first<{ id: string }>();
  const war = await env.DB.prepare(`SELECT w.id FROM sync_state s
    JOIN wars w ON w.id = s.active_war_id
    WHERE s.name = ? AND s.war_state = 'current' AND w.status = 'active'
      AND w.practical_start_time <= ?
      AND COALESCE(w.chain_watch_enabled, CASE WHEN COALESCE(w.war_type, 'real') = 'event' THEN 0 ELSE 1 END) = 1
      AND (w.practical_finish_time IS NULL OR w.practical_finish_time > ?)
      AND w.official_end_time IS NULL
    LIMIT 1`).bind(SOURCE_NAME, now, now).first<{ id: number }>();
  return { active: Boolean(watch || war), watch_id: watch?.id ?? null, war_id: war?.id ?? null };
}
