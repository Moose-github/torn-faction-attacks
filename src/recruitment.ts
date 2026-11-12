import { RECRUITMENT_CALLS_PER_KEY, RECRUITMENT_MIN_STATS, type RecruitmentScan,
  type RecruitmentSnapshot, type RecruitmentStatus } from '../shared/recruitment';
import { rebuildRecruitmentResults } from './recruitmentResults';
import { isRecord } from './backend/request';
import { fetchTrackedTornJson } from './external/torn';
import { ExternalApiError } from './external/http';
import { markTornKeyFailure, type TornKeyPoolCandidate } from './tornKeyPool';
import { readRecruitmentKeys, reserveRecruitmentPoolCall, RECRUITMENT_KEY_SQL } from './recruitmentKeys';
import { RecruitmentInputError } from './recruitmentSnapshot';
import type { Env } from './types';
import { nowSeconds } from './utils';

const HOF_URL = 'https://api.torn.com/v2/torn/hof';
const PAGE_SIZE = 100;
type HofPlayer = { player_id: number; username: string; total_work_stats: number; hof_position: number };
const nonnegative = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

export function parseRecruitmentHof(data: unknown, offset: number) {
  if (!isRecord(data) || !Array.isArray(data.hof) || data.hof.length > PAGE_SIZE
    || !isRecord(data._metadata) || !isRecord(data._metadata.links)) throw new RecruitmentInputError('Unexpected HOF response. Progress retained; check the API before resuming.');
  const players: HofPlayer[] = [];
  const ids = new Set<number>();
  let previous = Number.MAX_SAFE_INTEGER;
  for (const [index, value] of data.hof.entries()) {
    if (!isRecord(value) || !nonnegative(value.id) || value.id === 0 || ids.has(value.id)
      || typeof value.username !== 'string' || !value.username.trim() || value.username.length > 100
      || !nonnegative(value.value) || value.value > previous || value.position !== offset + index + 1) {
      throw new RecruitmentInputError('HOF data or page order was unexpected. Resume will retry the same page.');
    }
    ids.add(value.id); previous = value.value;
    players.push({ player_id: value.id, username: value.username, total_work_stats: value.value, hof_position: value.position as number });
  }
  const next = data._metadata.links.next;
  // Only retain a numeric offset; never store or follow a URL containing a key.
  if (next !== null) {
    if (typeof next !== 'string' || !next) throw new RecruitmentInputError('Missing HOF pagination. Progress retained.');
    let link: URL;
    try { link = new URL(next); } catch { throw new RecruitmentInputError('Invalid HOF pagination.'); }
    if (link.origin !== 'https://api.torn.com' || link.pathname.replace(/\/$/, '') !== '/v2/torn/hof'
      || link.username || link.password || link.searchParams.get('cat') !== 'workstats'
      || Number(link.searchParams.get('offset')) !== offset + PAGE_SIZE || link.searchParams.get('limit') !== '100'
      || players.length !== PAGE_SIZE) throw new RecruitmentInputError('Unexpected HOF pagination. Progress retained.');
  }
  const last = players.at(-1)?.total_work_stats ?? null;
  return { players: players.filter(p => p.total_work_stats >= RECRUITMENT_MIN_STATS),
    complete: next === null || (last !== null && last < RECRUITMENT_MIN_STATS), last,
    nextOffset: offset + players.length };
}

export async function readRecruitmentScan(env: Env) {
  const scan = await env.DB.prepare('SELECT * FROM recruitment_scan WHERE id = 1').first<RecruitmentScan>();
  if (!scan) throw new Error('Recruitment migration is missing');
  return scan;
}

export async function controlRecruitmentScan(env: Env, action: string, expectedRun: string, now = nowSeconds()) {
  let result: D1Result;
  if (action === 'start') {
    result = await env.DB.prepare(`UPDATE recruitment_scan SET run_id = ?, status = 'running', next_offset = 0,
      pages_saved = 0, players_saved = 0, calls_used = 0, started_at = ?, finished_at = NULL, updated_at = ?,
      last_error = NULL, retry_at = 0, failures = 0, lease_token = NULL, lease_until = 0, last_value = NULL
      WHERE id = 1 AND run_id = ? AND status IN ('idle', 'completed') AND lease_until <= ?`)
      .bind(crypto.randomUUID(), now, now, expectedRun, now).run();
  } else if (action === 'pause') {
    // Preserve the lease so an in-flight page can commit its results and checkpoint.
    result = await env.DB.prepare(`UPDATE recruitment_scan SET status = 'paused', updated_at = ?
      WHERE id = 1 AND run_id = ? AND status = 'running'`).bind(now, expectedRun).run();
  } else if (action === 'resume') {
    result = await env.DB.prepare(`UPDATE recruitment_scan SET status = 'running', updated_at = ?, last_error = NULL,
      failures = 0, retry_at = 0 WHERE id = 1 AND run_id = ? AND status IN ('paused', 'failed')`).bind(now, expectedRun).run();
  } else throw new RecruitmentInputError('Unknown scan action.');
  if (!result.meta.changes) throw new RecruitmentInputError('Scan state changed. Refresh before trying again.');
}

export async function reserveRecruitmentCall(env: Env, scan: RecruitmentScan, candidate: TornKeyPoolCandidate, now: number) {
  return reserveRecruitmentPoolCall(env, candidate, now, { scan });
}

export async function saveRecruitmentPage(env: Env, scan: RecruitmentScan, payload: unknown, now: number) {
  const page = parseRecruitmentHof(payload, scan.next_offset);
  const guard = `EXISTS (SELECT 1 FROM recruitment_scan WHERE id = 1 AND run_id = ? AND lease_token = ? AND next_offset = ? AND lease_until > ?)`;
  const results = await env.DB.batch([
    env.DB.prepare(`INSERT INTO recruitment_scan_stats(run_id, player_id, username, total_work_stats, hof_position, work_stats_checked_at)
      SELECT ?, json_extract(value, '$.player_id'), json_extract(value, '$.username'), json_extract(value, '$.total_work_stats'),
        json_extract(value, '$.hof_position'), ? FROM json_each(?) WHERE ${guard}
      ON CONFLICT(run_id, player_id) DO UPDATE SET username = excluded.username, total_work_stats = excluded.total_work_stats,
        hof_position = excluded.hof_position, work_stats_checked_at = excluded.work_stats_checked_at`)
      .bind(scan.run_id, now, JSON.stringify(page.players), scan.run_id, scan.lease_token, scan.next_offset, now),
    ...(page.complete ? [
      env.DB.prepare(`INSERT INTO recruitment_work_stats SELECT player_id, username, total_work_stats, hof_position, work_stats_checked_at
        FROM recruitment_scan_stats WHERE run_id = ? AND ${guard}
        ON CONFLICT(player_id) DO UPDATE SET username = excluded.username, total_work_stats = excluded.total_work_stats,
          hof_position = excluded.hof_position, work_stats_checked_at = excluded.work_stats_checked_at`)
        .bind(scan.run_id, scan.run_id, scan.lease_token, scan.next_offset, now),
      env.DB.prepare(`UPDATE recruitment_result_state SET stats_version = ? WHERE id = 1 AND ${guard}`)
        .bind(scan.run_id, scan.run_id, scan.lease_token, scan.next_offset, now),
    ] : []),
    env.DB.prepare(`UPDATE recruitment_scan SET next_offset = ?, pages_saved = pages_saved + 1,
      players_saved = players_saved + ?, updated_at = ?, last_value = ?, last_error = NULL, failures = 0, retry_at = 0,
      results_pending = CASE WHEN ? THEN 1 ELSE results_pending END,
      status = CASE WHEN ? THEN 'completed' ELSE status END, finished_at = CASE WHEN ? THEN ? ELSE finished_at END
      WHERE id = 1 AND run_id = ? AND lease_token = ? AND next_offset = ? AND lease_until > ?`)
      .bind(page.nextOffset, page.players.length, now, page.last, page.complete ? 1 : 0, page.complete ? 1 : 0, page.complete ? 1 : 0,
        now, scan.run_id, scan.lease_token, scan.next_offset, now),
  ]);
  if (!results.at(-1)!.meta.changes) throw new RecruitmentInputError('The scan lease changed before the page could be saved.');
  if (page.complete) {
    await rebuildRecruitmentResults(env);
    await env.DB.prepare('DELETE FROM recruitment_scan_stats WHERE run_id = ?').bind(scan.run_id).run();
  }
}

class RecruitmentApiError extends Error {
  constructor(message: string, readonly kind: 'key' | 'rate' | 'temporary' | 'fatal', readonly code?: number) { super(message); }
}
function apiError(payload: unknown) {
  if (!isRecord(payload) || !payload.error) return;
  const code = isRecord(payload.error) && nonnegative(payload.error.code) ? payload.error.code : undefined;
  const kind = code !== undefined && [1,2,7,10,13,16,18].includes(code) ? 'key'
    : code === 5 || code === 14 ? 'rate'
    : code !== undefined && [0,8,9,12,15,17,24].includes(code) ? 'temporary' : 'fatal';
  throw new RecruitmentApiError(`Torn API error${code === undefined ? '' : ` ${code}`}. Saved progress is retained.`, kind, code);
}

export async function runRecruitmentTick(env: Env) {
  const now = nowSeconds(), token = crypto.randomUUID();
  const claim = await env.DB.prepare(`UPDATE recruitment_scan SET lease_token = ?, lease_until = ?
    WHERE id = 1 AND (status = 'running' OR results_pending = 1) AND lease_until <= ? AND retry_at <= ? RETURNING *`)
    .bind(token, now + 90, now, now).first<RecruitmentScan>();
  if (!claim) return;
  try {
    if (claim.results_pending) await rebuildRecruitmentResults(env);
    if (claim.status !== 'running') {
      if (claim.status === 'completed') await env.DB.prepare('DELETE FROM recruitment_scan_stats WHERE run_id = ?').bind(claim.run_id).run();
      return;
    }
    await env.DB.prepare('DELETE FROM recruitment_attempts WHERE attempted_at < ?').bind(now - 86400).run();
    const candidates = await readRecruitmentKeys(env, now);
    const deadline = Date.now() + 50_000;
    let cursor = 0;
    for (let step = 0; step < Math.min(300, candidates.length * RECRUITMENT_CALLS_PER_KEY) && Date.now() < deadline; step++) {
      const scan = await readRecruitmentScan(env);
      if (scan.status !== 'running' || scan.lease_token !== token) break;
      let selected: TornKeyPoolCandidate | undefined;
      for (let i = 0; i < candidates.length; i++) {
        const candidate = candidates[cursor++ % candidates.length];
        if (await reserveRecruitmentCall(env, scan, candidate, nowSeconds())) { selected = candidate; break; }
      }
      if (!selected) break;
      try {
        const url = new URL(HOF_URL);
        url.search = new URLSearchParams({ cat: 'workstats', limit: '100', offset: String(scan.next_offset) }).toString();
        const data = await fetchTrackedTornJson(env, url, { headers: { Authorization: `ApiKey ${selected.key}` } },
          { feature: 'company_recruitment', keySource: selected.keySource, timeoutMs: 15_000 }, { rejectApiError: false });
        apiError(data);
        await saveRecruitmentPage(env, scan, data, nowSeconds());
      } catch (error) {
        const status = error instanceof ExternalApiError ? error.status : null;
        const failure = error instanceof RecruitmentApiError ? error
          : error instanceof RecruitmentInputError ? new RecruitmentApiError(error.message, 'fatal')
          : new RecruitmentApiError(status ? `Torn request failed (HTTP ${status}).` : 'Request or storage failed. The same page will be retried.',
            status === 429 ? 'rate' : status === 401 || status === 403 ? 'key' : 'temporary');
        if (failure.kind === 'key' || failure.kind === 'rate') {
          const until = nowSeconds() + (failure.kind === 'key' || failure.code === 14 ? 86400 : 120);
          await markTornKeyFailure(env, selected.id, failure.message, nowSeconds(), until - nowSeconds());
          if (failure.kind === 'rate') await env.DB.prepare(`UPDATE torn_api_keys SET paused_until = MAX(COALESCE(paused_until, 0), ?)
            WHERE owner_torn_user_id = (SELECT owner_torn_user_id FROM torn_api_keys WHERE id = ?)`).bind(until, selected.id).run();
          await env.DB.prepare('UPDATE recruitment_scan SET last_error = ? WHERE id = 1 AND lease_token = ?').bind(failure.message, token).run();
          continue;
        }
        const failed = failure.kind === 'fatal' || scan.failures + 1 >= 5;
        await env.DB.prepare(`UPDATE recruitment_scan SET status = CASE WHEN ? THEN 'failed' ELSE status END,
          failures = failures + 1, last_error = ?, retry_at = ?, updated_at = ? WHERE id = 1 AND status = 'running' AND lease_token = ?`)
          .bind(failed ? 1 : 0, failure.message, nowSeconds() + Math.min(900, 60 * 2 ** scan.failures), nowSeconds(), token).run();
        break;
      }
    }
  } catch {
    await env.DB.prepare(`UPDATE recruitment_scan SET status = 'failed', last_error = 'Scan stopped after a storage error. Resume to retry from the saved page.',
      updated_at = ? WHERE id = 1 AND status = 'running' AND lease_token = ?`).bind(nowSeconds(), token).run();
  } finally {
    await env.DB.prepare('UPDATE recruitment_scan SET lease_token = NULL, lease_until = 0 WHERE id = 1 AND lease_token = ?').bind(token).run();
  }
}

export async function recruitmentStatus(env: Env): Promise<RecruitmentStatus> {
  const [scan, snapshot, keys, resultState] = await Promise.all([
    readRecruitmentScan(env),
    env.DB.prepare(`SELECT s.* FROM recruitment_snapshots s JOIN recruitment_current_snapshot c ON c.snapshot_id = s.id WHERE c.id = 1`).first<RecruitmentSnapshot>(),
    env.DB.prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(COALESCE(k.paused_until, 0) <= ?), 0) AS available
      FROM torn_api_keys k WHERE ${RECRUITMENT_KEY_SQL}`).bind(nowSeconds()).first<{total: number; available: number}>(),
    env.DB.prepare('SELECT version FROM recruitment_result_state WHERE id = 1').first<{version:number}>(),
  ]);
  const { lease_token: _token, ...publicScan } = scan;
  return { scan: publicScan, snapshot, keys: { total: keys?.total ?? 0, available: keys?.available ?? 0,
    calls_per_minute: (keys?.available ?? 0) * RECRUITMENT_CALLS_PER_KEY }, min_work_stats: RECRUITMENT_MIN_STATS,
    results_version:resultState?.version ?? 0 };
}
