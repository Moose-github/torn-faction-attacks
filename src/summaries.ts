import {
  CHAIN_BONUS_HITS_SQL,
  DEFEND_WON_RESULTS_SQL,
  HOME_FACTION_ID,
  POSITIVE_RESULTS_SQL,
} from "./constants";
import { DEFENSE_ACTION_WINDOW_SQL, OUTGOING_ACTION_WINDOW_SQL } from "./sql";
import { Env } from "./types";

export async function applyIncrementalWarSummaries(
  env: Env,
  warId: number,
  ingestRunId: string,
): Promise<void> {
  const appliedAttacks = await applyIngestedWarMemberStats(env, warId, ingestRunId);
  if (appliedAttacks === 0) {
    return;
  }

  await rebuildWarSummaryFromMemberStats(env, warId);
}

export async function rebuildOpenWarMemberStatsFromRaw(env: Env): Promise<{ wars_rebuilt: number }> {
  const rows = await env.DB.prepare(
    `
    SELECT id
    FROM wars
    WHERE status = 'active'
      AND finalized_at IS NULL
      AND practical_finish_time IS NULL
    ORDER BY practical_start_time ASC, id ASC
    `,
  ).all();

  const wars = (rows.results ?? []) as { id: number }[];

  for (const war of wars) {
    await rebuildWarMemberStatsFromRaw(env, war.id);
    await rebuildWarSummaryFromMemberStats(env, war.id);
  }

  return {
    wars_rebuilt: wars.length,
  };
}

export async function finalizeWar(env: Env, warId: number): Promise<void> {
  const war = (await env.DB.prepare(
    `
    SELECT id, finalized_at
    FROM wars
    WHERE id = ?
    LIMIT 1
    `,
  )
    .bind(warId)
    .first()) as { id: number; finalized_at: number | null } | null;

  if (!war || war.finalized_at) {
    return;
  }

  await rebuildWarMemberStatsFromRaw(env, warId);
  await rebuildWarSummaryFromMemberStats(env, warId);

  await env.DB.prepare(
    `
    UPDATE wars
    SET finalized_at = unixepoch()
    WHERE id = ?
    `,
  )
    .bind(warId)
    .run();

  await env.DB.prepare(`UPDATE war_summary SET updated_at = unixepoch() WHERE war_id = ?`)
    .bind(warId)
    .run();
}

export async function rebuildWarSummaryFromMemberStats(env: Env, warId: number): Promise<void> {
  await env.DB.prepare(
    `
    INSERT INTO war_summary (
      war_id,
      attacks_vs_enemy_total,
      attacks_from_enemy_total,
      outside_hits,
      total_respect_gain,
      total_respect_gain_raw,
      total_respect_lost,
      total_respect_lost_raw,
      unique_attackers,
      first_attack_at,
      last_attack_at,
      updated_at
    )
    SELECT
      w.id,
      COALESCE(SUM(wms.attacks_vs_enemy_total), 0) AS attacks_vs_enemy_total,
      COALESCE(SUM(wms.defends_total), 0) AS attacks_from_enemy_total,
      COALESCE(SUM(wms.outside_hits), 0) AS outside_hits,
      COALESCE(SUM(wms.respect_gained), 0) AS total_respect_gain,
      COALESCE(SUM(wms.respect_gained_raw), 0) AS total_respect_gain_raw,
      COALESCE(SUM(wms.respect_lost), 0) AS total_respect_lost,
      COALESCE(SUM(wms.respect_lost_raw), 0) AS total_respect_lost_raw,
      COUNT(CASE
        WHEN wms.attacks_vs_enemy_total > 0
          OR wms.assists_vs_enemy > 0
          OR wms.outside_hits > 0
          OR wms.friendly_hosps > 0
        THEN 1
      END) AS unique_attackers,
      MIN(wms.first_action_at) AS first_attack_at,
      MAX(wms.last_action_at) AS last_attack_at,
      unixepoch() AS updated_at
    FROM wars w
    LEFT JOIN war_member_stats wms ON wms.war_id = w.id
    WHERE w.id = ?
    GROUP BY w.id
    ON CONFLICT(war_id) DO UPDATE SET
      attacks_vs_enemy_total = excluded.attacks_vs_enemy_total,
      attacks_from_enemy_total = excluded.attacks_from_enemy_total,
      outside_hits = excluded.outside_hits,
      total_respect_gain = excluded.total_respect_gain,
      total_respect_gain_raw = excluded.total_respect_gain_raw,
      total_respect_lost = excluded.total_respect_lost,
      total_respect_lost_raw = excluded.total_respect_lost_raw,
      unique_attackers = excluded.unique_attackers,
      first_attack_at = excluded.first_attack_at,
      last_attack_at = excluded.last_attack_at,
      updated_at = excluded.updated_at
    `,
  )
    .bind(warId)
    .run();
}

export async function rebuildDerivedStatsFromRaw(env: Env): Promise<{
  wars_rebuilt: number;
}> {
  await resetDerivedWarMemberStats(env);

  const rows = await env.DB.prepare(
    `
    SELECT id, status
    FROM wars
    ORDER BY practical_start_time ASC, id ASC
    `,
  ).all();

  const wars = (rows.results ?? []) as { id: number; status: string }[];

  for (const war of wars) {
    await rebuildWarMemberStatsFromRaw(env, war.id);
    await rebuildWarSummaryFromMemberStats(env, war.id);
  }

  return {
    wars_rebuilt: wars.length,
  };
}

export async function rebuildWarMemberStatsFromRaw(env: Env, warId: number): Promise<void> {
  await resetDerivedWarMemberStats(env, warId);

  await upsertWarMemberAttackStats(env, warId);
  await upsertWarMemberDefendStats(env, warId);
}

async function resetDerivedWarMemberStats(env: Env, warId?: number): Promise<void> {
  const whereClause = warId === undefined ? "" : "WHERE war_id = ?";
  const bindValue = warId === undefined ? [] : [warId];

  const resetStatement = env.DB.prepare(
    `
    UPDATE war_member_stats
    SET attacks_vs_enemy_total = 0,
        attacks_vs_enemy_successful = 0,
        respect_gained = 0,
        respect_gained_raw = 0,
        chain_bonus_hits_vs_enemy = 0,
        chain_bonus_respect_removed = 0,
        chain_bonus_hit_values_vs_enemy = '',
        chain_bonus_hit_details_vs_enemy = '',
        assists_vs_enemy = 0,
        hospitalizations_vs_enemy = 0,
        mugs_vs_enemy = 0,
        retaliations_vs_enemy = 0,
        outside_hits = 0,
        friendly_hosps = 0,
        average_fair_fight = NULL,
        defends_total = 0,
        defends_won = 0,
        defends_other = 0,
        respect_lost = 0,
        respect_lost_raw = 0,
        enemy_chain_bonus_hits_received = 0,
        enemy_chain_bonus_respect_removed = 0,
        enemy_chain_bonus_hit_values_received = '',
        enemy_chain_bonus_hit_details_received = '',
        first_action_at = NULL,
        last_action_at = NULL
    ${whereClause}
      ${whereClause ? "AND" : "WHERE"} added_from_report = 1
    `,
  );
  if (bindValue.length > 0) {
    await resetStatement.bind(...bindValue).run();
  } else {
    await resetStatement.run();
  }

  const deleteStatement = env.DB.prepare(
    `
    DELETE FROM war_member_stats
    ${whereClause}
      ${whereClause ? "AND" : "WHERE"} added_from_report = 0
    `,
  );
  if (bindValue.length > 0) {
    await deleteStatement.bind(...bindValue).run();
  } else {
    await deleteStatement.run();
  }
}

async function upsertWarMemberAttackStats(
  env: Env,
  warId: number,
): Promise<void> {
  await env.DB.prepare(
    `
    WITH member_averages AS (
      SELECT
        a.war_id,
        a.attacker_id,
        AVG(a.respect_gain) AS avg_respect
      FROM attacks a
      JOIN wars w ON w.id = a.war_id
      WHERE a.war_id = ?
        AND a.attacker_faction_id = ${HOME_FACTION_ID}
        AND a.attacker_id IS NOT NULL
        AND ${OUTGOING_ACTION_WINDOW_SQL}
        AND (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
        AND a.result IN (${POSITIVE_RESULTS_SQL})
        AND (a.chain IS NULL OR a.chain NOT IN (${CHAIN_BONUS_HITS_SQL}))
      GROUP BY a.war_id, a.attacker_id
    ),
    war_average AS (
      SELECT AVG(a.respect_gain) AS avg_respect
      FROM attacks a
      JOIN wars w ON w.id = a.war_id
      WHERE a.war_id = ?
        AND a.attacker_faction_id = ${HOME_FACTION_ID}
        AND ${OUTGOING_ACTION_WINDOW_SQL}
        AND (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
        AND a.result IN (${POSITIVE_RESULTS_SQL})
        AND (a.chain IS NULL OR a.chain NOT IN (${CHAIN_BONUS_HITS_SQL}))
    )
    INSERT INTO war_member_stats (
      war_id,
      member_id,
      member_name,
      attacks_vs_enemy_total,
      attacks_vs_enemy_successful,
      respect_gained,
      respect_gained_raw,
      chain_bonus_hits_vs_enemy,
      chain_bonus_respect_removed,
      chain_bonus_hit_values_vs_enemy,
      chain_bonus_hit_details_vs_enemy,
      assists_vs_enemy,
      hospitalizations_vs_enemy,
      mugs_vs_enemy,
      retaliations_vs_enemy,
      outside_hits,
      friendly_hosps,
      average_fair_fight,
      first_action_at,
      last_action_at
    )
    SELECT
      a.war_id,
      a.attacker_id,
      MAX(a.attacker_name),
      SUM(CASE
        WHEN w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id THEN 1
        ELSE 0
      END) AS attacks_vs_enemy_total,
      SUM(CASE
        WHEN (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
         AND a.result IN (${POSITIVE_RESULTS_SQL})
        THEN 1
        ELSE 0
      END) AS attacks_vs_enemy_successful,
      COALESCE(SUM(CASE
        WHEN w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id
        THEN CASE
          WHEN a.result IN (${POSITIVE_RESULTS_SQL})
           AND a.chain IN (${CHAIN_BONUS_HITS_SQL})
          THEN COALESCE(ma.avg_respect, wa.avg_respect, 0)
          ELSE a.respect_gain
        END
        ELSE 0
      END), 0) AS respect_gained,
      COALESCE(SUM(CASE
        WHEN (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
         AND a.result IN (${POSITIVE_RESULTS_SQL})
        THEN a.respect_gain
        ELSE 0
      END), 0) AS respect_gained_raw,
      SUM(CASE
        WHEN (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
         AND a.result IN (${POSITIVE_RESULTS_SQL})
         AND a.chain IN (${CHAIN_BONUS_HITS_SQL})
        THEN 1
        ELSE 0
      END) AS chain_bonus_hits_vs_enemy,
      COALESCE(SUM(CASE
        WHEN (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
         AND a.result IN (${POSITIVE_RESULTS_SQL})
         AND a.chain IN (${CHAIN_BONUS_HITS_SQL})
        THEN a.respect_gain - COALESCE(ma.avg_respect, wa.avg_respect, 0)
        ELSE 0
      END), 0) AS chain_bonus_respect_removed,
      COALESCE(GROUP_CONCAT(CASE
        WHEN (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
         AND a.result IN (${POSITIVE_RESULTS_SQL})
         AND a.chain IN (${CHAIN_BONUS_HITS_SQL})
        THEN a.chain
        ELSE NULL
      END, ', '), '') AS chain_bonus_hit_values_vs_enemy,
      COALESCE(GROUP_CONCAT(CASE
        WHEN (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
         AND a.result IN (${POSITIVE_RESULTS_SQL})
         AND a.chain IN (${CHAIN_BONUS_HITS_SQL})
        THEN a.chain || ' - ' || printf('%g', ROUND(COALESCE(ma.avg_respect, wa.avg_respect, 0), 1)) || ' respect'
        ELSE NULL
      END, char(10)), '') AS chain_bonus_hit_details_vs_enemy,
      SUM(CASE
        WHEN (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
         AND a.result = 'Assist'
        THEN 1
        ELSE 0
      END) AS assists_vs_enemy,
      SUM(CASE
        WHEN (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
         AND a.result = 'Hospitalized'
        THEN 1
        ELSE 0
      END) AS hospitalizations_vs_enemy,
      SUM(CASE
        WHEN (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
         AND a.result = 'Mugged'
        THEN 1
        ELSE 0
      END) AS mugs_vs_enemy,
      SUM(CASE
        WHEN (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
         AND a.result = 'Hospitalized'
         AND COALESCE(a.m_retaliation, 1) > 1
        THEN 1
        ELSE 0
      END) AS retaliations_vs_enemy,
      SUM(CASE
        WHEN w.enemy_faction_id IS NOT NULL
         AND (
           a.defender_faction_id IS NULL
           OR a.defender_faction_id != w.enemy_faction_id
         )
         AND NOT (
           a.defender_faction_id = ${HOME_FACTION_ID}
           AND a.result = 'Hospitalized'
         )
        THEN 1
        ELSE 0
      END) AS outside_hits,
      SUM(CASE
        WHEN a.result = 'Hospitalized'
         AND a.defender_faction_id = ${HOME_FACTION_ID}
        THEN 1
        ELSE 0
      END) AS friendly_hosps,
      AVG(CASE
        WHEN w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id
        THEN a.m_fair_fight
        ELSE NULL
      END) AS average_fair_fight,
      MIN(a.started) AS first_action_at,
      MAX(a.started) AS last_action_at
    FROM attacks a
    JOIN wars w ON w.id = a.war_id
    LEFT JOIN member_averages ma ON ma.war_id = a.war_id AND ma.attacker_id = a.attacker_id
    LEFT JOIN war_average wa ON 1 = 1
    WHERE a.war_id = ?
      AND a.attacker_faction_id = ?
      AND a.attacker_id IS NOT NULL
      AND ${OUTGOING_ACTION_WINDOW_SQL}
    GROUP BY a.war_id, a.attacker_id
    ON CONFLICT(war_id, member_id) DO UPDATE SET
      member_name = COALESCE(excluded.member_name, war_member_stats.member_name),
      attacks_vs_enemy_total = war_member_stats.attacks_vs_enemy_total + excluded.attacks_vs_enemy_total,
      attacks_vs_enemy_successful = war_member_stats.attacks_vs_enemy_successful + excluded.attacks_vs_enemy_successful,
      respect_gained = war_member_stats.respect_gained + excluded.respect_gained,
      respect_gained_raw = war_member_stats.respect_gained_raw + excluded.respect_gained_raw,
      chain_bonus_hits_vs_enemy = war_member_stats.chain_bonus_hits_vs_enemy + excluded.chain_bonus_hits_vs_enemy,
      chain_bonus_respect_removed = war_member_stats.chain_bonus_respect_removed + excluded.chain_bonus_respect_removed,
      chain_bonus_hit_values_vs_enemy = CASE
        WHEN war_member_stats.chain_bonus_hit_values_vs_enemy = '' THEN excluded.chain_bonus_hit_values_vs_enemy
        WHEN excluded.chain_bonus_hit_values_vs_enemy = '' THEN war_member_stats.chain_bonus_hit_values_vs_enemy
        ELSE war_member_stats.chain_bonus_hit_values_vs_enemy || ', ' || excluded.chain_bonus_hit_values_vs_enemy
      END,
      chain_bonus_hit_details_vs_enemy = CASE
        WHEN war_member_stats.chain_bonus_hit_details_vs_enemy = '' THEN excluded.chain_bonus_hit_details_vs_enemy
        WHEN excluded.chain_bonus_hit_details_vs_enemy = '' THEN war_member_stats.chain_bonus_hit_details_vs_enemy
        ELSE war_member_stats.chain_bonus_hit_details_vs_enemy || char(10) || excluded.chain_bonus_hit_details_vs_enemy
      END,
      assists_vs_enemy = war_member_stats.assists_vs_enemy + excluded.assists_vs_enemy,
      hospitalizations_vs_enemy = war_member_stats.hospitalizations_vs_enemy + excluded.hospitalizations_vs_enemy,
      mugs_vs_enemy = war_member_stats.mugs_vs_enemy + excluded.mugs_vs_enemy,
      retaliations_vs_enemy = war_member_stats.retaliations_vs_enemy + excluded.retaliations_vs_enemy,
      outside_hits = war_member_stats.outside_hits + excluded.outside_hits,
      friendly_hosps = war_member_stats.friendly_hosps + excluded.friendly_hosps,
      average_fair_fight = CASE
        WHEN war_member_stats.attacks_vs_enemy_total + excluded.attacks_vs_enemy_total > 0 THEN
          (
            COALESCE(war_member_stats.average_fair_fight, 0) * war_member_stats.attacks_vs_enemy_total +
            COALESCE(excluded.average_fair_fight, 0) * excluded.attacks_vs_enemy_total
          ) / (war_member_stats.attacks_vs_enemy_total + excluded.attacks_vs_enemy_total)
        ELSE COALESCE(excluded.average_fair_fight, war_member_stats.average_fair_fight)
      END,
      first_action_at = CASE
        WHEN war_member_stats.first_action_at IS NULL THEN excluded.first_action_at
        WHEN excluded.first_action_at IS NULL THEN war_member_stats.first_action_at
        ELSE MIN(war_member_stats.first_action_at, excluded.first_action_at)
      END,
      last_action_at = CASE
        WHEN war_member_stats.last_action_at IS NULL THEN excluded.last_action_at
        WHEN excluded.last_action_at IS NULL THEN war_member_stats.last_action_at
        ELSE MAX(war_member_stats.last_action_at, excluded.last_action_at)
      END
    `,
  )
    .bind(warId, warId, warId, HOME_FACTION_ID)
    .run();
}

async function applyIngestedWarMemberStats(
  env: Env,
  warId: number,
  ingestRunId: string,
): Promise<number> {
  const countRow = (await env.DB.prepare(
    `
    SELECT COUNT(*) AS count
    FROM attacks
    WHERE war_id = ?
      AND ingest_run_id = ?
    `,
  )
    .bind(warId, ingestRunId)
    .first()) as { count: number | null } | null;
  const appliedAttacks = Number(countRow?.count ?? 0);

  if (appliedAttacks === 0) {
    return 0;
  }

  await upsertIngestedWarMemberAttackStats(env, warId, ingestRunId);
  await upsertIngestedWarMemberDefendStats(env, warId, ingestRunId);
  return appliedAttacks;
}

async function upsertIngestedWarMemberAttackStats(
  env: Env,
  warId: number,
  ingestRunId: string,
): Promise<void> {
  await env.DB.prepare(
    `
    WITH member_averages AS (
      SELECT
        member_id,
        CASE
          WHEN attacks_vs_enemy_successful > 0
          THEN respect_gained_raw * 1.0 / attacks_vs_enemy_successful
          ELSE NULL
        END AS avg_respect
      FROM war_member_stats
      WHERE war_id = ?
    ),
    war_average AS (
      SELECT
        CASE
          WHEN COALESCE(SUM(attacks_vs_enemy_successful), 0) > 0
          THEN SUM(respect_gained_raw) * 1.0 / SUM(attacks_vs_enemy_successful)
          ELSE NULL
        END AS avg_respect
      FROM war_member_stats
      WHERE war_id = ?
    )
    INSERT INTO war_member_stats (
      war_id,
      member_id,
      member_name,
      attacks_vs_enemy_total,
      attacks_vs_enemy_successful,
      respect_gained,
      respect_gained_raw,
      chain_bonus_hits_vs_enemy,
      chain_bonus_respect_removed,
      chain_bonus_hit_values_vs_enemy,
      chain_bonus_hit_details_vs_enemy,
      assists_vs_enemy,
      hospitalizations_vs_enemy,
      mugs_vs_enemy,
      retaliations_vs_enemy,
      outside_hits,
      friendly_hosps,
      average_fair_fight,
      first_action_at,
      last_action_at
    )
    SELECT
      a.war_id,
      a.attacker_id,
      MAX(a.attacker_name),
      SUM(CASE
        WHEN w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id THEN 1
        ELSE 0
      END) AS attacks_vs_enemy_total,
      SUM(CASE
        WHEN (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
         AND a.result IN (${POSITIVE_RESULTS_SQL})
        THEN 1
        ELSE 0
      END) AS attacks_vs_enemy_successful,
      COALESCE(SUM(CASE
        WHEN w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id
        THEN CASE
          WHEN a.result IN (${POSITIVE_RESULTS_SQL})
           AND a.chain IN (${CHAIN_BONUS_HITS_SQL})
          THEN COALESCE(ma.avg_respect, wa.avg_respect, 0)
          ELSE a.respect_gain
        END
        ELSE 0
      END), 0) AS respect_gained,
      COALESCE(SUM(CASE
        WHEN (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
         AND a.result IN (${POSITIVE_RESULTS_SQL})
        THEN a.respect_gain
        ELSE 0
      END), 0) AS respect_gained_raw,
      SUM(CASE
        WHEN (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
         AND a.result IN (${POSITIVE_RESULTS_SQL})
         AND a.chain IN (${CHAIN_BONUS_HITS_SQL})
        THEN 1
        ELSE 0
      END) AS chain_bonus_hits_vs_enemy,
      COALESCE(SUM(CASE
        WHEN (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
         AND a.result IN (${POSITIVE_RESULTS_SQL})
         AND a.chain IN (${CHAIN_BONUS_HITS_SQL})
        THEN a.respect_gain - COALESCE(ma.avg_respect, wa.avg_respect, 0)
        ELSE 0
      END), 0) AS chain_bonus_respect_removed,
      COALESCE(GROUP_CONCAT(CASE
        WHEN (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
         AND a.result IN (${POSITIVE_RESULTS_SQL})
         AND a.chain IN (${CHAIN_BONUS_HITS_SQL})
        THEN a.chain
        ELSE NULL
      END, ', '), '') AS chain_bonus_hit_values_vs_enemy,
      COALESCE(GROUP_CONCAT(CASE
        WHEN (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
         AND a.result IN (${POSITIVE_RESULTS_SQL})
         AND a.chain IN (${CHAIN_BONUS_HITS_SQL})
        THEN a.chain || ' - ' || printf('%g', ROUND(COALESCE(ma.avg_respect, wa.avg_respect, 0), 1)) || ' respect'
        ELSE NULL
      END, char(10)), '') AS chain_bonus_hit_details_vs_enemy,
      SUM(CASE
        WHEN (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
         AND a.result = 'Assist'
        THEN 1
        ELSE 0
      END) AS assists_vs_enemy,
      SUM(CASE
        WHEN (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
         AND a.result = 'Hospitalized'
        THEN 1
        ELSE 0
      END) AS hospitalizations_vs_enemy,
      SUM(CASE
        WHEN (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
         AND a.result = 'Mugged'
        THEN 1
        ELSE 0
      END) AS mugs_vs_enemy,
      SUM(CASE
        WHEN (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
         AND a.result = 'Hospitalized'
         AND COALESCE(a.m_retaliation, 1) > 1
        THEN 1
        ELSE 0
      END) AS retaliations_vs_enemy,
      SUM(CASE
        WHEN w.enemy_faction_id IS NOT NULL
         AND (
           a.defender_faction_id IS NULL
           OR a.defender_faction_id != w.enemy_faction_id
         )
         AND NOT (
           a.defender_faction_id = ${HOME_FACTION_ID}
           AND a.result = 'Hospitalized'
         )
        THEN 1
        ELSE 0
      END) AS outside_hits,
      SUM(CASE
        WHEN a.result = 'Hospitalized'
         AND a.defender_faction_id = ${HOME_FACTION_ID}
        THEN 1
        ELSE 0
      END) AS friendly_hosps,
      AVG(CASE
        WHEN w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id
        THEN a.m_fair_fight
        ELSE NULL
      END) AS average_fair_fight,
      MIN(a.started) AS first_action_at,
      MAX(a.started) AS last_action_at
    FROM attacks a
    JOIN wars w ON w.id = a.war_id
    LEFT JOIN member_averages ma ON ma.member_id = a.attacker_id
    LEFT JOIN war_average wa ON 1 = 1
    WHERE a.war_id = ?
      AND a.ingest_run_id = ?
      AND a.attacker_faction_id = ${HOME_FACTION_ID}
      AND a.attacker_id IS NOT NULL
      AND ${OUTGOING_ACTION_WINDOW_SQL}
    GROUP BY a.war_id, a.attacker_id
    ON CONFLICT(war_id, member_id) DO UPDATE SET
      member_name = COALESCE(excluded.member_name, war_member_stats.member_name),
      attacks_vs_enemy_total = war_member_stats.attacks_vs_enemy_total + excluded.attacks_vs_enemy_total,
      attacks_vs_enemy_successful = war_member_stats.attacks_vs_enemy_successful + excluded.attacks_vs_enemy_successful,
      respect_gained = war_member_stats.respect_gained + excluded.respect_gained,
      respect_gained_raw = war_member_stats.respect_gained_raw + excluded.respect_gained_raw,
      chain_bonus_hits_vs_enemy = war_member_stats.chain_bonus_hits_vs_enemy + excluded.chain_bonus_hits_vs_enemy,
      chain_bonus_respect_removed = war_member_stats.chain_bonus_respect_removed + excluded.chain_bonus_respect_removed,
      chain_bonus_hit_values_vs_enemy = CASE
        WHEN war_member_stats.chain_bonus_hit_values_vs_enemy = '' THEN excluded.chain_bonus_hit_values_vs_enemy
        WHEN excluded.chain_bonus_hit_values_vs_enemy = '' THEN war_member_stats.chain_bonus_hit_values_vs_enemy
        ELSE war_member_stats.chain_bonus_hit_values_vs_enemy || ', ' || excluded.chain_bonus_hit_values_vs_enemy
      END,
      chain_bonus_hit_details_vs_enemy = CASE
        WHEN war_member_stats.chain_bonus_hit_details_vs_enemy = '' THEN excluded.chain_bonus_hit_details_vs_enemy
        WHEN excluded.chain_bonus_hit_details_vs_enemy = '' THEN war_member_stats.chain_bonus_hit_details_vs_enemy
        ELSE war_member_stats.chain_bonus_hit_details_vs_enemy || char(10) || excluded.chain_bonus_hit_details_vs_enemy
      END,
      assists_vs_enemy = war_member_stats.assists_vs_enemy + excluded.assists_vs_enemy,
      hospitalizations_vs_enemy = war_member_stats.hospitalizations_vs_enemy + excluded.hospitalizations_vs_enemy,
      mugs_vs_enemy = war_member_stats.mugs_vs_enemy + excluded.mugs_vs_enemy,
      retaliations_vs_enemy = war_member_stats.retaliations_vs_enemy + excluded.retaliations_vs_enemy,
      outside_hits = war_member_stats.outside_hits + excluded.outside_hits,
      friendly_hosps = war_member_stats.friendly_hosps + excluded.friendly_hosps,
      average_fair_fight = CASE
        WHEN war_member_stats.attacks_vs_enemy_total + excluded.attacks_vs_enemy_total > 0 THEN
          (
            COALESCE(war_member_stats.average_fair_fight, 0) * war_member_stats.attacks_vs_enemy_total +
            COALESCE(excluded.average_fair_fight, 0) * excluded.attacks_vs_enemy_total
          ) / (war_member_stats.attacks_vs_enemy_total + excluded.attacks_vs_enemy_total)
        ELSE COALESCE(excluded.average_fair_fight, war_member_stats.average_fair_fight)
      END,
      first_action_at = CASE
        WHEN war_member_stats.first_action_at IS NULL THEN excluded.first_action_at
        WHEN excluded.first_action_at IS NULL THEN war_member_stats.first_action_at
        ELSE MIN(war_member_stats.first_action_at, excluded.first_action_at)
      END,
      last_action_at = CASE
        WHEN war_member_stats.last_action_at IS NULL THEN excluded.last_action_at
        WHEN excluded.last_action_at IS NULL THEN war_member_stats.last_action_at
        ELSE MAX(war_member_stats.last_action_at, excluded.last_action_at)
      END
    `,
  )
    .bind(warId, warId, warId, ingestRunId)
    .run();
}

async function upsertIngestedWarMemberDefendStats(
  env: Env,
  warId: number,
  ingestRunId: string,
): Promise<void> {
  await env.DB.prepare(
    `
    WITH member_averages AS (
      SELECT
        a.attacker_id,
        AVG(a.respect_gain) AS avg_respect
      FROM attacks a
      JOIN wars w ON w.id = a.war_id
      WHERE a.war_id = ?
        AND a.defender_faction_id = ${HOME_FACTION_ID}
        AND a.defender_id IS NOT NULL
        AND w.enemy_faction_id IS NOT NULL
        AND a.attacker_faction_id = w.enemy_faction_id
        AND a.result IN (${POSITIVE_RESULTS_SQL})
        AND (a.chain IS NULL OR a.chain NOT IN (${CHAIN_BONUS_HITS_SQL}))
        AND ${DEFENSE_ACTION_WINDOW_SQL}
      GROUP BY a.attacker_id
    ),
    war_average AS (
      SELECT AVG(a.respect_gain) AS avg_respect
      FROM attacks a
      JOIN wars w ON w.id = a.war_id
      WHERE a.war_id = ?
        AND a.defender_faction_id = ${HOME_FACTION_ID}
        AND a.defender_id IS NOT NULL
        AND w.enemy_faction_id IS NOT NULL
        AND a.attacker_faction_id = w.enemy_faction_id
        AND a.result IN (${POSITIVE_RESULTS_SQL})
        AND (a.chain IS NULL OR a.chain NOT IN (${CHAIN_BONUS_HITS_SQL}))
        AND ${DEFENSE_ACTION_WINDOW_SQL}
    )
    INSERT INTO war_member_stats (
      war_id,
      member_id,
      member_name,
      defends_total,
      defends_won,
      defends_other,
      respect_lost,
      respect_lost_raw,
      enemy_chain_bonus_hits_received,
      enemy_chain_bonus_respect_removed,
      enemy_chain_bonus_hit_values_received,
      enemy_chain_bonus_hit_details_received,
      first_action_at,
      last_action_at
    )
    SELECT
      a.war_id,
      a.defender_id,
      MAX(a.defender_name),
      COUNT(*) AS defends_total,
      SUM(CASE
        WHEN a.result IN (${DEFEND_WON_RESULTS_SQL}) THEN 1
        ELSE 0
      END) AS defends_won,
      SUM(CASE
        WHEN a.result IS NULL
          OR (
            a.result NOT IN (${POSITIVE_RESULTS_SQL})
            AND a.result NOT IN (${DEFEND_WON_RESULTS_SQL})
          )
        THEN 1
        ELSE 0
      END) AS defends_other,
      COALESCE(SUM(CASE
        WHEN a.result IN (${POSITIVE_RESULTS_SQL})
        THEN CASE
          WHEN a.chain IN (${CHAIN_BONUS_HITS_SQL})
          THEN COALESCE(ma.avg_respect, wa.avg_respect, 0)
          ELSE a.respect_gain
        END
        ELSE 0
      END), 0) AS respect_lost,
      COALESCE(SUM(CASE
        WHEN a.result IN (${POSITIVE_RESULTS_SQL})
        THEN a.respect_gain
        ELSE 0
      END), 0) AS respect_lost_raw,
      SUM(CASE
        WHEN a.result IN (${POSITIVE_RESULTS_SQL})
         AND a.chain IN (${CHAIN_BONUS_HITS_SQL})
        THEN 1
        ELSE 0
      END) AS enemy_chain_bonus_hits_received,
      COALESCE(SUM(CASE
        WHEN a.result IN (${POSITIVE_RESULTS_SQL})
         AND a.chain IN (${CHAIN_BONUS_HITS_SQL})
        THEN a.respect_gain - COALESCE(ma.avg_respect, wa.avg_respect, 0)
        ELSE 0
      END), 0) AS enemy_chain_bonus_respect_removed,
      COALESCE(GROUP_CONCAT(CASE
        WHEN a.result IN (${POSITIVE_RESULTS_SQL})
         AND a.chain IN (${CHAIN_BONUS_HITS_SQL})
        THEN a.chain
        ELSE NULL
      END, ', '), '') AS enemy_chain_bonus_hit_values_received,
      COALESCE(GROUP_CONCAT(CASE
        WHEN a.result IN (${POSITIVE_RESULTS_SQL})
         AND a.chain IN (${CHAIN_BONUS_HITS_SQL})
        THEN a.chain || ' - ' || printf('%g', ROUND(COALESCE(ma.avg_respect, wa.avg_respect, 0), 1)) || ' respect'
        ELSE NULL
      END, char(10)), '') AS enemy_chain_bonus_hit_details_received,
      MIN(a.started) AS first_action_at,
      MAX(a.started) AS last_action_at
    FROM attacks a
    JOIN wars w ON w.id = a.war_id
    LEFT JOIN member_averages ma ON ma.attacker_id = a.attacker_id
    LEFT JOIN war_average wa ON 1 = 1
    WHERE a.war_id = ?
      AND a.ingest_run_id = ?
      AND a.defender_faction_id = ${HOME_FACTION_ID}
      AND a.defender_id IS NOT NULL
      AND w.enemy_faction_id IS NOT NULL
      AND a.attacker_faction_id = w.enemy_faction_id
      AND ${DEFENSE_ACTION_WINDOW_SQL}
    GROUP BY a.war_id, a.defender_id
    ON CONFLICT(war_id, member_id) DO UPDATE SET
      member_name = COALESCE(excluded.member_name, war_member_stats.member_name),
      defends_total = war_member_stats.defends_total + excluded.defends_total,
      defends_won = war_member_stats.defends_won + excluded.defends_won,
      defends_other = war_member_stats.defends_other + excluded.defends_other,
      respect_lost = war_member_stats.respect_lost + excluded.respect_lost,
      respect_lost_raw = war_member_stats.respect_lost_raw + excluded.respect_lost_raw,
      enemy_chain_bonus_hits_received = war_member_stats.enemy_chain_bonus_hits_received + excluded.enemy_chain_bonus_hits_received,
      enemy_chain_bonus_respect_removed = war_member_stats.enemy_chain_bonus_respect_removed + excluded.enemy_chain_bonus_respect_removed,
      enemy_chain_bonus_hit_values_received = CASE
        WHEN war_member_stats.enemy_chain_bonus_hit_values_received = '' THEN excluded.enemy_chain_bonus_hit_values_received
        WHEN excluded.enemy_chain_bonus_hit_values_received = '' THEN war_member_stats.enemy_chain_bonus_hit_values_received
        ELSE war_member_stats.enemy_chain_bonus_hit_values_received || ', ' || excluded.enemy_chain_bonus_hit_values_received
      END,
      enemy_chain_bonus_hit_details_received = CASE
        WHEN war_member_stats.enemy_chain_bonus_hit_details_received = '' THEN excluded.enemy_chain_bonus_hit_details_received
        WHEN excluded.enemy_chain_bonus_hit_details_received = '' THEN war_member_stats.enemy_chain_bonus_hit_details_received
        ELSE war_member_stats.enemy_chain_bonus_hit_details_received || char(10) || excluded.enemy_chain_bonus_hit_details_received
      END,
      first_action_at = CASE
        WHEN war_member_stats.first_action_at IS NULL THEN excluded.first_action_at
        WHEN excluded.first_action_at IS NULL THEN war_member_stats.first_action_at
        ELSE MIN(war_member_stats.first_action_at, excluded.first_action_at)
      END,
      last_action_at = CASE
        WHEN war_member_stats.last_action_at IS NULL THEN excluded.last_action_at
        WHEN excluded.last_action_at IS NULL THEN war_member_stats.last_action_at
        ELSE MAX(war_member_stats.last_action_at, excluded.last_action_at)
      END
    `,
  )
    .bind(warId, warId, warId, ingestRunId)
    .run();
}

async function upsertWarMemberDefendStats(
  env: Env,
  warId: number,
): Promise<void> {
  await env.DB.prepare(
    `
    WITH member_averages AS (
      SELECT
        a.attacker_id,
        AVG(a.respect_gain) AS avg_respect
      FROM attacks a
      JOIN wars w ON w.id = a.war_id
      WHERE a.war_id = ?
        AND a.defender_faction_id = ${HOME_FACTION_ID}
        AND a.defender_id IS NOT NULL
        AND w.enemy_faction_id IS NOT NULL
        AND a.attacker_faction_id = w.enemy_faction_id
        AND a.result IN (${POSITIVE_RESULTS_SQL})
        AND (a.chain IS NULL OR a.chain NOT IN (${CHAIN_BONUS_HITS_SQL}))
        AND ${DEFENSE_ACTION_WINDOW_SQL}
      GROUP BY a.attacker_id
    ),
    war_average AS (
      SELECT AVG(a.respect_gain) AS avg_respect
      FROM attacks a
      JOIN wars w ON w.id = a.war_id
      WHERE a.war_id = ?
        AND a.defender_faction_id = ${HOME_FACTION_ID}
        AND a.defender_id IS NOT NULL
        AND w.enemy_faction_id IS NOT NULL
        AND a.attacker_faction_id = w.enemy_faction_id
        AND a.result IN (${POSITIVE_RESULTS_SQL})
        AND (a.chain IS NULL OR a.chain NOT IN (${CHAIN_BONUS_HITS_SQL}))
        AND ${DEFENSE_ACTION_WINDOW_SQL}
    )
    INSERT INTO war_member_stats (
      war_id,
      member_id,
      member_name,
      defends_total,
      defends_won,
      defends_other,
      respect_lost,
      respect_lost_raw,
      enemy_chain_bonus_hits_received,
      enemy_chain_bonus_respect_removed,
      enemy_chain_bonus_hit_values_received,
      enemy_chain_bonus_hit_details_received,
      first_action_at,
      last_action_at
    )
    SELECT
      a.war_id,
      a.defender_id,
      MAX(a.defender_name),
      COUNT(*) AS defends_total,
      SUM(CASE
        WHEN a.result IN (${DEFEND_WON_RESULTS_SQL}) THEN 1
        ELSE 0
      END) AS defends_won,
      SUM(CASE
        WHEN a.result IS NULL
          OR (
            a.result NOT IN (${POSITIVE_RESULTS_SQL})
            AND a.result NOT IN (${DEFEND_WON_RESULTS_SQL})
          )
        THEN 1
        ELSE 0
      END) AS defends_other,
      COALESCE(SUM(CASE
        WHEN a.result IN (${POSITIVE_RESULTS_SQL})
        THEN CASE
          WHEN a.chain IN (${CHAIN_BONUS_HITS_SQL})
          THEN COALESCE(ma.avg_respect, wa.avg_respect, 0)
          ELSE a.respect_gain
        END
        ELSE 0
      END), 0) AS respect_lost,
      COALESCE(SUM(CASE
        WHEN a.result IN (${POSITIVE_RESULTS_SQL})
        THEN a.respect_gain
        ELSE 0
      END), 0) AS respect_lost_raw,
      SUM(CASE
        WHEN a.result IN (${POSITIVE_RESULTS_SQL})
         AND a.chain IN (${CHAIN_BONUS_HITS_SQL})
        THEN 1
        ELSE 0
      END) AS enemy_chain_bonus_hits_received,
      COALESCE(SUM(CASE
        WHEN a.result IN (${POSITIVE_RESULTS_SQL})
         AND a.chain IN (${CHAIN_BONUS_HITS_SQL})
        THEN a.respect_gain - COALESCE(ma.avg_respect, wa.avg_respect, 0)
        ELSE 0
      END), 0) AS enemy_chain_bonus_respect_removed,
      COALESCE(GROUP_CONCAT(CASE
        WHEN a.result IN (${POSITIVE_RESULTS_SQL})
         AND a.chain IN (${CHAIN_BONUS_HITS_SQL})
        THEN a.chain
        ELSE NULL
      END, ', '), '') AS enemy_chain_bonus_hit_values_received,
      COALESCE(GROUP_CONCAT(CASE
        WHEN a.result IN (${POSITIVE_RESULTS_SQL})
         AND a.chain IN (${CHAIN_BONUS_HITS_SQL})
        THEN a.chain || ' - ' || printf('%g', ROUND(COALESCE(ma.avg_respect, wa.avg_respect, 0), 1)) || ' respect'
        ELSE NULL
      END, char(10)), '') AS enemy_chain_bonus_hit_details_received,
      MIN(a.started) AS first_action_at,
      MAX(a.started) AS last_action_at
    FROM attacks a
    JOIN wars w ON w.id = a.war_id
    LEFT JOIN member_averages ma ON ma.attacker_id = a.attacker_id
    LEFT JOIN war_average wa ON 1 = 1
    WHERE a.war_id = ?
      AND a.defender_faction_id = ?
      AND a.defender_id IS NOT NULL
      AND w.enemy_faction_id IS NOT NULL
      AND a.attacker_faction_id = w.enemy_faction_id
      AND ${DEFENSE_ACTION_WINDOW_SQL}
    GROUP BY a.war_id, a.defender_id
    ON CONFLICT(war_id, member_id) DO UPDATE SET
      member_name = COALESCE(excluded.member_name, war_member_stats.member_name),
      defends_total = war_member_stats.defends_total + excluded.defends_total,
      defends_won = war_member_stats.defends_won + excluded.defends_won,
      defends_other = war_member_stats.defends_other + excluded.defends_other,
      respect_lost = war_member_stats.respect_lost + excluded.respect_lost,
      respect_lost_raw = war_member_stats.respect_lost_raw + excluded.respect_lost_raw,
      enemy_chain_bonus_hits_received = war_member_stats.enemy_chain_bonus_hits_received + excluded.enemy_chain_bonus_hits_received,
      enemy_chain_bonus_respect_removed = war_member_stats.enemy_chain_bonus_respect_removed + excluded.enemy_chain_bonus_respect_removed,
      enemy_chain_bonus_hit_values_received = CASE
        WHEN war_member_stats.enemy_chain_bonus_hit_values_received = '' THEN excluded.enemy_chain_bonus_hit_values_received
        WHEN excluded.enemy_chain_bonus_hit_values_received = '' THEN war_member_stats.enemy_chain_bonus_hit_values_received
        ELSE war_member_stats.enemy_chain_bonus_hit_values_received || ', ' || excluded.enemy_chain_bonus_hit_values_received
      END,
      enemy_chain_bonus_hit_details_received = CASE
        WHEN war_member_stats.enemy_chain_bonus_hit_details_received = '' THEN excluded.enemy_chain_bonus_hit_details_received
        WHEN excluded.enemy_chain_bonus_hit_details_received = '' THEN war_member_stats.enemy_chain_bonus_hit_details_received
        ELSE war_member_stats.enemy_chain_bonus_hit_details_received || char(10) || excluded.enemy_chain_bonus_hit_details_received
      END,
      first_action_at = CASE
        WHEN war_member_stats.first_action_at IS NULL THEN excluded.first_action_at
        WHEN excluded.first_action_at IS NULL THEN war_member_stats.first_action_at
        ELSE MIN(war_member_stats.first_action_at, excluded.first_action_at)
      END,
      last_action_at = CASE
        WHEN war_member_stats.last_action_at IS NULL THEN excluded.last_action_at
        WHEN excluded.last_action_at IS NULL THEN war_member_stats.last_action_at
        ELSE MAX(war_member_stats.last_action_at, excluded.last_action_at)
      END
    `,
  )
    .bind(warId, warId, warId, HOME_FACTION_ID)
    .run();
}
