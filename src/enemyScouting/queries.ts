import { HOME_FACTION_ID } from "../constants";
import type { Env } from "../types";
import type { CurrentScoutingWar, EnemyFactionMemberRow } from "./model";

export async function readCurrentScoutingWar(env: Env): Promise<CurrentScoutingWar | null> {
  return (await env.DB.prepare(
    `
    SELECT
      id,
      name,
      enemy_faction_id,
      war_type,
      practical_start_time,
      practical_finish_time,
      official_start_time,
      enemy_scouting_status_checked_at
    FROM wars
    WHERE enemy_faction_id IS NOT NULL
      AND official_end_time IS NULL
      AND COALESCE(war_type, 'real') != 'event'
    ORDER BY practical_start_time DESC, id DESC
    LIMIT 1
    `,
  ).first()) as CurrentScoutingWar | null;
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
