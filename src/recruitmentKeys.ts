import { decryptTornApiKey, markTornKeyFailure, type TornKeyPoolCandidate, type TornKeyPoolRow } from './tornKeyPool';
import type { Env } from './types';
import { RECRUITMENT_CALLS_PER_KEY, type RecruitmentScan } from '../shared/recruitment';

export const SNAPSHOT_REFRESH_STATE = 'recruitment_snapshot_refresh';

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

// Snapshot refreshes and HOF pages share the same recruitment and pool budgets.
export async function reserveRecruitmentPoolCall(env: Env, candidate: TornKeyPoolCandidate, now: number,
  context: { scan: RecruitmentScan } | { snapshotRefreshAt: number }) {
  if (candidate.sourceType !== 'submitted') return false;
  const id = crypto.randomUUID(), window = now - now % 60;
  const scan = 'scan' in context ? context.scan : null;
  const guard = scan
    ? `EXISTS (SELECT 1 FROM recruitment_scan s WHERE s.id = 1 AND s.run_id = ? AND s.lease_token = ?
        AND s.lease_until > ? AND s.status = 'running' AND s.next_offset = ? AND s.retry_at <= ?)`
    : `EXISTS (SELECT 1 FROM sync_state WHERE name = ? AND last_started = ? AND last_started > ?)`;
  const guardArgs = scan ? [scan.run_id, scan.lease_token, now, scan.next_offset, now]
    : [SNAPSHOT_REFRESH_STATE, (context as { snapshotRefreshAt: number }).snapshotRefreshAt, now - 120];
  const statements = [
    env.DB.prepare(`INSERT INTO recruitment_attempts(id, run_id, key_id, attempted_at, offset)
      SELECT ?, ?, k.id, ?, ? FROM torn_api_keys k WHERE ${guard}
        AND k.id = ? AND ${RECRUITMENT_KEY_SQL} AND COALESCE(k.paused_until, 0) <= ?
        AND (SELECT COUNT(*) FROM recruitment_attempts a WHERE a.key_id = k.id AND a.attempted_at > ?) < ?
        AND COALESCE((SELECT request_count FROM torn_api_key_usage_windows WHERE key_id = k.id AND window_start = ?), 0)
          < COALESCE(k.max_requests_per_minute, 35)
        AND COALESCE((SELECT SUM(w.request_count) FROM torn_api_key_usage_windows w JOIN torn_api_keys o ON o.id = w.key_id
          WHERE o.owner_torn_user_id = k.owner_torn_user_id AND w.window_start >= ?), 0) < 90`)
      .bind(id, scan?.run_id ?? `snapshot:${id}`, now, scan?.next_offset ?? -1, ...guardArgs,
        candidate.id, now, now - 60, RECRUITMENT_CALLS_PER_KEY, window, window - 60),
    env.DB.prepare(`INSERT INTO torn_api_key_usage_windows(key_id, window_start, request_count)
      SELECT ?, ?, 1 WHERE EXISTS (SELECT 1 FROM recruitment_attempts WHERE id = ?)
      ON CONFLICT(key_id, window_start) DO UPDATE SET request_count = request_count + 1`).bind(candidate.id, window, id),
    env.DB.prepare(`UPDATE torn_api_keys SET last_used_at = ?, last_used_feature = 'company_recruitment', updated_at = ?
      WHERE id = ? AND EXISTS (SELECT 1 FROM recruitment_attempts WHERE id = ?)`).bind(now, now, candidate.id, id),
  ];
  if (scan) statements.push(env.DB.prepare(`UPDATE recruitment_scan SET calls_used = calls_used + 1, updated_at = ?
    WHERE id = 1 AND EXISTS (SELECT 1 FROM recruitment_attempts WHERE id = ?)`).bind(now, id));
  const results = await env.DB.batch(statements);
  return (results[0].meta.changes ?? 0) > 0;
}
