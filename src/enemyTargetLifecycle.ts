import { HOME_FACTION_ID } from "./constants";
import { clearSyncLatch } from "./syncLatches";
import { Env } from "./types";

export type EnemyTargetLifecycleMetrics = {
  writeStatements: number;
  changedRows: number;
  enemyRosterRowsDeleted: number;
  homeComparisonStatsRowsCleared: number;
  enemyHeatmapRowsDeleted: number;
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
const FF_FILL_COMPLETE_STATE_PREFIX = "enemy_target_ff_fill_complete";

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
    const heatmapMetrics = await clearReplaceableEnemyHeatmaps(env, nextFactionId);
    addEnemyTargetLifecycleMetrics(metrics, heatmapMetrics);
  }

  if (options.warId !== undefined) {
    const latchChanges = await clearEnemyTargetFillCompletionLatches(
      env,
      options.warId,
      nextFactionId,
    );
    metrics.writeStatements += 2;
    metrics.changedRows += latchChanges;
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

function emptyEnemyTargetLifecycleMetrics(): EnemyTargetLifecycleMetrics {
  return {
    writeStatements: 0,
    changedRows: 0,
    enemyRosterRowsDeleted: 0,
    homeComparisonStatsRowsCleared: 0,
    enemyHeatmapRowsDeleted: 0,
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
  target.homeComparisonStatsRowsCleared += source.homeComparisonStatsRowsCleared;
  target.enemyHeatmapRowsDeleted += source.enemyHeatmapRowsDeleted;
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
  ]);

  return results.reduce((total, result) => total + d1Changes(result), 0);
}

async function clearReplaceableEnemyHeatmaps(
  env: Env,
  nextFactionId: number,
): Promise<EnemyTargetLifecycleMetrics> {
  const metrics = emptyEnemyTargetLifecycleMetrics();
  const cachedFactions = ((await env.DB.prepare(
    `
    SELECT DISTINCT faction_id
    FROM faction_activity_heatmap
    WHERE faction_id != ?
      AND faction_id != ?
    `,
  )
    .bind(nextFactionId, HOME_FACTION_ID)
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
      continue;
    }

    const result = await env.DB.prepare(
      `
      DELETE FROM faction_activity_heatmap
      WHERE faction_id = ?
      `,
    )
      .bind(cachedFaction.faction_id)
      .run();
    const changes = d1Changes(result);
    metrics.writeStatements += 1;
    metrics.changedRows += changes;
    metrics.enemyHeatmapRowsDeleted += changes;
  }

  return metrics;
}

function d1Changes(result: unknown): number {
  const changes = (result as { meta?: { changes?: unknown } } | null)?.meta?.changes;
  return typeof changes === "number" && Number.isFinite(changes) ? changes : 0;
}
