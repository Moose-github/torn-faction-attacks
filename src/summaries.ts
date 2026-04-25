import { HOME_FACTION_ID, POSITIVE_RESULTS_SQL } from "./constants";
import { Env } from "./types";

export async function applyIncrementalWarSummaries(
  env: Env,
  warId: number,
  ingestRunId: string,
): Promise<void> {
  await ensureWarSummaryRow(env, warId);
  await incrementWarMemberStatsFromRun(env, warId, ingestRunId);
  await incrementWarSummaryFromRun(env, warId, ingestRunId);
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
  await rollWarIntoCareerStats(env, warId);

  await env.DB.prepare(
    `
    UPDATE wars
    SET finalized_at = unixepoch()
    WHERE id = ?
    `,
  )
    .bind(warId)
    .run();

  await env.DB.prepare(
    `
    UPDATE war_summary
    SET finalized_at = unixepoch(), updated_at = unixepoch()
    WHERE war_id = ?
    `,
  )
    .bind(warId)
    .run();
}

export async function rebuildWarSummaryFromRaw(env: Env, warId: number): Promise<void> {
  await env.DB.prepare(
    `
    INSERT INTO war_summary (
      war_id,
      war_name,
      status,
      started_at,
      ended_at,
      total_attacks,
      total_respect_gain,
      total_respect_lost,
      unique_attackers,
      unique_members_lost_defends,
      first_attack_at,
      last_attack_at,
      updated_at,
      finalized_at
    )
    SELECT
      w.id,
      w.name,
      w.status,
      w.started_at,
      w.ended_at,
      COUNT(a.id) AS total_attacks,
      COALESCE(SUM(CASE WHEN a.attacker_faction_id = ${HOME_FACTION_ID} THEN a.respect_gain ELSE 0 END), 0) AS total_respect_gain,
      COALESCE(SUM(CASE
        WHEN a.defender_faction_id = ${HOME_FACTION_ID}
         AND a.result IN (${POSITIVE_RESULTS_SQL})
        THEN a.respect_gain
        ELSE 0
      END), 0) AS total_respect_lost,
      COUNT(DISTINCT CASE WHEN a.attacker_faction_id = ${HOME_FACTION_ID} THEN a.attacker_id END) AS unique_attackers,
      COUNT(DISTINCT CASE
        WHEN a.defender_faction_id = ${HOME_FACTION_ID}
         AND a.result IN (${POSITIVE_RESULTS_SQL})
        THEN a.defender_id
      END) AS unique_members_lost_defends,
      MIN(a.started) AS first_attack_at,
      MAX(a.started) AS last_attack_at,
      unixepoch() AS updated_at,
      (SELECT finalized_at FROM war_summary WHERE war_id = w.id) AS finalized_at
    FROM wars w
    LEFT JOIN attacks a ON a.war_id = w.id
    WHERE w.id = ?
    GROUP BY w.id
    ON CONFLICT(war_id) DO UPDATE SET
      war_name = excluded.war_name,
      status = excluded.status,
      started_at = excluded.started_at,
      ended_at = excluded.ended_at,
      total_attacks = excluded.total_attacks,
      total_respect_gain = excluded.total_respect_gain,
      total_respect_lost = excluded.total_respect_lost,
      unique_attackers = excluded.unique_attackers,
      unique_members_lost_defends = excluded.unique_members_lost_defends,
      first_attack_at = excluded.first_attack_at,
      last_attack_at = excluded.last_attack_at,
      updated_at = excluded.updated_at,
      finalized_at = COALESCE(excluded.finalized_at, war_summary.finalized_at)
    `,
  )
    .bind(warId)
    .run();
}

export async function rebuildWarMemberStatsFromRaw(env: Env, warId: number): Promise<void> {
  await env.DB.prepare(`DELETE FROM war_member_stats WHERE war_id = ?`)
    .bind(warId)
    .run();

  await env.DB.prepare(
    `
    INSERT INTO war_member_stats (
      war_id,
      member_id,
      member_name,
      attacks_made,
      wins,
      losses,
      draws,
      escapes,
      stalemates,
      respect_gain,
      first_attack_at,
      last_attack_at
    )
    SELECT
      a.war_id,
      a.attacker_id,
      MAX(a.attacker_name),
      COUNT(*) AS attacks_made,
      SUM(CASE WHEN a.result IN (${POSITIVE_RESULTS_SQL}) THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN a.result = 'Lost' THEN 1 ELSE 0 END) AS losses,
      SUM(CASE WHEN a.result = 'Draw' THEN 1 ELSE 0 END) AS draws,
      SUM(CASE WHEN a.result = 'Escaped' THEN 1 ELSE 0 END) AS escapes,
      SUM(CASE WHEN a.result = 'Stalemate' THEN 1 ELSE 0 END) AS stalemates,
      COALESCE(SUM(a.respect_gain), 0) AS respect_gain,
      MIN(a.started) AS first_attack_at,
      MAX(a.started) AS last_attack_at
    FROM attacks a
    WHERE a.war_id = ?
      AND a.attacker_faction_id = ?
      AND a.attacker_id IS NOT NULL
    GROUP BY a.war_id, a.attacker_id
    `,
  )
    .bind(warId, HOME_FACTION_ID)
    .run();

  await env.DB.prepare(
    `
    INSERT INTO war_member_stats (
      war_id,
      member_id,
      member_name,
      defends_lost,
      respect_lost,
      first_attack_at,
      last_attack_at
    )
    SELECT
      a.war_id,
      a.defender_id,
      MAX(a.defender_name),
      COUNT(*) AS defends_lost,
      COALESCE(SUM(a.respect_gain), 0) AS respect_lost,
      MIN(a.started) AS first_attack_at,
      MAX(a.started) AS last_attack_at
    FROM attacks a
    WHERE a.war_id = ?
      AND a.defender_faction_id = ?
      AND a.defender_id IS NOT NULL
      AND a.result IN (${POSITIVE_RESULTS_SQL})
    GROUP BY a.war_id, a.defender_id
    ON CONFLICT(war_id, member_id) DO UPDATE SET
      member_name = COALESCE(excluded.member_name, war_member_stats.member_name),
      defends_lost = excluded.defends_lost,
      respect_lost = excluded.respect_lost,
      first_attack_at = CASE
        WHEN war_member_stats.first_attack_at IS NULL THEN excluded.first_attack_at
        WHEN excluded.first_attack_at IS NULL THEN war_member_stats.first_attack_at
        ELSE MIN(war_member_stats.first_attack_at, excluded.first_attack_at)
      END,
      last_attack_at = CASE
        WHEN war_member_stats.last_attack_at IS NULL THEN excluded.last_attack_at
        WHEN excluded.last_attack_at IS NULL THEN war_member_stats.last_attack_at
        ELSE MAX(war_member_stats.last_attack_at, excluded.last_attack_at)
      END
    `,
  )
    .bind(warId, HOME_FACTION_ID)
    .run();
}

async function ensureWarSummaryRow(env: Env, warId: number): Promise<void> {
  await env.DB.prepare(
    `
    INSERT INTO war_summary (
      war_id,
      war_name,
      status,
      started_at,
      ended_at,
      updated_at
    )
    SELECT
      id,
      name,
      status,
      started_at,
      ended_at,
      unixepoch()
    FROM wars
    WHERE id = ?
    ON CONFLICT(war_id) DO NOTHING
    `,
  )
    .bind(warId)
    .run();
}

async function incrementWarMemberStatsFromRun(
  env: Env,
  warId: number,
  ingestRunId: string,
): Promise<void> {
  await env.DB.prepare(
    `
    INSERT INTO war_member_stats (
      war_id,
      member_id,
      member_name,
      attacks_made,
      wins,
      losses,
      draws,
      escapes,
      stalemates,
      respect_gain,
      first_attack_at,
      last_attack_at
    )
    SELECT
      a.war_id,
      a.attacker_id,
      MAX(a.attacker_name),
      COUNT(*) AS attacks_made,
      SUM(CASE WHEN a.result IN (${POSITIVE_RESULTS_SQL}) THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN a.result = 'Lost' THEN 1 ELSE 0 END) AS losses,
      SUM(CASE WHEN a.result = 'Draw' THEN 1 ELSE 0 END) AS draws,
      SUM(CASE WHEN a.result = 'Escaped' THEN 1 ELSE 0 END) AS escapes,
      SUM(CASE WHEN a.result = 'Stalemate' THEN 1 ELSE 0 END) AS stalemates,
      COALESCE(SUM(a.respect_gain), 0) AS respect_gain,
      MIN(a.started) AS first_attack_at,
      MAX(a.started) AS last_attack_at
    FROM attacks a
    WHERE a.war_id = ?
      AND a.ingest_run_id = ?
      AND a.attacker_faction_id = ?
      AND a.attacker_id IS NOT NULL
    GROUP BY a.war_id, a.attacker_id
    ON CONFLICT(war_id, member_id) DO UPDATE SET
      member_name = COALESCE(excluded.member_name, war_member_stats.member_name),
      attacks_made = war_member_stats.attacks_made + excluded.attacks_made,
      wins = war_member_stats.wins + excluded.wins,
      losses = war_member_stats.losses + excluded.losses,
      draws = war_member_stats.draws + excluded.draws,
      escapes = war_member_stats.escapes + excluded.escapes,
      stalemates = war_member_stats.stalemates + excluded.stalemates,
      respect_gain = war_member_stats.respect_gain + excluded.respect_gain,
      first_attack_at = CASE
        WHEN war_member_stats.first_attack_at IS NULL THEN excluded.first_attack_at
        WHEN excluded.first_attack_at IS NULL THEN war_member_stats.first_attack_at
        ELSE MIN(war_member_stats.first_attack_at, excluded.first_attack_at)
      END,
      last_attack_at = CASE
        WHEN war_member_stats.last_attack_at IS NULL THEN excluded.last_attack_at
        WHEN excluded.last_attack_at IS NULL THEN war_member_stats.last_attack_at
        ELSE MAX(war_member_stats.last_attack_at, excluded.last_attack_at)
      END
    `,
  )
    .bind(warId, ingestRunId, HOME_FACTION_ID)
    .run();

  await env.DB.prepare(
    `
    INSERT INTO war_member_stats (
      war_id,
      member_id,
      member_name,
      defends_lost,
      respect_lost,
      first_attack_at,
      last_attack_at
    )
    SELECT
      a.war_id,
      a.defender_id,
      MAX(a.defender_name),
      COUNT(*) AS defends_lost,
      COALESCE(SUM(a.respect_gain), 0) AS respect_lost,
      MIN(a.started) AS first_attack_at,
      MAX(a.started) AS last_attack_at
    FROM attacks a
    WHERE a.war_id = ?
      AND a.ingest_run_id = ?
      AND a.defender_faction_id = ?
      AND a.defender_id IS NOT NULL
      AND a.result IN (${POSITIVE_RESULTS_SQL})
    GROUP BY a.war_id, a.defender_id
    ON CONFLICT(war_id, member_id) DO UPDATE SET
      member_name = COALESCE(excluded.member_name, war_member_stats.member_name),
      defends_lost = war_member_stats.defends_lost + excluded.defends_lost,
      respect_lost = war_member_stats.respect_lost + excluded.respect_lost,
      first_attack_at = CASE
        WHEN war_member_stats.first_attack_at IS NULL THEN excluded.first_attack_at
        WHEN excluded.first_attack_at IS NULL THEN war_member_stats.first_attack_at
        ELSE MIN(war_member_stats.first_attack_at, excluded.first_attack_at)
      END,
      last_attack_at = CASE
        WHEN war_member_stats.last_attack_at IS NULL THEN excluded.last_attack_at
        WHEN excluded.last_attack_at IS NULL THEN war_member_stats.last_attack_at
        ELSE MAX(war_member_stats.last_attack_at, excluded.last_attack_at)
      END
    `,
  )
    .bind(warId, ingestRunId, HOME_FACTION_ID)
    .run();
}

async function incrementWarSummaryFromRun(
  env: Env,
  warId: number,
  ingestRunId: string,
): Promise<void> {
  const delta = (await env.DB.prepare(
    `
    SELECT
      COUNT(*) AS total_attacks,
      COALESCE(SUM(CASE WHEN attacker_faction_id = ${HOME_FACTION_ID} THEN respect_gain ELSE 0 END), 0) AS total_respect_gain,
      COALESCE(SUM(CASE
        WHEN defender_faction_id = ${HOME_FACTION_ID}
         AND result IN (${POSITIVE_RESULTS_SQL})
        THEN respect_gain
        ELSE 0
      END), 0) AS total_respect_lost,
      MIN(started) AS first_attack_at,
      MAX(started) AS last_attack_at
    FROM attacks
    WHERE war_id = ?
      AND ingest_run_id = ?
    `,
  )
    .bind(warId, ingestRunId)
    .first()) as {
    total_attacks: number | null;
    total_respect_gain: number | null;
    total_respect_lost: number | null;
    first_attack_at: number | null;
    last_attack_at: number | null;
  } | null;

  if (!delta || Number(delta.total_attacks ?? 0) === 0) {
    return;
  }

  await env.DB.prepare(
    `
    UPDATE war_summary
    SET
      total_attacks = total_attacks + ?,
      total_respect_gain = total_respect_gain + ?,
      total_respect_lost = total_respect_lost + ?,
      first_attack_at = CASE
        WHEN first_attack_at IS NULL THEN ?
        WHEN ? IS NULL THEN first_attack_at
        ELSE MIN(first_attack_at, ?)
      END,
      last_attack_at = CASE
        WHEN last_attack_at IS NULL THEN ?
        WHEN ? IS NULL THEN last_attack_at
        ELSE MAX(last_attack_at, ?)
      END,
      unique_attackers = (
        SELECT COUNT(*)
        FROM war_member_stats
        WHERE war_id = ?
          AND attacks_made > 0
      ),
      unique_members_lost_defends = (
        SELECT COUNT(*)
        FROM war_member_stats
        WHERE war_id = ?
          AND defends_lost > 0
      ),
      updated_at = unixepoch(),
      status = (SELECT status FROM wars WHERE id = ?),
      ended_at = (SELECT ended_at FROM wars WHERE id = ?)
    WHERE war_id = ?
    `,
  )
    .bind(
      Number(delta.total_attacks ?? 0),
      Number(delta.total_respect_gain ?? 0),
      Number(delta.total_respect_lost ?? 0),
      delta.first_attack_at,
      delta.first_attack_at,
      delta.first_attack_at,
      delta.last_attack_at,
      delta.last_attack_at,
      delta.last_attack_at,
      warId,
      warId,
      warId,
      warId,
      warId,
    )
    .run();
}

async function rollWarIntoCareerStats(env: Env, warId: number): Promise<void> {
  await env.DB.prepare(
    `
    INSERT INTO member_career_stats (
      member_id,
      member_name,
      wars_participated,
      attacks_made,
      wins,
      losses,
      draws,
      escapes,
      stalemates,
      respect_gain,
      defends_lost,
      respect_lost,
      first_seen_at,
      last_seen_at,
      updated_at
    )
    SELECT
      member_id,
      MAX(member_name),
      1,
      attacks_made,
      wins,
      losses,
      draws,
      escapes,
      stalemates,
      respect_gain,
      defends_lost,
      respect_lost,
      first_attack_at,
      last_attack_at,
      unixepoch()
    FROM war_member_stats
    WHERE war_id = ?
    GROUP BY member_id
    ON CONFLICT(member_id) DO UPDATE SET
      member_name = COALESCE(excluded.member_name, member_career_stats.member_name),
      wars_participated = member_career_stats.wars_participated + excluded.wars_participated,
      attacks_made = member_career_stats.attacks_made + excluded.attacks_made,
      wins = member_career_stats.wins + excluded.wins,
      losses = member_career_stats.losses + excluded.losses,
      draws = member_career_stats.draws + excluded.draws,
      escapes = member_career_stats.escapes + excluded.escapes,
      stalemates = member_career_stats.stalemates + excluded.stalemates,
      respect_gain = member_career_stats.respect_gain + excluded.respect_gain,
      defends_lost = member_career_stats.defends_lost + excluded.defends_lost,
      respect_lost = member_career_stats.respect_lost + excluded.respect_lost,
      first_seen_at = CASE
        WHEN member_career_stats.first_seen_at IS NULL THEN excluded.first_seen_at
        WHEN excluded.first_seen_at IS NULL THEN member_career_stats.first_seen_at
        ELSE MIN(member_career_stats.first_seen_at, excluded.first_seen_at)
      END,
      last_seen_at = CASE
        WHEN member_career_stats.last_seen_at IS NULL THEN excluded.last_seen_at
        WHEN excluded.last_seen_at IS NULL THEN member_career_stats.last_seen_at
        ELSE MAX(member_career_stats.last_seen_at, excluded.last_seen_at)
      END,
      updated_at = excluded.updated_at
    `,
  )
    .bind(warId)
    .run();
}
