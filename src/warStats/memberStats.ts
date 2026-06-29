import {
  CHAIN_BONUS_HITS_SQL,
  DEFEND_WON_RESULTS_SQL,
  HOME_FACTION_ID,
  POSITIVE_RESULTS_SQL,
} from "../constants";
import { DEFENSE_ACTION_WINDOW_SQL, OUTGOING_ACTION_WINDOW_SQL } from "../sql";
import { Env } from "../types";
import { d1Changes } from "../utils";
import { ATTACK_MEMBER_STAT_MERGE_SQL, DEFEND_MEMBER_STAT_MERGE_SQL } from "./sqlFragments";
import { rebuildWarSummaryFromMemberStats } from "./warSummary";

const MEMBER_ACTIVITY_BUCKET_SECONDS = 15 * 60;

export type WarStatsRebuildScope = "single-war" | "open-wars" | "all-wars";

export type WarStatsRebuildReason =
  | "admin"
  | "cron"
  | "lifecycle"
  | "maintenance"
  | "relink"
  | "finalize"
  | "compatibility";

export type WarStatsRebuildOptions = {
  scope: WarStatsRebuildScope;
  warId?: number;
  reason?: WarStatsRebuildReason;
};

export type WarStatsRebuildResult = {
  wars_rebuilt: number;
  combat_bucket_rows: number;
};

export async function clearWarStats(env: Env, warId: number): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM war_member_combat_buckets WHERE war_id = ?`).bind(warId),
    env.DB.prepare(`DELETE FROM war_member_stats WHERE war_id = ?`).bind(warId),
    env.DB.prepare(`DELETE FROM war_summary WHERE war_id = ?`).bind(warId),
  ]);
}

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

export async function rebuildWarStatsFromRaw(
  env: Env,
  options: WarStatsRebuildOptions,
): Promise<WarStatsRebuildResult> {
  if (options.scope === "single-war") {
    return rebuildSingleWarStatsFromRaw(env, options.warId);
  }

  if (options.scope === "open-wars") {
    return rebuildOpenWarStatsFromRaw(env);
  }

  return rebuildAllWarStatsFromRaw(env);
}

export async function rebuildOpenWarMemberStatsFromRaw(env: Env): Promise<{ wars_rebuilt: number }> {
  const result = await rebuildWarStatsFromRaw(env, {
    scope: "open-wars",
    reason: "compatibility",
  });

  return {
    wars_rebuilt: result.wars_rebuilt,
  };
}

async function rebuildOpenWarStatsFromRaw(env: Env): Promise<WarStatsRebuildResult> {
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
    await rebuildSingleWarStatsFromRaw(env, war.id);
  }

  return {
    wars_rebuilt: wars.length,
    combat_bucket_rows: await countWarMemberCombatBuckets(env),
  };
}

export async function refreshOpenWarChainBonusAdjustmentsFromRaw(env: Env): Promise<{
  wars_checked: number;
  wars_updated: number;
  stat_rows_updated: number;
}> {
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
  let warsUpdated = 0;
  let statRowsUpdated = 0;

  for (const war of wars) {
    const updated = await refreshWarChainBonusAdjustmentsFromRaw(env, war.id);
    if (updated > 0) {
      warsUpdated += 1;
      statRowsUpdated += updated;
      await rebuildWarSummaryFromMemberStats(env, war.id);
    }
  }

  return {
    wars_checked: wars.length,
    wars_updated: warsUpdated,
    stat_rows_updated: statRowsUpdated,
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

  await rebuildWarStatsFromRaw(env, {
    scope: "single-war",
    warId,
    reason: "finalize",
  });

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

export async function rebuildDerivedStatsFromRaw(env: Env, warId?: number): Promise<{
  wars_rebuilt: number;
  combat_bucket_rows: number;
}> {
  return rebuildWarStatsFromRaw(env, warId === undefined
    ? { scope: "all-wars", reason: "compatibility" }
    : { scope: "single-war", warId, reason: "compatibility" });
}

async function rebuildSingleWarStatsFromRaw(
  env: Env,
  warId: number | undefined,
): Promise<WarStatsRebuildResult> {
  if (warId === undefined) {
    return { wars_rebuilt: 0, combat_bucket_rows: 0 };
  }

  const war = (await env.DB.prepare(
    `
    SELECT id
    FROM wars
    WHERE id = ?
    LIMIT 1
    `,
  )
    .bind(warId)
    .first()) as { id: number } | null;

  if (!war) {
    return { wars_rebuilt: 0, combat_bucket_rows: 0 };
  }

  await rebuildWarMemberStatsFromRaw(env, war.id);
  await rebuildWarSummaryFromMemberStats(env, war.id);

  return {
    wars_rebuilt: 1,
    combat_bucket_rows: await countWarMemberCombatBuckets(env, war.id),
  };
}

async function rebuildAllWarStatsFromRaw(env: Env): Promise<WarStatsRebuildResult> {
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
    await rebuildSingleWarStatsFromRaw(env, war.id);
  }

  return {
    wars_rebuilt: wars.length,
    combat_bucket_rows: await countWarMemberCombatBuckets(env),
  };
}

async function countWarMemberCombatBuckets(env: Env, warId?: number): Promise<number> {
  const row = warId === undefined
    ? await env.DB.prepare(
      `
      SELECT COUNT(*) AS count
      FROM war_member_combat_buckets
      `,
    ).first()
    : await env.DB.prepare(
      `
      SELECT COUNT(*) AS count
      FROM war_member_combat_buckets
      WHERE war_id = ?
      `,
    )
      .bind(warId)
      .first();

  return Number((row as { count?: number | null } | null)?.count ?? 0);
}

export async function rebuildWarMemberStatsFromRaw(env: Env, warId: number): Promise<void> {
  await resetDerivedWarMemberStats(env, warId);

  await env.DB.prepare(`DELETE FROM war_member_combat_buckets WHERE war_id = ?`)
    .bind(warId)
    .run();

  await upsertWarMemberAttackStats(env, warId);
  await upsertWarMemberDefendStats(env, warId);
  await upsertWarMemberCombatBuckets(env, warId);
}

async function refreshWarChainBonusAdjustmentsFromRaw(env: Env, warId: number): Promise<number> {
  const outgoing = await refreshWarOutgoingChainBonusAdjustmentsFromRaw(env, warId);
  const defending = await refreshWarDefendChainBonusAdjustmentsFromRaw(env, warId);
  return outgoing + defending;
}

async function refreshWarOutgoingChainBonusAdjustmentsFromRaw(
  env: Env,
  warId: number,
): Promise<number> {
  const result = await env.DB.prepare(
    `
    WITH chain_members AS (
      SELECT DISTINCT a.attacker_id AS member_id
      FROM attacks a
      JOIN wars w ON w.id = a.war_id
      WHERE a.war_id = ?
        AND a.attacker_faction_id = ${HOME_FACTION_ID}
        AND a.attacker_id IS NOT NULL
        AND ${OUTGOING_ACTION_WINDOW_SQL}
        AND (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
        AND a.result IN (${POSITIVE_RESULTS_SQL})
        AND a.chain IN (${CHAIN_BONUS_HITS_SQL})
    ),
    member_averages AS (
      SELECT
        a.attacker_id AS member_id,
        AVG(a.respect_gain) AS avg_respect
      FROM attacks a
      JOIN wars w ON w.id = a.war_id
      JOIN chain_members cm ON cm.member_id = a.attacker_id
      WHERE a.war_id = ?
        AND a.attacker_faction_id = ${HOME_FACTION_ID}
        AND ${OUTGOING_ACTION_WINDOW_SQL}
        AND (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
        AND a.result IN (${POSITIVE_RESULTS_SQL})
        AND (a.chain IS NULL OR a.chain NOT IN (${CHAIN_BONUS_HITS_SQL}))
      GROUP BY a.attacker_id
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
      respect_gained,
      respect_gained_raw,
      chain_bonus_hits_vs_enemy,
      chain_bonus_respect_removed,
      chain_bonus_hit_values_vs_enemy,
      chain_bonus_hit_details_vs_enemy
    )
    SELECT
      a.war_id,
      a.attacker_id,
      MAX(a.attacker_name),
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
      END, char(10)), '') AS chain_bonus_hit_details_vs_enemy
    FROM attacks a
    JOIN wars w ON w.id = a.war_id
    JOIN chain_members cm ON cm.member_id = a.attacker_id
    JOIN war_member_stats existing ON existing.war_id = a.war_id AND existing.member_id = a.attacker_id
    LEFT JOIN member_averages ma ON ma.member_id = a.attacker_id
    LEFT JOIN war_average wa ON 1 = 1
    WHERE a.war_id = ?
      AND a.attacker_faction_id = ${HOME_FACTION_ID}
      AND a.attacker_id IS NOT NULL
      AND ${OUTGOING_ACTION_WINDOW_SQL}
    GROUP BY a.war_id, a.attacker_id
    ON CONFLICT(war_id, member_id) DO UPDATE SET
      member_name = COALESCE(excluded.member_name, war_member_stats.member_name),
      respect_gained = excluded.respect_gained,
      respect_gained_raw = excluded.respect_gained_raw,
      chain_bonus_hits_vs_enemy = excluded.chain_bonus_hits_vs_enemy,
      chain_bonus_respect_removed = excluded.chain_bonus_respect_removed,
      chain_bonus_hit_values_vs_enemy = excluded.chain_bonus_hit_values_vs_enemy,
      chain_bonus_hit_details_vs_enemy = excluded.chain_bonus_hit_details_vs_enemy
    `,
  )
    .bind(warId, warId, warId, warId)
    .run();

  return d1Changes(result);
}

async function refreshWarDefendChainBonusAdjustmentsFromRaw(
  env: Env,
  warId: number,
): Promise<number> {
  const result = await env.DB.prepare(
    `
    WITH chain_defenders AS (
      SELECT DISTINCT a.defender_id AS member_id
      FROM attacks a
      JOIN wars w ON w.id = a.war_id
      WHERE a.war_id = ?
        AND a.defender_faction_id = ${HOME_FACTION_ID}
        AND a.defender_id IS NOT NULL
        AND w.enemy_faction_id IS NOT NULL
        AND a.attacker_faction_id = w.enemy_faction_id
        AND a.result IN (${POSITIVE_RESULTS_SQL})
        AND a.chain IN (${CHAIN_BONUS_HITS_SQL})
        AND ${DEFENSE_ACTION_WINDOW_SQL}
    ),
    member_averages AS (
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
      respect_lost,
      respect_lost_non_hospitalized,
      respect_lost_raw,
      enemy_chain_bonus_hits_received,
      enemy_chain_bonus_respect_removed,
      enemy_chain_bonus_hit_values_received,
      enemy_chain_bonus_hit_details_received
    )
    SELECT
      a.war_id,
      a.defender_id,
      MAX(a.defender_name),
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
         AND a.result != 'Hospitalized'
        THEN CASE
          WHEN a.chain IN (${CHAIN_BONUS_HITS_SQL})
          THEN COALESCE(ma.avg_respect, wa.avg_respect, 0)
          ELSE a.respect_gain
        END
        ELSE 0
      END), 0) AS respect_lost_non_hospitalized,
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
      END, char(10)), '') AS enemy_chain_bonus_hit_details_received
    FROM attacks a
    JOIN wars w ON w.id = a.war_id
    JOIN chain_defenders cd ON cd.member_id = a.defender_id
    JOIN war_member_stats existing ON existing.war_id = a.war_id AND existing.member_id = a.defender_id
    LEFT JOIN member_averages ma ON ma.attacker_id = a.attacker_id
    LEFT JOIN war_average wa ON 1 = 1
    WHERE a.war_id = ?
      AND a.defender_faction_id = ${HOME_FACTION_ID}
      AND a.defender_id IS NOT NULL
      AND w.enemy_faction_id IS NOT NULL
      AND a.attacker_faction_id = w.enemy_faction_id
      AND ${DEFENSE_ACTION_WINDOW_SQL}
    GROUP BY a.war_id, a.defender_id
    ON CONFLICT(war_id, member_id) DO UPDATE SET
      member_name = COALESCE(excluded.member_name, war_member_stats.member_name),
      respect_lost = excluded.respect_lost,
      respect_lost_non_hospitalized = excluded.respect_lost_non_hospitalized,
      respect_lost_raw = excluded.respect_lost_raw,
      enemy_chain_bonus_hits_received = excluded.enemy_chain_bonus_hits_received,
      enemy_chain_bonus_respect_removed = excluded.enemy_chain_bonus_respect_removed,
      enemy_chain_bonus_hit_values_received = excluded.enemy_chain_bonus_hit_values_received,
      enemy_chain_bonus_hit_details_received = excluded.enemy_chain_bonus_hit_details_received
    `,
  )
    .bind(warId, warId, warId, warId)
    .run();

  return d1Changes(result);
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
        defends_lost_non_hospitalized = 0,
        respect_lost = 0,
        respect_lost_non_hospitalized = 0,
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
${ATTACK_MEMBER_STAT_MERGE_SQL}
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
  await upsertWarMemberCombatBuckets(env, warId, ingestRunId);
  return appliedAttacks;
}

async function upsertWarMemberCombatBuckets(
  env: Env,
  warId: number,
  ingestRunId?: string,
): Promise<void> {
  if (ingestRunId) {
    await upsertIngestedWarMemberCombatBuckets(env, warId, ingestRunId);
    return;
  }

  const bindValues = [
    warId,
    warId,
    warId,
    warId,
    MEMBER_ACTIVITY_BUCKET_SECONDS,
    MEMBER_ACTIVITY_BUCKET_SECONDS,
    warId,
    MEMBER_ACTIVITY_BUCKET_SECONDS,
    MEMBER_ACTIVITY_BUCKET_SECONDS,
    warId,
  ];

  await env.DB.prepare(
    `
    WITH outgoing_member_averages AS (
      SELECT
        a.attacker_id AS member_id,
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
      GROUP BY a.attacker_id
    ),
    outgoing_war_average AS (
      SELECT AVG(a.respect_gain) AS avg_respect
      FROM attacks a
      JOIN wars w ON w.id = a.war_id
      WHERE a.war_id = ?
        AND a.attacker_faction_id = ${HOME_FACTION_ID}
        AND ${OUTGOING_ACTION_WINDOW_SQL}
        AND (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
        AND a.result IN (${POSITIVE_RESULTS_SQL})
        AND (a.chain IS NULL OR a.chain NOT IN (${CHAIN_BONUS_HITS_SQL}))
    ),
    defend_member_averages AS (
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
    defend_war_average AS (
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
    ),
    bucket_rows AS (
      SELECT
        a.war_id,
        a.attacker_id AS member_id,
        CAST((a.started / ?) AS INTEGER) * ? AS bucket_start,
        SUM(CASE
          WHEN (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
           AND a.result IN (${POSITIVE_RESULTS_SQL})
          THEN 1
          ELSE 0
        END) AS attacks_successful,
        SUM(CASE
          WHEN (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
           AND a.result = 'Assist'
          THEN 1
          ELSE 0
        END) AS assists_vs_enemy,
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
        0 AS defends_lost,
        0 AS defends_won,
        0 AS defends_other,
        COALESCE(SUM(CASE
          WHEN (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
           AND a.result IN (${POSITIVE_RESULTS_SQL})
          THEN CASE
            WHEN a.chain IN (${CHAIN_BONUS_HITS_SQL})
            THEN COALESCE(oma.avg_respect, owa.avg_respect, 0)
            ELSE a.respect_gain
          END
          ELSE 0
        END), 0) AS respect_gained,
        0 AS respect_lost
      FROM attacks a
      JOIN wars w ON w.id = a.war_id
      LEFT JOIN outgoing_member_averages oma ON oma.member_id = a.attacker_id
      LEFT JOIN outgoing_war_average owa ON 1 = 1
      WHERE a.war_id = ?
        AND a.started IS NOT NULL
        AND a.attacker_faction_id = ${HOME_FACTION_ID}
        AND a.attacker_id IS NOT NULL
        AND ${OUTGOING_ACTION_WINDOW_SQL}
      GROUP BY a.war_id, a.attacker_id, bucket_start
      HAVING attacks_successful > 0
        OR assists_vs_enemy > 0
        OR outside_hits > 0
        OR respect_gained > 0

      UNION ALL

      SELECT
        a.war_id,
        a.defender_id AS member_id,
        CAST((a.started / ?) AS INTEGER) * ? AS bucket_start,
        0 AS attacks_successful,
        0 AS assists_vs_enemy,
        0 AS outside_hits,
        SUM(CASE
          WHEN a.result IN (${POSITIVE_RESULTS_SQL})
          THEN 1
          ELSE 0
        END) AS defends_lost,
        SUM(CASE
          WHEN a.result IN (${DEFEND_WON_RESULTS_SQL})
          THEN 1
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
        0 AS respect_gained,
        COALESCE(SUM(CASE
          WHEN a.result IN (${POSITIVE_RESULTS_SQL})
          THEN CASE
            WHEN a.chain IN (${CHAIN_BONUS_HITS_SQL})
            THEN COALESCE(dma.avg_respect, dwa.avg_respect, 0)
            ELSE a.respect_gain
          END
          ELSE 0
        END), 0) AS respect_lost
      FROM attacks a
      JOIN wars w ON w.id = a.war_id
      LEFT JOIN defend_member_averages dma ON dma.attacker_id = a.attacker_id
      LEFT JOIN defend_war_average dwa ON 1 = 1
      WHERE a.war_id = ?
        AND a.started IS NOT NULL
        AND a.defender_faction_id = ${HOME_FACTION_ID}
        AND a.defender_id IS NOT NULL
        AND w.enemy_faction_id IS NOT NULL
        AND a.attacker_faction_id = w.enemy_faction_id
        AND ${DEFENSE_ACTION_WINDOW_SQL}
      GROUP BY a.war_id, a.defender_id, bucket_start
      HAVING defends_lost > 0
        OR defends_won > 0
        OR defends_other > 0
        OR respect_lost > 0
    ),
    grouped_rows AS (
      SELECT
        war_id,
        member_id,
        bucket_start,
        SUM(attacks_successful) AS attacks_successful,
        SUM(assists_vs_enemy) AS assists_vs_enemy,
        SUM(outside_hits) AS outside_hits,
        SUM(defends_lost) AS defends_lost,
        SUM(defends_won) AS defends_won,
        SUM(defends_other) AS defends_other,
        SUM(respect_gained) AS respect_gained,
        SUM(respect_lost) AS respect_lost
      FROM bucket_rows
      GROUP BY war_id, member_id, bucket_start
    )
    INSERT INTO war_member_combat_buckets (
      war_id,
      member_id,
      bucket_start,
      attacks_successful,
      assists_vs_enemy,
      outside_hits,
      defends_lost,
      defends_won,
      defends_other,
      respect_gained,
      respect_lost
    )
    SELECT
      war_id,
      member_id,
      bucket_start,
      attacks_successful,
      assists_vs_enemy,
      outside_hits,
      defends_lost,
      defends_won,
      defends_other,
      respect_gained,
      respect_lost
    FROM grouped_rows
    WHERE true
    ON CONFLICT(war_id, member_id, bucket_start) DO UPDATE SET
      attacks_successful = war_member_combat_buckets.attacks_successful + excluded.attacks_successful,
      assists_vs_enemy = war_member_combat_buckets.assists_vs_enemy + excluded.assists_vs_enemy,
      outside_hits = war_member_combat_buckets.outside_hits + excluded.outside_hits,
      defends_lost = war_member_combat_buckets.defends_lost + excluded.defends_lost,
      defends_won = war_member_combat_buckets.defends_won + excluded.defends_won,
      defends_other = war_member_combat_buckets.defends_other + excluded.defends_other,
      respect_gained = war_member_combat_buckets.respect_gained + excluded.respect_gained,
      respect_lost = war_member_combat_buckets.respect_lost + excluded.respect_lost
    `,
  )
    .bind(...bindValues)
    .run();
}

async function upsertIngestedWarMemberCombatBuckets(
  env: Env,
  warId: number,
  ingestRunId: string,
): Promise<void> {
  await env.DB.prepare(
    `
    WITH outgoing_member_averages AS (
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
    outgoing_war_average AS (
      SELECT
        CASE
          WHEN COALESCE(SUM(attacks_vs_enemy_successful), 0) > 0
          THEN SUM(respect_gained_raw) * 1.0 / SUM(attacks_vs_enemy_successful)
          ELSE NULL
        END AS avg_respect
      FROM war_member_stats
      WHERE war_id = ?
    ),
    defend_war_average AS (
      SELECT
        CASE
          WHEN COALESCE(SUM(defends_total - defends_won - defends_other), 0) > 0
          THEN SUM(respect_lost_raw) * 1.0 / SUM(defends_total - defends_won - defends_other)
          ELSE NULL
        END AS avg_respect
      FROM war_member_stats
      WHERE war_id = ?
    ),
    bucket_rows AS (
      SELECT
        a.war_id,
        a.attacker_id AS member_id,
        CAST((a.started / ?) AS INTEGER) * ? AS bucket_start,
        SUM(CASE
          WHEN (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
           AND a.result IN (${POSITIVE_RESULTS_SQL})
          THEN 1
          ELSE 0
        END) AS attacks_successful,
        SUM(CASE
          WHEN (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
           AND a.result = 'Assist'
          THEN 1
          ELSE 0
        END) AS assists_vs_enemy,
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
        0 AS defends_lost,
        0 AS defends_won,
        0 AS defends_other,
        COALESCE(SUM(CASE
          WHEN (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
           AND a.result IN (${POSITIVE_RESULTS_SQL})
          THEN CASE
            WHEN a.chain IN (${CHAIN_BONUS_HITS_SQL})
            THEN COALESCE(oma.avg_respect, owa.avg_respect, a.respect_gain, 0)
            ELSE a.respect_gain
          END
          ELSE 0
        END), 0) AS respect_gained,
        0 AS respect_lost
      FROM attacks a
      JOIN wars w ON w.id = a.war_id
      LEFT JOIN outgoing_member_averages oma ON oma.member_id = a.attacker_id
      LEFT JOIN outgoing_war_average owa ON 1 = 1
      WHERE a.war_id = ?
        AND a.ingest_run_id = ?
        AND a.started IS NOT NULL
        AND a.attacker_faction_id = ${HOME_FACTION_ID}
        AND a.attacker_id IS NOT NULL
        AND ${OUTGOING_ACTION_WINDOW_SQL}
      GROUP BY a.war_id, a.attacker_id, bucket_start
      HAVING attacks_successful > 0
        OR assists_vs_enemy > 0
        OR outside_hits > 0
        OR respect_gained > 0

      UNION ALL

      SELECT
        a.war_id,
        a.defender_id AS member_id,
        CAST((a.started / ?) AS INTEGER) * ? AS bucket_start,
        0 AS attacks_successful,
        0 AS assists_vs_enemy,
        0 AS outside_hits,
        SUM(CASE
          WHEN a.result IN (${POSITIVE_RESULTS_SQL})
          THEN 1
          ELSE 0
        END) AS defends_lost,
        SUM(CASE
          WHEN a.result IN (${DEFEND_WON_RESULTS_SQL})
          THEN 1
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
        0 AS respect_gained,
        COALESCE(SUM(CASE
          WHEN a.result IN (${POSITIVE_RESULTS_SQL})
          THEN CASE
            WHEN a.chain IN (${CHAIN_BONUS_HITS_SQL})
            THEN COALESCE(dwa.avg_respect, a.respect_gain, 0)
            ELSE a.respect_gain
          END
          ELSE 0
        END), 0) AS respect_lost
      FROM attacks a
      JOIN wars w ON w.id = a.war_id
      LEFT JOIN defend_war_average dwa ON 1 = 1
      WHERE a.war_id = ?
        AND a.ingest_run_id = ?
        AND a.started IS NOT NULL
        AND a.defender_faction_id = ${HOME_FACTION_ID}
        AND a.defender_id IS NOT NULL
        AND w.enemy_faction_id IS NOT NULL
        AND a.attacker_faction_id = w.enemy_faction_id
        AND ${DEFENSE_ACTION_WINDOW_SQL}
      GROUP BY a.war_id, a.defender_id, bucket_start
      HAVING defends_lost > 0
        OR defends_won > 0
        OR defends_other > 0
        OR respect_lost > 0
    ),
    grouped_rows AS (
      SELECT
        war_id,
        member_id,
        bucket_start,
        SUM(attacks_successful) AS attacks_successful,
        SUM(assists_vs_enemy) AS assists_vs_enemy,
        SUM(outside_hits) AS outside_hits,
        SUM(defends_lost) AS defends_lost,
        SUM(defends_won) AS defends_won,
        SUM(defends_other) AS defends_other,
        SUM(respect_gained) AS respect_gained,
        SUM(respect_lost) AS respect_lost
      FROM bucket_rows
      GROUP BY war_id, member_id, bucket_start
    )
    INSERT INTO war_member_combat_buckets (
      war_id,
      member_id,
      bucket_start,
      attacks_successful,
      assists_vs_enemy,
      outside_hits,
      defends_lost,
      defends_won,
      defends_other,
      respect_gained,
      respect_lost
    )
    SELECT
      war_id,
      member_id,
      bucket_start,
      attacks_successful,
      assists_vs_enemy,
      outside_hits,
      defends_lost,
      defends_won,
      defends_other,
      respect_gained,
      respect_lost
    FROM grouped_rows
    WHERE true
    ON CONFLICT(war_id, member_id, bucket_start) DO UPDATE SET
      attacks_successful = war_member_combat_buckets.attacks_successful + excluded.attacks_successful,
      assists_vs_enemy = war_member_combat_buckets.assists_vs_enemy + excluded.assists_vs_enemy,
      outside_hits = war_member_combat_buckets.outside_hits + excluded.outside_hits,
      defends_lost = war_member_combat_buckets.defends_lost + excluded.defends_lost,
      defends_won = war_member_combat_buckets.defends_won + excluded.defends_won,
      defends_other = war_member_combat_buckets.defends_other + excluded.defends_other,
      respect_gained = war_member_combat_buckets.respect_gained + excluded.respect_gained,
      respect_lost = war_member_combat_buckets.respect_lost + excluded.respect_lost
    `,
  )
    .bind(
      warId,
      warId,
      warId,
      MEMBER_ACTIVITY_BUCKET_SECONDS,
      MEMBER_ACTIVITY_BUCKET_SECONDS,
      warId,
      ingestRunId,
      MEMBER_ACTIVITY_BUCKET_SECONDS,
      MEMBER_ACTIVITY_BUCKET_SECONDS,
      warId,
      ingestRunId,
    )
    .run();
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
${ATTACK_MEMBER_STAT_MERGE_SQL}
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
        NULL AS attacker_id,
        NULL AS avg_respect
      WHERE 0
    ),
    war_average AS (
      SELECT
        CASE
          WHEN COALESCE(SUM(defends_total - defends_won - defends_other), 0) > 0
          THEN SUM(respect_lost_raw) * 1.0 / SUM(defends_total - defends_won - defends_other)
          ELSE NULL
        END AS avg_respect
      FROM war_member_stats
      WHERE war_id = ?
    )
    INSERT INTO war_member_stats (
      war_id,
      member_id,
      member_name,
      defends_total,
      defends_won,
      defends_other,
      defends_lost_non_hospitalized,
      respect_lost,
      respect_lost_non_hospitalized,
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
      SUM(CASE
        WHEN a.result IN (${POSITIVE_RESULTS_SQL})
         AND a.result != 'Hospitalized'
        THEN 1
        ELSE 0
      END) AS defends_lost_non_hospitalized,
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
         AND a.result != 'Hospitalized'
        THEN CASE
          WHEN a.chain IN (${CHAIN_BONUS_HITS_SQL})
          THEN COALESCE(ma.avg_respect, wa.avg_respect, 0)
          ELSE a.respect_gain
        END
        ELSE 0
      END), 0) AS respect_lost_non_hospitalized,
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
${DEFEND_MEMBER_STAT_MERGE_SQL}
    `,
  )
    .bind(warId, warId, ingestRunId)
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
      defends_lost_non_hospitalized,
      respect_lost,
      respect_lost_non_hospitalized,
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
      SUM(CASE
        WHEN a.result IN (${POSITIVE_RESULTS_SQL})
         AND a.result != 'Hospitalized'
        THEN 1
        ELSE 0
      END) AS defends_lost_non_hospitalized,
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
         AND a.result != 'Hospitalized'
        THEN CASE
          WHEN a.chain IN (${CHAIN_BONUS_HITS_SQL})
          THEN COALESCE(ma.avg_respect, wa.avg_respect, 0)
          ELSE a.respect_gain
        END
        ELSE 0
      END), 0) AS respect_lost_non_hospitalized,
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
${DEFEND_MEMBER_STAT_MERGE_SQL}
    `,
  )
    .bind(warId, warId, warId, HOME_FACTION_ID)
    .run();
}
