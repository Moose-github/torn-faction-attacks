import { cleanString, positiveIntegerOrNull, readJsonObject } from "./backend/request";
import { HOME_FACTION_ID, POSITIVE_RESULTS_SQL, RETALIATION_WINDOW_SECONDS, SOURCE_NAME } from "./constants";
import { type DiscordEmbed } from "./discord";
import { syncRetaliationMessages } from "./retaliationDiscordMessages";
import { isDiscordAlertEnabled } from "./discordAlertSettings";
import { DISCORD_ALERT_KEYS } from "./discordAlerts";
import { ingestRecentFactionAttacks, RecentAttackIngestionResult } from "./ingestion";
import { readSyncTimestamp, upsertSyncTimestamp } from "./syncState";
import { Env } from "./types";
import { d1Changes, json, nowSeconds, parseLimit } from "./utils";
import { refreshActiveChainWatchFromStoredAttacks } from "./chainWatch";

export { RETALIATION_WINDOW_SECONDS } from "./constants";
export const RETALIATION_CLAIM_TTL_SECONDS = 30;

const LIGHT_SYNC_LOOKBACK_SECONDS = RETALIATION_WINDOW_SECONDS + 90;
const LIGHT_SYNC_FRESH_SECONDS = 45;
const LIGHT_SYNC_COOLDOWN_SECONDS = 20;
const LIGHT_SYNC_ATTEMPT_STATE = "retaliation_light_sync_attempt";
const LIGHT_SYNC_SUCCESS_STATE = "retaliation_light_sync_success";
export const RETALIATION_BOARD_ACTIVE_REFRESH_SECONDS = 10;
const RETALIATION_BOARD_FALLBACK_REFRESH_SECONDS = 60;
const RETALIATION_BOARD_LIGHT_SYNC_ATTEMPT_STATE = "retaliation_board_light_sync_attempt";
const RETALIATION_BOARD_LIGHT_SYNC_SUCCESS_STATE = "retaliation_board_light_sync_success";
const RETALIATION_BOARD_LIGHT_SYNC_COOLDOWN_SECONDS = 10;
const RETALIATION_BOARD_AVAILABLE_COLOR = 0xed4245;
const RETALIATION_BOARD_PENDING_COLOR = 0xffa500;
const RETALIATION_BOARD_CONFIRMED_COLOR = 0x57f287;
const RETALIATION_BOARD_ALARM_NAME = "retaliation-board";

export type RetaliationAttackRow = {
  id: number;
  code: string | null;
  started: number | null;
  ended: number | null;
  attacker_id: number | null;
  attacker_name: string | null;
  attacker_faction_id: number | null;
  attacker_faction_name: string | null;
  defender_id: number | null;
  defender_name: string | null;
  defender_faction_id: number | null;
  defender_faction_name: string | null;
  result: string | null;
  respect_gain: number | null;
  respect_loss: number | null;
  m_retaliation?: number | null;
  attack_at: number | null;
};

export type RetaliationStatus = "available" | "claimed_pending" | "claimed_confirmed" | "expired";

export type PendingRetaliationClaim = {
  opening_attack_id: number;
  target_id: number;
  claimant_torn_user_id: number;
  claimant_name: string | null;
  source: "dashboard" | "tampermonkey";
  attack_url: string | null;
  created_at: number;
  updated_at: number;
  expires_at: number;
};

export type RetaliationOpportunity = {
  target_id: number;
  opening_attack_id: number | null;
  status: RetaliationStatus | "none";
  available: boolean;
  reason: "available" | "claimed" | "none";
  enemy_attack: RetaliationAttackRow | null;
  claimed_by_attack: RetaliationAttackRow | null;
  pending_claim: PendingRetaliationClaim | null;
  expires_at: number | null;
};

export type RetaliationAvailability = RetaliationOpportunity;

type LightSyncResult = {
  fresh: boolean;
  status: "fresh" | "refreshed" | "cooldown" | "failed" | "stored";
  last_success_at: number | null;
  warning: string | null;
  result: RecentAttackIngestionResult | null;
};

type RetaliationBoardDiscordPayload = {
  content: string;
  embeds: DiscordEmbed[];
};

type RetaliationBoardAlarmStub = DurableObjectStub & {
  schedule(alarmAtSeconds: number): Promise<void>;
  cancel(): Promise<void>;
};

export type RetaliationBoardRefreshPlan = {
  active: boolean;
  nextRefreshAt: number;
};

export type RetaliationBoardSyncResult = RetaliationBoardRefreshPlan & {
  edited: boolean;
  skippedReason?: string;
  lightSync?: LightSyncResult;
};

export async function getRetaliationCheck(url: URL, env: Env): Promise<Response> {
  const targetId = positiveIntegerOrNull(url.searchParams.get("target_id"));
  if (targetId === null) {
    return json({
      ok: false,
      error: "A valid target_id query parameter is required",
      code: "INVALID_TARGET_ID",
    }, 400);
  }

  const checkedAt = nowSeconds();
  const sync = await maybeSyncRecentAttacks(env, checkedAt);
  const availability = await readRetaliationAvailability(env, targetId, checkedAt);

  return json({
    ok: true,
    target_id: targetId,
    opening_attack_id: availability.opening_attack_id,
    checked_at: checkedAt,
    window_seconds: RETALIATION_WINDOW_SECONDS,
    claim_ttl_seconds: RETALIATION_CLAIM_TTL_SECONDS,
    status: availability.status,
    available: availability.available,
    reason: availability.reason,
    expires_at: availability.expires_at,
    fresh: sync.fresh,
    sync: {
      status: sync.status,
      last_success_at: sync.last_success_at,
      warning: sync.warning,
      result: sync.result,
    },
    pending_claim: availability.pending_claim,
    enemy_attack: availability.enemy_attack,
    claimed_by_attack: availability.claimed_by_attack,
  });
}

export async function getAvailableRetaliations(url: URL, env: Env): Promise<Response> {
  const checkedAt = nowSeconds();
  const sync = await maybeSyncRecentAttacks(env, checkedAt);
  const includeClaimed = booleanQueryParam(url.searchParams.get("include_claimed"));
  const includeExpired = booleanQueryParam(url.searchParams.get("include_expired"));
  const limit = parseLimit(url.searchParams.get("limit"), 100, 250);
  const retaliations = await listRetaliationOpportunities(env, checkedAt, {
    includeClaimed,
    includeExpired,
    limit,
  });

  return json({
    ok: true,
    checked_at: checkedAt,
    window_seconds: RETALIATION_WINDOW_SECONDS,
    claim_ttl_seconds: RETALIATION_CLAIM_TTL_SECONDS,
    fresh: sync.fresh,
    sync: {
      status: sync.status,
      last_success_at: sync.last_success_at,
      warning: sync.warning,
      result: sync.result,
    },
    retaliations,
  });
}

export async function createRetaliationClaimFromRequest(
  request: Request,
  env: Env,
  claimantTornUserId: number | null,
): Promise<Response> {
  if (claimantTornUserId === null) {
    return json({ ok: false, error: "Unauthorized", code: "UNAUTHORIZED" }, 401);
  }

  const body = await readJsonObject(request);
  const targetId = positiveIntegerOrNull(body.target_id);
  const openingAttackId = positiveIntegerOrNull(body.opening_attack_id);
  const source = retaliationClaimSource(body.source);
  const attackUrl = cleanString(body.attack_url)?.slice(0, 500) ?? null;

  if (targetId === null) {
    return json({ ok: false, error: "A valid target_id is required", code: "INVALID_TARGET_ID" }, 400);
  }
  if (openingAttackId === null) {
    return json({
      ok: false,
      error: "A valid opening_attack_id is required",
      code: "INVALID_OPENING_ATTACK_ID",
    }, 400);
  }
  if (!source) {
    return json({ ok: false, error: "source must be dashboard or tampermonkey", code: "INVALID_SOURCE" }, 400);
  }

  const checkedAt = nowSeconds();
  const sync = await maybeSyncRecentAttacks(env, checkedAt);
  const openingAttack = await readEnemyAttackById(env, openingAttackId);
  if (!openingAttack || openingAttack.attacker_id !== targetId) {
    return json({
      ok: false,
      error: "The requested retaliation opportunity is no longer current",
      code: "OPPORTUNITY_CHANGED",
    }, 409);
  }

  const openingAt = attackTimestamp(openingAttack);
  const expiresAt = openingAt === null ? null : openingAt + RETALIATION_WINDOW_SECONDS;
  if (openingAt === null || expiresAt === null || expiresAt <= checkedAt) {
    return json({
      ok: false,
      error: "The requested retaliation opportunity has expired",
      code: "OPPORTUNITY_EXPIRED",
    }, 410);
  }

  const latestAttack = await readLatestEnemyAttack(env, targetId, checkedAt - RETALIATION_WINDOW_SECONDS);
  if (!latestAttack || latestAttack.id !== openingAttackId) {
    return json({
      ok: false,
      error: "A newer retaliation opportunity exists for this target",
      code: "OPPORTUNITY_CHANGED",
      retaliation: latestAttack
        ? await resolveRetaliationOpportunityFromAttack(env, latestAttack, checkedAt)
        : null,
    }, 409);
  }

  const confirmedClaim = await readClaimingRetaliationAttack(env, targetId, openingAt);
  if (confirmedClaim) {
    return json({
      ok: false,
      error: "This retaliation has already been completed and confirmed by Torn attack data",
      code: "CLAIM_ALREADY_CONFIRMED",
      retaliation: resolveRetaliationOpportunity(openingAttack, confirmedClaim, null, checkedAt),
    }, 409);
  }

  const existingClaim = await readAnyPendingClaim(env, openingAttackId);
  if (
    existingClaim &&
    existingClaim.expires_at > checkedAt &&
    existingClaim.claimant_torn_user_id !== claimantTornUserId
  ) {
    return json({
      ok: false,
      error: "Another member has already started this attack",
      code: "CLAIM_ALREADY_PENDING",
      retaliation: resolveRetaliationOpportunity(openingAttack, null, existingClaim, checkedAt),
    }, 409);
  }

  await upsertPendingClaim(env, {
    openingAttackId,
    targetId,
    claimantTornUserId,
    source,
    attackUrl,
    now: checkedAt,
  });

  const retaliation = await resolveRetaliationOpportunityFromAttack(env, openingAttack, checkedAt);
  await syncRetaliationDiscordBoard(env, checkedAt);

  return json({
    ok: true,
    checked_at: checkedAt,
    window_seconds: RETALIATION_WINDOW_SECONDS,
    claim_ttl_seconds: RETALIATION_CLAIM_TTL_SECONDS,
    fresh: sync.fresh,
    sync: {
      status: sync.status,
      last_success_at: sync.last_success_at,
      warning: sync.warning,
      result: sync.result,
    },
    retaliation,
  });
}

export function evaluateRetaliationAvailability(
  enemyAttack: RetaliationAttackRow | null,
  claimedByAttack: RetaliationAttackRow | null,
  now: number = nowSeconds(),
): RetaliationAvailability {
  return resolveRetaliationOpportunity(enemyAttack, claimedByAttack, null, now);
}

export function resolveRetaliationOpportunity(
  enemyAttack: RetaliationAttackRow | null,
  claimedByAttack: RetaliationAttackRow | null,
  pendingClaim: PendingRetaliationClaim | null,
  now: number = nowSeconds(),
): RetaliationOpportunity {
  const targetId = enemyAttack?.attacker_id ?? pendingClaim?.target_id ?? 0;
  if (!enemyAttack) {
    return {
      target_id: targetId,
      opening_attack_id: null,
      status: "none",
      available: false,
      reason: "none",
      enemy_attack: null,
      claimed_by_attack: null,
      pending_claim: null,
      expires_at: null,
    };
  }

  const attackAt = attackTimestamp(enemyAttack);
  if (attackAt === null) {
    return {
      target_id: targetId,
      opening_attack_id: null,
      status: "none",
      available: false,
      reason: "none",
      enemy_attack: null,
      claimed_by_attack: null,
      pending_claim: null,
      expires_at: null,
    };
  }

  const expiresAt = attackAt + RETALIATION_WINDOW_SECONDS;
  const expired = expiresAt <= now;
  const unexpiredPending = pendingClaim && pendingClaim.expires_at > now ? pendingClaim : null;

  if (expired && !claimedByAttack) {
    return {
      target_id: targetId,
      opening_attack_id: enemyAttack.id,
      status: "expired",
      available: false,
      reason: "none",
      enemy_attack: enemyAttack,
      claimed_by_attack: null,
      pending_claim: null,
      expires_at: expiresAt,
    };
  }

  if (claimedByAttack) {
    return {
      target_id: targetId,
      opening_attack_id: enemyAttack.id,
      status: "claimed_confirmed",
      available: false,
      reason: "claimed",
      enemy_attack: enemyAttack,
      claimed_by_attack: claimedByAttack,
      pending_claim: null,
      expires_at: expiresAt,
    };
  }

  if (unexpiredPending) {
    return {
      target_id: targetId,
      opening_attack_id: enemyAttack.id,
      status: "claimed_pending",
      available: false,
      reason: "claimed",
      enemy_attack: enemyAttack,
      claimed_by_attack: null,
      pending_claim: unexpiredPending,
      expires_at: expiresAt,
    };
  }

  return {
    target_id: targetId,
    opening_attack_id: enemyAttack.id,
    status: "available",
    available: true,
    reason: "available",
    enemy_attack: enemyAttack,
    claimed_by_attack: null,
    pending_claim: null,
    expires_at: expiresAt,
  };
}

export async function syncRetaliationDiscordBoard(
  env: Env,
  checkedAt: number = nowSeconds(),
  options: { allowActiveLightSync?: boolean } = {},
): Promise<RetaliationBoardSyncResult> {
  let rows = await listDiscordRetaliationOpportunities(env, checkedAt);
  // Include tracked messages whose windows just ended, so the final edit can
  // observe a retaliation made shortly before the deadline.
  const lightSync = options.allowActiveLightSync && rows.length > 0
    ? await maybeSyncRetaliationBoardRecentAttacks(env, checkedAt)
    : null;
  if ((lightSync?.result?.inserted_attacks ?? 0) > 0) {
    await refreshActiveChainWatchFromStoredAttacks(env, checkedAt);
  }
  if (lightSync?.status === "refreshed") rows = await listDiscordRetaliationOpportunities(env, checkedAt);
  const refreshPlan = getRetaliationBoardRefreshPlan(rows, checkedAt);
  if (!await isDiscordAlertEnabled(env, DISCORD_ALERT_KEYS.retaliationBoard)) {
    if (refreshPlan.active) {
      await scheduleRetaliationBoardAlarm(env, refreshPlan.nextRefreshAt);
    }
    return {
      ...refreshPlan,
      edited: false,
      skippedReason: "disabled",
      ...(lightSync ? { lightSync } : {}),
    };
  }

  const delivery = await syncRetaliationMessages(env, rows.filter(row => row.opening_attack_id !== null)
    .map(row => ({
      openingAttackId: row.opening_attack_id!,
      expiresAt: row.expires_at!,
      terminal: !isActiveRetaliationBoardRow(row),
      payload: renderRetaliationMessagePayload(row),
    })), checkedAt);
  const active = refreshPlan.active || delivery.pending;
  const nextRefreshAt = active ? checkedAt + RETALIATION_BOARD_ACTIVE_REFRESH_SECONDS : refreshPlan.nextRefreshAt;
  if (active) await scheduleRetaliationBoardAlarm(env, nextRefreshAt);
  return { active, nextRefreshAt, edited: delivery.edited, ...(lightSync ? { lightSync } : {}) };
}

async function listDiscordRetaliationOpportunities(env: Env, now: number): Promise<RetaliationOpportunity[]> {
  // Read each opening attack, including multiple openings from the same target.
  // The dashboard's latest-per-target cache must not collapse separate messages.
  const result = await env.DB.prepare(`
    SELECT ${retaliationAttackColumns()} FROM attacks
    WHERE defender_faction_id = ? AND result IN (${POSITIVE_RESULTS_SQL})
      AND attacker_id > 0 AND ended > ? AND ended <= ?
    UNION
    SELECT ${retaliationAttackColumns()} FROM attacks
    WHERE id IN (SELECT opening_attack_id FROM retaliation_discord_messages WHERE finalized_at IS NULL)
    ORDER BY attack_at ASC, id ASC
  `).bind(HOME_FACTION_ID, now - RETALIATION_WINDOW_SECONDS, now).all<RetaliationAttackRow>();
  const openings = result.results ?? [];
  const rows: RetaliationOpportunity[] = [];
  // Stay below D1's per-statement binding limit even during a busy war.
  for (let offset = 0; offset < openings.length; offset += 50) {
    const batch = openings.slice(offset, offset + 50);
    const confirmed = await readConfirmedClaimsForOpenings(env, batch);
    const pending = await readPendingClaimsForOpenings(env, batch.map(attack => attack.id), now);
    rows.push(...batch.map(attack => resolveRetaliationOpportunity(
      attack, confirmed.get(attack.id) ?? null, pending.get(attack.id) ?? null, now,
    )));
  }
  return rows;
}

export async function handleRetaliationBoardAlarm(env: Env, checkedAt: number = nowSeconds()): Promise<void> {
  await syncRetaliationDiscordBoard(env, checkedAt, { allowActiveLightSync: true });
}

async function listRetaliationOpportunities(
  env: Env,
  now: number,
  options: { includeClaimed: boolean; includeExpired: boolean; limit: number },
): Promise<RetaliationOpportunity[]> {
  const lookback = options.includeExpired
    ? RETALIATION_WINDOW_SECONDS * 6
    : RETALIATION_WINDOW_SECONDS;
  const attacks = await readRecentEnemyAttacks(env, now - lookback, options.limit * 3);
  const latestByTarget = new Map<number, RetaliationAttackRow>();

  for (const attack of attacks) {
    const targetId = attack.attacker_id;
    if (!targetId || latestByTarget.has(targetId)) {
      continue;
    }
    latestByTarget.set(targetId, attack);
    if (latestByTarget.size >= options.limit) {
      break;
    }
  }

  const openings = Array.from(latestByTarget.values());
  const confirmedClaims = await readConfirmedClaimsForOpenings(env, openings);
  const pendingClaims = await readPendingClaimsForOpenings(env, openings.map((attack) => attack.id), now);

  return openings
    .map((attack) => resolveRetaliationOpportunity(
      attack,
      confirmedClaims.get(attack.id) ?? null,
      pendingClaims.get(attack.id) ?? null,
      now,
    ))
    .filter((row) => options.includeExpired || (row.expires_at ?? 0) > now)
    .filter((row) => options.includeClaimed || row.status === "available")
    .sort(compareRetaliationRows)
    .slice(0, options.limit);
}

async function readRetaliationAvailability(
  env: Env,
  targetId: number,
  now: number,
): Promise<RetaliationAvailability> {
  const enemyAttack = await readLatestEnemyAttack(env, targetId, now - RETALIATION_WINDOW_SECONDS);
  return enemyAttack
    ? resolveRetaliationOpportunityFromAttack(env, enemyAttack, now)
    : resolveRetaliationOpportunity(null, null, null, now);
}

async function resolveRetaliationOpportunityFromAttack(
  env: Env,
  enemyAttack: RetaliationAttackRow,
  now: number,
): Promise<RetaliationOpportunity> {
  const attackAt = attackTimestamp(enemyAttack);
  const targetId = enemyAttack.attacker_id;
  const confirmed = targetId && attackAt !== null
    ? await readClaimingRetaliationAttack(env, targetId, attackAt)
    : null;
  const pending = await readPendingClaim(env, enemyAttack.id, now);
  return resolveRetaliationOpportunity(enemyAttack, confirmed, pending, now);
}

async function maybeSyncRecentAttacks(env: Env, now: number): Promise<LightSyncResult> {
  const lastSuccess = await readSyncTimestamp(env, LIGHT_SYNC_SUCCESS_STATE);

  if (lastSuccess >= now - LIGHT_SYNC_FRESH_SECONDS) {
    return {
      fresh: true,
      status: "fresh",
      last_success_at: lastSuccess,
      warning: null,
      result: null,
    };
  }

  const claimed = await claimLightSyncAttempt(env, LIGHT_SYNC_ATTEMPT_STATE, LIGHT_SYNC_COOLDOWN_SECONDS, now);
  if (!claimed) {
    return {
      fresh: lastSuccess >= now - LIGHT_SYNC_FRESH_SECONDS,
      status: "cooldown",
      last_success_at: lastSuccess || null,
      warning: "Recent attack refresh is already cooling down; using stored data",
      result: null,
    };
  }

  try {
    const result = await ingestRecentFactionAttacks(env, now - LIGHT_SYNC_LOOKBACK_SECONDS, now);
    await upsertSyncTimestamp(env, LIGHT_SYNC_SUCCESS_STATE, now);
    return {
      fresh: true,
      status: "refreshed",
      last_success_at: now,
      warning: null,
      result,
    };
  } catch (err: any) {
    return {
      fresh: false,
      status: "failed",
      last_success_at: lastSuccess || await readSyncTimestamp(env, SOURCE_NAME) || null,
      warning: err?.message || String(err),
      result: null,
    };
  }
}

async function maybeSyncRetaliationBoardRecentAttacks(env: Env, now: number): Promise<LightSyncResult> {
  const lastSuccess = await readSyncTimestamp(env, RETALIATION_BOARD_LIGHT_SYNC_SUCCESS_STATE);
  const claimed = await claimLightSyncAttempt(
    env,
    RETALIATION_BOARD_LIGHT_SYNC_ATTEMPT_STATE,
    RETALIATION_BOARD_LIGHT_SYNC_COOLDOWN_SECONDS,
    now,
  );

  if (!claimed) {
    return {
      fresh: lastSuccess >= now - RETALIATION_BOARD_LIGHT_SYNC_COOLDOWN_SECONDS,
      status: "cooldown",
      last_success_at: lastSuccess || null,
      warning: "Retaliation board attack refresh is already cooling down; using stored data",
      result: null,
    };
  }

  try {
    const result = await ingestRecentFactionAttacks(env, now - LIGHT_SYNC_LOOKBACK_SECONDS, now);
    await upsertSyncTimestamp(env, RETALIATION_BOARD_LIGHT_SYNC_SUCCESS_STATE, now);
    return {
      fresh: true,
      status: "refreshed",
      last_success_at: now,
      warning: null,
      result,
    };
  } catch (err: any) {
    console.warn("Retaliation board attack refresh failed:", err?.message || err);
    return {
      fresh: false,
      status: "failed",
      last_success_at: lastSuccess || await readSyncTimestamp(env, SOURCE_NAME) || null,
      warning: err?.message || String(err),
      result: null,
    };
  }
}

async function claimLightSyncAttempt(
  env: Env,
  stateName: string,
  cooldownSeconds: number,
  now: number,
): Promise<boolean> {
  const result = await env.DB.prepare(
    `
    INSERT INTO sync_state (name, last_started, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(name) DO UPDATE SET
      last_started = excluded.last_started,
      updated_at = CURRENT_TIMESTAMP
    WHERE sync_state.last_started <= ?
    `,
  )
    .bind(stateName, now, now - cooldownSeconds)
    .run();

  return d1Changes(result) > 0;
}

async function readLatestEnemyAttack(
  env: Env,
  targetId: number,
  since: number,
): Promise<RetaliationAttackRow | null> {
  return (await env.DB.prepare(
    `
    SELECT ${retaliationOpportunityColumns()}
    FROM retaliation_opportunities
    WHERE target_id = ?
      AND attack_at >= ?
    LIMIT 1
    `,
  )
    .bind(targetId, since)
    .first()) as RetaliationAttackRow | null;
}

async function readEnemyAttackById(env: Env, attackId: number): Promise<RetaliationAttackRow | null> {
  return (await env.DB.prepare(
    `
    SELECT ${retaliationAttackColumns()}
    FROM attacks
    WHERE id = ?
      AND defender_faction_id = ?
      AND result IN (${POSITIVE_RESULTS_SQL})
      AND ended IS NOT NULL
    LIMIT 1
    `,
  )
    .bind(attackId, HOME_FACTION_ID)
    .first()) as RetaliationAttackRow | null;
}

async function readRecentEnemyAttacks(
  env: Env,
  since: number,
  limit: number,
): Promise<RetaliationAttackRow[]> {
  const result = await env.DB.prepare(
    `
    SELECT ${retaliationOpportunityColumns()}
    FROM retaliation_opportunities
    WHERE attack_at >= ?
    ORDER BY attack_at DESC, opening_attack_id DESC
    LIMIT ?
    `,
  )
    .bind(since, limit)
    .all<RetaliationAttackRow>();

  return result.results ?? [];
}

async function readClaimingRetaliationAttack(
  env: Env,
  targetId: number,
  after: number,
): Promise<RetaliationAttackRow | null> {
  return (await env.DB.prepare(
    `
    SELECT ${retaliationAttackColumns()}
    FROM attacks
    WHERE attacker_faction_id = ?
      AND defender_id = ?
      AND result = 'Hospitalized'
      AND COALESCE(m_retaliation, 1) > 1
      AND ended >= ?
      AND ended < ?
    ORDER BY ended ASC, id ASC
    LIMIT 1
    `,
  )
    .bind(HOME_FACTION_ID, targetId, after, after + RETALIATION_WINDOW_SECONDS)
    .first()) as RetaliationAttackRow | null;
}

async function readConfirmedClaimsForOpenings(
  env: Env,
  openings: RetaliationAttackRow[],
): Promise<Map<number, RetaliationAttackRow>> {
  const targetIds = uniquePositive(openings.map((attack) => attack.attacker_id));
  const earliestOpeningAt = openings.reduce<number | null>((earliest, attack) => {
    const at = attackTimestamp(attack);
    if (at === null) return earliest;
    return earliest === null ? at : Math.min(earliest, at);
  }, null);
  if (targetIds.length === 0 || earliestOpeningAt === null) {
    return new Map();
  }

  const placeholders = targetIds.map(() => "?").join(",");
  const result = await env.DB.prepare(
    `
    SELECT ${retaliationAttackColumns()}
    FROM attacks
    WHERE attacker_faction_id = ?
      AND defender_id IN (${placeholders})
      AND result = 'Hospitalized'
      AND COALESCE(m_retaliation, 1) > 1
      AND ended >= ?
    ORDER BY ended ASC, id ASC
    `,
  )
    .bind(HOME_FACTION_ID, ...targetIds, earliestOpeningAt)
    .all<RetaliationAttackRow>();

  const claims = result.results ?? [];
  const byOpening = new Map<number, RetaliationAttackRow>();
  for (const opening of openings) {
    const targetId = opening.attacker_id;
    const openingAt = attackTimestamp(opening);
    if (!targetId || openingAt === null) continue;
    const claim = claims.find((candidate) =>
      candidate.defender_id === targetId &&
      (attackTimestamp(candidate) ?? 0) >= openingAt &&
      (attackTimestamp(candidate) ?? Number.MAX_SAFE_INTEGER) < openingAt + RETALIATION_WINDOW_SECONDS
    );
    if (claim) byOpening.set(opening.id, claim);
  }
  return byOpening;
}

async function readPendingClaim(
  env: Env,
  openingAttackId: number,
  now: number,
): Promise<PendingRetaliationClaim | null> {
  const row = await readAnyPendingClaim(env, openingAttackId);
  return row && row.expires_at > now ? row : null;
}

async function readAnyPendingClaim(env: Env, openingAttackId: number): Promise<PendingRetaliationClaim | null> {
  return (await env.DB.prepare(
    `
    SELECT
      c.opening_attack_id,
      c.target_id,
      c.claimant_torn_user_id,
      h.name AS claimant_name,
      c.source,
      c.attack_url,
      c.created_at,
      c.updated_at,
      c.expires_at
    FROM retaliation_claim_signals c
    LEFT JOIN home_faction_members h ON h.member_id = c.claimant_torn_user_id
    WHERE c.opening_attack_id = ?
    LIMIT 1
    `,
  )
    .bind(openingAttackId)
    .first()) as PendingRetaliationClaim | null;
}

async function readPendingClaimsForOpenings(
  env: Env,
  openingAttackIds: number[],
  now: number,
): Promise<Map<number, PendingRetaliationClaim>> {
  if (openingAttackIds.length === 0) {
    return new Map();
  }

  const placeholders = openingAttackIds.map(() => "?").join(",");
  const result = await env.DB.prepare(
    `
    SELECT
      c.opening_attack_id,
      c.target_id,
      c.claimant_torn_user_id,
      h.name AS claimant_name,
      c.source,
      c.attack_url,
      c.created_at,
      c.updated_at,
      c.expires_at
    FROM retaliation_claim_signals c
    LEFT JOIN home_faction_members h ON h.member_id = c.claimant_torn_user_id
    WHERE c.opening_attack_id IN (${placeholders})
      AND c.expires_at > ?
    `,
  )
    .bind(...openingAttackIds, now)
    .all<PendingRetaliationClaim>();

  return new Map((result.results ?? []).map((claim) => [claim.opening_attack_id, claim]));
}

async function upsertPendingClaim(
  env: Env,
  claim: {
    openingAttackId: number;
    targetId: number;
    claimantTornUserId: number;
    source: "dashboard" | "tampermonkey";
    attackUrl: string | null;
    now: number;
  },
): Promise<void> {
  await env.DB.prepare(
    `
    INSERT INTO retaliation_claim_signals (
      opening_attack_id,
      target_id,
      claimant_torn_user_id,
      source,
      attack_url,
      created_at,
      updated_at,
      expires_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(opening_attack_id) DO UPDATE SET
      target_id = excluded.target_id,
      claimant_torn_user_id = excluded.claimant_torn_user_id,
      source = excluded.source,
      attack_url = excluded.attack_url,
      updated_at = excluded.updated_at,
      expires_at = excluded.expires_at
    `,
  )
    .bind(
      claim.openingAttackId,
      claim.targetId,
      claim.claimantTornUserId,
      claim.source,
      claim.attackUrl,
      claim.now,
      claim.now,
      claim.now + RETALIATION_CLAIM_TTL_SECONDS,
    )
    .run();
}

function retaliationAttackColumns(): string {
  return `
      id,
      code,
      started,
      ended,
      attacker_id,
      attacker_name,
      attacker_faction_id,
      attacker_faction_name,
      defender_id,
      defender_name,
      defender_faction_id,
      defender_faction_name,
      result,
      respect_gain,
      respect_loss,
      m_retaliation,
      ended AS attack_at
  `;
}

function retaliationOpportunityColumns(): string {
  return `
      opening_attack_id AS id,
      code,
      started,
      ended,
      attacker_id,
      attacker_name,
      attacker_faction_id,
      attacker_faction_name,
      defender_id,
      defender_name,
      defender_faction_id,
      defender_faction_name,
      result,
      respect_gain,
      respect_loss,
      m_retaliation,
      attack_at
  `;
}

export function renderRetaliationMessagePayload(row: RetaliationOpportunity): RetaliationBoardDiscordPayload {
  // Discord's relative timestamps count down on their own. Only status/data
  // changes need an edit, avoiding a PATCH for every ten-second poll.
  return { content: "**Retaliation opportunity**", embeds: [retaliationBoardEmbed(row)] };
}

export function getRetaliationBoardRefreshPlan(
  rows: RetaliationOpportunity[],
  checkedAt: number,
): RetaliationBoardRefreshPlan {
  const active = rows.some(isActiveRetaliationBoardRow);
  return {
    active,
    nextRefreshAt: checkedAt + (
      active
        ? RETALIATION_BOARD_ACTIVE_REFRESH_SECONDS
        : RETALIATION_BOARD_FALLBACK_REFRESH_SECONDS
    ),
  };
}

async function scheduleRetaliationBoardAlarm(env: Env, alarmAtSeconds: number): Promise<void> {
  try {
    await retaliationBoardAlarmStub(env).schedule(alarmAtSeconds);
    console.debug(`Retaliation board active refresh scheduled for ${alarmAtSeconds}`);
  } catch (err: any) {
    console.warn("Retaliation board active refresh scheduling failed:", err?.message || err);
  }
}

function compareRetaliationRows(left: RetaliationOpportunity, right: RetaliationOpportunity): number {
  const leftExpires = left.expires_at ?? Number.MAX_SAFE_INTEGER;
  const rightExpires = right.expires_at ?? Number.MAX_SAFE_INTEGER;
  if (leftExpires !== rightExpires) return leftExpires - rightExpires;
  return (right.opening_attack_id ?? 0) - (left.opening_attack_id ?? 0);
}

function isActiveRetaliationBoardRow(row: RetaliationOpportunity): boolean {
  return row.status === "available" || row.status === "claimed_pending";
}

function retaliationBoardAlarmStub(env: Env): RetaliationBoardAlarmStub {
  return env.RETALIATION_BOARD_ALARMS.getByName(RETALIATION_BOARD_ALARM_NAME) as RetaliationBoardAlarmStub;
}

function attackTimestamp(attack: Pick<RetaliationAttackRow, "attack_at" | "ended" | "started">): number | null {
  return attack.attack_at ?? attack.ended ?? null;
}

function booleanQueryParam(value: string | null): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

function retaliationClaimSource(value: unknown): "dashboard" | "tampermonkey" | null {
  return value === "dashboard" || value === "tampermonkey" ? value : null;
}

function uniquePositive(values: Array<number | null | undefined>): number[] {
  return Array.from(new Set(values.filter((value): value is number =>
    Number.isInteger(value) && Number(value) > 0,
  )));
}

function cleanDiscordText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[`*_~|<>@[\]()]/g, "").trim();
  return cleaned || null;
}

function retaliationBoardEmbed(row: RetaliationOpportunity): DiscordEmbed {
  const attack = row.enemy_attack;
  const target = cleanDiscordText(attack?.attacker_name) ?? `Torn ${row.target_id}`;
  const faction = discordFactionLink(attack?.attacker_faction_id ?? null, attack?.attacker_faction_name ?? null);
  const attackAt = attackTimestamp(attack ?? { attack_at: null, ended: null, started: null });
  const defender = attack?.defender_id
    ? `[${cleanDiscordText(attack.defender_name) ?? `Torn ${attack.defender_id}`}](https://www.torn.com/profiles.php?XID=${attack.defender_id})`
    : cleanDiscordText(attack?.defender_name) ?? "Unknown";
  const result = cleanDiscordText(attack?.result) ?? "Log";
  const log = attack?.code
    ? `[${result}](https://www.torn.com/loader.php?sid=attackLog&ID=${encodeURIComponent(attack.code)})`
    : result;

  return {
    title: `${target} [${row.target_id}] ⚔️`,
    url: `https://www.torn.com/page.php?sid=attack&user2ID=${row.target_id}`,
    description: `from ${faction}`,
    color: retaliationBoardEmbedColor(row),
    fields: [
      { name: "Time", value: discordRelativeTime(attackAt), inline: true },
      { name: "Timeout", value: discordRelativeTime(row.expires_at), inline: true },
      { name: "Defender", value: defender, inline: true },
      { name: "Status", value: retaliationBoardStatus(row), inline: true },
      { name: "Respect", value: formatDiscordRespect(attack?.respect_gain ?? attack?.respect_loss ?? null), inline: true },
      { name: "Log", value: log, inline: true },
    ],
  };
}

function discordFactionLink(factionId: number | null, factionName: string | null): string {
  const label = cleanDiscordText(factionName) ?? (factionId ? `Faction ${factionId}` : "Unknown faction");
  return factionId
    ? `[${label}](https://www.torn.com/factions.php?step=profile&ID=${factionId})`
    : label;
}

function retaliationBoardEmbedColor(row: RetaliationOpportunity): number {
  if (row.status === "claimed_pending") return RETALIATION_BOARD_PENDING_COLOR;
  if (row.status === "claimed_confirmed") return RETALIATION_BOARD_CONFIRMED_COLOR;
  if (row.status === "expired") return 0x95a5a6;
  return RETALIATION_BOARD_AVAILABLE_COLOR;
}

function retaliationBoardStatus(row: RetaliationOpportunity): string {
  if (row.status === "available") return "Open";
  if (row.status === "claimed_pending") {
    return `Attack started by ${cleanDiscordText(row.pending_claim?.claimant_name) ?? row.pending_claim?.claimant_torn_user_id ?? "member"}`;
  }
  if (row.status === "claimed_confirmed") {
    return `Taken — retaliated by ${cleanDiscordText(row.claimed_by_attack?.attacker_name) ?? "Torn data"}`;
  }
  return "Timed out";
}

function discordRelativeTime(timestamp: number | null | undefined): string {
  return timestamp ? `<t:${timestamp}:R>` : "Unknown";
}

function formatDiscordRespect(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "Unknown";
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}
