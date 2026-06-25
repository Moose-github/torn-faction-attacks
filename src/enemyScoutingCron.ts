import { HOME_FACTION_ID } from "./constants";
import { sendDiscordMessageWithAttachments } from "./discord";
import {
  renderEnemyMemberStatsTablePng,
  renderStatsComparisonPng,
} from "./discordImageRenderer";
import {
  enemyTargetBspFillCompleteLatchName,
  enemyTargetComparisonStatsCompleteLatchName,
  enemyTargetFfFillCompleteLatchName,
  enemyTargetHitStatsFillCompleteLatchName,
  enemyTargetNetworthFillCompleteLatchName,
  enemyTargetStatsImagePendingLatchName,
  enemyTargetStatsImageSentLatchName,
} from "./enemyTargetLifecycle";
import {
  ENEMY_HIT_STAT_PER_KEY_LIMIT,
  emptyEnemyHitStatsRefreshMetrics,
  refreshMissingEnemyHitStats,
  type EnemyHitStatsRefreshMetrics,
} from "./enemyHitStats";
import {
  ENEMY_NETWORTH_MAX_ATTEMPTS,
  ENEMY_NETWORTH_PER_KEY_LIMIT,
  enemyNetworthCandidateLimit,
  partitionEnemyNetworthCandidates,
  pauseEnemyNetworthKey,
  readAvailableEnemyNetworthKeys,
  type TornApiKey,
} from "./enemyNetworth";
import { seedEnemyBigHittersForWar } from "./enemyBigHitters";
import { fetchTornPersonalStats, TornPersonalStatsHttpError } from "./personalStats";
import {
  clearSyncLatch,
  isSyncLatchSet,
  readSetSyncLatches,
  setSyncLatch,
} from "./syncLatches";
import { Env } from "./types";
import { corsHeaders, d1Changes, finiteNumber, json, nowSeconds } from "./utils";
import { isWarRoomMemberTrackingActive, isWarRoomMemberTrackingLive } from "./warRoomTracking";
import {
  runWarLiveStartedHooks,
  runWarPreLiveStartedHooks,
} from "./warLifecycleHooks";
import {
  clearLiveEnemyTrackingData,
  fetchBspBattlestatPrediction,
  readCurrentScoutingWar,
  readEnemyScouting,
  readHomeScouting,
  refreshEnemyFactionMemberStatuses,
  refreshMissingFfBattlestats,
} from "./enemyScouting";
import type {
  BspBattlestatRefreshMetrics,
  CurrentScoutingWar,
  EnemyFactionMemberRow,
  EnemyMemberTrackingRefreshMetrics,
  FfscouterRefreshMetrics,
  ScoutingNetworthRefreshMetrics,
} from "./enemyScouting";

const BSP_BATTLESTAT_REFRESH_LIMIT = 40;
const LIVE_ENEMY_TRACKING_CLEAR_STATE_PREFIX = "enemy_live_tracking_cleared";
const MAX_STORED_NETWORTH_ERROR_LENGTH = 240;

type EnemyTrackingSchedule = "always" | "live" | "war-room";

type EnemyTargetStateNames = {
  ff: string;
  bsp: string;
  networth: string;
  hitStats: string;
  comparisonStatsComplete: string;
  statsImagePending: string;
  statsImageSent: string;
  liveTrackingCleared: string;
};

type EnemyScoutingCronContext = {
  war: CurrentScoutingWar;
  stateNames: EnemyTargetStateNames;
  activeLatches: Set<string>;
};

export type EnemyStatsImageSendResult = {
  sent: boolean;
  skipped: boolean;
  reason?: string;
};

export type EnemyScoutingCronTickMetrics = {
  skipped: boolean;
  reason?: string;
  tracking: EnemyMemberTrackingRefreshMetrics;
  ff: FfscouterRefreshMetrics;
  networth: ScoutingNetworthRefreshMetrics;
  hitStats: EnemyHitStatsRefreshMetrics;
  bsp: BspBattlestatRefreshMetrics;
  image: EnemyStatsImageSendResult;
};

export async function runEnemyScoutingCronTick(
  env: Env,
  options: {
    trackingSchedule?: EnemyTrackingSchedule;
    scheduledTime?: number;
    skipTracking?: boolean;
    includeMembers?: boolean;
    bspLimit?: number;
    networthLimit?: number;
    hitStatsLimit?: number;
  } = {},
): Promise<EnemyScoutingCronTickMetrics> {
  const war = await readCurrentScoutingWar(env);
  if (!war) {
    return {
      ...emptyEnemyScoutingCronTickMetrics(),
      skipped: true,
      reason: "no current scouting war",
    };
  }

  await runDueWarRoomLifecycleHooks(env, war, options.scheduledTime);

  const stateNames = buildEnemyTargetStateNames(war.id, war.enemy_faction_id);
  const activeLatches = await readSetSyncLatches(env, Object.values(stateNames));
  const context: EnemyScoutingCronContext = { war, stateNames, activeLatches };
  const metrics: EnemyScoutingCronTickMetrics = {
    ...emptyEnemyScoutingCronTickMetrics(),
    skipped: false,
  };

  if (!options.skipTracking) {
    metrics.tracking = await refreshCurrentEnemyMemberTrackingForScheduledTick(env, war, {
      trackingSchedule: options.trackingSchedule ?? "always",
      scheduledTime: options.scheduledTime,
      includeMembers: options.includeMembers,
      activeLatches,
      stateNames,
    });
  }

  if (!activeLatches.has(stateNames.comparisonStatsComplete)) {
    if (!activeLatches.has(stateNames.ff)) {
      metrics.ff = await refreshMissingFfscouterEstimatesForContext(env, context);
    }

    if (!activeLatches.has(stateNames.networth)) {
      metrics.networth = await refreshMissingEnemyScoutingNetworthForContext(env, {
        limit: options.networthLimit ?? ENEMY_NETWORTH_PER_KEY_LIMIT,
        context,
      });
    }

    if (!activeLatches.has(stateNames.bsp)) {
      metrics.bsp = await refreshMissingBspBattlestatPredictionsForContext(env, {
        limit: options.bspLimit ?? BSP_BATTLESTAT_REFRESH_LIMIT,
        context,
      });
    }

    await markEnemyTargetComparisonStatsCompleteIfReady(env, context);
  }

  if (!activeLatches.has(stateNames.hitStats)) {
    metrics.hitStats = await refreshMissingEnemyHitStats(env, {
      warId: war.id,
      enemyFactionId: war.enemy_faction_id,
      completeLatchName: stateNames.hitStats,
      activeLatches,
      limit: options.hitStatsLimit ?? ENEMY_HIT_STAT_PER_KEY_LIMIT,
    });
  }

  metrics.image = await sendPendingEnemyStatsComparisonImageForContext(env, context);
  return metrics;
}

export async function refreshCurrentEnemyMemberTracking(
  env: Env,
  options: { includeMembers?: boolean; liveOnly?: boolean } = {},
): Promise<EnemyMemberTrackingRefreshMetrics> {
  const war = await readCurrentScoutingWar(env);
  if (!war) {
    return {
      writeStatements: 0,
      changedRows: 0,
      fetchedMembers: 0,
      updatedMembers: 0,
      skipped: true,
      factionId: null,
    };
  }

  return refreshCurrentEnemyMemberTrackingForWar(env, war, options);
}

async function refreshCurrentEnemyMemberTrackingForScheduledTick(
  env: Env,
  war: CurrentScoutingWar,
  options: {
    trackingSchedule: EnemyTrackingSchedule;
    scheduledTime?: number;
    includeMembers?: boolean;
    activeLatches?: Set<string>;
    stateNames?: EnemyTargetStateNames;
  },
): Promise<EnemyMemberTrackingRefreshMetrics> {
  const checkedAt = options.scheduledTime
    ? Math.floor(options.scheduledTime / 1000)
    : nowSeconds();

  if (!shouldRefreshEnemyTrackingForSchedule(war, options.trackingSchedule, checkedAt)) {
    return {
      writeStatements: 0,
      changedRows: 0,
      fetchedMembers: 0,
      updatedMembers: 0,
      skipped: true,
      factionId: war.enemy_faction_id,
    };
  }

  return refreshCurrentEnemyMemberTrackingForWar(env, war, {
    includeMembers: options.includeMembers,
    activeLatches: options.activeLatches,
    stateNames: options.stateNames,
  });
}

function shouldRefreshEnemyTrackingForSchedule(
  war: CurrentScoutingWar,
  schedule: EnemyTrackingSchedule,
  checkedAt: number,
): boolean {
  if (schedule === "always") {
    return true;
  }

  if (schedule === "live") {
    return isWarRoomMemberTrackingLive(war, checkedAt);
  }

  if (isWarRoomMemberTrackingLive(war, checkedAt)) {
    return true;
  }

  const minute = new Date(checkedAt * 1000).getUTCMinutes();
  return minute % 5 === 0;
}

async function refreshCurrentEnemyMemberTrackingForWar(
  env: Env,
  war: CurrentScoutingWar,
  options: {
    includeMembers?: boolean;
    liveOnly?: boolean;
    activeLatches?: Set<string>;
    stateNames?: EnemyTargetStateNames;
  } = {},
): Promise<EnemyMemberTrackingRefreshMetrics> {
  const checkedAt = nowSeconds();
  if (options.liveOnly && !isWarRoomMemberTrackingLive(war, checkedAt)) {
    return {
      writeStatements: 0,
      changedRows: 0,
      fetchedMembers: 0,
      updatedMembers: 0,
      skipped: true,
      factionId: war.enemy_faction_id,
    };
  }

  if (!isWarRoomMemberTrackingActive(war, checkedAt)) {
    let clearMetrics = { writeStatements: 0, changedRows: 0 };
    const clearLatchName = options.stateNames?.liveTrackingCleared ?? liveEnemyTrackingClearLatchName(war.id);
    if (
      war.practical_finish_time !== null &&
      checkedAt > war.practical_finish_time &&
      !options.activeLatches?.has(clearLatchName)
    ) {
      clearMetrics = await clearLiveEnemyTrackingData(env, war.id, war.enemy_faction_id);
      options.activeLatches?.add(clearLatchName);
    }
    return {
      writeStatements: clearMetrics.writeStatements,
      changedRows: clearMetrics.changedRows,
      fetchedMembers: 0,
      updatedMembers: 0,
      skipped: true,
      factionId: war.enemy_faction_id,
    };
  }

  return refreshEnemyFactionMemberStatuses(
    env,
    war.id,
    war.name,
    war.enemy_faction_id,
    war.practical_start_time,
    war.enemy_scouting_status_checked_at,
    { includeMembers: options.includeMembers, warType: war.war_type },
  );
}

async function runDueWarRoomLifecycleHooks(
  env: Env,
  war: CurrentScoutingWar,
  scheduledTime?: number,
): Promise<void> {
  const checkedAt = scheduledTime ? Math.floor(scheduledTime / 1000) : nowSeconds();

  if (isWarRoomMemberTrackingActive(war, checkedAt)) {
    await runWarPreLiveStartedHooks(env, war.id);
  }

  if (isWarRoomMemberTrackingLive(war, checkedAt)) {
    await runWarLiveStartedHooks(env, war.id);
  }
}

export async function refreshMissingFfscouterEstimates(
  env: Env,
): Promise<FfscouterRefreshMetrics> {
  const scoutingWar = await readCurrentScoutingWar(env);
  if (!scoutingWar) {
    return { ...emptyFfscouterRefreshMetrics(), skipped: true };
  }

  const stateNames = buildEnemyTargetStateNames(scoutingWar.id, scoutingWar.enemy_faction_id);
  return refreshMissingFfscouterEstimatesForContext(env, {
    war: scoutingWar,
    stateNames,
    activeLatches: await readSetSyncLatches(env, [stateNames.ff]),
  });
}

async function refreshMissingFfscouterEstimatesForContext(
  env: Env,
  context: EnemyScoutingCronContext,
): Promise<FfscouterRefreshMetrics> {
  const metrics: FfscouterRefreshMetrics = {
    writeStatements: 0,
    changedRows: 0,
    enemyCandidates: 0,
    homeCandidates: 0,
    enemyUpdated: 0,
    homeUpdated: 0,
    skipped: false,
  };
  const scoutingWar = context.war;

  const completeLatchName = context.stateNames.ff;
  if (context.activeLatches.has(completeLatchName)) {
    return { ...metrics, skipped: true };
  }

  const enemyRows = (await env.DB.prepare(
    `
    SELECT *
    FROM enemy_faction_members
    WHERE faction_id = ?
      AND ff_battlestats IS NULL
    ORDER BY level DESC, name ASC
    `,
  )
    .bind(scoutingWar.enemy_faction_id)
    .all()).results as EnemyFactionMemberRow[] | undefined;

  metrics.enemyCandidates = enemyRows?.length ?? 0;
  const enemyMetrics = await refreshMissingFfBattlestats(env, enemyRows ?? []);
  metrics.writeStatements += enemyMetrics.writeStatements;
  metrics.changedRows += enemyMetrics.changedRows;
  metrics.enemyUpdated += enemyMetrics.changedRows;

  const homeRows = (await env.DB.prepare(
    `
    SELECT *
    FROM home_faction_members
    WHERE ff_battlestats IS NULL
      AND is_current = 1
    ORDER BY level DESC, name ASC
    `,
  ).all()).results as EnemyFactionMemberRow[] | undefined;

  metrics.homeCandidates = homeRows?.length ?? 0;
  const homeMetrics = await refreshMissingFfBattlestats(env, homeRows ?? [], "home_faction_members");
  metrics.writeStatements += homeMetrics.writeStatements;
  metrics.changedRows += homeMetrics.changedRows;
  metrics.homeUpdated += homeMetrics.changedRows;

  if (metrics.enemyCandidates + metrics.homeCandidates === 0) {
    await setSyncLatch(env, completeLatchName, nowSeconds());
    context.activeLatches.add(completeLatchName);
  }

  return metrics;
}

export async function refreshMissingBspBattlestatPredictions(
  env: Env,
  options: { limit?: number } = {},
): Promise<BspBattlestatRefreshMetrics> {
  const scoutingWar = await readCurrentScoutingWar(env);
  if (!scoutingWar) {
    return { ...emptyBspBattlestatRefreshMetrics(), skipped: true };
  }

  const stateNames = buildEnemyTargetStateNames(scoutingWar.id, scoutingWar.enemy_faction_id);
  return refreshMissingBspBattlestatPredictionsForContext(env, {
    ...options,
    context: {
      war: scoutingWar,
      stateNames,
      activeLatches: await readSetSyncLatches(env, [stateNames.bsp]),
    },
  });
}

async function refreshMissingBspBattlestatPredictionsForContext(
  env: Env,
  options: { limit?: number; context: EnemyScoutingCronContext },
): Promise<BspBattlestatRefreshMetrics> {
  const metrics: BspBattlestatRefreshMetrics = {
    writeStatements: 0,
    changedRows: 0,
    candidates: 0,
    updated: 0,
    skipped: false,
  };
  if (!env.BSP_TORN_API_KEY) {
    return { ...metrics, skipped: true };
  }

  const scoutingWar = options.context.war;

  const completeLatchName = options.context.stateNames.bsp;
  if (options.context.activeLatches.has(completeLatchName)) {
    return { ...metrics, skipped: true };
  }

  const enemyMetrics = await refreshMissingBspBattlestatPredictionsForFaction(
    env,
    "enemy_faction_members",
    scoutingWar.enemy_faction_id,
    undefined,
    options,
  );
  addBspBattlestatMetrics(metrics, enemyMetrics);

  const homeMetrics = await refreshMissingBspBattlestatPredictionsForFaction(
    env,
    "home_faction_members",
    HOME_FACTION_ID,
    undefined,
    options,
  );
  addBspBattlestatMetrics(metrics, homeMetrics);

  if (metrics.candidates === 0) {
    await setSyncLatch(env, completeLatchName, nowSeconds());
    options.context.activeLatches.add(completeLatchName);
  }

  return metrics;
}

function addBspBattlestatMetrics(
  target: BspBattlestatRefreshMetrics,
  source: BspBattlestatRefreshMetrics,
): void {
  target.writeStatements += source.writeStatements;
  target.changedRows += source.changedRows;
  target.candidates += source.candidates;
  target.updated += source.updated;
}

async function refreshMissingBspBattlestatPredictionsForFaction(
  env: Env,
  tableName: "enemy_faction_members" | "home_faction_members",
  factionId: number,
  rows?: EnemyFactionMemberRow[],
  options: { limit?: number } = {},
): Promise<BspBattlestatRefreshMetrics> {
  const metrics: BspBattlestatRefreshMetrics = {
    writeStatements: 0,
    changedRows: 0,
    candidates: 0,
    updated: 0,
    skipped: false,
  };
  if (!env.BSP_TORN_API_KEY) {
    return { ...metrics, skipped: true };
  }

  const limit = Math.max(
    1,
    Math.min(Math.floor(options.limit ?? BSP_BATTLESTAT_REFRESH_LIMIT), BSP_BATTLESTAT_REFRESH_LIMIT),
  );
  const candidateRows = rows
    ? rows
        .filter((row) => row.faction_id === factionId && row.bsp_battlestats_updated_at == null)
        .slice(0, limit)
    : ((await env.DB.prepare(
        `
        SELECT *
        FROM ${tableName}
        WHERE faction_id = ?
          AND bsp_battlestats_updated_at IS NULL
        ORDER BY ff_battlestats DESC NULLS LAST, level DESC, name ASC
        LIMIT ?
        `,
      )
        .bind(factionId, limit)
        .all()).results ?? []) as EnemyFactionMemberRow[];

  metrics.candidates = candidateRows.length;

  for (const row of candidateRows) {
    const prediction = await fetchBspBattlestatPrediction(env, row.member_id).catch((err) => {
      console.warn(`BSP battlestat prediction fetch failed for ${row.member_id}:`, err?.message || err);
      return null;
    });

    if (!prediction) {
      continue;
    }

    const result = await env.DB.prepare(
      `
      UPDATE ${tableName}
      SET bsp_battlestats = ?,
          bsp_battlestats_updated_at = unixepoch(),
          updated_at = unixepoch()
      WHERE faction_id = ?
        AND member_id = ?
        AND bsp_battlestats_updated_at IS NULL
      `,
    )
      .bind(
        prediction,
        factionId,
        row.member_id,
      )
      .run();

    const changes = d1Changes(result);
    metrics.writeStatements += 1;
    metrics.changedRows += changes;
    metrics.updated += changes;
  }

  return metrics;
}

export async function refreshMissingEnemyScoutingNetworth(
  env: Env,
  options: { limit?: number } = {},
): Promise<ScoutingNetworthRefreshMetrics> {
  const scoutingWar = await readCurrentScoutingWar(env);
  if (!scoutingWar) {
    return { ...emptyScoutingNetworthRefreshMetrics(), skipped: true };
  }

  const stateNames = buildEnemyTargetStateNames(scoutingWar.id, scoutingWar.enemy_faction_id);
  return refreshMissingEnemyScoutingNetworthForContext(env, {
    ...options,
    context: {
      war: scoutingWar,
      stateNames,
      activeLatches: await readSetSyncLatches(env, [stateNames.networth]),
    },
  });
}

async function refreshMissingEnemyScoutingNetworthForContext(
  env: Env,
  options: { limit?: number; context: EnemyScoutingCronContext },
): Promise<ScoutingNetworthRefreshMetrics> {
  const metrics: ScoutingNetworthRefreshMetrics = {
    writeStatements: 0,
    changedRows: 0,
    candidates: 0,
    updated: 0,
    failed: 0,
    rateLimited: 0,
    activeKeys: 0,
    skipped: false,
  };
  const scoutingWar = options.context.war;

  const completeLatchName = options.context.stateNames.networth;
  if (options.context.activeLatches.has(completeLatchName)) {
    return { ...metrics, skipped: true };
  }

  const perKeyLimit = Math.max(
    1,
    Math.min(Math.floor(options.limit ?? ENEMY_NETWORTH_PER_KEY_LIMIT), ENEMY_NETWORTH_PER_KEY_LIMIT),
  );
  const now = nowSeconds();
  const activeKeys = await readAvailableEnemyNetworthKeys(env, now);
  metrics.activeKeys = activeKeys.length;
  if (activeKeys.length === 0) {
    if (!(await hasRetryableEnemyNetworthRows(env, scoutingWar.enemy_faction_id))) {
      await setSyncLatch(env, completeLatchName, nowSeconds());
      options.context.activeLatches.add(completeLatchName);
    }
    return { ...metrics, skipped: true };
  }

  const rows = await readRetryableEnemyNetworthRows(
    env,
    scoutingWar.enemy_faction_id,
    enemyNetworthCandidateLimit(activeKeys.length, perKeyLimit),
  );

  metrics.candidates = rows.length;
  if (rows.length === 0) {
    await setSyncLatch(env, completeLatchName, nowSeconds());
    options.context.activeLatches.add(completeLatchName);
    return metrics;
  }

  const batches = partitionEnemyNetworthCandidates(rows, activeKeys, perKeyLimit);
  const results = await Promise.all(
    batches.map((batch) => processEnemyNetworthBatch(env, scoutingWar.enemy_faction_id, batch.key, batch.rows)),
  );
  for (const result of results) {
    metrics.writeStatements += result.writeStatements;
    metrics.changedRows += result.changedRows;
    metrics.updated += result.updated;
    metrics.failed += result.failed;
    metrics.rateLimited += result.rateLimited;
  }

  if (!(await hasRetryableEnemyNetworthRows(env, scoutingWar.enemy_faction_id))) {
    await setSyncLatch(env, completeLatchName, nowSeconds());
    options.context.activeLatches.add(completeLatchName);
  }

  return metrics;
}

async function readRetryableEnemyNetworthRows(
  env: Env,
  enemyFactionId: number,
  limit: number,
): Promise<EnemyFactionMemberRow[]> {
  return ((await env.DB.prepare(
    `
    SELECT *
    FROM enemy_faction_members
    WHERE faction_id = ?
      AND networth_updated_at IS NULL
      AND COALESCE(networth_attempt_count, 0) < ?
    ORDER BY COALESCE(networth_attempted_at, 0) ASC, level DESC, name ASC
    LIMIT ?
    `,
  )
    .bind(enemyFactionId, ENEMY_NETWORTH_MAX_ATTEMPTS, limit)
    .all()).results ?? []) as EnemyFactionMemberRow[];
}

async function hasRetryableEnemyNetworthRows(env: Env, enemyFactionId: number): Promise<boolean> {
  const row = await env.DB.prepare(
    `
    SELECT 1
    FROM enemy_faction_members
    WHERE faction_id = ?
      AND networth_updated_at IS NULL
      AND COALESCE(networth_attempt_count, 0) < ?
    LIMIT 1
    `,
  )
    .bind(enemyFactionId, ENEMY_NETWORTH_MAX_ATTEMPTS)
    .first();

  return row !== null;
}

async function processEnemyNetworthBatch(
  env: Env,
  enemyFactionId: number,
  key: TornApiKey,
  rows: EnemyFactionMemberRow[],
): Promise<Pick<ScoutingNetworthRefreshMetrics, "writeStatements" | "changedRows" | "updated" | "failed" | "rateLimited">> {
  const metrics = {
    writeStatements: 0,
    changedRows: 0,
    updated: 0,
    failed: 0,
    rateLimited: 0,
  };

  for (const row of rows) {
    try {
      const stats = await fetchTornPersonalStats(env, row.member_id, ["networth"], {
        apiKey: key.key,
        keySource: key.keySource,
      });
      const networth = finiteNumber(stats.networth);
      const result = await env.DB.prepare(
        `
        UPDATE enemy_faction_members
        SET networth = ?,
            networth_updated_at = unixepoch(),
            networth_attempted_at = unixepoch(),
            networth_error = NULL,
            networth_key_source = ?,
            updated_at = unixepoch()
        WHERE faction_id = ?
          AND member_id = ?
          AND networth_updated_at IS NULL
        `,
      )
        .bind(networth, key.keySource, enemyFactionId, row.member_id)
        .run();
      const changes = d1Changes(result);
      metrics.writeStatements += 1;
      metrics.changedRows += changes;
      metrics.updated += changes;
    } catch (err: any) {
      if (err instanceof TornPersonalStatsHttpError && err.status === 429) {
        await pauseEnemyNetworthKey(env, key.keySource, nowSeconds());
        await markEnemyNetworthRateLimited(env, enemyFactionId, row, key.keySource, err.message);
        metrics.writeStatements += 2;
        metrics.rateLimited += 1;
        break;
      }

      const result = await env.DB.prepare(
        `
        UPDATE enemy_faction_members
        SET networth_attempted_at = unixepoch(),
            networth_attempt_count = COALESCE(networth_attempt_count, 0) + 1,
            networth_error = ?,
            networth_key_source = ?,
            updated_at = unixepoch()
        WHERE faction_id = ?
          AND member_id = ?
          AND networth_updated_at IS NULL
        `,
      )
        .bind(storedNetworthError(err), key.keySource, enemyFactionId, row.member_id)
        .run();
      const changes = d1Changes(result);
      metrics.writeStatements += 1;
      metrics.changedRows += changes;
      metrics.failed += changes;
    }
  }

  return metrics;
}

async function markEnemyNetworthRateLimited(
  env: Env,
  enemyFactionId: number,
  row: EnemyFactionMemberRow,
  keySource: string,
  error: string,
): Promise<void> {
  await env.DB.prepare(
    `
    UPDATE enemy_faction_members
    SET networth_attempted_at = unixepoch(),
        networth_error = ?,
        networth_key_source = ?,
        updated_at = unixepoch()
    WHERE faction_id = ?
      AND member_id = ?
      AND networth_updated_at IS NULL
    `,
  )
    .bind(storedNetworthError(error), keySource, enemyFactionId, row.member_id)
    .run();
}

function storedNetworthError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.length > MAX_STORED_NETWORTH_ERROR_LENGTH
    ? `${message.slice(0, MAX_STORED_NETWORTH_ERROR_LENGTH - 3)}...`
    : message;
}

export async function sendPendingEnemyStatsComparisonImage(
  env: Env,
): Promise<EnemyStatsImageSendResult> {
  const scoutingWar = await readCurrentScoutingWar(env);
  if (!scoutingWar) {
    return { sent: false, skipped: true, reason: "no current scouting war" };
  }

  const stateNames = buildEnemyTargetStateNames(scoutingWar.id, scoutingWar.enemy_faction_id);
  const activeLatches = await readSetSyncLatches(env, Object.values(stateNames));
  return sendPendingEnemyStatsComparisonImageForContext(env, {
    war: scoutingWar,
    stateNames,
    activeLatches,
  });
}

export async function resetEnemyStatsImageFromRequest(env: Env): Promise<Response> {
  const scoutingWar = await readCurrentScoutingWar(env);
  if (!scoutingWar) {
    return json(
      { ok: false, error: "No current scouting war found", code: "NO_CURRENT_SCOUTING_WAR" },
      404,
    );
  }

  const stateNames = buildEnemyTargetStateNames(scoutingWar.id, scoutingWar.enemy_faction_id);
  const sentClear = await clearSyncLatch(env, stateNames.statsImageSent);
  await setSyncLatch(env, stateNames.statsImagePending, nowSeconds());

  return json({
    ok: true,
    war: {
      id: scoutingWar.id,
      name: scoutingWar.name,
      enemy_faction_id: scoutingWar.enemy_faction_id,
    },
    pending_latch: stateNames.statsImagePending,
    sent_latch: stateNames.statsImageSent,
    sent_latch_deleted: d1Changes(sentClear),
  });
}

export async function previewEnemyStatsImageFromRequest(url: URL, env: Env): Promise<Response> {
  const type = url.searchParams.get("type") ?? "comparison";
  if (type !== "comparison" && type !== "members") {
    return json(
      {
        ok: false,
        error: "Preview type must be comparison or members",
        code: "INVALID_PREVIEW_TYPE",
      },
      400,
    );
  }

  const scoutingWar = await readCurrentScoutingWar(env);
  if (!scoutingWar) {
    return json(
      { ok: false, error: "No current scouting war found", code: "NO_CURRENT_SCOUTING_WAR" },
      404,
    );
  }

  const [homeMembers, enemyMembers] = await Promise.all([
    readHomeScouting(env),
    readEnemyScouting(env, scoutingWar.enemy_faction_id),
  ]);
  const data = type === "comparison"
    ? await renderStatsComparisonPng({
        enemyName: scoutingWar.name,
        homeMembers,
        enemyMembers,
      })
    : await renderEnemyMemberStatsTablePng({
        enemyName: scoutingWar.name,
        enemyMembers,
      });
  const filename = type === "comparison"
    ? `enemy-stats-comparison-${scoutingWar.id}.png`
    : `enemy-member-stats-${scoutingWar.id}.png`;

  return new Response(data, {
    headers: {
      ...corsHeaders,
      "Content-Type": "image/png",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

async function sendPendingEnemyStatsComparisonImageForContext(
  env: Env,
  context: EnemyScoutingCronContext,
): Promise<EnemyStatsImageSendResult> {
  const scoutingWar = context.war;
  const pendingLatchName = context.stateNames.statsImagePending;
  if (!context.activeLatches.has(pendingLatchName)) {
    return { sent: false, skipped: true, reason: "no pending image" };
  }

  const sentLatchName = context.stateNames.statsImageSent;
  if (context.activeLatches.has(sentLatchName)) {
    await clearSyncLatch(env, pendingLatchName);
    context.activeLatches.delete(pendingLatchName);
    return { sent: false, skipped: true, reason: "already sent" };
  }

  const ready = await areEnemyTargetComparisonStatsComplete(
    env,
    scoutingWar.id,
    scoutingWar.enemy_faction_id,
    context,
  );
  if (!ready) {
    return { sent: false, skipped: true, reason: "stats still filling" };
  }

  const [homeMembers, enemyMembers] = await Promise.all([
    readHomeScouting(env),
    readEnemyScouting(env, scoutingWar.enemy_faction_id),
  ]);
  const statsComparisonPng = await renderStatsComparisonPng({
    enemyName: scoutingWar.name,
    homeMembers,
    enemyMembers,
  });
  const memberTablePng = await renderEnemyMemberStatsTablePng({
    enemyName: scoutingWar.name,
    enemyMembers,
  });
  const startAt = scoutingWar.official_start_time ?? scoutingWar.practical_start_time;

  await sendDiscordMessageWithAttachments(env, {
    content: `War matchup announced: Buttgrass vs ${scoutingWar.name}. Starts <t:${startAt}:R>`,
    attachments: [
      {
        filename: `enemy-stats-comparison-${scoutingWar.id}.png`,
        mimeType: "image/png",
        data: statsComparisonPng,
      },
      {
        filename: `enemy-member-stats-${scoutingWar.id}.png`,
        mimeType: "image/png",
        data: memberTablePng,
      },
    ],
  });

  await setSyncLatch(env, sentLatchName, nowSeconds());
  await clearSyncLatch(env, pendingLatchName);
  context.activeLatches.add(sentLatchName);
  context.activeLatches.delete(pendingLatchName);
  return { sent: true, skipped: false };
}

async function areEnemyTargetComparisonStatsComplete(
  env: Env,
  warId: number,
  enemyFactionId: number,
  context?: EnemyScoutingCronContext,
): Promise<boolean> {
  const stateNames = context?.stateNames ?? buildEnemyTargetStateNames(warId, enemyFactionId);
  if (context?.activeLatches.has(stateNames.comparisonStatsComplete)) {
    return true;
  }

  const requiredNames = [
    stateNames.ff,
    stateNames.bsp,
    stateNames.networth,
  ];

  if (context) {
    return requiredNames.every((name) => context.activeLatches.has(name));
  }

  const results = await Promise.all([
    isSyncLatchSet(env, stateNames.comparisonStatsComplete),
    ...requiredNames.map((name) => isSyncLatchSet(env, name)),
  ]);
  if (results[0]) {
    return true;
  }
  return results.slice(1).every(Boolean);
}

export async function isEnemyTargetComparisonStatsCompleteForWar(
  env: Env,
  warId: number,
  enemyFactionId: number,
): Promise<boolean> {
  return areEnemyTargetComparisonStatsComplete(env, warId, enemyFactionId);
}

async function markEnemyTargetComparisonStatsCompleteIfReady(
  env: Env,
  context: EnemyScoutingCronContext,
): Promise<void> {
  const requiredNames = [
    context.stateNames.ff,
    context.stateNames.bsp,
    context.stateNames.networth,
  ];
  if (!requiredNames.every((name) => context.activeLatches.has(name))) {
    return;
  }

  await setSyncLatch(env, context.stateNames.comparisonStatsComplete, nowSeconds());
  context.activeLatches.add(context.stateNames.comparisonStatsComplete);
  await seedEnemyBigHittersForWar(env, context.war.id, context.war.enemy_faction_id);
}

function buildEnemyTargetStateNames(warId: number, enemyFactionId: number): EnemyTargetStateNames {
  return {
    ff: enemyTargetFfFillCompleteLatchName(warId, enemyFactionId),
    bsp: enemyTargetBspFillCompleteLatchName(warId, enemyFactionId),
    networth: enemyTargetNetworthFillCompleteLatchName(warId, enemyFactionId),
    hitStats: enemyTargetHitStatsFillCompleteLatchName(warId, enemyFactionId),
    comparisonStatsComplete: enemyTargetComparisonStatsCompleteLatchName(warId, enemyFactionId),
    statsImagePending: enemyTargetStatsImagePendingLatchName(warId, enemyFactionId),
    statsImageSent: enemyTargetStatsImageSentLatchName(warId, enemyFactionId),
    liveTrackingCleared: liveEnemyTrackingClearLatchName(warId),
  };
}

function liveEnemyTrackingClearLatchName(warId: number): string {
  return `${LIVE_ENEMY_TRACKING_CLEAR_STATE_PREFIX}:${warId}`;
}

function emptyEnemyScoutingCronTickMetrics(): EnemyScoutingCronTickMetrics {
  return {
    skipped: false,
    tracking: emptyEnemyMemberTrackingRefreshMetrics(),
    ff: emptyFfscouterRefreshMetrics(),
    networth: emptyScoutingNetworthRefreshMetrics(),
    hitStats: emptyEnemyHitStatsRefreshMetrics(),
    bsp: emptyBspBattlestatRefreshMetrics(),
    image: { sent: false, skipped: true, reason: "not checked" },
  };
}

function emptyEnemyMemberTrackingRefreshMetrics(): EnemyMemberTrackingRefreshMetrics {
  return {
    writeStatements: 0,
    changedRows: 0,
    fetchedMembers: 0,
    updatedMembers: 0,
    skipped: true,
    factionId: null,
  };
}

function emptyFfscouterRefreshMetrics(): FfscouterRefreshMetrics {
  return {
    writeStatements: 0,
    changedRows: 0,
    enemyCandidates: 0,
    homeCandidates: 0,
    enemyUpdated: 0,
    homeUpdated: 0,
    skipped: true,
  };
}

function emptyBspBattlestatRefreshMetrics(): BspBattlestatRefreshMetrics {
  return {
    writeStatements: 0,
    changedRows: 0,
    candidates: 0,
    updated: 0,
    skipped: true,
  };
}

function emptyScoutingNetworthRefreshMetrics(): ScoutingNetworthRefreshMetrics {
  return {
    writeStatements: 0,
    changedRows: 0,
    candidates: 0,
    updated: 0,
    failed: 0,
    rateLimited: 0,
    activeKeys: 0,
    skipped: true,
  };
}
