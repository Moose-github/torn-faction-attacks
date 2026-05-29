import { HOME_FACTION_ID, SOURCE_NAME } from "./constants";
import { bumpWarCacheVersionById } from "./cacheVersions";
import { clearLiveEnemyTrackingData } from "./enemyScouting";
import { finalizeWar, rebuildWarMemberStatsFromRaw, rebuildWarSummaryFromMemberStats } from "./summaries";
import { WAR_RETURNING_COLUMNS } from "./sql";
import { readSyncState, upsertSyncTimestamp } from "./syncState";
import { Env, WarRow } from "./types";
import { nowSeconds } from "./utils";

export async function startWarTracking(
  env: Env,
  options: { warId: number; startedAt: number },
): Promise<void> {
  await env.DB.prepare(
    `
    UPDATE wars
    SET status = 'active'
    WHERE id = ?
    `,
  )
    .bind(options.warId)
    .run();

  await setCurrentWarState(env, options.warId, options.startedAt);
  await backfillWarAssignments(env, options.warId, options.startedAt);
  await refreshWarDerivedStats(env, options.warId);
}

export async function clearCurrentWarState(env: Env, warId?: number): Promise<void> {
  const warFilter = warId === undefined ? "" : "AND active_war_id = ?";
  const statement = env.DB.prepare(
    `
    UPDATE sync_state
    SET active_war_id = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE name = ?
      ${warFilter}
    `,
  );

  if (warId === undefined) {
    await statement.bind(SOURCE_NAME).run();
    return;
  }

  await statement.bind(SOURCE_NAME, warId).run();
}

export async function readCurrentWarId(env: Env): Promise<number | null> {
  const state = await readSyncState(env, SOURCE_NAME);

  return state?.active_war_id ?? null;
}

export async function recordTermedWarPracticalFinish(
  env: Env,
  options: {
    warId: number;
    finishAt: number;
    enemyFactionId: number | null;
    tornWarId?: number | null;
    preserveExistingFinish?: boolean;
  },
): Promise<void> {
  const finishAssignment = options.preserveExistingFinish
    ? "practical_finish_time = COALESCE(practical_finish_time, ?)"
    : "practical_finish_time = ?";
  const tornWarAssignment =
    options.tornWarId !== undefined ? ", torn_war_id = COALESCE(torn_war_id, ?)" : "";
  const bindValues: unknown[] = [options.finishAt];

  if (options.tornWarId !== undefined) {
    bindValues.push(options.tornWarId);
  }
  bindValues.push(options.warId);

  await env.DB.prepare(
    `
    UPDATE wars
    SET ${finishAssignment}
        ${tornWarAssignment}
    WHERE id = ?
    `,
  )
    .bind(...bindValues)
    .run();

  await stopLiveEnemyTracking(env, options.warId, options.enemyFactionId);
  await refreshWarDerivedStats(env, options.warId);
  await bumpWarCacheVersionById(env, options.warId);
}

export async function setWarPracticalWindow(
  env: Env,
  options: {
    warId: number;
    practicalStartTime: number;
    practicalFinishTime: number | null;
    enemyFactionId: number | null;
    warType?: string;
    factionRespectLimit?: number | null;
    memberRespectLimit?: number | null;
  },
): Promise<WarRow | null> {
  const warTypeAssignment = options.warType === undefined
    ? ""
    : `,
        war_type = ?,
        auto_end_enabled = CASE WHEN ? = 'termed' THEN auto_end_enabled ELSE 0 END,
        faction_respect_limit = CASE WHEN ? = 'termed' THEN ? ELSE NULL END,
        member_respect_limit = CASE WHEN ? = 'termed' THEN ? ELSE NULL END`;
  const bindValues: Array<number | string | null> = [
    options.practicalStartTime,
    options.practicalFinishTime,
  ];

  if (options.warType !== undefined) {
    bindValues.push(
      options.warType,
      options.warType,
      options.warType,
      options.factionRespectLimit ?? null,
      options.warType,
      options.memberRespectLimit ?? null,
    );
  }

  bindValues.push(options.warId);

  const war = (await env.DB.prepare(
    `
    UPDATE wars
    SET practical_start_time = ?,
        practical_finish_time = ?
        ${warTypeAssignment}
    WHERE id = ?
    RETURNING
      ${WAR_RETURNING_COLUMNS}
    `,
  )
    .bind(...bindValues)
    .first()) as WarRow | null;

  if (options.practicalFinishTime !== null && options.practicalFinishTime < nowSeconds()) {
    await stopLiveEnemyTracking(env, options.warId, options.enemyFactionId);
  }

  await refreshWarDerivedStats(env, options.warId);
  await bumpWarCacheVersionById(env, options.warId);
  return war;
}

export async function endWarPractically(
  env: Env,
  options: {
    warId: number;
    finishAt: number;
    enemyFactionId: number | null;
  },
): Promise<void> {
  await env.DB.prepare(
    `
    UPDATE wars
    SET status = 'ended',
        practical_finish_time = ?
    WHERE id = ?
    `,
  )
    .bind(options.finishAt, options.warId)
    .run();

  await clearCurrentWarState(env, options.warId);
  await stopLiveEnemyTracking(env, options.warId, options.enemyFactionId);
  await finalizeWar(env, options.warId);
  await bumpWarCacheVersionById(env, options.warId);
}

export async function applyTornOfficialWarEnd(
  env: Env,
  options: {
    warId: number;
    officialEndTime: number;
    tornWarId: number;
    currentEnemyFactionId: number | null;
    enemyFactionId: number | null;
    homeScore: number | null;
    enemyScore: number | null;
    winnerFactionId: number | null;
  },
): Promise<void> {
  await env.DB.prepare(
    `
    UPDATE wars
    SET status = 'ended',
        official_end_time = ?,
        practical_finish_time = COALESCE(practical_finish_time, ?),
        torn_war_id = COALESCE(torn_war_id, ?),
        enemy_faction_id = COALESCE(?, enemy_faction_id),
        official_home_score = ?,
        official_enemy_score = ?,
        winner_faction_id = COALESCE(?, winner_faction_id)
    WHERE id = ?
    `,
  )
    .bind(
      options.officialEndTime,
      options.officialEndTime,
      options.tornWarId,
      options.enemyFactionId,
      options.homeScore,
      options.enemyScore,
      options.winnerFactionId,
      options.warId,
    )
    .run();

  await clearCurrentWarState(env);
  await stopLiveEnemyTracking(
    env,
    options.warId,
    options.enemyFactionId ?? options.currentEnemyFactionId,
  );
  await bumpWarCacheVersionById(env, options.warId);
}

export async function refreshWarDerivedStats(env: Env, warId: number): Promise<void> {
  await rebuildWarMemberStatsFromRaw(env, warId);
  await rebuildWarSummaryFromMemberStats(env, warId);
}

async function setCurrentWarState(
  env: Env,
  warId: number,
  startedAt: number,
): Promise<void> {
  await upsertSyncTimestamp(env, SOURCE_NAME, startedAt, warId);
}

async function backfillWarAssignments(
  env: Env,
  warId: number,
  startedAt: number,
): Promise<void> {
  await env.DB.prepare(
    `
    UPDATE attacks
    SET war_id = ?
    WHERE war_id IS NULL
      AND started >= ?
      AND (
        attacker_faction_id = ?
        OR defender_faction_id = ?
      )
    `,
  )
    .bind(warId, startedAt, HOME_FACTION_ID, HOME_FACTION_ID)
    .run();
}

async function stopLiveEnemyTracking(
  env: Env,
  warId: number,
  enemyFactionId: number | null,
): Promise<void> {
  if (enemyFactionId === null) {
    return;
  }

  await clearLiveEnemyTrackingData(env, warId, enemyFactionId);
}
