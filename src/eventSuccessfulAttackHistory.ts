import { HOME_FACTION_ID, POSITIVE_RESULTS_SQL } from "./constants";
import type { Env, WarRow } from "./types";
import { nowSeconds } from "./utils";

const HOUR = 3600;
// The requested display cutoff does not change the event's counting window.
export const SUCCESSFUL_ATTACK_HISTORY_START = Date.parse("2026-10-29T12:00:00Z") / 1000;
export type EventSuccessfulAttackPoint = { observed_at: number; successful_attacks: number };

/** Rebuild hourly cumulative totals from saved hits, including delayed imports.
 * Use the whole faction feed, as with chain history, regardless of war assignment.
 */
export async function readEventSuccessfulAttackHistory(
  env: Env,
  war: Pick<WarRow, "practical_start_time" | "practical_finish_time">,
  now = nowSeconds(),
): Promise<EventSuccessfulAttackPoint[]> {
  const first = Math.max(SUCCESSFUL_ATTACK_HISTORY_START, Math.ceil(war.practical_start_time / HOUR) * HOUR);
  const last = Math.floor(Math.min(war.practical_finish_time ?? now, now) / HOUR) * HOUR;
  if (first > last) return [];
  // Collapse all earlier event hits into the first displayed point. Later hits
  // belong to the next clock-hour boundary, including hits exactly on that hour.
  // Each hour is its own index range: grouping by hour adds a sort D1 bills as reads.
  const rows = await env.DB.prepare(`WITH RECURSIVE hours(observed_at) AS (
      SELECT ? UNION ALL SELECT observed_at + 3600 FROM hours WHERE observed_at < ?)
    SELECT observed_at, (SELECT COUNT(*) FROM attacks
      WHERE attacker_faction_id = ? AND (defender_faction_id IS NULL OR defender_faction_id != ?)
        AND result IN (${POSITIVE_RESULTS_SQL})
        AND COALESCE(ended, started) >= CASE WHEN observed_at = ? THEN ? ELSE observed_at - 3599 END
        AND COALESCE(ended, started) <= observed_at) AS hits
    FROM hours`)
    .bind(first, last, HOME_FACTION_ID, HOME_FACTION_ID, first, war.practical_start_time)
    .all<{ observed_at: number; hits: number }>();
  const hits = new Map((rows.results ?? []).map(row => [row.observed_at, row.hits]));
  const history: EventSuccessfulAttackPoint[] = [];
  let total = 0;
  for (let observed_at = first; observed_at <= last; observed_at += HOUR) {
    total += hits.get(observed_at) ?? 0;
    history.push({ observed_at, successful_attacks: total });
  }
  return history;
}
