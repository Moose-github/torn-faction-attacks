import { HOME_FACTION_ID } from "./constants";
import { Env } from "./types";

export type EnemyTargetCleanupMetrics = {
  writeStatements: number;
  changedRows: number;
  enemyRosterRowsDeleted: number;
  homeBattlestatRowsCleared: number;
  enemyHeatmapRowsDeleted: number;
};

type EnemyTargetCleanupOptions = {
  clearCachedEnemyRoster?: boolean;
  clearHomeComparisonStats?: boolean;
  clearReplaceableHeatmaps?: boolean;
};

export async function clearEnemyDataForNewTarget(
  env: Env,
  nextFactionId: number,
  options: EnemyTargetCleanupOptions = {},
): Promise<EnemyTargetCleanupMetrics> {
  const metrics = emptyEnemyTargetCleanupMetrics();

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
          networth = NULL,
          networth_updated_at = NULL,
          updated_at = unixepoch()
      WHERE ff_battlestats IS NOT NULL
         OR ff_battlestats_updated_at IS NOT NULL
         OR bsp_battlestats IS NOT NULL
         OR bsp_battlestats_updated_at IS NOT NULL
         OR networth IS NOT NULL
         OR networth_updated_at IS NOT NULL
      `,
    ).run();
    const changes = d1Changes(result);
    metrics.writeStatements += 1;
    metrics.changedRows += changes;
    metrics.homeBattlestatRowsCleared += changes;
  }

  if (options.clearReplaceableHeatmaps) {
    const heatmapMetrics = await clearReplaceableEnemyHeatmaps(env, nextFactionId);
    addEnemyTargetCleanupMetrics(metrics, heatmapMetrics);
  }

  return metrics;
}

function emptyEnemyTargetCleanupMetrics(): EnemyTargetCleanupMetrics {
  return {
    writeStatements: 0,
    changedRows: 0,
    enemyRosterRowsDeleted: 0,
    homeBattlestatRowsCleared: 0,
    enemyHeatmapRowsDeleted: 0,
  };
}

function addEnemyTargetCleanupMetrics(
  target: EnemyTargetCleanupMetrics,
  source: EnemyTargetCleanupMetrics,
): void {
  target.writeStatements += source.writeStatements;
  target.changedRows += source.changedRows;
  target.enemyRosterRowsDeleted += source.enemyRosterRowsDeleted;
  target.homeBattlestatRowsCleared += source.homeBattlestatRowsCleared;
  target.enemyHeatmapRowsDeleted += source.enemyHeatmapRowsDeleted;
}

async function clearReplaceableEnemyHeatmaps(
  env: Env,
  nextFactionId: number,
): Promise<EnemyTargetCleanupMetrics> {
  const metrics = emptyEnemyTargetCleanupMetrics();
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
