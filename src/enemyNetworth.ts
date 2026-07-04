import { readSyncTimestamp, upsertSyncTimestamp } from "./syncState";
import { readAvailableTornApiKeys, type TornKeyPoolCandidate } from "./tornKeyPool";
import { Env } from "./types";

export type TornApiKey = TornKeyPoolCandidate;

export const ENEMY_NETWORTH_MAX_ATTEMPTS = 3;
export const ENEMY_NETWORTH_PER_KEY_LIMIT = 40;
export const ENEMY_NETWORTH_KEY_PAUSE_SECONDS = 60;

const ENEMY_NETWORTH_KEY_PAUSE_PREFIX = "enemy_networth_key_pause";

export async function readAvailableEnemyNetworthKeys(env: Env, now: number): Promise<TornApiKey[]> {
  const candidates = await readAvailableTornApiKeys(env, "enemy_scouting", now);
  const keys: TornApiKey[] = [];
  for (const key of candidates) {
    const pauseUntil = await readSyncTimestamp(env, enemyNetworthKeyPauseStateName(key.keySource));
    if (pauseUntil <= now) {
      keys.push(key);
    }
  }
  return keys;
}

export async function pauseEnemyNetworthKey(env: Env, keySource: string, now: number): Promise<void> {
  await upsertSyncTimestamp(
    env,
    enemyNetworthKeyPauseStateName(keySource),
    now + ENEMY_NETWORTH_KEY_PAUSE_SECONDS,
    null,
  );
}

export function enemyNetworthCandidateLimit(activeKeyCount: number, perKeyLimit = ENEMY_NETWORTH_PER_KEY_LIMIT): number {
  return Math.max(0, activeKeyCount) * Math.max(1, perKeyLimit);
}

export function partitionEnemyNetworthCandidates<T>(
  rows: T[],
  keys: TornApiKey[],
  perKeyLimit = ENEMY_NETWORTH_PER_KEY_LIMIT,
): Array<{ key: TornApiKey; rows: T[] }> {
  return keys.map((key, keyIndex) => ({
    key,
    rows: rows
      .filter((_, rowIndex) => rowIndex % keys.length === keyIndex)
      .slice(0, perKeyLimit),
  }));
}

function enemyNetworthKeyPauseStateName(keySource: string): string {
  return `${ENEMY_NETWORTH_KEY_PAUSE_PREFIX}:${keySource}`;
}
