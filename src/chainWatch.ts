import {
  HOME_FACTION_ID,
  POSITIVE_ATTACK_RESULTS,
  POSITIVE_RESULTS_SQL,
  TORN_FACTION_CHAIN_API_URL,
} from "./constants";
import { type DiscordAllowedMentions } from "./discord";
import { deliverChainWatchAlert, type WatchDeliveryResult } from "./chainWatchDiscordDelivery";
import { DISCORD_ALERT_KEYS, type DiscordAlertKey } from "./discordAlerts";
import { formatDiscordAlertMessage, readDiscordAlertMentions } from "./discordMentions";
import { fetchTrackedTornJson } from "./external/torn";
import { withTornKeyPool } from "./tornKeyPool";
import { Env } from "./types";
import { finiteNumber, json, nowSeconds } from "./utils";
import { readChainWatchDemand } from "./chainWatchDemand";
import type { ChainWatchLiveResponse } from "../shared/chainWatchLive";
import { WATCH_HOUR } from "../shared/chainWatchSchedule";

export const CHAIN_WATCH_TIMEOUT_SECONDS = 5 * 60;
export const CHAIN_WATCH_WARNING_60_OFFSET_SECONDS = 4 * 60;
export const CHAIN_WATCH_WARNING_30_OFFSET_SECONDS = 4 * 60 + 30;
export const CHAIN_WATCH_ALERT_MIN_CHAIN = 100;

const CHAIN_WATCH_MAX_ERROR_LENGTH = 240;
const CHAIN_WATCH_ALARM_NAME_PREFIX = "chain-watch";
const CHAIN_WATCH_LIVE_TIMEOUT_DRIFT_SECONDS = 5;
const CHAIN_WATCH_WARNING_COLOR = 0xffa500;
const CHAIN_WATCH_CRITICAL_COLOR = 0xff0000;
const CHAIN_WATCH_DROP_COLOR = 0x3498db;

type ChainWatchSource = "stored" | "live_confirm" | "stale" | "dropped";
type ChainWatchAlarmStage = "warning_60" | "warning_30" | "drop";
type ChainWatchAlarmStub = DurableObjectStub & {
  scheduleFaction(factionId: number, alarmAtSeconds: number): Promise<void>;
  cancel(): Promise<void>;
};

export type ChainWatchStateRow = {
  faction_id: number;
  enabled: number;
  source: ChainWatchSource;
  current_chain: number | null;
  reset_at: number | null;
  timeout_at: number | null;
  last_hit_id: number | null;
  last_hit_at: number | null;
  last_hit_attacker_name: string | null;
  last_hit_defender_name: string | null;
  last_hit_result: string | null;
  scheduled_alarm_stage: ChainWatchAlarmStage | null;
  scheduled_alarm_at: number | null;
  warning_60_sent_at: number | null;
  warning_30_sent_at: number | null;
  drop_sent_at: number | null;
  alert_chain: number | null;
  alert_reset_at: number | null;
  discord_message_id: string | null;
  last_checked_at: number | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
};

export type ChainWatchAttackRow = {
  id: number;
  started: number | null;
  ended: number | null;
  attacker_faction_id: number | null;
  defender_faction_id: number | null;
  attacker_name: string | null;
  defender_name: string | null;
  result: string | null;
  chain: number | null;
};

type ChainWatchObservation = {
  source: ChainWatchSource;
  currentChain: number | null;
  resetAt: number | null;
  timeoutAt: number | null;
  lastHit: ChainWatchAttackRow | null;
  lastError: string | null;
};

export type ParsedTornChain = {
  current: number;
  timeoutAt: number | null;
  active: boolean;
};

export type NextChainWatchAlarm = {
  stage: ChainWatchAlarmStage;
  alarmAt: number;
} | null;

export async function ensureChainWatchState(env: Env): Promise<void> {
  await env.DB.prepare(`
    INSERT INTO faction_chain_watch_state (faction_id, enabled, source, created_at, updated_at)
    VALUES (?, 0, 'stored', unixepoch(), unixepoch())
    ON CONFLICT(faction_id) DO NOTHING
  `).bind(HOME_FACTION_ID).run();
}

// A watch and a war can request the same monitor. Neither owns its state or alarm.
export async function reconcileChainWatchActivity(env: Env, checkedAt = nowSeconds()): Promise<boolean> {
  const demand = await readChainWatchDemand(env, checkedAt);
  const existing = await readChainWatchState(env);
  if (!demand.active) {
    if (existing?.enabled === 1) {
      await env.DB.prepare(`UPDATE faction_chain_watch_state SET enabled = 0,
        scheduled_alarm_stage = NULL, scheduled_alarm_at = NULL, updated_at = ? WHERE faction_id = ?`)
        .bind(checkedAt, HOME_FACTION_ID).run();
      await syncChainWatchStoppedDiscordMessage(env, existing, checkedAt);
    }
    await cancelChainWatchAlarm(env, HOME_FACTION_ID);
    return false;
  }
  await ensureChainWatchState(env);
  await env.DB.prepare("UPDATE faction_chain_watch_state SET enabled = 1 WHERE faction_id = ? AND enabled = 0")
    .bind(HOME_FACTION_ID).run();
  return true;
}

export async function runChainWatchCron(env: Env, scheduledTime: number): Promise<void> {
  const checkedAt = Math.max(Math.floor(scheduledTime / 1000), nowSeconds());
  if (await reconcileChainWatchActivity(env, checkedAt)) {
    await refreshChainWatch(env, checkedAt);
  }
}

export async function readChainWatchLive(env: Env, now = nowSeconds()) {
  const [state, demand] = await Promise.all([readChainWatchState(env), readChainWatchDemand(env, now)]);
  const remainingSeconds = state?.timeout_at ? Math.max(0, state.timeout_at - now) : null;
  return {
    ok: true as const,
    now,
    faction_id: HOME_FACTION_ID,
    state,
    demand,
    computed: {
      active: demand.active && state?.enabled === 1,
      alert_eligible: chainWatchAlertEligible(state?.current_chain ?? null),
      remaining_seconds: remainingSeconds,
      dropped: remainingSeconds !== null && remainingSeconds <= 0,
    },
  } satisfies ChainWatchLiveResponse;
}

export async function getChainWatchLive(env: Env): Promise<Response> {
  return json(await readChainWatchLive(env));
}

export function isQualifyingChainAttack(row: ChainWatchAttackRow): boolean {
  return (
    row.attacker_faction_id === HOME_FACTION_ID &&
    row.defender_faction_id !== HOME_FACTION_ID &&
    POSITIVE_ATTACK_RESULTS.includes(row.result as (typeof POSITIVE_ATTACK_RESULTS)[number]) &&
    chainHitAt(row) !== null
  );
}

export function chainHitAt(row: Pick<ChainWatchAttackRow, "started" | "ended">): number | null {
  return row.ended ?? row.started ?? null;
}

export function chainWatchAlertEligible(chain: number | null): boolean {
  return Number(chain ?? 0) > CHAIN_WATCH_ALERT_MIN_CHAIN;
}

export function selectNextChainWatchAlarm(input: {
  currentChain: number | null;
  resetAt: number | null;
  timeoutAt: number | null;
  warning60SentAt: number | null;
  warning30SentAt: number | null;
  dropSentAt: number | null;
  now: number;
}): NextChainWatchAlarm {
  if (
    !chainWatchAlertEligible(input.currentChain) ||
    input.resetAt === null ||
    input.timeoutAt === null ||
    input.dropSentAt !== null
  ) {
    return null;
  }

  if (input.timeoutAt <= input.now) {
    return input.warning60SentAt !== null || input.warning30SentAt !== null
      ? { stage: "drop", alarmAt: input.now }
      : null;
  }

  if (input.warning60SentAt === null) {
    return {
      stage: "warning_60",
      alarmAt: Math.max(input.now, input.resetAt + CHAIN_WATCH_WARNING_60_OFFSET_SECONDS),
    };
  }

  if (input.warning30SentAt === null) {
    return {
      stage: "warning_30",
      alarmAt: Math.max(input.now, input.resetAt + CHAIN_WATCH_WARNING_30_OFFSET_SECONDS),
    };
  }

  return {
    stage: "drop",
    alarmAt: Math.max(input.now, input.timeoutAt),
  };
}

export function parseTornChainResponse(data: unknown, now: number): ParsedTornChain | null {
  const root = isRecord(data) ? data : null;
  const chain = isRecord(root?.chain) ? root.chain : root;
  if (!chain) {
    return null;
  }

  const current = Math.floor(Number(chain.current ?? chain.chain ?? 0));
  if (!Number.isFinite(current) || current <= 0) {
    return { current: 0, timeoutAt: null, active: false };
  }

  const timeoutValue = finiteNumber(chain.timeout ?? chain.timeout_at ?? chain.timeoutAt);
  const timeoutAt = timeoutValue === null
    ? null
    : timeoutValue > 1_000_000_000
      ? Math.floor(timeoutValue)
      : now + Math.max(0, Math.floor(timeoutValue));

  return {
    current,
    timeoutAt,
    active: timeoutAt === null || timeoutAt > now,
  };
}

export function chainWatchWarningMessage(options: {
  stage: "warning_60" | "warning_30";
  currentChain: number;
  timeoutAt: number;
  lastHit: ChainWatchStateRow | ChainWatchAttackRow | null;
}): string {
  const critical = options.stage === "warning_30";
  const remaining = critical ? "30 seconds" : "60 seconds";
  return [
    critical
      ? `Chain Watch CRITICAL: ${remaining} remaining`
      : `Chain Watch WARNING: ${remaining} remaining`,
    `Chain ${options.currentChain}`,
    `Last hit: ${formatChainWatchAttackPair(options.lastHit)}`,
    `Timeout: ${formatChainWatchDateTime(options.timeoutAt)}`,
  ].join("\n");
}

export async function refreshActiveChainWatchFromStoredAttacks(
  env: Env,
  checkedAt: number = nowSeconds(),
): Promise<ChainWatchStateRow | null> {
  if (!await reconcileChainWatchActivity(env, checkedAt)) return readChainWatchState(env);
  const existing = await readChainWatchState(env);
  const observation = await observeStoredChainWatch(env, checkedAt);
  if (!observation) {
    return existing;
  }

  let saved = await saveChainWatchObservation(env, HOME_FACTION_ID, existing, observation, checkedAt);
  saved = await syncChainWatchStatusDiscordMessage(env, existing, saved, checkedAt);
  await scheduleChainWatchAlarmForState(env, saved, checkedAt);
  return saved;
}

export function chainWatchNormalMessage(options: {
  currentChain: number;
  timeoutAt: number;
}): string {
  return [
    `Chain Watch: chain ${options.currentChain} is active.`,
    `Timeout: ${formatChainWatchDateTime(options.timeoutAt)}`,
  ].join("\n");
}

export function chainWatchDroppedMessage(options: {
  currentChain: number;
  timeoutAt: number | null;
  lastHit: ChainWatchStateRow | ChainWatchAttackRow | null;
}): string {
  return [
    "Chain Watch DROPPED",
    `Chain ${options.currentChain}`,
    `Last hit: ${formatChainWatchAttackPair(options.lastHit)}`,
    `Dropped at: ${options.timeoutAt ? formatChainWatchAbsoluteDateTime(options.timeoutAt) : "an unknown time"}`,
  ].join("\n");
}

export function chainWatchTrackingMessage(options: {
  currentChain: number | null;
}): string {
  if (chainWatchAlertEligible(options.currentChain)) {
    return [
      `Chain Watch: tracking is active.`,
      `Current chain: ${options.currentChain}`,
    ].join("\n");
  }

  if (Number(options.currentChain ?? 0) > 0) {
    return [
      `Chain Watch: tracking is active.`,
      `Current chain: ${options.currentChain}`,
      `Waiting for a qualifying chain above ${CHAIN_WATCH_ALERT_MIN_CHAIN}.`,
    ].join("\n");
  }

  return [
    `Chain Watch: tracking is active.`,
    `Waiting for a qualifying chain above ${CHAIN_WATCH_ALERT_MIN_CHAIN}.`,
  ].join("\n");
}

export function chainWatchStoppedMessage(options: { warName?: string | null } = {}): string {
  const warName = cleanDiscordLineText(options.warName);
  return warName ? `Chain Watch stopped for ${warName}.` : "Chain Watch stopped.";
}

export function chainWatchWarningAlertKey(stage: "warning_60" | "warning_30"): DiscordAlertKey {
  return stage === "warning_60"
    ? DISCORD_ALERT_KEYS.chainWatchWarning
    : DISCORD_ALERT_KEYS.chainWatchCritical;
}

export async function refreshChainWatch(
  env: Env,
  checkedAt: number,
  options: { scheduleAlarm?: boolean; confirmDrop?: boolean } = {},
): Promise<ChainWatchStateRow | null> {
  const existing = await readChainWatchState(env);
  if (existing && existing.enabled !== 1) {
    await cancelChainWatchAlarm(env, HOME_FACTION_ID);
    return existing;
  }

  const observation = await observeChainWatch(env, checkedAt, {
    confirmDrop: options.confirmDrop ?? false,
  });
  let saved = await saveChainWatchObservation(env, HOME_FACTION_ID, existing, observation, checkedAt);
  saved = await syncChainWatchStatusDiscordMessage(env, existing, saved, checkedAt);

  if (options.scheduleAlarm !== false) {
    await scheduleChainWatchAlarmForState(env, saved, checkedAt);
  }

  return saved;
}

async function observeChainWatch(
  env: Env,
  checkedAt: number,
  options: { confirmDrop: boolean },
): Promise<ChainWatchObservation> {
  const latestHit = await readLatestQualifyingChainHit(env, checkedAt);
  const storedObservationValue = storedChainWatchObservation(latestHit, checkedAt);

  if (storedObservationValue) {
    return storedObservationValue;
  }

  if (!latestHit || !storedObservationValue || options.confirmDrop) {
    const live = await readTornChain(env, checkedAt).catch((err: any) => ({
      error: err?.message || String(err),
      chain: null,
    }));

    if (live.chain?.active && live.chain.timeoutAt !== null) {
      return {
        source: "live_confirm",
        currentChain: live.chain.current,
        resetAt: Math.max(0, live.chain.timeoutAt - CHAIN_WATCH_TIMEOUT_SECONDS),
        timeoutAt: live.chain.timeoutAt,
        lastHit: latestHit,
        lastError: null,
      };
    }

    if (!latestHit) {
      return {
        source: "dropped",
        currentChain: live.chain?.current ?? 0,
        resetAt: null,
        timeoutAt: null,
        lastHit: null,
        lastError: live.error ?? null,
      };
    }

    if (live.error) {
      return {
        ...storedObservation(latestHit),
        source: "stale",
        lastError: live.error,
      };
    }
  }

  return {
    ...storedObservation(latestHit),
    source: "stale",
  };
}

async function observeStoredChainWatch(
  env: Env,
  checkedAt: number,
): Promise<ChainWatchObservation | null> {
  return storedChainWatchObservation(
    await readLatestQualifyingChainHit(env, checkedAt),
    checkedAt,
  );
}

export function storedChainWatchObservation(
  latestHit: ChainWatchAttackRow | null,
  checkedAt: number,
): ChainWatchObservation | null {
  const latestHitAt = latestHit ? chainHitAt(latestHit) : null;
  if (!latestHit || latestHitAt === null || latestHitAt + CHAIN_WATCH_TIMEOUT_SECONDS <= checkedAt) {
    return null;
  }

  return storedObservation(latestHit);
}

function storedObservation(hit: ChainWatchAttackRow): ChainWatchObservation {
  const hitAt = chainHitAt(hit);

  return {
    source: "stored",
    currentChain: hit.chain,
    resetAt: hitAt,
    timeoutAt: hitAt === null ? null : hitAt + CHAIN_WATCH_TIMEOUT_SECONDS,
    lastHit: hit,
    lastError: null,
  };
}

export async function handleChainWatchAlarm(env: Env, factionId: number): Promise<void> {
  if (factionId !== HOME_FACTION_ID) return;
  const now = nowSeconds();
  if (!await reconcileChainWatchActivity(env, now)) return;
  const stateBefore = await readChainWatchState(env);

  if (!stateBefore || stateBefore.enabled !== 1 || stateBefore.scheduled_alarm_stage === null) {
    await cancelChainWatchAlarm(env, factionId);
    return;
  }

  const state = await refreshChainWatch(env, now, {
    scheduleAlarm: false,
    confirmDrop: stateBefore.scheduled_alarm_stage === "drop",
  });
  if (!state) {
    await cancelChainWatchAlarm(env, factionId);
    return;
  }

  const changedReset =
    state.current_chain !== stateBefore.current_chain ||
    state.reset_at !== stateBefore.reset_at ||
    state.timeout_at !== stateBefore.timeout_at;
  if (changedReset) {
    await scheduleChainWatchAlarmForState(env, state, now);
    return;
  }

  if (stateBefore.scheduled_alarm_stage === "warning_60") {
    await sendWarningIfDue(env, state, "warning_60", now);
  } else if (stateBefore.scheduled_alarm_stage === "warning_30") {
    await sendWarningIfDue(env, state, "warning_30", now);
  } else {
    await sendDroppedIfDue(env, state, now);
  }

  const updated = await readChainWatchState(env);
  if (updated) {
    await scheduleChainWatchAlarmForState(env, updated, now);
  }
}

async function sendWarningIfDue(
  env: Env,
  state: ChainWatchStateRow,
  stage: "warning_60" | "warning_30",
  sentAt: number,
): Promise<void> {
  const warningColumn = stage === "warning_60" ? "warning_60_sent_at" : "warning_30_sent_at";
  if (
    state.timeout_at === null ||
    state.timeout_at <= sentAt ||
    !chainWatchAlertEligible(state.current_chain) ||
    state[warningColumn] !== null
  ) {
    return;
  }

  const confirmedState = await confirmChainWatchWarningWithLiveChain(env, state, sentAt);
  if (
    confirmedState === null ||
    confirmedState.timeout_at === null ||
    confirmedState.timeout_at <= sentAt ||
    !chainWatchAlertEligible(confirmedState.current_chain) ||
    confirmedState[warningColumn] !== null
  ) {
    return;
  }

  // A new message is required for mention notifications. Keep the live status
  // message's ID separate so later refreshes do not overwrite this alert.
  const delivery = await deliverChainWatchAlert(
    env,
    null,
    await chainWatchWarningDiscordMessage(env, {
      stage,
      currentChain: Number(confirmedState.current_chain),
      timeoutAt: confirmedState.timeout_at,
      lastHit: confirmedState,
    }),
    stage === "warning_60" ? CHAIN_WATCH_WARNING_COLOR : CHAIN_WATCH_CRITICAL_COLOR,
    chainWatchWarningAlertKey(stage),
  );
  await requireChainWatchAlertDelivery(env, confirmedState, delivery, sentAt);

  await env.DB.prepare(
    `
    UPDATE faction_chain_watch_state
    SET ${warningColumn} = ?,
        alert_chain = ?,
        alert_reset_at = ?,
        scheduled_alarm_stage = NULL,
        scheduled_alarm_at = NULL,
        last_error = NULL,
        updated_at = ?
    WHERE faction_id = ?
    `,
  )
    .bind(
      sentAt,
      confirmedState.current_chain,
      confirmedState.reset_at,
      sentAt,
      confirmedState.faction_id,
    )
    .run();
}

async function confirmChainWatchWarningWithLiveChain(
  env: Env,
  state: ChainWatchStateRow,
  checkedAt: number,
): Promise<ChainWatchStateRow | null> {
  const live = await readTornChain(env, checkedAt).catch((err: any) => ({
    error: err?.message || String(err),
    chain: null,
  }));

  if (live.error) {
    await updateChainWatchLiveCheckStatus(env, state.faction_id, checkedAt, "stale", live.error);
    return state;
  }

  if (!live.chain?.active) {
    await saveLiveChainWarningObservation(env, state, {
      source: "dropped",
      currentChain: live.chain?.current ?? 0,
      resetAt: null,
      timeoutAt: checkedAt,
      lastHit: null,
      lastError: null,
    }, checkedAt);
    return null;
  }

  if (live.chain.timeoutAt === null) {
    return await updateChainWatchLiveCheckStatus(env, state.faction_id, checkedAt, "live_confirm", null);
  }

  const liveResetAt = Math.max(0, live.chain.timeoutAt - CHAIN_WATCH_TIMEOUT_SECONDS);
  const timeoutMovedLater =
    state.timeout_at !== null &&
    live.chain.timeoutAt > state.timeout_at + CHAIN_WATCH_LIVE_TIMEOUT_DRIFT_SECONDS;
  const timeoutDiffers =
    state.timeout_at === null ||
    Math.abs(live.chain.timeoutAt - state.timeout_at) > CHAIN_WATCH_LIVE_TIMEOUT_DRIFT_SECONDS;
  const chainDiffers = live.chain.current !== Number(state.current_chain ?? 0);

  if (timeoutDiffers || chainDiffers) {
    let updated = await saveLiveChainWarningObservation(env, state, {
      source: "live_confirm",
      currentChain: live.chain.current,
      resetAt: liveResetAt,
      timeoutAt: live.chain.timeoutAt,
      lastHit: null,
      lastError: null,
    }, checkedAt);
    updated = await syncChainWatchStatusDiscordMessage(env, state, updated, checkedAt);

    return timeoutMovedLater ? null : updated;
  }

  return await updateChainWatchLiveCheckStatus(env, state.faction_id, checkedAt, "live_confirm", null);
}

async function sendDroppedIfDue(
  env: Env,
  state: ChainWatchStateRow,
  sentAt: number,
): Promise<void> {
  const wasAlertEligible =
    chainWatchAlertEligible(state.current_chain) ||
    chainWatchAlertEligible(state.alert_chain);
  if (
    state.drop_sent_at !== null ||
    !wasAlertEligible ||
    state.timeout_at === null ||
    state.timeout_at > sentAt
  ) {
    return;
  }

  const delivery = await deliverChainWatchAlert(
    env,
    null,
    await chainWatchDroppedDiscordMessage(env, {
      currentChain: Number(state.current_chain ?? state.alert_chain ?? 0),
      timeoutAt: state.timeout_at,
      lastHit: state,
    }),
    CHAIN_WATCH_DROP_COLOR,
    DISCORD_ALERT_KEYS.chainWatchDrop,
  );
  await requireChainWatchAlertDelivery(env, state, delivery, sentAt);

  await env.DB.prepare(
    `
    UPDATE faction_chain_watch_state
    SET drop_sent_at = ?,
        source = 'dropped',
        scheduled_alarm_stage = NULL,
        scheduled_alarm_at = NULL,
        last_error = NULL,
        updated_at = ?
    WHERE faction_id = ?
    `,
  )
    .bind(sentAt, sentAt, state.faction_id)
    .run();
}

async function requireChainWatchAlertDelivery(
  env: Env, state: ChainWatchStateRow, delivery: WatchDeliveryResult<string>, checkedAt: number,
): Promise<void> {
  // Disabled/unrouted alerts intentionally advance the stage. A failed request
  // leaves it pending and propagates to the alarm's retry mechanism.
  if (delivery.status !== "failed") return;
  await env.DB.prepare("UPDATE faction_chain_watch_state SET last_error = ?, updated_at = ? WHERE faction_id = ?")
    .bind(truncateChainWatchError(delivery.error.message), checkedAt, state.faction_id).run();
  throw delivery.error;
}

async function updateChainWatchLiveCheckStatus(
  env: Env,
  factionId: number,
  checkedAt: number,
  source: ChainWatchSource,
  error: string | null,
): Promise<ChainWatchStateRow> {
  const row = (await env.DB.prepare(
    `
    UPDATE faction_chain_watch_state
    SET source = ?,
        last_checked_at = ?,
        last_error = ?,
        updated_at = ?
    WHERE faction_id = ?
    RETURNING *
    `,
  )
    .bind(source, checkedAt, truncateChainWatchError(error), checkedAt, factionId)
    .first()) as ChainWatchStateRow | null;

  if (!row) {
    throw new Error("Failed to update chain watch live check status");
  }

  return row;
}

async function saveLiveChainWarningObservation(
  env: Env,
  state: ChainWatchStateRow,
  observation: ChainWatchObservation,
  checkedAt: number,
): Promise<ChainWatchStateRow> {
  return await saveChainWatchObservation(env, state.faction_id, state, {
    ...observation,
    lastHit: observation.lastHit ?? chainWatchStateAsAttackRow(state),
  }, checkedAt);
}

async function scheduleChainWatchAlarmForState(
  env: Env,
  state: ChainWatchStateRow,
  now: number,
): Promise<void> {
  const next = selectNextChainWatchAlarm({
    currentChain: state.current_chain,
    resetAt: state.reset_at,
    timeoutAt: state.timeout_at,
    warning60SentAt: state.warning_60_sent_at,
    warning30SentAt: state.warning_30_sent_at,
    dropSentAt: state.drop_sent_at,
    now,
  });

  if (!next) {
    await env.DB.prepare(
      `
      UPDATE faction_chain_watch_state
      SET scheduled_alarm_stage = NULL,
          scheduled_alarm_at = NULL,
          updated_at = ?
      WHERE faction_id = ?
      `,
    )
      .bind(now, state.faction_id)
      .run();
    await cancelChainWatchAlarm(env, state.faction_id);
    return;
  }

  await env.DB.prepare(
    `
    UPDATE faction_chain_watch_state
    SET scheduled_alarm_stage = ?,
        scheduled_alarm_at = ?,
        updated_at = ?
    WHERE faction_id = ?
    `,
  )
    .bind(next.stage, next.alarmAt, now, state.faction_id)
    .run();
  await chainWatchAlarmStub(env, state.faction_id).scheduleFaction(state.faction_id, next.alarmAt);
}

async function saveChainWatchObservation(
  env: Env,
  factionId: number,
  existing: ChainWatchStateRow | null,
  observation: ChainWatchObservation,
  checkedAt: number,
): Promise<ChainWatchStateRow> {
  const chainWindowChanged =
    existing === null ||
    existing.current_chain !== observation.currentChain ||
    existing.reset_at !== observation.resetAt ||
    existing.timeout_at !== observation.timeoutAt;
  const activeObservation =
    observation.resetAt !== null &&
    observation.timeoutAt !== null &&
    observation.timeoutAt > checkedAt;
  const resetAlertState = chainWindowChanged && activeObservation;
  const hit = observation.lastHit;
  const hitAt = hit ? chainHitAt(hit) : null;

  const row = (await env.DB.prepare(
    `
    INSERT INTO faction_chain_watch_state (
      faction_id,
      enabled,
      source,
      current_chain,
      reset_at,
      timeout_at,
      last_hit_id,
      last_hit_at,
      last_hit_attacker_name,
      last_hit_defender_name,
      last_hit_result,
      warning_60_sent_at,
      warning_30_sent_at,
      drop_sent_at,
      alert_chain,
      alert_reset_at,
      discord_message_id,
      last_checked_at,
      last_error,
      created_at,
      updated_at
    )
    VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?)
    ON CONFLICT(faction_id) DO UPDATE SET
      source = excluded.source,
      current_chain = excluded.current_chain,
      reset_at = excluded.reset_at,
      timeout_at = excluded.timeout_at,
      last_hit_id = excluded.last_hit_id,
      last_hit_at = excluded.last_hit_at,
      last_hit_attacker_name = excluded.last_hit_attacker_name,
      last_hit_defender_name = excluded.last_hit_defender_name,
      last_hit_result = excluded.last_hit_result,
      warning_60_sent_at = CASE WHEN ? THEN NULL ELSE faction_chain_watch_state.warning_60_sent_at END,
      warning_30_sent_at = CASE WHEN ? THEN NULL ELSE faction_chain_watch_state.warning_30_sent_at END,
      drop_sent_at = CASE WHEN ? THEN NULL ELSE faction_chain_watch_state.drop_sent_at END,
      alert_chain = CASE WHEN ? THEN NULL ELSE faction_chain_watch_state.alert_chain END,
      alert_reset_at = CASE WHEN ? THEN NULL ELSE faction_chain_watch_state.alert_reset_at END,
      last_checked_at = excluded.last_checked_at,
      last_error = excluded.last_error,
      updated_at = excluded.updated_at
    RETURNING *
    `,
  )
    .bind(
      factionId,
      observation.source,
      observation.currentChain,
      observation.resetAt,
      observation.timeoutAt,
      hit?.id ?? null,
      hitAt,
      hit?.attacker_name ?? null,
      hit?.defender_name ?? null,
      hit?.result ?? null,
      checkedAt,
      truncateChainWatchError(observation.lastError),
      checkedAt,
      checkedAt,
      resetAlertState ? 1 : 0,
      resetAlertState ? 1 : 0,
      resetAlertState ? 1 : 0,
      resetAlertState ? 1 : 0,
      resetAlertState ? 1 : 0,
    )
    .first()) as ChainWatchStateRow | null;

  if (!row) {
    throw new Error("Failed to save chain watch state");
  }

  return row;
}

function chainWatchStateAsAttackRow(state: ChainWatchStateRow): ChainWatchAttackRow | null {
  if (state.last_hit_id === null && state.last_hit_at === null) {
    return null;
  }

  return {
    id: state.last_hit_id ?? 0,
    started: state.last_hit_at,
    ended: state.last_hit_at,
    attacker_faction_id: HOME_FACTION_ID,
    defender_faction_id: null,
    attacker_name: state.last_hit_attacker_name,
    defender_name: state.last_hit_defender_name,
    result: state.last_hit_result,
    chain: state.current_chain,
  };
}

export async function readLatestQualifyingChainHit(
  env: Env,
  checkedAt: number = nowSeconds(),
): Promise<ChainWatchAttackRow | null> {
  // The ingestion feed includes attacks both inside and outside war windows.
  // A chain can span a war or watch boundary, so do not filter on either.
  return env.DB.prepare(`
    SELECT a.id, a.started, a.ended, a.attacker_faction_id, a.defender_faction_id,
      a.attacker_name, a.defender_name, a.result, a.chain
    FROM attacks a
    WHERE a.attacker_faction_id = ?
      AND (a.defender_faction_id IS NULL OR a.defender_faction_id != ?)
      AND a.result IN (${POSITIVE_RESULTS_SQL})
      AND COALESCE(a.ended, a.started) <= ?
    ORDER BY COALESCE(a.ended, a.started) DESC, a.id DESC
    LIMIT 1
  `).bind(HOME_FACTION_ID, HOME_FACTION_ID, checkedAt).first<ChainWatchAttackRow>();
}

async function readTornChain(
  env: Env,
  now: number,
): Promise<{ chain: ParsedTornChain | null; error: string | null }> {
  const data = await withTornKeyPool(env, {
    feature: "war_live_data",
    run: ({ key, keySource }) => fetchTrackedTornJson<unknown>(
      env,
      TORN_FACTION_CHAIN_API_URL,
      {
        headers: {
          Accept: "application/json",
          Authorization: `ApiKey ${key}`,
        },
      },
      {
        feature: "chain-watch:chain",
        keySource,
        timeoutMs: 10_000,
      },
      {
        service: "Torn chain",
      },
    ),
  });

  return { chain: parseTornChainResponse(data, now), error: null };
}

async function syncChainWatchStatusDiscordMessage(
  env: Env,
  previous: ChainWatchStateRow | null,
  state: ChainWatchStateRow,
  checkedAt: number,
): Promise<ChainWatchStateRow> {
  const chainWindowChanged =
    previous === null ||
    previous.current_chain !== state.current_chain ||
    previous.reset_at !== state.reset_at ||
    previous.timeout_at !== state.timeout_at;
  const warningWasActive =
    previous !== null &&
    (previous.warning_60_sent_at !== null || previous.warning_30_sent_at !== null);
  const dropStateChanged = previous?.drop_sent_at !== state.drop_sent_at;
  const shouldSync =
    state.discord_message_id === null ||
    chainWindowChanged ||
    warningWasActive ||
    dropStateChanged;

  if (!shouldSync) {
    return state;
  }

  const delivery = await deliverChainWatchAlert(
    env,
    state.discord_message_id,
    chainWatchStatusMessage(state, checkedAt),
  );

  if (delivery.status === "failed") console.warn("Chain Watch Discord status update failed:", delivery.error.message);
  if (delivery.status !== "success" || delivery.value === state.discord_message_id) {
    return state;
  }
  const discordMessageId = delivery.value;

  await env.DB.prepare(
    `
    UPDATE faction_chain_watch_state
    SET discord_message_id = ?,
        updated_at = ?
    WHERE faction_id = ?
    `,
  )
    .bind(discordMessageId, checkedAt, state.faction_id)
    .run();

  return {
    ...state,
    discord_message_id: discordMessageId,
    updated_at: checkedAt,
  };
}

function chainWatchStatusMessage(state: ChainWatchStateRow, checkedAt: number): string {
  if (
    state.timeout_at !== null &&
    state.timeout_at > checkedAt &&
    state.drop_sent_at === null &&
    chainWatchAlertEligible(state.current_chain)
  ) {
    return chainWatchNormalMessage({
      currentChain: Number(state.current_chain),
      timeoutAt: state.timeout_at,
    });
  }

  return chainWatchTrackingMessage({
    currentChain: state.current_chain,
  });
}

async function syncChainWatchStoppedDiscordMessage(
  env: Env,
  state: ChainWatchStateRow,
  checkedAt: number,
): Promise<ChainWatchStateRow> {
  if (!state.discord_message_id) {
    return state;
  }

  const delivery = await deliverChainWatchAlert(
    env,
    state.discord_message_id,
    chainWatchStoppedMessage(),
  );
  if (delivery.status === "failed") console.warn("Chain Watch Discord stopped update failed:", delivery.error.message);

  return {
    ...state,
    updated_at: checkedAt,
  };
}

export async function readChainWatchState(env: Env): Promise<ChainWatchStateRow | null> {
  return env.DB.prepare("SELECT * FROM faction_chain_watch_state WHERE faction_id = ? LIMIT 1")
    .bind(HOME_FACTION_ID).first<ChainWatchStateRow>();
}

function chainWatchAlarmStub(env: Env, factionId: number): ChainWatchAlarmStub {
  return env.CHAIN_WATCH_ALARMS.getByName(`${CHAIN_WATCH_ALARM_NAME_PREFIX}:faction:${factionId}`) as ChainWatchAlarmStub;
}

async function cancelChainWatchAlarm(env: Env, factionId: number): Promise<void> {
  await chainWatchAlarmStub(env, factionId).cancel().catch(() => undefined);
}

function formatChainWatchAttackPair(
  attack: ChainWatchStateRow | ChainWatchAttackRow | null,
): string {
  const attacker = cleanDiscordLineText(
    attack && "last_hit_attacker_name" in attack
      ? attack.last_hit_attacker_name
      : attack?.attacker_name,
  ) ?? "Unknown attacker";
  const defender = cleanDiscordLineText(
    attack && "last_hit_defender_name" in attack
      ? attack.last_hit_defender_name
      : attack?.defender_name,
  ) ?? "Unknown defender";

  return `${attacker} v ${defender}`;
}

function formatChainWatchDateTime(timestamp: number): string {
  return `<t:${Math.floor(timestamp)}:R>`;
}

function formatChainWatchAbsoluteDateTime(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(date);
}

async function chainWatchWarningDiscordMessage(
  env: Env,
  options: {
    stage: "warning_60" | "warning_30";
    currentChain: number;
    timeoutAt: number;
    lastHit: ChainWatchStateRow | ChainWatchAttackRow | null;
  },
): Promise<{ message: string; allowedMentions?: DiscordAllowedMentions }> {
  return chainWatchAlertDiscordMessage(env, chainWatchWarningAlertKey(options.stage), chainWatchWarningMessage(options));
}

async function chainWatchDroppedDiscordMessage(
  env: Env,
  options: {
    currentChain: number;
    timeoutAt: number | null;
    lastHit: ChainWatchStateRow | ChainWatchAttackRow | null;
  },
): Promise<{ message: string; allowedMentions?: DiscordAllowedMentions }> {
  return chainWatchAlertDiscordMessage(env, DISCORD_ALERT_KEYS.chainWatchDrop, chainWatchDroppedMessage(options));
}

async function chainWatchAlertDiscordMessage(env: Env, alertKey: DiscordAlertKey, message: string) {
  const mentions = await readDiscordAlertMentions(env, alertKey);
  const watcherId = await readCurrentChainWatcherDiscordId(env);
  const allowedMentions = mentions.allowedMentions ?? { users: [], roles: [] };
  const users = allowedMentions.users ?? [];
  const appendWatcher = watcherId !== null && !users.includes(watcherId);
  const suffix = appendWatcher ? [mentions.messageSuffix, `<@${watcherId}>`].filter(Boolean).join(" ") : mentions.messageSuffix;
  return {
    message: formatDiscordAlertMessage(message, suffix),
    allowedMentions: appendWatcher ? { ...allowedMentions, users: [...users, watcherId] } : allowedMentions,
  };
}

async function readCurrentChainWatcherDiscordId(env: Env): Promise<string | null> {
  const now = nowSeconds();
  try {
    const watcher = await env.DB.prepare(`
      SELECT links.discord_user_id FROM chain_watch_slots slot
      JOIN chain_watch_schedules watch ON watch.id = slot.watch_id
      JOIN home_faction_members member ON member.member_id = slot.assigned_to AND member.is_current = 1
      JOIN discord_member_links links ON links.torn_user_id = slot.assigned_to
      WHERE watch.is_open = 1 AND watch.start_at <= ? AND (watch.finish_at IS NULL OR watch.finish_at > ?)
        AND slot.start_at = ? AND slot.cancelled = 0
      LIMIT 1
    `).bind(now, now, Math.floor(now / WATCH_HOUR) * WATCH_HOUR).first<{ discord_user_id: string }>();
    const id = watcher?.discord_user_id?.trim();
    return id && /^\d{5,32}$/.test(id) ? id : null;
  } catch (err: any) {
    // An assignment lookup failure must not prevent the normal chain alert.
    console.warn("Chain Watch assignment lookup failed:", err?.message || err);
    return null;
  }
}

function cleanDiscordLineText(value: string | null | undefined): string | null {
  const cleaned = value?.replace(/\s+/g, " ").trim();

  return cleaned || null;
}

function truncateChainWatchError(error: string | null): string | null {
  return error ? error.slice(0, CHAIN_WATCH_MAX_ERROR_LENGTH) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
