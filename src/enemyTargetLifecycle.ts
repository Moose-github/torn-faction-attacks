import { clearEnemyLiveTrackingRows } from "./enemyLiveTrackingCleanup";
import { clearSyncLatch, setSyncLatch } from "./syncLatches";
import { Env } from "./types";
import { d1Changes, nowSeconds } from "./utils";

export type EnemyTargetLifecycleMetrics = {
  writeStatements: number;
  changedRows: number;
  enemyRosterRowsDeleted: number;
  enemyBigHitterRowsDeleted: number;
  enemyControlRowsDeleted: number;
  enemyPushRowsDeleted: number;
  enemyPushAlertLatchesCleared: number;
  enemyHitStatRowsDeleted: number;
  homeComparisonStatsRowsCleared: number;
  enemyActivitySampleRowsDeleted: number;
  fillCompletionLatchesCleared: number;
};

type EnemyTargetMatchedOptions = {
  warId?: number;
  clearCachedEnemyRoster?: boolean;
  clearHomeComparisonStats?: boolean;
  clearReplaceableHeatmaps?: boolean;
};

const BSP_FILL_COMPLETE_STATE_PREFIX = "enemy_target_bsp_fill_complete";
const ENEMY_NETWORTH_FILL_COMPLETE_STATE_PREFIX = "enemy_target_networth_fill_complete";
const ENEMY_HIT_STATS_FILL_COMPLETE_STATE_PREFIX = "enemy_target_hit_stats_fill_complete";
const FF_FILL_COMPLETE_STATE_PREFIX = "enemy_target_ff_fill_complete";
const COMPARISON_STATS_COMPLETE_STATE_PREFIX = "enemy_target_comparison_stats_complete";
const STATS_IMAGE_PENDING_STATE_PREFIX = "enemy_target_stats_image_pending";
const STATS_IMAGE_SENT_STATE_PREFIX = "enemy_target_stats_image_sent";

export async function canInitializeEnemyTarget(env: Env, nextFactionId: number): Promise<boolean> {
  const cachedFactions = ((await env.DB.prepare(
    `
    SELECT DISTINCT faction_id
    FROM enemy_faction_members
    WHERE faction_id != ?
    `,
  )
    .bind(nextFactionId)
    .all()).results ?? []) as { faction_id: number }[];

  for (const cachedFaction of cachedFactions) {
    const unfinishedWar = (await env.DB.prepare(
      `
      SELECT id
      FROM wars
      WHERE enemy_faction_id = ?
        AND official_end_time IS NULL
      ORDER BY practical_start_time DESC
      LIMIT 1
      `,
    )
      .bind(cachedFaction.faction_id)
      .first()) as { id: number } | null;

    if (unfinishedWar) {
      return false;
    }
  }

  return true;
}

export async function handleEnemyTargetMatched(
  env: Env,
  nextFactionId: number,
  options: EnemyTargetMatchedOptions = {},
): Promise<EnemyTargetLifecycleMetrics> {
  const metrics = emptyEnemyTargetLifecycleMetrics();

  if (options.clearCachedEnemyRoster) {
    const result = await env.DB.prepare(`DELETE FROM enemy_faction_members`).run();
    const changes = d1Changes(result);
    metrics.writeStatements += 1;
    metrics.changedRows += changes;
    metrics.enemyRosterRowsDeleted += changes;

    const trackerTargetClear = await env.DB.prepare(`DELETE FROM discord_travel_tracker_target WHERE id = 1`).run();
    metrics.writeStatements += 1;
    metrics.changedRows += d1Changes(trackerTargetClear);

    const hitStatsResult = await env.DB.prepare(`DELETE FROM enemy_hit_stat_snapshots`).run();
    const hitStatsChanges = d1Changes(hitStatsResult);
    metrics.writeStatements += 1;
    metrics.changedRows += hitStatsChanges;
    metrics.enemyHitStatRowsDeleted += hitStatsChanges;

    await clearEnemyLiveTrackingForTargetReplacement(env, nextFactionId, metrics, options.warId);
  }

  if (options.clearHomeComparisonStats) {
    const result = await env.DB.prepare(
      `
      UPDATE home_faction_members
      SET ff_battlestats = NULL,
          ff_battlestats_updated_at = NULL,
          bsp_battlestats = NULL,
          bsp_battlestats_updated_at = NULL,
          updated_at = unixepoch()
      WHERE ff_battlestats IS NOT NULL
         OR ff_battlestats_updated_at IS NOT NULL
         OR bsp_battlestats IS NOT NULL
         OR bsp_battlestats_updated_at IS NOT NULL
      `,
    ).run();
    const changes = d1Changes(result);
    metrics.writeStatements += 1;
    metrics.changedRows += changes;
    metrics.homeComparisonStatsRowsCleared += changes;
  }

  if (options.clearReplaceableHeatmaps) {
    const heatmapMetrics = await clearEnemyActivitySamplesForTargetReplacement(env);
    addEnemyTargetLifecycleMetrics(metrics, heatmapMetrics);
  }

  if (options.warId !== undefined) {
    const latchChanges = await clearEnemyTargetFillCompletionLatches(
      env,
      options.warId,
      nextFactionId,
    );
    await setSyncLatch(
      env,
      enemyTargetStatsImagePendingLatchName(options.warId, nextFactionId),
      nowSeconds(),
    );
    const sentClear = await clearSyncLatch(
      env,
      enemyTargetStatsImageSentLatchName(options.warId, nextFactionId),
    );
    metrics.writeStatements += 7;
    metrics.changedRows += latchChanges;
    metrics.changedRows += 1 + d1Changes(sentClear);
    metrics.fillCompletionLatchesCleared += latchChanges;
  }

  return metrics;
}

export function enemyTargetBspFillCompleteLatchName(warId: number, enemyFactionId: number): string {
  return `${BSP_FILL_COMPLETE_STATE_PREFIX}:${warId}:${enemyFactionId}`;
}

export function enemyTargetFfFillCompleteLatchName(warId: number, enemyFactionId: number): string {
  return `${FF_FILL_COMPLETE_STATE_PREFIX}:${warId}:${enemyFactionId}`;
}

export function enemyTargetNetworthFillCompleteLatchName(
  warId: number,
  enemyFactionId: number,
): string {
  return `${ENEMY_NETWORTH_FILL_COMPLETE_STATE_PREFIX}:${warId}:${enemyFactionId}`;
}

export function enemyTargetHitStatsFillCompleteLatchName(
  warId: number,
  enemyFactionId: number,
): string {
  return `${ENEMY_HIT_STATS_FILL_COMPLETE_STATE_PREFIX}:${warId}:${enemyFactionId}`;
}

export function enemyTargetComparisonStatsCompleteLatchName(
  warId: number,
  enemyFactionId: number,
): string {
  return `${COMPARISON_STATS_COMPLETE_STATE_PREFIX}:${warId}:${enemyFactionId}`;
}

export function enemyTargetStatsImagePendingLatchName(
  warId: number,
  enemyFactionId: number,
): string {
  return `${STATS_IMAGE_PENDING_STATE_PREFIX}:${warId}:${enemyFactionId}`;
}

export function enemyTargetStatsImageSentLatchName(warId: number, enemyFactionId: number): string {
  return `${STATS_IMAGE_SENT_STATE_PREFIX}:${warId}:${enemyFactionId}`;
}

function emptyEnemyTargetLifecycleMetrics(): EnemyTargetLifecycleMetrics {
  return {
    writeStatements: 0,
    changedRows: 0,
    enemyRosterRowsDeleted: 0,
    enemyBigHitterRowsDeleted: 0,
    enemyControlRowsDeleted: 0,
    enemyPushRowsDeleted: 0,
    enemyPushAlertLatchesCleared: 0,
    enemyHitStatRowsDeleted: 0,
    homeComparisonStatsRowsCleared: 0,
    enemyActivitySampleRowsDeleted: 0,
    fillCompletionLatchesCleared: 0,
  };
}

function addEnemyTargetLifecycleMetrics(
  target: EnemyTargetLifecycleMetrics,
  source: EnemyTargetLifecycleMetrics,
): void {
  target.writeStatements += source.writeStatements;
  target.changedRows += source.changedRows;
  target.enemyRosterRowsDeleted += source.enemyRosterRowsDeleted;
  target.enemyBigHitterRowsDeleted += source.enemyBigHitterRowsDeleted;
  target.enemyControlRowsDeleted += source.enemyControlRowsDeleted;
  target.enemyPushRowsDeleted += source.enemyPushRowsDeleted;
  target.enemyPushAlertLatchesCleared += source.enemyPushAlertLatchesCleared;
  target.enemyHitStatRowsDeleted += source.enemyHitStatRowsDeleted;
  target.homeComparisonStatsRowsCleared += source.homeComparisonStatsRowsCleared;
  target.enemyActivitySampleRowsDeleted += source.enemyActivitySampleRowsDeleted;
  target.fillCompletionLatchesCleared += source.fillCompletionLatchesCleared;
}

async function clearEnemyTargetFillCompletionLatches(
  env: Env,
  warId: number,
  enemyFactionId: number,
): Promise<number> {
  const results = await Promise.all([
    clearSyncLatch(env, enemyTargetBspFillCompleteLatchName(warId, enemyFactionId)),
    clearSyncLatch(env, enemyTargetFfFillCompleteLatchName(warId, enemyFactionId)),
    clearSyncLatch(env, enemyTargetNetworthFillCompleteLatchName(warId, enemyFactionId)),
    clearSyncLatch(env, enemyTargetHitStatsFillCompleteLatchName(warId, enemyFactionId)),
    clearSyncLatch(env, enemyTargetComparisonStatsCompleteLatchName(warId, enemyFactionId)),
  ]);

  return results.reduce((total, result) => total + d1Changes(result), 0);
}

async function clearEnemyLiveTrackingForTargetReplacement(
  env: Env,
  nextFactionId: number,
  metrics: EnemyTargetLifecycleMetrics,
  warId?: number,
): Promise<void> {
  if (warId === undefined) {
    return;
  }

  const liveClear = await clearEnemyLiveTrackingRows(env, warId, nextFactionId, {
    clearMemberStatuses: false,
  });
  metrics.writeStatements += liveClear.writeStatements;
  metrics.changedRows += liveClear.changedRows;
  metrics.enemyBigHitterRowsDeleted += liveClear.bigHitterRowsDeleted;
  metrics.enemyControlRowsDeleted += liveClear.controlSnapshotRowsDeleted;
  metrics.enemyPushRowsDeleted += liveClear.pushSnapshotRowsDeleted;
  metrics.enemyPushAlertLatchesCleared += liveClear.pushAlertLatchesCleared;
  metrics.enemyActivitySampleRowsDeleted += liveClear.enemyActivitySampleRowsDeleted;
}

async function clearEnemyActivitySamplesForTargetReplacement(
  env: Env,
): Promise<EnemyTargetLifecycleMetrics> {
  const metrics = emptyEnemyTargetLifecycleMetrics();

  const factionResult = await env.DB.prepare(
    `
    DELETE FROM enemy_faction_activity_samples
    `,
  ).run();

  const memberResult = await env.DB.prepare(
    `
    DELETE FROM enemy_member_activity_samples
    `,
  ).run();

  const changes = d1Changes(factionResult) + d1Changes(memberResult);
  metrics.writeStatements += 2;
  metrics.changedRows += changes;
  metrics.enemyActivitySampleRowsDeleted += changes;

  return metrics;
}
