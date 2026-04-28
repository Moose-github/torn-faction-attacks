import { CHAIN_BONUS_HITS_SQL, HOME_FACTION_ID, POSITIVE_RESULTS_SQL } from "./constants";
import { DEFENSE_ACTION_WINDOW_SQL, OUTGOING_ACTION_WINDOW_SQL } from "./sql";
import { Env } from "./types";

export async function applyIncrementalWarSummaries(
  env: Env,
  warId: number,
  _ingestRunId: string,
): Promise<void> {
  await rebuildWarMemberStatsFromRaw(env, warId);
  await rebuildWarSummaryFromRaw(env, warId);
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
  await rebuildWarSummaryFromRaw(env, warId);

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

export async function rebuildWarSummaryFromRaw(env: Env, warId: number): Promise<void> {
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
    INSERT INTO war_summary (
      war_id,
      faction_attacks,
      enemy_attacks,
      outside_hits_outgoing,
      total_respect_gain,
      total_respect_lost,
      unique_attackers,
      first_attack_at,
      last_attack_at,
      updated_at
    )
    SELECT
      w.id,
      COALESCE(SUM(CASE
        WHEN a.attacker_faction_id = ${HOME_FACTION_ID}
         AND ${OUTGOING_ACTION_WINDOW_SQL}
         AND (
           w.enemy_faction_id IS NULL
           OR a.defender_faction_id = w.enemy_faction_id
         )
        THEN 1
        ELSE 0
      END), 0) AS faction_attacks,
      COALESCE(SUM(CASE
        WHEN w.enemy_faction_id IS NOT NULL
         AND a.attacker_faction_id = w.enemy_faction_id
         AND a.defender_faction_id = ${HOME_FACTION_ID}
         AND ${DEFENSE_ACTION_WINDOW_SQL}
        THEN 1
        ELSE 0
      END), 0) AS enemy_attacks,
      COALESCE(SUM(CASE
        WHEN w.enemy_faction_id IS NOT NULL
         AND a.attacker_faction_id = ${HOME_FACTION_ID}
         AND ${OUTGOING_ACTION_WINDOW_SQL}
         AND (
           a.defender_faction_id IS NULL
           OR a.defender_faction_id != w.enemy_faction_id
         )
        THEN 1
        ELSE 0
      END), 0) AS outside_hits_outgoing,
      COALESCE(SUM(CASE
        WHEN a.attacker_faction_id = ${HOME_FACTION_ID}
         AND ${OUTGOING_ACTION_WINDOW_SQL}
         AND (
           w.enemy_faction_id IS NULL
           OR a.defender_faction_id = w.enemy_faction_id
         )
        THEN CASE
          WHEN a.result IN (${POSITIVE_RESULTS_SQL})
           AND a.chain IN (${CHAIN_BONUS_HITS_SQL})
          THEN COALESCE(ma.avg_respect, wa.avg_respect, 0)
          ELSE a.respect_gain
        END
        ELSE 0
      END), 0) AS total_respect_gain,
      COALESCE(SUM(CASE
        WHEN a.defender_faction_id = ${HOME_FACTION_ID}
         AND a.result IN (${POSITIVE_RESULTS_SQL})
         AND ${DEFENSE_ACTION_WINDOW_SQL}
        THEN a.respect_gain
        ELSE 0
      END), 0) AS total_respect_lost,
      COUNT(DISTINCT CASE
        WHEN a.attacker_faction_id = ${HOME_FACTION_ID}
         AND ${OUTGOING_ACTION_WINDOW_SQL}
        THEN a.attacker_id
      END) AS unique_attackers,
      MIN(a.started) AS first_attack_at,
      MAX(a.started) AS last_attack_at,
      unixepoch() AS updated_at
    FROM wars w
    LEFT JOIN attacks a ON a.war_id = w.id
    LEFT JOIN member_averages ma ON ma.war_id = a.war_id AND ma.attacker_id = a.attacker_id
    LEFT JOIN war_average wa ON 1 = 1
    WHERE w.id = ?
    GROUP BY w.id
    ON CONFLICT(war_id) DO UPDATE SET
      faction_attacks = excluded.faction_attacks,
      enemy_attacks = excluded.enemy_attacks,
      outside_hits_outgoing = excluded.outside_hits_outgoing,
      total_respect_gain = excluded.total_respect_gain,
      total_respect_lost = excluded.total_respect_lost,
      unique_attackers = excluded.unique_attackers,
      first_attack_at = excluded.first_attack_at,
      last_attack_at = excluded.last_attack_at,
      updated_at = excluded.updated_at
    `,
  )
    .bind(warId, warId, warId)
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
    await rebuildWarSummaryFromRaw(env, war.id);
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
    SET enemy_attacks_total = 0,
        enemy_attacks_successful = 0,
        enemy_respect_gained = 0,
        enemy_assists = 0,
        enemy_hospitalizations = 0,
        enemy_mugs = 0,
        outside_attacks = 0,
        friendly_hospitals = 0,
        defends_total = 0,
        defends_won = 0,
        respect_lost = 0,
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
      enemy_attacks_total,
      enemy_attacks_successful,
      enemy_respect_gained,
      enemy_assists,
      enemy_hospitalizations,
      enemy_mugs,
      outside_attacks,
      friendly_hospitals,
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
      END) AS enemy_attacks_total,
      SUM(CASE
        WHEN (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
         AND a.result IN (${POSITIVE_RESULTS_SQL})
        THEN 1
        ELSE 0
      END) AS enemy_attacks_successful,
      COALESCE(SUM(CASE
        WHEN w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id
        THEN CASE
          WHEN a.result IN (${POSITIVE_RESULTS_SQL})
           AND a.chain IN (${CHAIN_BONUS_HITS_SQL})
          THEN COALESCE(ma.avg_respect, wa.avg_respect, 0)
          ELSE a.respect_gain
        END
        ELSE 0
      END), 0) AS enemy_respect_gained,
      SUM(CASE
        WHEN (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
         AND a.result = 'Assist'
        THEN 1
        ELSE 0
      END) AS enemy_assists,
      SUM(CASE
        WHEN (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
         AND a.result = 'Hospitalized'
        THEN 1
        ELSE 0
      END) AS enemy_hospitalizations,
      SUM(CASE
        WHEN (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
         AND a.result = 'Mugged'
        THEN 1
        ELSE 0
      END) AS enemy_mugs,
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
      END) AS outside_attacks,
      SUM(CASE
        WHEN a.result = 'Hospitalized'
         AND a.defender_faction_id = ${HOME_FACTION_ID}
        THEN 1
        ELSE 0
      END) AS friendly_hospitals,
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
      enemy_attacks_total = war_member_stats.enemy_attacks_total + excluded.enemy_attacks_total,
      enemy_attacks_successful = war_member_stats.enemy_attacks_successful + excluded.enemy_attacks_successful,
      enemy_respect_gained = war_member_stats.enemy_respect_gained + excluded.enemy_respect_gained,
      enemy_assists = war_member_stats.enemy_assists + excluded.enemy_assists,
      enemy_hospitalizations = war_member_stats.enemy_hospitalizations + excluded.enemy_hospitalizations,
      enemy_mugs = war_member_stats.enemy_mugs + excluded.enemy_mugs,
      outside_attacks = war_member_stats.outside_attacks + excluded.outside_attacks,
      friendly_hospitals = war_member_stats.friendly_hospitals + excluded.friendly_hospitals,
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

async function upsertWarMemberDefendStats(
  env: Env,
  warId: number,
): Promise<void> {
  await env.DB.prepare(
    `
    INSERT INTO war_member_stats (
      war_id,
      member_id,
      member_name,
      defends_total,
      defends_won,
      respect_lost,
      first_action_at,
      last_action_at
    )
    SELECT
      a.war_id,
      a.defender_id,
      MAX(a.defender_name),
      COUNT(*) AS defends_total,
      SUM(CASE
        WHEN a.result NOT IN (${POSITIVE_RESULTS_SQL}) OR a.result IS NULL THEN 1
        ELSE 0
      END) AS defends_won,
      COALESCE(SUM(CASE
        WHEN a.result IN (${POSITIVE_RESULTS_SQL})
        THEN a.respect_gain
        ELSE 0
      END), 0) AS respect_lost,
      MIN(a.started) AS first_action_at,
      MAX(a.started) AS last_action_at
    FROM attacks a
    JOIN wars w ON w.id = a.war_id
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
      respect_lost = war_member_stats.respect_lost + excluded.respect_lost,
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
    .bind(warId, HOME_FACTION_ID)
    .run();
}
