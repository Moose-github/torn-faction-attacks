import { cleanString, positiveIntegerOrNull, readJsonObject } from "./backend/request";
import { HOME_FACTION_ID, POSITIVE_RESULTS_SQL, SOURCE_NAME } from "./constants";
import { createDiscordWebhookMessage, type DiscordEmbed, editDiscordWebhookMessage } from "./discord";
import { isDiscordAlertEnabled } from "./discordAlertSettings";
import { DISCORD_ALERT_KEYS } from "./discordAlerts";
import { ingestRecentFactionAttacks, RecentAttackIngestionResult } from "./ingestion";
import { readSyncTimestamp, upsertSyncTimestamp } from "./syncState";
import { Env } from "./types";
import { d1Changes, json, nowSeconds, parseLimit } from "./utils";

export const RETALIATION_WINDOW_SECONDS = 5 * 60;
export const RETALIATION_CLAIM_TTL_SECONDS = 30;

const LIGHT_SYNC_LOOKBACK_SECONDS = RETALIATION_WINDOW_SECONDS + 90;
const LIGHT_SYNC_FRESH_SECONDS = 45;
const LIGHT_SYNC_COOLDOWN_SECONDS = 20;
const LIGHT_SYNC_ATTEMPT_STATE = "retaliation_light_sync_attempt";
const LIGHT_SYNC_SUCCESS_STATE = "retaliation_light_sync_success";
const RETALIATION_BOARD_MIN_EDIT_INTERVAL_SECONDS = 5;
const RETALIATION_BOARD_LIMIT = 10;
const RETALIATION_BOARD_FALLBACK_REFRESH_SECONDS = 60;
const RETALIATION_BOARD_AVAILABLE_COLOR = 0xed4245;
const RETALIATION_BOARD_PENDING_COLOR = 0xffa500;
const RETALIATION_BOARD_CONFIRMED_COLOR = 0x57f287;

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

type BoardStateRow = {
  id: number;
  discord_message_id: string | null;
  last_rendered_hash: string | null;
  last_edited_at: number | null;
};

type RetaliationBoardDiscordPayload = {
  content: string;
  embeds: DiscordEmbed[];
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
  const expiresAt = attackAt === null ? null : attackAt + RETALIATION_WINDOW_SECONDS;
  const expired = expiresAt === null || expiresAt <= now;
  const unexpiredPending = pendingClaim && pendingClaim.expires_at > now ? pendingClaim : null;

  if (expired) {
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

export async function syncRetaliationDiscordBoard(env: Env, checkedAt: number = nowSeconds()): Promise<void> {
  if (!env.DISCORD_WEBHOOK_URL) {
    return;
  }
  if (!await isDiscordAlertEnabled(env, DISCORD_ALERT_KEYS.retaliationBoard)) {
    return;
  }

  const rows = await listRetaliationOpportunities(env, checkedAt, {
    includeClaimed: true,
    includeExpired: false,
    limit: RETALIATION_BOARD_LIMIT,
  });
  const message = renderRetaliationBoardPayload(rows, checkedAt);
  const hash = stableHash(JSON.stringify(message));
  const state = await readRetaliationBoardState(env);

  if (state?.last_rendered_hash === hash) {
    return;
  }
  if (
    state?.last_edited_at !== null &&
    state?.last_edited_at !== undefined &&
    state.last_edited_at > checkedAt - RETALIATION_BOARD_MIN_EDIT_INTERVAL_SECONDS
  ) {
    return;
  }

  const messageId = await upsertRetaliationBoardMessage(env, state?.discord_message_id ?? null, message);
  await saveRetaliationBoardState(env, {
    discordMessageId: messageId,
    renderedHash: hash,
    editedAt: checkedAt,
  });
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
    .filter((row) => options.includeExpired || row.status !== "expired")
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

  const claimed = await claimLightSyncAttempt(env, now);
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

async function claimLightSyncAttempt(env: Env, now: number): Promise<boolean> {
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
    .bind(LIGHT_SYNC_ATTEMPT_STATE, now, now - LIGHT_SYNC_COOLDOWN_SECONDS)
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
    SELECT ${retaliationAttackColumns()}
    FROM attacks
    WHERE attacker_id = ?
      AND defender_faction_id = ?
      AND result IN (${POSITIVE_RESULTS_SQL})
      AND COALESCE(ended, started) >= ?
    ORDER BY COALESCE(ended, started) DESC, id DESC
    LIMIT 1
    `,
  )
    .bind(targetId, HOME_FACTION_ID, since)
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
    SELECT ${retaliationAttackColumns()}
    FROM attacks
    WHERE defender_faction_id = ?
      AND result IN (${POSITIVE_RESULTS_SQL})
      AND attacker_id IS NOT NULL
      AND COALESCE(ended, started) >= ?
    ORDER BY COALESCE(ended, started) DESC, id DESC
    LIMIT ?
    `,
  )
    .bind(HOME_FACTION_ID, since, limit)
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
      AND COALESCE(ended, started) >= ?
    ORDER BY COALESCE(ended, started) ASC, id ASC
    LIMIT 1
    `,
  )
    .bind(HOME_FACTION_ID, targetId, after)
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
      AND COALESCE(ended, started) >= ?
    ORDER BY COALESCE(ended, started) ASC, id ASC
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
      COALESCE(ended, started) AS attack_at
  `;
}

export function renderRetaliationBoardPayload(
  rows: RetaliationOpportunity[],
  checkedAt: number,
): RetaliationBoardDiscordPayload {
  const nextRefreshAt = checkedAt + RETALIATION_BOARD_FALLBACK_REFRESH_SECONDS;
  const content = rows.length === 0
    ? "**Retaliation Board**"
    : `**Retaliation Board**\nUpdate <t:${nextRefreshAt}:R>`;

  return {
    content,
    embeds: rows.length === 0
      ? [noActiveRetaliationBoardEmbed(nextRefreshAt)]
      : rows.map(retaliationBoardEmbed),
  };
}

async function readRetaliationBoardState(env: Env): Promise<BoardStateRow | null> {
  return (await env.DB.prepare(
    `
    SELECT id, discord_message_id, last_rendered_hash, last_edited_at
    FROM retaliation_board_state
    WHERE id = 1
    LIMIT 1
    `,
  )
    .first()) as BoardStateRow | null;
}

async function saveRetaliationBoardState(
  env: Env,
  state: { discordMessageId: string | null; renderedHash: string; editedAt: number },
): Promise<void> {
  await env.DB.prepare(
    `
    INSERT INTO retaliation_board_state (
      id,
      discord_message_id,
      last_rendered_hash,
      last_edited_at,
      created_at,
      updated_at
    )
    VALUES (1, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      discord_message_id = excluded.discord_message_id,
      last_rendered_hash = excluded.last_rendered_hash,
      last_edited_at = excluded.last_edited_at,
      updated_at = excluded.updated_at
    `,
  )
    .bind(state.discordMessageId, state.renderedHash, state.editedAt, state.editedAt, state.editedAt)
    .run();
}

async function upsertRetaliationBoardMessage(
  env: Env,
  existingMessageId: string | null,
  message: RetaliationBoardDiscordPayload,
): Promise<string | null> {
  try {
    if (existingMessageId) {
      await editDiscordWebhookMessage(
        env,
        existingMessageId,
        message.content,
        { users: [], roles: [] },
        { embeds: message.embeds },
      );
      return existingMessageId;
    }
    return await createDiscordWebhookMessage(
      env,
      message.content,
      { users: [], roles: [] },
      { embeds: message.embeds },
    );
  } catch (err: any) {
    console.warn("Retaliation board Discord update failed:", err?.message || err);
    return existingMessageId;
  }
}

function compareRetaliationRows(left: RetaliationOpportunity, right: RetaliationOpportunity): number {
  const leftExpires = left.expires_at ?? Number.MAX_SAFE_INTEGER;
  const rightExpires = right.expires_at ?? Number.MAX_SAFE_INTEGER;
  if (leftExpires !== rightExpires) return leftExpires - rightExpires;
  return (right.opening_attack_id ?? 0) - (left.opening_attack_id ?? 0);
}

function attackTimestamp(attack: Pick<RetaliationAttackRow, "attack_at" | "ended" | "started">): number | null {
  return attack.attack_at ?? attack.ended ?? attack.started ?? null;
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

function noActiveRetaliationBoardEmbed(nextRefreshAt: number): DiscordEmbed {
  return {
    title: "No active retaliation",
    description: `-# Update <t:${nextRefreshAt}:R>`,
    color: RETALIATION_BOARD_CONFIRMED_COLOR,
  };
}

function retaliationBoardEmbedColor(row: RetaliationOpportunity): number {
  if (row.status === "claimed_pending") return RETALIATION_BOARD_PENDING_COLOR;
  if (row.status === "claimed_confirmed") return RETALIATION_BOARD_CONFIRMED_COLOR;
  return RETALIATION_BOARD_AVAILABLE_COLOR;
}

function retaliationBoardStatus(row: RetaliationOpportunity): string {
  if (row.status === "available") return "Open";
  if (row.status === "claimed_pending") {
    return `Attack started by ${cleanDiscordText(row.pending_claim?.claimant_name) ?? row.pending_claim?.claimant_torn_user_id ?? "member"}`;
  }
  if (row.status === "claimed_confirmed") {
    return `Retaliated by ${cleanDiscordText(row.claimed_by_attack?.attacker_name) ?? "Torn data"}`;
  }
  return "Expired";
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

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}
