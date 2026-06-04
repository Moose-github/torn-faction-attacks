import { positiveIntegerOrNull } from "./backend/request";
import { HOME_FACTION_ID, POSITIVE_RESULTS_SQL } from "./constants";
import { ingestRecentFactionAttacks, RecentAttackIngestionResult } from "./ingestion";
import { readSyncTimestamp, upsertSyncTimestamp } from "./syncState";
import { Env } from "./types";
import { d1Changes, json, nowSeconds } from "./utils";

const RETALIATION_WINDOW_SECONDS = 5 * 60;
const LIGHT_SYNC_LOOKBACK_SECONDS = RETALIATION_WINDOW_SECONDS + 90;
const LIGHT_SYNC_FRESH_SECONDS = 45;
const LIGHT_SYNC_COOLDOWN_SECONDS = 20;
const LIGHT_SYNC_ATTEMPT_STATE = "retaliation_light_sync_attempt";
const LIGHT_SYNC_SUCCESS_STATE = "retaliation_light_sync_success";

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

export type RetaliationAvailability = {
  available: boolean;
  reason: "available" | "claimed" | "none";
  enemy_attack: RetaliationAttackRow | null;
  claimed_by_attack: RetaliationAttackRow | null;
  expires_at: number | null;
};

type LightSyncResult = {
  fresh: boolean;
  status: "fresh" | "refreshed" | "cooldown" | "failed";
  last_success_at: number | null;
  warning: string | null;
  result: RecentAttackIngestionResult | null;
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
    checked_at: checkedAt,
    window_seconds: RETALIATION_WINDOW_SECONDS,
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
    enemy_attack: availability.enemy_attack,
    claimed_by_attack: availability.claimed_by_attack,
  });
}

export function evaluateRetaliationAvailability(
  enemyAttack: RetaliationAttackRow | null,
  claimedByAttack: RetaliationAttackRow | null,
  now: number = nowSeconds(),
): RetaliationAvailability {
  if (!enemyAttack) {
    return {
      available: false,
      reason: "none",
      enemy_attack: null,
      claimed_by_attack: null,
      expires_at: null,
    };
  }

  const attackAt = attackTimestamp(enemyAttack);
  const expiresAt = attackAt === null ? null : attackAt + RETALIATION_WINDOW_SECONDS;

  if (expiresAt === null || expiresAt <= now) {
    return {
      available: false,
      reason: "none",
      enemy_attack: null,
      claimed_by_attack: null,
      expires_at: null,
    };
  }

  if (claimedByAttack) {
    return {
      available: false,
      reason: "claimed",
      enemy_attack: enemyAttack,
      claimed_by_attack: claimedByAttack,
      expires_at: expiresAt,
    };
  }

  return {
    available: true,
    reason: "available",
    enemy_attack: enemyAttack,
    claimed_by_attack: null,
    expires_at: expiresAt,
  };
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
      last_success_at: lastSuccess || null,
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

async function readRetaliationAvailability(
  env: Env,
  targetId: number,
  now: number,
): Promise<RetaliationAvailability> {
  const since = now - RETALIATION_WINDOW_SECONDS;
  const enemyAttack = await readLatestEnemyAttack(env, targetId, since);

  if (!enemyAttack) {
    return evaluateRetaliationAvailability(null, null);
  }

  const enemyAttackAt = attackTimestamp(enemyAttack);
  const claimedByAttack = enemyAttackAt === null
    ? null
    : await readClaimingRetaliationAttack(env, targetId, enemyAttackAt);

  return evaluateRetaliationAvailability(enemyAttack, claimedByAttack, now);
}

async function readLatestEnemyAttack(
  env: Env,
  targetId: number,
  since: number,
): Promise<RetaliationAttackRow | null> {
  return (await env.DB.prepare(
    `
    SELECT
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

async function readClaimingRetaliationAttack(
  env: Env,
  targetId: number,
  after: number,
): Promise<RetaliationAttackRow | null> {
  return (await env.DB.prepare(
    `
    SELECT
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

function attackTimestamp(attack: Pick<RetaliationAttackRow, "attack_at" | "ended" | "started">): number | null {
  return attack.attack_at ?? attack.ended ?? attack.started ?? null;
}
