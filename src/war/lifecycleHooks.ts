import { HOME_FACTION_ID } from "../constants";
import { bumpWarCacheVersionById } from "../cacheVersions";
import { ensureChainWatchEnabledForWar } from "../chainWatch";
import {
  enableDiscordTravelTrackersForWar,
  stopDiscordTravelTrackersForWar,
} from "../discordTravelTracker";
import {
  clearLiveEnemyTrackingData,
  fetchEnemyScoutingOnceForWar,
} from "../enemyScouting";
import { rebuildWarStatsFromRaw } from "../warStats";
import { DEFENSE_ACTION_WINDOW_SQL } from "../sql";
import { isSyncLatchSet, setSyncLatch } from "../syncLatches";
import type { Env } from "../types";
import { nowSeconds } from "../utils";

export type WarLifecyclePhase =
  | "war_scheduled"
  | "pre_live_started"
  | "live_started"
  | "war_started"
  | "practically_finished"
  | "officially_ended";

type WarLifecycleHandler = {
  name: string;
  run: () => Promise<boolean | void>;
};

type EnemyWarLifecycleOptions = {
  warId: number;
  enemyFactionId: number | null;
};

export async function runWarScheduledHooks(env: Env, warId: number): Promise<void> {
  const config = await readWarLifecycleConfig(env, warId);
  if (config.warType === "event") {
    await runWarLifecycleHandlersOnce(env, "war_scheduled", warId, []);
    return;
  }

  await runWarLifecycleHandlersOnce(env, "war_scheduled", warId, [
    {
      name: "enemy_scouting_once",
      run: () => fetchEnemyScoutingOnceForWar(env, warId),
    },
  ]);
}

export async function runWarPreLiveStartedHooks(env: Env, warId: number): Promise<void> {
  const config = await readWarLifecycleConfig(env, warId);
  if (config.warType === "event") {
    await runWarLifecycleHandlersOnce(env, "pre_live_started", warId, []);
    return;
  }

  await runWarLifecycleHandlersOnce(env, "pre_live_started", warId, [
    {
      name: "discord_travel_trackers_enabled",
      run: () => enableDiscordTravelTrackersForWar(env),
    },
    {
      name: "enemy_scouting_once",
      run: () => fetchEnemyScoutingOnceForWar(env, warId),
    },
  ]);
}

export async function runWarLiveStartedHooks(env: Env, warId: number): Promise<void> {
  await runWarLifecycleHandlersOnce(env, "live_started", warId, []);
}

export async function runWarStartedHooks(
  env: Env,
  options: { warId: number; startedAt: number },
): Promise<void> {
  const config = await readWarLifecycleConfig(env, options.warId);
  const handlers: WarLifecycleHandler[] = [
    {
      name: "attack_assignments_backfilled",
      run: () => backfillWarAssignments(env, options.warId, options.startedAt),
    },
    {
      name: "derived_stats_refreshed",
      run: () => refreshWarDerivedStats(env, options.warId),
    },
  ];

  if (shouldEnableChainWatch(config)) {
    handlers.unshift({
      name: "chain_watch_enabled",
      run: () => ensureChainWatchEnabledForWar(env, options.warId),
    });
  }

  await runWarLifecycleHandlersOnce(env, "war_started", options.warId, handlers);
}

export async function runWarPracticallyFinishedHooks(
  env: Env,
  options: EnemyWarLifecycleOptions,
): Promise<void> {
  await runWarLifecycleHandlersOnce(env, "practically_finished", options.warId, [
    {
      name: "live_enemy_tracking_stopped",
      run: () => stopLiveEnemyTracking(env, options.warId, options.enemyFactionId),
    },
    {
      name: "discord_travel_trackers_stopped",
      run: () => stopDiscordTravelTrackersForWar(env),
    },
    {
      name: "derived_stats_refreshed",
      run: () => refreshWarDerivedStats(env, options.warId),
    },
    {
      name: "war_cache_bumped",
      run: () => bumpWarCacheVersionById(env, options.warId),
    },
  ]);
}

export async function runWarOfficiallyEndedHooks(
  env: Env,
  options: EnemyWarLifecycleOptions,
): Promise<void> {
  await runWarLifecycleHandlersOnce(env, "officially_ended", options.warId, [
    {
      name: "official_attack_assignments_backfilled",
      run: () => backfillOfficialWarAssignments(env, options.warId),
    },
    {
      name: "derived_stats_refreshed",
      run: () => refreshWarDerivedStats(env, options.warId),
    },
    {
      name: "live_enemy_tracking_stopped",
      run: () => stopLiveEnemyTracking(env, options.warId, options.enemyFactionId),
    },
    {
      name: "discord_travel_trackers_stopped",
      run: () => stopDiscordTravelTrackersForWar(env),
    },
    {
      name: "war_cache_bumped",
      run: () => bumpWarCacheVersionById(env, options.warId),
    },
  ]);
}

export async function refreshWarDerivedStats(env: Env, warId: number): Promise<void> {
  await rebuildWarStatsFromRaw(env, {
    scope: "single-war",
    warId,
    reason: "lifecycle",
  });
}

async function runWarLifecycleHandlersOnce(
  env: Env,
  phase: WarLifecyclePhase,
  warId: number,
  handlers: WarLifecycleHandler[],
): Promise<void> {
  const phaseLatchName = warLifecyclePhaseLatchName(phase, warId);
  const phaseLatchSet = await isSyncLatchSet(env, phaseLatchName);
  const handlerLatchNames = handlers.map((handler) =>
    warLifecycleHandlerLatchName(phase, warId, handler.name),
  );

  if (phaseLatchSet && handlerLatchNames.length === 0) {
    return;
  }

  if (phaseLatchSet && handlerLatchNames.length > 0) {
    const handlerLatches = await Promise.all(handlerLatchNames.map((name) => isSyncLatchSet(env, name)));
    if (handlerLatches.every(Boolean)) {
      return;
    }
  }

  let completed = true;

  for (const [index, handler] of handlers.entries()) {
    const latchName = handlerLatchNames[index];
    if (await isSyncLatchSet(env, latchName)) {
      continue;
    }

    const result = await handler.run();
    if (result === false) {
      completed = false;
      continue;
    }

    await setSyncLatch(env, latchName, nowSeconds());
  }

  if (completed && !phaseLatchSet) {
    await setSyncLatch(env, phaseLatchName, nowSeconds());
  }
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

async function backfillOfficialWarAssignments(
  env: Env,
  warId: number,
): Promise<void> {
  await env.DB.prepare(
    `
    UPDATE attacks
    SET war_id = ?
    WHERE id IN (
      SELECT a.id
      FROM attacks a
      JOIN wars w ON w.id = ?
      WHERE a.war_id IS NULL
        AND (
          (
            a.attacker_faction_id = ${HOME_FACTION_ID}
            AND ${DEFENSE_ACTION_WINDOW_SQL}
          )
          OR (
            w.enemy_faction_id IS NOT NULL
            AND a.attacker_faction_id = w.enemy_faction_id
            AND a.defender_faction_id = ${HOME_FACTION_ID}
            AND ${DEFENSE_ACTION_WINDOW_SQL}
          )
        )
    )
    `,
  )
    .bind(warId, warId)
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

async function readWarLifecycleConfig(env: Env, warId: number): Promise<{
  warType: string | null;
  chainWatchEnabled: number | null;
}> {
  const row = (await env.DB.prepare(
    `
    SELECT war_type, chain_watch_enabled
    FROM wars
    WHERE id = ?
    LIMIT 1
    `,
  )
    .bind(warId)
    .first()) as { war_type: string | null; chain_watch_enabled: number | null } | null;

  return {
    warType: row?.war_type ?? null,
    chainWatchEnabled: row?.chain_watch_enabled ?? null,
  };
}

function shouldEnableChainWatch(config: {
  warType: string | null;
  chainWatchEnabled: number | null;
}): boolean {
  const defaultEnabled = (config.warType ?? "real") === "event" ? 0 : 1;
  return Number(config.chainWatchEnabled ?? defaultEnabled) === 1;
}

function warLifecycleHandlerLatchName(
  phase: WarLifecyclePhase,
  warId: number,
  handlerName: string,
): string {
  return `${warLifecyclePhaseLatchName(phase, warId)}:${handlerName}`;
}

function warLifecyclePhaseLatchName(phase: WarLifecyclePhase, warId: number): string {
  return `war_lifecycle:${phase}:${warId}`;
}
