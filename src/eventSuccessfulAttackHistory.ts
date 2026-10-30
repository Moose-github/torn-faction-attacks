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
  const rows = await env.DB.prepare(`SELECT
      CASE WHEN COALESCE(ended, started) <= ? THEN ?
        ELSE CAST((COALESCE(ended, started) + 3599) / 3600 AS INTEGER) * 3600 END AS observed_at,
      COUNT(*) AS hits
    FROM attacks
    WHERE attacker_faction_id = ? AND (defender_faction_id IS NULL OR defender_faction_id != ?)
      AND result IN (${POSITIVE_RESULTS_SQL})
      AND COALESCE(ended, started) >= ? AND COALESCE(ended, started) <= ?
    GROUP BY observed_at ORDER BY observed_at`)
    .bind(first, first, HOME_FACTION_ID, HOME_FACTION_ID, war.practical_start_time, last)
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
