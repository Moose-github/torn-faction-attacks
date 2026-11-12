import { decryptTornApiKey, markTornKeyFailure, type TornKeyPoolCandidate, type TornKeyPoolRow } from './tornKeyPool';
import type { Env } from './types';

// Recruitment explicitly uses all active submitted keys, independent of the
// feature opt-ins used by other tools. Never load any environment fallback.
export const RECRUITMENT_KEY_SQL = `k.status = 'active'
  AND LOWER(TRIM(COALESCE(k.label, ''))) NOT IN ('fallback', 'fallback key')
  AND k.owner_torn_user_id IS NOT NULL`;

export async function readRecruitmentKeys(env: Env, now: number): Promise<TornKeyPoolCandidate[]> {
  const binding = env.TORN_KEY_STORAGE_SECRET;
  const secret = typeof binding === 'string' ? binding : await binding?.get();
  if (!secret?.trim()) return [];
  const rows = await env.DB.prepare(`SELECT k.* FROM torn_api_keys k WHERE ${RECRUITMENT_KEY_SQL}
    AND COALESCE(k.paused_until, 0) <= ? ORDER BY COALESCE(k.last_used_at, 0), k.id`).bind(now).all<TornKeyPoolRow>();
  const result: TornKeyPoolCandidate[] = [];
  for (const row of rows.results) {
    try {
      result.push({ id: row.id, key: await decryptTornApiKey(row.encrypted_key, secret.trim()), keySource: `key_pool:${row.id}`,
        sourceType: 'submitted', maxRequestsPerMinute: row.max_requests_per_minute, currentMinuteUsage: 0,
        lastUsedAt: row.last_used_at, monitorLastUsedAt: row.monitor_last_used_at });
    } catch {
      await markTornKeyFailure(env, row.id, 'Unable to decrypt stored key', now, 900);
    }
  }
  return result;
}
