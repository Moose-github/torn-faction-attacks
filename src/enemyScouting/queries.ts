import { HOME_FACTION_ID, SOURCE_NAME } from "../constants";
import type { Env } from "../types";
import type { CurrentScoutingWar, EnemyFactionMemberRow } from "./model";

export async function readCurrentScoutingWar(env: Env): Promise<CurrentScoutingWar | null> {
  return (await env.DB.prepare(
    `
    SELECT
      w.id,
      w.name,
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
    SELECT *
    FROM enemy_faction_members
    WHERE faction_id = ?
    ORDER BY ff_battlestats DESC NULLS LAST, level DESC, name ASC
    `,
  )
    .bind(factionId)
    .all<EnemyFactionMemberRow>();

  return rows.results ?? [];
}

export async function readHomeScouting(env: Env): Promise<EnemyFactionMemberRow[]> {
  const rows = await env.DB.prepare(
    `
    SELECT *
    FROM home_faction_members
    WHERE faction_id = ?
      AND is_current = 1
    ORDER BY ff_battlestats DESC NULLS LAST, level DESC, name ASC
    `,
  )
    .bind(HOME_FACTION_ID)
    .all<EnemyFactionMemberRow>();

  return rows.results ?? [];
}
