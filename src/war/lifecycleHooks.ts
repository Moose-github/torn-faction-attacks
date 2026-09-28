import { HOME_FACTION_ID } from "../constants";
import { ensureEventCompetitionStarted } from "../eventCompetition";
import { bumpWarCacheVersionById } from "../cacheVersions";
import { ensureChainWatchEnabledForWar } from "../chainWatchWar";
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
import { d1Changes, nowSeconds } from "../utils";
import type { PracticalPhase } from "../../shared/practicalPhases";
import { isDiscordAlertEnabled } from "../discordAlertSettings";
import { DISCORD_ALERT_KEYS } from "../discordAlerts";
import { upsertDiscordAlertMessage } from "../discordAlertDelivery";
import { readDiscordAlertMentions, formatDiscordAlertMessage } from "../discordMentions";

export async function runPracticalPhaseHooks(env: Env, phase: PracticalPhase, officiallyEnded: boolean): Promise<boolean> {
  const handlers: WarLifecycleHandler[] = [];
  if (phase.status === "active" && !officiallyEnded) {
    handlers.push({ name: "travel_started", run: () => enableDiscordTravelTrackersForWar(env) });
    handlers.push({ name: "scouting", run: () => fetchEnemyScoutingOnceForWar(env, phase.war_id) });
  } else if (phase.status === "completed") {
    handlers.push({ name: "travel_stopped", run: async () => {
      const active = await env.DB.prepare("SELECT id FROM war_practical_phases WHERE war_id = ? AND status = 'active' AND removed_at IS NULL LIMIT 1")
        .bind(phase.war_id).first();
      if (!active) await stopDiscordTravelTrackersForWar(env);
    } });
    if (phase.reason === "target_reached") handlers.push({ name: "target_notification", run: async () => {
      if (!await isDiscordAlertEnabled(env, DISCORD_ALERT_KEYS.termedWarAutoEnd)) return;
      const receipt = await env.DB.prepare("SELECT id FROM war_practical_phase_audit WHERE war_id = ? AND action = ? LIMIT 1")
        .bind(phase.war_id, `notification:${phase.id}`).first();
      if (receipt) return;
      const mentions = await readDiscordAlertMentions(env, DISCORD_ALERT_KEYS.termedWarAutoEnd);
      const war = await env.DB.prepare("SELECT name FROM wars WHERE id = ?").bind(phase.war_id).first<{ name: string }>();
      const message = `${war?.name ?? "Termed war"}: practical phase closed\nPhase start: ${new Date(phase.start_time! * 1000).toISOString()}\nCumulative target reached: ${phase.target}\nFinish time: ${new Date(phase.finish_time! * 1000).toISOString()}`;
      const messageId = await upsertDiscordAlertMessage(env, DISCORD_ALERT_KEYS.termedWarAutoEnd, null,
        formatDiscordAlertMessage(message, mentions.messageSuffix), mentions.allowedMentions ?? { users: [], roles: [] },
        { nonce: phase.id.replaceAll("-", "").slice(0, 25) });
      if (!messageId) return false;
      await env.DB.prepare(`INSERT INTO war_practical_phase_audit (war_id, changed_at, actor_id, action, before_json, after_json)
        VALUES (?, ?, NULL, ?, '{}', ?)`)
        .bind(phase.war_id, nowSeconds(), `notification:${phase.id}`, JSON.stringify({ message_id: messageId })).run();
    } });
  }
  // Monitoring queries follow the current practical state. Do not delete any
  // collected samples when pausing between phases.
  for (const handler of handlers) {
    const key = `practical_phase:${phase.id}:${phase.status}:${handler.name}`;
    if (await isSyncLatchSet(env, key)) continue;
    const claimedAt = nowSeconds();
    const claim = await env.DB.prepare(`INSERT INTO sync_state(name, last_started) VALUES (?, ?)
      ON CONFLICT(name) DO UPDATE SET last_started = excluded.last_started WHERE sync_state.last_started < ?`)
      .bind(`${key}:lease`, claimedAt, claimedAt - 120).run();
    if (d1Changes(claim) === 0) return false;
    try {
      if (!await isSyncLatchSet(env, key)) {
        if (await handler.run() === false) return false;
        await setSyncLatch(env, key, nowSeconds());
      }
    } finally {
      await env.DB.prepare("DELETE FROM sync_state WHERE name = ? AND last_started = ?").bind(`${key}:lease`, claimedAt).run();
    }
  }
  return true;
}

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
  await ensureEventCompetitionStarted(env, options.warId);
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
