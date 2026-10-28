import { HOME_FACTION_ID, POSITIVE_RESULTS_SQL } from "./constants";
import { bumpWarCacheVersionById } from "./cacheVersions";
import type { Env } from "./types";
import { nowSeconds } from "./utils";

const HOUR = 3600;
const CHAIN_TIMEOUT = 300;
const MAX_SAMPLES_PER_RUN = 48;
type EventWindow = { id: number; practical_start_time: number; practical_finish_time: number | null };
type SavedSample = { sampled_at: number; chain_count: number | null; recorded_at: number };
export type EventChainPoint = { observed_at: number; chain: number | null };

/** Include event start, then clock-hour boundaries, never future or post-event points. */
export function eventChainSampleTimes(start: number, finish: number | null, now: number): number[] {
  const end = Math.min(finish ?? now, now);
  if (start > end) return [];
  const times = [start];
  for (let time = (Math.floor(start / HOUR) + 1) * HOUR; time <= end; time += HOUR) times.push(time);
  return times;
}

export async function readEventChainHistory(env: Env, war: EventWindow, now = nowSeconds()): Promise<EventChainPoint[]> {
  const saved = await env.DB.prepare(`SELECT sampled_at, chain_count FROM event_chain_history
    WHERE war_id = ? AND sampled_at >= ? AND sampled_at <= ? ORDER BY sampled_at`)
    .bind(war.id, war.practical_start_time, Math.min(war.practical_finish_time ?? now, now)).all<SavedSample>();
  const counts = new Map((saved.results ?? []).map(row => [row.sampled_at, row.chain_count]));
  return eventChainSampleTimes(war.practical_start_time, war.practical_finish_time, now)
    .map(time => ({ observed_at: time, chain: counts.get(time) ?? null }));
}

/** Backfill and sample the persisted attack feed; no additional Torn requests.
 * Recent slots are reconciled for delayed ingestion. Older gaps are retried hourly.
 * An expired/missing hit is unknown, not evidence that a chain dropped to zero.
 */
export async function captureEventChainHistory(env: Env, now = nowSeconds()): Promise<void> {
  const wars = await env.DB.prepare(`SELECT id, practical_start_time, practical_finish_time FROM wars
    WHERE war_type = 'event' AND event_type = 'halloween' AND status IN ('active', 'ended')
      AND practical_start_time <= ?`).bind(now).all<EventWindow>();
  for (const war of wars.results ?? []) {
    const saved = await env.DB.prepare(`SELECT sampled_at, chain_count, recorded_at FROM event_chain_history
      WHERE war_id = ?`).bind(war.id).all<SavedSample>();
    const byTime = new Map((saved.results ?? []).map(row => [row.sampled_at, row]));
    const times = eventChainSampleTimes(war.practical_start_time, war.practical_finish_time, now);
    const due = times.filter(time => {
      const previous = byTime.get(time);
      return !previous || (time >= now - 2 * HOUR && previous.recorded_at <= now - 60)
        || (previous.chain_count === null && previous.recorded_at <= now - HOUR);
    }).sort((a, b) => (byTime.get(a)?.recorded_at ?? 0) - (byTime.get(b)?.recorded_at ?? 0) || a - b)
      .slice(0, MAX_SAMPLES_PER_RUN);
    if (!due.length) continue;
    // The faction/time index bounds each lookup to five minutes. Use the entire
    // faction feed: chains can begin before this event and span other wars.
    await env.DB.batch(due.map(time => env.DB.prepare(`INSERT INTO event_chain_history
      (war_id, sampled_at, chain_count, attack_id, recorded_at)
      SELECT ?, ?, CASE WHEN a.chain >= 0 THEN a.chain ELSE NULL END, a.id, ?
      FROM (SELECT 1) seed LEFT JOIN attacks a ON a.id = (
        SELECT id FROM attacks
        WHERE attacker_faction_id = ? AND (defender_faction_id IS NULL OR defender_faction_id != ?)
          AND result IN (${POSITIVE_RESULTS_SQL})
          AND COALESCE(ended, started) > ? AND COALESCE(ended, started) <= ?
        ORDER BY COALESCE(ended, started) DESC, chain DESC, id DESC LIMIT 1
      ) WHERE 1
      ON CONFLICT(war_id, sampled_at) DO UPDATE SET chain_count = excluded.chain_count,
        attack_id = excluded.attack_id, recorded_at = excluded.recorded_at
      WHERE event_chain_history.recorded_at <= excluded.recorded_at`)
      .bind(war.id, time, now, HOME_FACTION_ID, HOME_FACTION_ID, time - CHAIN_TIMEOUT, time)));
    await bumpWarCacheVersionById(env, war.id);
  }
}
