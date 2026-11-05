import { CHAIN_WATCH_ALERT_MIN_CHAIN, HOME_FACTION_ID, POSITIVE_RESULTS_SQL, SOURCE_NAME } from "./constants";
import type { Env } from "./types";
import { nowSeconds } from "./utils";
import type { ChainWatchStateRow } from "./chainWatch";
import { PENDING_CHAIN_WATCH_WARNING_SQL } from "./chainWatchWarningCleanup";

// Long enough for the 5-minute timer, its drop alert and delayed attack ingestion.
const UNATTENDED_CHAIN_WINDOW_SECONDS = 15 * 60;

// Shared by API reads and the background shortcut so activation rules cannot drift.
// The input row also returns a result before a monitor exists.
const DEMAND_CTES = `WITH inputs AS (SELECT ? AS faction_id, ? AS source_name, ? AS checked_at),
  demand AS (SELECT
    (SELECT id FROM chain_watch_schedules
      WHERE is_open = 1 AND start_at <= inputs.checked_at
        AND (finish_at IS NULL OR finish_at > inputs.checked_at) LIMIT 1) AS watch_id,
    COALESCE((SELECT w.id FROM sync_state s JOIN wars w ON w.id = s.active_war_id
      WHERE s.name = inputs.source_name AND s.war_state = 'current' AND w.status = 'active'
        AND w.practical_start_time <= inputs.checked_at
        AND COALESCE(w.chain_watch_enabled, CASE WHEN COALESCE(w.war_type, 'real') = 'event' THEN 0 ELSE 1 END) = 1
        AND (w.practical_finish_time IS NULL OR w.practical_finish_time > inputs.checked_at)
        AND w.official_end_time IS NULL LIMIT 1),
      (SELECT id FROM wars WHERE war_type = 'event' AND status = 'active' AND chain_watch_enabled = 1
        AND practical_start_time <= inputs.checked_at
        AND (practical_finish_time IS NULL OR practical_finish_time > inputs.checked_at)
        ORDER BY practical_start_time, id LIMIT 1)) AS war_id,
    (SELECT a.chain FROM attacks a
      WHERE a.attacker_faction_id = inputs.faction_id
        AND (a.defender_faction_id IS NULL OR a.defender_faction_id != inputs.faction_id)
        AND a.result IN (${POSITIVE_RESULTS_SQL})
        AND COALESCE(a.ended, a.started) <= inputs.checked_at
        AND COALESCE(a.ended, a.started) > inputs.checked_at - ${UNATTENDED_CHAIN_WINDOW_SECONDS}
      ORDER BY COALESCE(a.ended, a.started) DESC, a.chain DESC, a.id DESC LIMIT 1) AS latest_chain
    FROM inputs)`;

type DemandRow = { manual_enabled: number | null; watch_id: string | null; war_id: number | null; latest_chain: number | null };
function demandFromRow(row: DemandRow) {
  const manualEnabled = row.manual_enabled === 1;
  // Someone asked for monitoring, so its alerts may mention people. Any other chain
  // above the warning threshold is still protected, but its alerts ping nobody.
  const attended = manualEnabled || Boolean(row.watch_id || row.war_id);
  return { active: attended || Number(row.latest_chain ?? 0) > CHAIN_WATCH_ALERT_MIN_CHAIN, attended,
    manual_enabled: manualEnabled, watch_id: row.watch_id, war_id: row.war_id };
}

export async function readChainWatchDemand(env: Env, now = nowSeconds()) {
  const row = await env.DB.prepare(`${DEMAND_CTES}
    SELECT s.manual_enabled, demand.* FROM inputs CROSS JOIN demand
    LEFT JOIN faction_chain_watch_state s ON s.faction_id = inputs.faction_id`)
    .bind(HOME_FACTION_ID, SOURCE_NAME, now).first<DemandRow>();
  return demandFromRow(row!);
}

type ActivityRow = ChainWatchStateRow & DemandRow & {
  inactive_alarm_synced_version: number | null;
  pending_cleanup: number;
};

export async function readChainWatchActivity(env: Env, now: number) {
  const row = (await env.DB.prepare(`${DEMAND_CTES}
    SELECT s.*, demand.*, EXISTS(SELECT 1 FROM chain_watch_warning_cycles
      WHERE faction_id = inputs.faction_id AND ${PENDING_CHAIN_WATCH_WARNING_SQL}) AS pending_cleanup
    FROM inputs CROSS JOIN demand
    LEFT JOIN faction_chain_watch_state s ON s.faction_id = inputs.faction_id`)
    .bind(HOME_FACTION_ID, SOURCE_NAME, now).first<ActivityRow>())!;
  const { watch_id, war_id, latest_chain, pending_cleanup, ...state } = row;
  return { state: row.faction_id == null ? null : state,
    demand: demandFromRow(row), pendingCleanup: pending_cleanup === 1 };
}

export type ChainWatchActivity = Awaited<ReturnType<typeof readChainWatchActivity>>;
