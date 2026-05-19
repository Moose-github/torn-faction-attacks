import { HOME_FACTION_ID } from "./constants";
import { sendDiscordMessageWithAttachments } from "./discord";
import {
  enemyTargetBspFillCompleteLatchName,
  enemyTargetComparisonStatsCompleteLatchName,
  enemyTargetFfFillCompleteLatchName,
  enemyTargetNetworthFillCompleteLatchName,
  enemyTargetStatsImagePendingLatchName,
  enemyTargetStatsImageSentLatchName,
} from "./enemyTargetLifecycle";
import { fetchTornPersonalStats } from "./personalStats";
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
  SIMPLE_PNG_COLORS,
  createPngCanvas,
  drawLine,
  drawText,
  encodePng,
  fillRect,
  strokeRect,
} from "./simplePng";
import {
  SCOUTING_BATTLE_STATS_BUCKETS,
  SCOUTING_NETWORTH_BUCKETS,
  ScoutingBucket,
  ScoutingComparisonMetric,
} from "../shared/scoutingBuckets";
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
const NETWORTH_REFRESH_LIMIT = 40;
const HOME_STATS_LABEL = "Buttgrass";
const LIVE_ENEMY_TRACKING_CLEAR_STATE_PREFIX = "enemy_live_tracking_cleared";

type EnemyTrackingSchedule = "always" | "live" | "war-room";

type EnemyTargetStateNames = {
  ff: string;
  bsp: string;
  networth: string;
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
        limit: options.networthLimit ?? NETWORTH_REFRESH_LIMIT,
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
    war.enemy_scouting_status_checked_at,
    { includeMembers: options.includeMembers },
  );
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
    skipped: false,
  };
  const scoutingWar = options.context.war;

  const completeLatchName = options.context.stateNames.networth;
  if (options.context.activeLatches.has(completeLatchName)) {
    return { ...metrics, skipped: true };
  }

  const limit = Math.max(
    1,
    Math.min(Math.floor(options.limit ?? NETWORTH_REFRESH_LIMIT), NETWORTH_REFRESH_LIMIT),
  );
  const rows = ((await env.DB.prepare(
    `
    SELECT *
    FROM enemy_faction_members
    WHERE faction_id = ?
      AND networth_updated_at IS NULL
    ORDER BY level DESC, name ASC
    LIMIT ?
    `,
  )
    .bind(scoutingWar.enemy_faction_id, limit)
    .all()).results ?? []) as EnemyFactionMemberRow[];

  metrics.candidates = rows.length;
  if (rows.length === 0) {
    await setSyncLatch(env, completeLatchName, nowSeconds());
    options.context.activeLatches.add(completeLatchName);
    return metrics;
  }

  for (const row of rows) {
    const stats = await fetchTornPersonalStats(env, row.member_id, ["networth"]);
    const networth = finiteNumber(stats.networth);

    const result = await env.DB.prepare(
      `
      UPDATE enemy_faction_members
      SET networth = ?,
          networth_updated_at = unixepoch(),
          updated_at = unixepoch()
      WHERE faction_id = ?
        AND member_id = ?
        AND networth_updated_at IS NULL
      `,
    )
      .bind(networth, scoutingWar.enemy_faction_id, row.member_id)
      .run();
    const changes = d1Changes(result);
    metrics.writeStatements += 1;
    metrics.changedRows += changes;
    metrics.updated += changes;
  }

  return metrics;
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
    ? buildStatsComparisonPng({
        enemyName: scoutingWar.name,
        homeMembers,
        enemyMembers,
      })
    : buildEnemyMemberStatsTablePng({
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
  const statsComparisonPng = buildStatsComparisonPng({
    enemyName: scoutingWar.name,
    homeMembers,
    enemyMembers,
  });
  const memberTablePng = buildEnemyMemberStatsTablePng({
    enemyName: scoutingWar.name,
    enemyMembers,
  });

  await sendDiscordMessageWithAttachments(env, {
    content: `Enemy stats comparison ready: ${scoutingWar.name}`,
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
}

function buildEnemyTargetStateNames(warId: number, enemyFactionId: number): EnemyTargetStateNames {
  return {
    ff: enemyTargetFfFillCompleteLatchName(warId, enemyFactionId),
    bsp: enemyTargetBspFillCompleteLatchName(warId, enemyFactionId),
    networth: enemyTargetNetworthFillCompleteLatchName(warId, enemyFactionId),
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
    skipped: true,
  };
}

function buildStatsComparisonPng({
  enemyName,
  homeMembers,
  enemyMembers,
}: {
  enemyName: string;
  homeMembers: EnemyFactionMemberRow[];
  enemyMembers: EnemyFactionMemberRow[];
}): Uint8Array {
  const width = 1200;
  const headerHeight = 98;
  const footerHeight = 24;
  const panelGap = 18;
  const statsPanels = [
    {
      title: "FF stats",
      metric: "ff_battlestats" as const,
      buckets: SCOUTING_BATTLE_STATS_BUCKETS,
    },
    {
      title: "BSP stats",
      metric: "bsp_battlestats" as const,
      buckets: SCOUTING_BATTLE_STATS_BUCKETS,
    },
    {
      title: "Networth",
      metric: "networth" as const,
      buckets: SCOUTING_NETWORTH_BUCKETS,
    },
  ];
  const panelHeights = statsPanels.map((panel) => statsPanelHeight(panel.buckets.length));
  const height = headerHeight + panelHeights.reduce((total, panelHeight) => total + panelHeight, 0)
    + panelGap * (statsPanels.length - 1) + footerHeight;
  const canvas = createPngCanvas(width, height, SIMPLE_PNG_COLORS.page);
  const generatedAt = new Date().toISOString().replace("T", " ").slice(0, 16);

  fillRect(canvas, 24, 20, 1152, 64, SIMPLE_PNG_COLORS.dark);
  drawText(canvas, 48, 34, `${enemyName} stats comparison`, SIMPLE_PNG_COLORS.white, {
    scale: 3,
    maxWidth: 780,
  });
  drawText(
    canvas,
    48,
    64,
    `Generated ${generatedAt} UTC after FF, BSP, and networth fills completed`,
    SIMPLE_PNG_COLORS.mutedOnDark,
    { scale: 1, maxWidth: 720 },
  );
  fillRect(canvas, 872, 36, 14, 14, SIMPLE_PNG_COLORS.blue);
  drawText(canvas, 896, 38, HOME_STATS_LABEL, SIMPLE_PNG_COLORS.soft, { scale: 1, maxWidth: 110 });
  fillRect(canvas, 1012, 36, 14, 14, SIMPLE_PNG_COLORS.red);
  drawText(canvas, 1036, 38, enemyName, SIMPLE_PNG_COLORS.soft, { scale: 1, maxWidth: 120 });

  let panelY = headerHeight;
  statsPanels.forEach((panel, index) => {
    drawStatsPanel(canvas, {
      ...panel,
      y: panelY,
      height: panelHeights[index],
      homeMembers,
      enemyMembers,
      enemyName,
    });
    panelY += panelHeights[index] + panelGap;
  });

  return encodePng(canvas);
}

function statsPanelHeight(bucketCount: number): number {
  return bucketCount > 8 ? 288 : 268;
}

function drawStatsPanel(
  canvas: ReturnType<typeof createPngCanvas>,
  {
    y,
    height,
    title,
    metric,
    buckets,
    homeMembers,
    enemyMembers,
    enemyName,
  }: {
    y: number;
    height: number;
    title: string;
    metric: ScoutingComparisonMetric;
    buckets: ScoutingBucket[];
    homeMembers: EnemyFactionMemberRow[];
    enemyMembers: EnemyFactionMemberRow[];
    enemyName: string;
  },
): void {
  const left = 48;
  const top = y + 16;
  const chartLeft = 108;
  const chartRight = 1088;
  const chartTop = y + 72;
  const chartBottom = y + height - 48;
  const chartWidth = chartRight - chartLeft;
  const chartHeight = chartBottom - chartTop;
  const valueLabelX = chartLeft - 14;
  const homeValues = buildBucketCounts(homeMembers, buckets, metric);
  const enemyValues = buildBucketCounts(enemyMembers, buckets, metric);
  const maxValue = niceChartMax(Math.max(1, ...homeValues, ...enemyValues));
  const homeCoverage = metricCoverage(homeMembers, metric);
  const enemyCoverage = metricCoverage(enemyMembers, metric);
  const homeAverage = metricAverage(homeMembers, metric);
  const enemyAverage = metricAverage(enemyMembers, metric);

  fillRect(canvas, 24, y, 1152, height, SIMPLE_PNG_COLORS.white);
  strokeRect(canvas, 24, y, 1152, height, SIMPLE_PNG_COLORS.border);
  fillRect(canvas, 24, y, 1152, 34, SIMPLE_PNG_COLORS.alternate);
  drawText(canvas, left, top + 5, title, SIMPLE_PNG_COLORS.dark, { scale: 2, maxWidth: 160 });
  drawText(
    canvas,
    420,
    top + 10,
    `${HOME_STATS_LABEL} ${homeCoverage.available}/${homeCoverage.total} avg ${formatCompactNumber(homeAverage)}`,
    SIMPLE_PNG_COLORS.muted,
    { scale: 1, maxWidth: 270, align: "center" },
  );
  drawText(
    canvas,
    730,
    top + 10,
    `${enemyName} ${enemyCoverage.available}/${enemyCoverage.total} avg ${formatCompactNumber(enemyAverage)}`,
    SIMPLE_PNG_COLORS.muted,
    { scale: 1, maxWidth: 310, align: "center" },
  );

  for (let index = 0; index <= 4; index += 1) {
    const value = Math.round((maxValue / 4) * index);
    const gridY = chartBottom - Math.round((index / 4) * chartHeight);
    fillRect(canvas, chartLeft, gridY, chartWidth, 1, SIMPLE_PNG_COLORS.soft);
    drawText(canvas, valueLabelX, gridY - 4, String(value), SIMPLE_PNG_COLORS.muted, {
      scale: 1,
      maxWidth: 48,
      align: "right",
    });
  }
  fillRect(canvas, chartLeft, chartTop, 1, chartHeight, SIMPLE_PNG_COLORS.border);
  fillRect(canvas, chartLeft, chartBottom, chartWidth, 1, SIMPLE_PNG_COLORS.border);

  const step = buckets.length > 1 ? chartWidth / (buckets.length - 1) : chartWidth;
  const homePoints = homeValues.map((value, index) =>
    chartPoint(chartLeft, chartBottom, chartHeight, step, index, value, maxValue),
  );
  const enemyPoints = enemyValues.map((value, index) =>
    chartPoint(chartLeft, chartBottom, chartHeight, step, index, value, maxValue),
  );

  drawAreaSeries(canvas, homePoints, chartBottom, SIMPLE_PNG_COLORS.blueSoft, SIMPLE_PNG_COLORS.blue);
  drawAreaSeries(canvas, enemyPoints, chartBottom, SIMPLE_PNG_COLORS.redSoft, SIMPLE_PNG_COLORS.red);

  buckets.forEach((bucket, index) => {
    const labelX = chartLeft + Math.round(index * step);
    drawText(canvas, labelX, chartBottom + 12, bucket.label, SIMPLE_PNG_COLORS.muted, {
      scale: 1,
      maxWidth: Math.max(42, Math.floor(step) - 6),
      align: "center",
    });
  });
}

function chartPoint(
  chartLeft: number,
  chartBottom: number,
  chartHeight: number,
  step: number,
  index: number,
  value: number,
  maxValue: number,
): { x: number; y: number } {
  return {
    x: chartLeft + Math.round(index * step),
    y: chartBottom - Math.round((value / maxValue) * chartHeight),
  };
}

function drawAreaSeries(
  canvas: ReturnType<typeof createPngCanvas>,
  points: Array<{ x: number; y: number }>,
  baseline: number,
  fillColor: number,
  lineColor: number,
): void {
  if (points.length === 0) {
    return;
  }

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const minX = Math.min(start.x, end.x);
    const maxX = Math.max(start.x, end.x);
    for (let x = minX; x <= maxX; x += 1) {
      const ratio = end.x === start.x ? 0 : (x - start.x) / (end.x - start.x);
      const y = Math.round(start.y + (end.y - start.y) * ratio);
      fillRect(canvas, x, y, 1, Math.max(0, baseline - y), fillColor);
    }
    drawThickLine(canvas, start.x, start.y, end.x, end.y, lineColor);
  }

  points.forEach((point) => {
    fillRect(canvas, point.x - 2, point.y - 2, 5, 5, lineColor);
  });
}

function drawThickLine(
  canvas: ReturnType<typeof createPngCanvas>,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: number,
): void {
  drawLine(canvas, x0, y0, x1, y1, color);
  drawLine(canvas, x0, y0 + 1, x1, y1 + 1, color);
}

function niceChartMax(value: number): number {
  if (value <= 5) return 5;
  if (value <= 10) return 10;
  return Math.ceil(value / 5) * 5;
}

function buildEnemyMemberStatsTablePng({
  enemyName,
  enemyMembers,
}: {
  enemyName: string;
  enemyMembers: EnemyFactionMemberRow[];
}): Uint8Array {
  const width = 920;
  const contentWidth = width - 48;
  const tableTop = 96;
  const tableHeaderHeight = 30;
  const rowHeight = 24;
  const footerHeight = 24;
  const members = [...enemyMembers].sort(compareEnemyMemberStatsRows);
  const bodyRows = Math.max(1, members.length);
  const tableHeight = tableHeaderHeight + bodyRows * rowHeight;
  const height = tableTop + tableHeight + footerHeight;
  const canvas = createPngCanvas(width, height, SIMPLE_PNG_COLORS.page);
  const generatedAt = new Date().toISOString().replace("T", " ").slice(0, 16);

  fillRect(canvas, 24, 20, contentWidth, 62, SIMPLE_PNG_COLORS.dark);
  drawText(canvas, 48, 34, `${enemyName} member stats`, SIMPLE_PNG_COLORS.white, {
    scale: 3,
    maxWidth: 620,
  });
  drawText(canvas, 48, 64, `Generated ${generatedAt} UTC`, SIMPLE_PNG_COLORS.mutedOnDark, {
    scale: 1,
    maxWidth: 260,
  });
  fillRect(canvas, 24, tableTop, contentWidth, tableHeight, SIMPLE_PNG_COLORS.white);
  strokeRect(canvas, 24, tableTop, contentWidth, tableHeight, SIMPLE_PNG_COLORS.border);
  fillRect(canvas, 24, tableTop, contentWidth, tableHeaderHeight, SIMPLE_PNG_COLORS.soft);
  drawText(canvas, 48, tableTop + 10, "Name", SIMPLE_PNG_COLORS.muted, { scale: 1 });
  drawText(canvas, 440, tableTop + 10, "Level", SIMPLE_PNG_COLORS.muted, { scale: 1, align: "right" });
  drawText(canvas, 630, tableTop + 10, "FF stats", SIMPLE_PNG_COLORS.muted, { scale: 1, align: "right" });
  drawText(canvas, 820, tableTop + 10, "BSP stats", SIMPLE_PNG_COLORS.muted, {
    scale: 1,
    align: "right",
  });

  if (members.length === 0) {
    const y = tableTop + tableHeaderHeight;
    fillRect(canvas, 24, y, contentWidth, rowHeight, SIMPLE_PNG_COLORS.white);
    drawText(canvas, 48, y + 6, "No enemy members cached", SIMPLE_PNG_COLORS.muted, {
      scale: 1,
      maxWidth: 300,
    });
    return encodePng(canvas);
  }

  members.forEach((member, index) => {
    const y = tableTop + tableHeaderHeight + index * rowHeight;
    fillRect(
      canvas,
      24,
      y,
      contentWidth,
      rowHeight,
      index % 2 === 0 ? SIMPLE_PNG_COLORS.white : SIMPLE_PNG_COLORS.alternate,
    );
    drawText(canvas, 48, y + 7, member.name ?? `#${member.member_id}`, SIMPLE_PNG_COLORS.dark, {
      scale: 1,
      maxWidth: 320,
    });
    drawText(canvas, 440, y + 7, formatNullableInteger(member.level), SIMPLE_PNG_COLORS.text, {
      scale: 1,
      maxWidth: 80,
      align: "right",
    });
    drawText(canvas, 630, y + 7, formatNullableInteger(member.ff_battlestats), SIMPLE_PNG_COLORS.text, {
      scale: 1,
      maxWidth: 160,
      align: "right",
    });
    drawText(canvas, 820, y + 7, formatNullableInteger(member.bsp_battlestats), SIMPLE_PNG_COLORS.text, {
      scale: 1,
      maxWidth: 160,
      align: "right",
    });
  });

  return encodePng(canvas);
}

function compareEnemyMemberStatsRows(a: EnemyFactionMemberRow, b: EnemyFactionMemberRow): number {
  const bFf = Number(b.ff_battlestats ?? 0);
  const aFf = Number(a.ff_battlestats ?? 0);
  if (bFf !== aFf) {
    return bFf - aFf;
  }

  const bBsp = Number(b.bsp_battlestats ?? 0);
  const aBsp = Number(a.bsp_battlestats ?? 0);
  if (bBsp !== aBsp) {
    return bBsp - aBsp;
  }

  return (b.level ?? 0) - (a.level ?? 0) || (a.name ?? "").localeCompare(b.name ?? "");
}

function formatNullableInteger(value: number | null | undefined): string {
  const numberValue = Number(value ?? 0);
  return Number.isFinite(numberValue) && numberValue > 0
    ? Math.round(numberValue).toLocaleString("en-US")
    : "-";
}

function buildBucketCounts(
  members: EnemyFactionMemberRow[],
  buckets: ScoutingBucket[],
  metric: ScoutingComparisonMetric,
): number[] {
  return buckets.map(
    (bucket) =>
      members.filter((member) => {
        if (!hasScoutingMetricValue(member, metric)) {
          return false;
        }
        const value = Number(member[metric] ?? 0);
        return Number.isFinite(value) && value >= bucket.min && value < bucket.max;
      }).length,
  );
}

function metricCoverage(
  members: EnemyFactionMemberRow[],
  metric: ScoutingComparisonMetric,
): { available: number; total: number } {
  return {
    available: members.filter((member) => hasScoutingMetricValue(member, metric)).length,
    total: members.length,
  };
}

function metricAverage(
  members: EnemyFactionMemberRow[],
  metric: ScoutingComparisonMetric,
): number | null {
  const values = members
    .map((member) => Number(member[metric] ?? 0))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (values.length === 0) {
    return null;
  }
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function hasScoutingMetricValue(
  member: EnemyFactionMemberRow,
  metric: ScoutingComparisonMetric,
): boolean {
  const value = Number(member[metric] ?? 0);
  return Number.isFinite(value) && value > 0;
}

function formatCompactNumber(value: number | null): string {
  if (value === null) {
    return "n/a";
  }
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000_000) return `${trimNumber(value / 1_000_000_000_000)}t`;
  if (abs >= 1_000_000_000) return `${trimNumber(value / 1_000_000_000)}b`;
  if (abs >= 1_000_000) return `${trimNumber(value / 1_000_000)}m`;
  if (abs >= 1_000) return `${trimNumber(value / 1_000)}k`;
  return String(Math.round(value));
}

function trimNumber(value: number): string {
  return value.toFixed(value >= 10 ? 1 : 2).replace(/\.?0+$/, "");
}
