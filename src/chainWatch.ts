import {
  HOME_FACTION_ID,
  POSITIVE_ATTACK_RESULTS,
  POSITIVE_RESULTS_SQL,
  SOURCE_NAME,
  TORN_FACTION_CHAIN_API_URL,
} from "./constants";
import { createDiscordWebhookMessage, type DiscordAllowedMentions, editDiscordWebhookMessage } from "./discord";
import { DISCORD_ALERT_KEYS } from "./discordAlerts";
import { formatDiscordAlertMessage, readDiscordAlertMentions } from "./discordMentions";
import { fetchTrackedTornJson } from "./external/torn";
import { WAR_SELECT_COLUMNS, WAR_SELECT_COLUMNS_WITH_ALIAS } from "./sql";
import { Env, WarRow } from "./types";
import { finiteNumber, json, nowSeconds } from "./utils";
import { readJsonObject } from "./backend/request";
import { readWarFromUrl } from "./warRequest";

export const CHAIN_WATCH_TIMEOUT_SECONDS = 5 * 60;
export const CHAIN_WATCH_WARNING_60_OFFSET_SECONDS = 4 * 60;
export const CHAIN_WATCH_WARNING_30_OFFSET_SECONDS = 4 * 60 + 30;
export const CHAIN_WATCH_ALERT_MIN_CHAIN = 100;

const CHAIN_WATCH_MAX_ERROR_LENGTH = 240;
const CHAIN_WATCH_ALARM_NAME_PREFIX = "chain-watch";
const CHAIN_WATCH_LIVE_TIMEOUT_DRIFT_SECONDS = 5;
const CHAIN_WATCH_WARNING_COLOR = 0xffa500;
const CHAIN_WATCH_CRITICAL_COLOR = 0xff0000;

type ChainWatchSource = "stored" | "live_confirm" | "stale" | "dropped";
type ChainWatchAlarmStage = "warning_60" | "warning_30" | "drop";
type ChainWatchAlarmStub = DurableObjectStub & {
  schedule(warId: number, alarmAtSeconds: number): Promise<void>;
  cancel(): Promise<void>;
};

export type ChainWatchStateRow = {
  war_id: number;
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

export async function ensureChainWatchEnabledForWar(env: Env, warId: number): Promise<void> {
  await env.DB.prepare(
    `
    INSERT INTO chain_watch_state (war_id, enabled, source, created_at, updated_at)
    VALUES (?, 1, 'stored', unixepoch(), unixepoch())
    ON CONFLICT(war_id) DO NOTHING
    `,
  )
    .bind(warId)
    .run();
}

export async function runChainWatchCron(env: Env, scheduledTime: number): Promise<void> {
  const checkedAt = Math.floor(scheduledTime / 1000);
  const war = await readActiveChainWatchWar(env);
  if (!war) {
    return;
  }

  await ensureChainWatchEnabledForWar(env, war.id);
  await refreshChainWatchForWar(env, war, checkedAt);
}

export async function getChainWatchForWar(url: URL, env: Env): Promise<Response> {
  try {
    const war = await readWarForChainWatchUrl(url, env);
    if (war instanceof Response) {
      return war;
    }

    if (isWarChainWatchActive(war)) {
      await ensureChainWatchEnabledForWar(env, war.id);
    }

    const state = await readChainWatchState(env, war.id);
    return json(chainWatchResponse(war, state, nowSeconds()));
  } catch (err: any) {
    return json({ ok: false, error: err?.message || String(err), code: "INTERNAL_ERROR" }, 500);
  }
}

export async function updateChainWatchForWar(request: Request, url: URL, env: Env): Promise<Response> {
  try {
    const war = await readWarForChainWatchUrl(url, env);
    if (war instanceof Response) {
      return war;
    }

    const body = await readJsonObject(request);
    const enabled = Boolean(body.enabled);
    const now = nowSeconds();

    await ensureChainWatchEnabledForWar(env, war.id);
    await env.DB.prepare(
      `
      UPDATE chain_watch_state
      SET enabled = ?,
          last_checked_at = ?,
          updated_at = ?
      WHERE war_id = ?
      `,
    )
      .bind(enabled ? 1 : 0, now, now, war.id)
      .run();

    if (!enabled) {
      await cancelChainWatchAlarm(env, war.id);
    } else if (isWarChainWatchActive(war)) {
      await refreshChainWatchForWar(env, war, now);
    }

    const state = await readChainWatchState(env, war.id);
    return json(chainWatchResponse(war, state, nowSeconds()));
  } catch (err: any) {
    return json({ ok: false, error: err?.message || String(err), code: "INTERNAL_ERROR" }, 500);
  }
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
      ? `Chain Watch CRITICAL: chain ${options.currentChain} ${remaining} remaining`
      : `Chain Watch WARNING: chain ${options.currentChain} ${remaining} remaining`,
    `Last hit: ${formatChainWatchAttackPair(options.lastHit)}`,
    `Timeout: ${formatChainWatchDateTime(options.timeoutAt)}`,
  ].join("\n");
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
    `Chain Watch: chain ${options.currentChain} dropped at ${
      options.timeoutAt ? formatChainWatchAbsoluteDateTime(options.timeoutAt) : "an unknown time"
    }.`,
    `Last hit: ${formatChainWatchAttackPair(options.lastHit)}`,
  ].join("\n");
}

async function refreshChainWatchForWar(
  env: Env,
  war: WarRow,
  checkedAt: number,
  options: { scheduleAlarm?: boolean; confirmDrop?: boolean } = {},
): Promise<ChainWatchStateRow | null> {
  const existing = await readChainWatchState(env, war.id);
  if (existing && existing.enabled !== 1) {
    await cancelChainWatchAlarm(env, war.id);
    return existing;
  }

  const observation = await observeChainWatch(env, war, checkedAt, {
    confirmDrop: options.confirmDrop ?? false,
  });
  let saved = await saveChainWatchObservation(env, war.id, existing, observation, checkedAt);
  saved = await syncChainWatchNormalDiscordMessage(env, existing, saved, checkedAt);

  if (options.scheduleAlarm !== false) {
    await scheduleChainWatchAlarmForState(env, saved, checkedAt);
  }

  return saved;
}

async function observeChainWatch(
  env: Env,
  war: WarRow,
  checkedAt: number,
  options: { confirmDrop: boolean },
): Promise<ChainWatchObservation> {
  const latestHit = await readLatestQualifyingChainHit(env, war.id);
  const latestHitAt = latestHit ? chainHitAt(latestHit) : null;
  const storedTimedOut =
    latestHit !== null &&
    latestHitAt !== null &&
    latestHitAt + CHAIN_WATCH_TIMEOUT_SECONDS <= checkedAt;

  if (latestHit && latestHitAt !== null && latestHitAt + CHAIN_WATCH_TIMEOUT_SECONDS > checkedAt) {
    return storedObservation(latestHit);
  }

  if (!latestHit || storedTimedOut || options.confirmDrop) {
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

export async function handleChainWatchAlarm(env: Env, warId: number): Promise<void> {
  const now = nowSeconds();
  const war = await readWarById(env, warId);
  if (!war || !isWarChainWatchActive(war)) {
    await cancelChainWatchAlarm(env, warId);
    return;
  }

  const stateBefore = await readChainWatchState(env, warId);
  if (!stateBefore || stateBefore.enabled !== 1 || stateBefore.scheduled_alarm_stage === null) {
    await cancelChainWatchAlarm(env, warId);
    return;
  }

  const state = await refreshChainWatchForWar(env, war, now, {
    scheduleAlarm: false,
    confirmDrop: stateBefore.scheduled_alarm_stage === "drop",
  });
  if (!state) {
    await cancelChainWatchAlarm(env, warId);
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

  const updated = await readChainWatchState(env, warId);
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

  const discordMessageId = await upsertChainWatchDiscordMessage(
    env,
    confirmedState.discord_message_id,
    await chainWatchWarningDiscordMessage(env, {
      stage,
      currentChain: Number(confirmedState.current_chain),
      timeoutAt: confirmedState.timeout_at,
      lastHit: confirmedState,
    }),
    stage === "warning_60" ? CHAIN_WATCH_WARNING_COLOR : CHAIN_WATCH_CRITICAL_COLOR,
  );

  await env.DB.prepare(
    `
    UPDATE chain_watch_state
    SET ${warningColumn} = ?,
        alert_chain = ?,
        alert_reset_at = ?,
        discord_message_id = COALESCE(?, discord_message_id),
        scheduled_alarm_stage = NULL,
        scheduled_alarm_at = NULL,
        last_error = NULL,
        updated_at = ?
    WHERE war_id = ?
    `,
  )
    .bind(
      sentAt,
      confirmedState.current_chain,
      confirmedState.reset_at,
      discordMessageId,
      sentAt,
      confirmedState.war_id,
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
    await updateChainWatchLiveCheckStatus(env, state.war_id, checkedAt, "stale", live.error);
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
    return await updateChainWatchLiveCheckStatus(env, state.war_id, checkedAt, "live_confirm", null);
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
    updated = await syncChainWatchNormalDiscordMessage(env, state, updated, checkedAt);

    return timeoutMovedLater ? null : updated;
  }

  return await updateChainWatchLiveCheckStatus(env, state.war_id, checkedAt, "live_confirm", null);
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

  const discordMessageId = await upsertChainWatchDiscordMessage(
    env,
    state.discord_message_id,
    chainWatchDroppedMessage({
      currentChain: Number(state.current_chain ?? state.alert_chain ?? 0),
      timeoutAt: state.timeout_at,
      lastHit: state,
    }),
  );

  await env.DB.prepare(
    `
    UPDATE chain_watch_state
    SET drop_sent_at = ?,
        source = 'dropped',
        discord_message_id = COALESCE(?, discord_message_id),
        scheduled_alarm_stage = NULL,
        scheduled_alarm_at = NULL,
        last_error = NULL,
        updated_at = ?
    WHERE war_id = ?
    `,
  )
    .bind(sentAt, discordMessageId, sentAt, state.war_id)
    .run();
}

async function updateChainWatchLiveCheckStatus(
  env: Env,
  warId: number,
  checkedAt: number,
  source: ChainWatchSource,
  error: string | null,
): Promise<ChainWatchStateRow> {
  const row = (await env.DB.prepare(
    `
    UPDATE chain_watch_state
    SET source = ?,
        last_checked_at = ?,
        last_error = ?,
        updated_at = ?
    WHERE war_id = ?
    RETURNING *
    `,
  )
    .bind(source, checkedAt, truncateChainWatchError(error), checkedAt, warId)
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
  return await saveChainWatchObservation(env, state.war_id, state, {
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
      UPDATE chain_watch_state
      SET scheduled_alarm_stage = NULL,
          scheduled_alarm_at = NULL,
          updated_at = ?
      WHERE war_id = ?
      `,
    )
      .bind(now, state.war_id)
      .run();
    await cancelChainWatchAlarm(env, state.war_id);
    return;
  }

  await env.DB.prepare(
    `
    UPDATE chain_watch_state
    SET scheduled_alarm_stage = ?,
        scheduled_alarm_at = ?,
        updated_at = ?
    WHERE war_id = ?
    `,
  )
    .bind(next.stage, next.alarmAt, now, state.war_id)
    .run();
  await chainWatchAlarmStub(env, state.war_id).schedule(state.war_id, next.alarmAt);
}

async function saveChainWatchObservation(
  env: Env,
  warId: number,
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
  const clearDiscordMessage = resetAlertState && existing?.drop_sent_at !== null;
  const hit = observation.lastHit;
  const hitAt = hit ? chainHitAt(hit) : null;

  const row = (await env.DB.prepare(
    `
    INSERT INTO chain_watch_state (
      war_id,
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
    ON CONFLICT(war_id) DO UPDATE SET
      source = excluded.source,
      current_chain = excluded.current_chain,
      reset_at = excluded.reset_at,
      timeout_at = excluded.timeout_at,
      last_hit_id = excluded.last_hit_id,
      last_hit_at = excluded.last_hit_at,
      last_hit_attacker_name = excluded.last_hit_attacker_name,
      last_hit_defender_name = excluded.last_hit_defender_name,
      last_hit_result = excluded.last_hit_result,
      warning_60_sent_at = CASE WHEN ? THEN NULL ELSE chain_watch_state.warning_60_sent_at END,
      warning_30_sent_at = CASE WHEN ? THEN NULL ELSE chain_watch_state.warning_30_sent_at END,
      drop_sent_at = CASE WHEN ? THEN NULL ELSE chain_watch_state.drop_sent_at END,
      alert_chain = CASE WHEN ? THEN NULL ELSE chain_watch_state.alert_chain END,
      alert_reset_at = CASE WHEN ? THEN NULL ELSE chain_watch_state.alert_reset_at END,
      discord_message_id = CASE WHEN ? THEN NULL ELSE chain_watch_state.discord_message_id END,
      last_checked_at = excluded.last_checked_at,
      last_error = excluded.last_error,
      updated_at = excluded.updated_at
    RETURNING *
    `,
  )
    .bind(
      warId,
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
      clearDiscordMessage ? 1 : 0,
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

async function readLatestQualifyingChainHit(
  env: Env,
  warId: number,
): Promise<ChainWatchAttackRow | null> {
  return (await env.DB.prepare(
    `
    SELECT
      a.id,
      a.started,
      a.ended,
      a.attacker_faction_id,
      a.defender_faction_id,
      a.attacker_name,
      a.defender_name,
      a.result,
      a.chain
    FROM attacks a
    JOIN wars w ON w.id = a.war_id
    WHERE a.war_id = ?
      AND a.attacker_faction_id = ${HOME_FACTION_ID}
      AND (
        a.defender_faction_id IS NULL
        OR a.defender_faction_id != ${HOME_FACTION_ID}
      )
      AND a.result IN (${POSITIVE_RESULTS_SQL})
      AND COALESCE(a.ended, a.started) IS NOT NULL
      AND a.started >= w.practical_start_time
      AND (
        w.practical_finish_time IS NULL
        OR COALESCE(a.ended, a.started) <= w.practical_finish_time
      )
      AND (
        w.official_end_time IS NULL
        OR COALESCE(a.ended, a.started) <= w.official_end_time
      )
    ORDER BY COALESCE(a.ended, a.started) DESC, a.id DESC
    LIMIT 1
    `,
  )
    .bind(warId)
    .first()) as ChainWatchAttackRow | null;
}

async function readTornChain(
  env: Env,
  now: number,
): Promise<{ chain: ParsedTornChain | null; error: string | null }> {
  const data = await fetchTrackedTornJson<unknown>(
    env,
    TORN_FACTION_CHAIN_API_URL,
    {
      headers: {
        Accept: "application/json",
        Authorization: `ApiKey ${env.TORN_API_KEY}`,
      },
    },
    {
      feature: "chain-watch:chain",
      keySource: "env:TORN_API_KEY",
      timeoutMs: 10_000,
    },
    {
      service: "Torn chain",
    },
  );

  return { chain: parseTornChainResponse(data, now), error: null };
}

async function syncChainWatchNormalDiscordMessage(
  env: Env,
  previous: ChainWatchStateRow | null,
  state: ChainWatchStateRow,
  checkedAt: number,
): Promise<ChainWatchStateRow> {
  if (
    state.timeout_at === null ||
    state.timeout_at <= checkedAt ||
    state.drop_sent_at !== null ||
    !chainWatchAlertEligible(state.current_chain)
  ) {
    return state;
  }

  const chainWindowChanged =
    previous === null ||
    previous.current_chain !== state.current_chain ||
    previous.reset_at !== state.reset_at ||
    previous.timeout_at !== state.timeout_at;
  const warningWasActive =
    previous !== null &&
    (previous.warning_60_sent_at !== null || previous.warning_30_sent_at !== null);

  if (state.discord_message_id !== null && !chainWindowChanged && !warningWasActive) {
    return state;
  }

  const discordMessageId = await upsertChainWatchDiscordMessage(
    env,
    state.discord_message_id,
    chainWatchNormalMessage({
      currentChain: Number(state.current_chain),
      timeoutAt: state.timeout_at,
    }),
  );

  if (!discordMessageId || discordMessageId === state.discord_message_id) {
    return state;
  }

  await env.DB.prepare(
    `
    UPDATE chain_watch_state
    SET discord_message_id = ?,
        updated_at = ?
    WHERE war_id = ?
    `,
  )
    .bind(discordMessageId, checkedAt, state.war_id)
    .run();

  return {
    ...state,
    discord_message_id: discordMessageId,
    updated_at: checkedAt,
  };
}

async function upsertChainWatchDiscordMessage(
  env: Env,
  existingMessageId: string | null,
  options: string | { message: string; allowedMentions?: DiscordAllowedMentions },
  embedColor?: number,
): Promise<string | null> {
  if (!env.DISCORD_WEBHOOK_URL) {
    return existingMessageId;
  }

  const message = typeof options === "string" ? options : options.message;
  const allowedMentions = typeof options === "string" ? { users: [], roles: [] } : options.allowedMentions;

  try {
    if (existingMessageId) {
      await editDiscordWebhookMessage(env, existingMessageId, message, allowedMentions, { embedColor });
      return existingMessageId;
    }

    return await createDiscordWebhookMessage(env, message, allowedMentions, { embedColor });
  } catch (err: any) {
    console.warn("Chain Watch Discord alert failed:", err?.message || err);
    return existingMessageId;
  }
}

async function readActiveChainWatchWar(env: Env): Promise<WarRow | null> {
  return (await env.DB.prepare(
    `
    SELECT ${WAR_SELECT_COLUMNS_WITH_ALIAS}
    FROM sync_state state
    JOIN wars w ON w.id = state.active_war_id
    WHERE state.name = ?
      AND state.war_state = 'current'
      AND w.status = 'active'
      AND w.practical_finish_time IS NULL
      AND w.official_end_time IS NULL
    LIMIT 1
    `,
  )
    .bind(SOURCE_NAME)
    .first()) as WarRow | null;
}

async function readWarById(env: Env, warId: number): Promise<WarRow | null> {
  return (await env.DB.prepare(
    `
    SELECT ${WAR_SELECT_COLUMNS}
    FROM wars
    WHERE id = ?
    LIMIT 1
    `,
  )
    .bind(warId)
    .first()) as WarRow | null;
}

async function readWarForChainWatchUrl(url: URL, env: Env): Promise<WarRow | Response> {
  return readWarFromUrl(url, env);
}

async function readChainWatchState(env: Env, warId: number): Promise<ChainWatchStateRow | null> {
  return (await env.DB.prepare(
    `
    SELECT *
    FROM chain_watch_state
    WHERE war_id = ?
    LIMIT 1
    `,
  )
    .bind(warId)
    .first()) as ChainWatchStateRow | null;
}

function chainWatchResponse(war: WarRow, state: ChainWatchStateRow | null, now: number) {
  const remainingSeconds = state?.timeout_at ? Math.max(0, state.timeout_at - now) : null;

  return {
    ok: true,
    war: {
      id: war.id,
      name: war.name,
      status: war.status,
      practical_finish_time: war.practical_finish_time,
      official_end_time: war.official_end_time,
    },
    state,
    computed: {
      active: isWarChainWatchActive(war) && state?.enabled === 1,
      alert_eligible: chainWatchAlertEligible(state?.current_chain ?? null),
      remaining_seconds: remainingSeconds,
      dropped: remainingSeconds !== null && remainingSeconds <= 0,
    },
  };
}

function isWarChainWatchActive(war: WarRow): boolean {
  return war.status === "active" && war.practical_finish_time === null;
}

function chainWatchAlarmStub(env: Env, warId: number): ChainWatchAlarmStub {
  return env.CHAIN_WATCH_ALARMS.getByName(`${CHAIN_WATCH_ALARM_NAME_PREFIX}:${warId}`) as ChainWatchAlarmStub;
}

async function cancelChainWatchAlarm(env: Env, warId: number): Promise<void> {
  await chainWatchAlarmStub(env, warId).cancel().catch(() => undefined);
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
  const mentions = await readDiscordAlertMentions(env, DISCORD_ALERT_KEYS.chainWatch);
  return {
    message: formatDiscordAlertMessage(chainWatchWarningMessage(options), mentions.messageSuffix),
    allowedMentions: mentions.allowedMentions ?? { users: [], roles: [] },
  };
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
