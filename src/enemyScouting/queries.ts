import { HOME_FACTION_ID, SOURCE_NAME } from "../constants";
import type { Env } from "../types";
import type { CurrentScoutingWar, EnemyFactionMemberRow } from "./model";
import { MEMBER_LIVE_STATUS_SELECT_COLUMNS } from "../memberLiveStatus";

export async function readCurrentScoutingWar(env: Env): Promise<CurrentScoutingWar | null> {
  return (await env.DB.prepare(
    `
    SELECT
      w.id,
      w.name,
      w.status,
      w.enemy_faction_id,
      w.war_type,
      w.practical_start_time,
      w.practical_finish_time,
      w.official_start_time,
      w.enemy_scouting_status_checked_at
    FROM sync_state state
    JOIN wars w ON w.id = state.active_war_id
    WHERE state.name = ?
      AND state.war_state IN ('upcoming', 'current')
      AND w.enemy_faction_id IS NOT NULL
      AND COALESCE(w.status, 'active') != 'ended'
      AND w.official_end_time IS NULL
      AND w.practical_finish_time IS NULL
      AND COALESCE(w.war_type, 'real') != 'event'
    LIMIT 1
    `,
  )
    .bind(SOURCE_NAME)
    .first()) as CurrentScoutingWar | null;
}

export async function readEnemyScouting(
  env: Env,
  factionId: number,
): Promise<EnemyFactionMemberRow[]> {
  const rows = await env.DB.prepare(
    `
    SELECT
      members.member_id,
      members.faction_id,
      members.name,
      members.level,
      members.position,
      members.days_in_faction,
      members.ff_battlestats,
      members.ff_battlestats_updated_at,
      members.bsp_battlestats,
      members.bsp_battlestats_updated_at,
      members.networth,
      members.networth_updated_at,
      members.networth_attempted_at,
      members.networth_attempt_count,
      members.networth_error,
      members.networth_key_source,
      ${MEMBER_LIVE_STATUS_SELECT_COLUMNS},
      members.updated_at
    FROM enemy_faction_members members
    LEFT JOIN enemy_member_live_status live
      ON live.member_id = members.member_id
     AND live.faction_id = members.faction_id
    WHERE members.faction_id = ?
    ORDER BY members.ff_battlestats DESC NULLS LAST, members.level DESC, members.name ASC
    `,
  )
    .bind(factionId)
    .all<EnemyFactionMemberRow>();

  return rows.results ?? [];
}

export async function readHomeScouting(env: Env): Promise<EnemyFactionMemberRow[]> {
  const rows = await env.DB.prepare(
    `
    SELECT
      members.member_id,
      members.faction_id,
      members.name,
      members.level,
      members.position,
      members.days_in_faction,
      members.ff_battlestats,
      members.ff_battlestats_updated_at,
      members.bsp_battlestats,
      members.bsp_battlestats_updated_at,
      members.networth,
      members.networth_updated_at,
      NULL AS networth_attempted_at,
      NULL AS networth_attempt_count,
      NULL AS networth_error,
      NULL AS networth_key_source,
      ${MEMBER_LIVE_STATUS_SELECT_COLUMNS},
      members.updated_at
    FROM home_faction_members members
    LEFT JOIN home_member_live_status live
      ON live.member_id = members.member_id
     AND live.faction_id = members.faction_id
    WHERE members.faction_id = ?
      AND members.is_current = 1
    ORDER BY members.ff_battlestats DESC NULLS LAST, members.level DESC, members.name ASC
    `,
  )
    .bind(HOME_FACTION_ID)
    .all<EnemyFactionMemberRow>();

  return rows.results ?? [];
}
