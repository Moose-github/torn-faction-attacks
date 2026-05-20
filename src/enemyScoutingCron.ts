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
