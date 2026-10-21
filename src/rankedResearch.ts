import { isRecord, readJsonObject } from './backend/request';
import { fetchTrackedTornJson } from './external/torn';
import { markTornKeyFailure, readAvailableTornApiKeys, type TornKeyPoolCandidate } from './tornKeyPool';
import type { Env } from './types';
import { json, nowSeconds } from './utils';
import type { ResearchRun } from '../shared/rankedResearch';
import { validateResearchEvidence } from './rankedResearchEvidence';
import { ExternalApiError } from './external/http';

const ROOT = 'https://api.torn.com/v2/faction/';
const FEATURE = 'ranked_war_research' as const;
const MAX_FAILURES = 5;
const retryDelay = (failures: number) => Math.min(900, 60 * 2 ** Math.min(failures - 1, 4));
class ResearchRequestError extends Error {
  constructor(message: string, readonly kind: 'temporary' | 'key' | 'rate' | 'report' | 'fatal', readonly code?: number) { super(message); }
}
class ResearchInputError extends Error {}
function check(value: unknown, message: string): asserts value {
  if (!value) throw new ResearchInputError(message);
}
function integer(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
export function validateResearchAnalysis(value: unknown) {
  const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string');
  const pair = (v: unknown) => Array.isArray(v) && v.length === 2 && v.every(finite);
  check(isRecord(value) && typeof value.generated_at === 'string' && typeof value.scope === 'string', 'Invalid analysis metadata.');
  check(['eligible_wars', 'observations', 'distinct_factions', 'model_observations'].every(k => integer(value[k])), 'Invalid analysis sample counts.');
  check(isRecord(value.range) && typeof value.range.start === 'string' && typeof value.range.end === 'string', 'Invalid analysis range.');
  check(strings(value.warnings) && isRecord(value.prices) && Object.values(value.prices).every(v => v === null || (finite(v) && v >= 0)), 'Invalid analysis assumptions.');
  check(Array.isArray(value.summaries) && value.summaries.every(s => isRecord(s) && integer(s.division) && s.division >= 1 && s.division <= 4 && (s.won === 0 || s.won === 1) && integer(s.n) && finite(s.median_value) && finite(s.mean_value)), 'Invalid reward summaries.');
  function validateModel(model: unknown) {
    check(isRecord(model) && typeof model.available === 'boolean', 'Invalid adjusted analysis.');
    if (model.available) {
      check(typeof model.method === 'string' && Array.isArray(model.effects) && model.effects.length <= 20, 'Invalid adjusted factors.');
      for (const effect of model.effects) {
        check(isRecord(effect) && typeof effect.field === 'string' && typeof effect.label === 'string' && typeof effect.available === 'boolean', 'Invalid factor.');
        if (effect.available) check(typeof effect.status === 'string' && pair(effect.range) && finite(effect.effect_m) && (effect.interval_m === null || pair(effect.interval_m)) && strings(effect.cautions), 'Invalid factor estimates.');
        else check(typeof effect.reason === 'string', 'Missing factor explanation.');
      }
    } else check(typeof model.reason === 'string', 'Missing analysis explanation.');
  }
  validateModel(value.model);
  if (value.whole_war !== undefined) {
    const whole = value.whole_war;
    check(isRecord(whole) && ['eligible_wars', 'valued_wars', 'model_observations'].every(k => integer(whole[k])), 'Invalid whole-war sample counts.');
    check(whole.eligible_wars === value.eligible_wars && Number(whole.model_observations) <= Number(whole.valued_wars) && Number(whole.valued_wars) <= Number(whole.eligible_wars), 'Inconsistent whole-war sample counts.');
    check(['median_value', 'mean_value'].every(k => whole.valued_wars === 0 ? whole[k] === null : finite(whole[k]) && Number(whole[k]) >= 0), 'Invalid whole-war reward values.');
    check(Array.isArray(whole.summaries) && whole.summaries.every(s => isRecord(s) && [s.winner_division, s.loser_division].every(v => integer(v) && v >= 1 && v <= 4) && integer(s.n) && finite(s.median_value) && finite(s.mean_value)), 'Invalid whole-war reward summaries.');
    validateModel(whole.model);
  }
  validateResearchEvidence(value, check);
  return value;
}
export function researchDates(start: unknown, end: unknown) {
  check(typeof start === 'string' && typeof end === 'string', 'Choose both dates.');
  check(/^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end), 'Use valid dates.');
  const from = Date.parse(start + 'T00:00:00Z') / 1000;
  const to = Date.parse(end + 'T00:00:00Z') / 1000 + 86399;
  check(Number.isFinite(from) && Number.isFinite(to) && new Date(from * 1000).toISOString().slice(0, 10) === start && new Date((to - 86399) * 1000).toISOString().slice(0, 10) === end, 'Use valid dates.');
  check(start >= '2025-05-21' && from <= to && to < nowSeconds(), 'Choose completed days from 21 May 2025 through yesterday.');
  return { from, to, start, end };
}

// Keep only the report object. API metadata can contain authenticated URLs.
export function validateResearchReport(payload: unknown) {
  check(isRecord(payload) && isRecord(payload.rankedwarreport), 'Expected an API v2 ranked war report.');
  const r = payload.rankedwarreport;
  check(integer(r.id) && r.id > 0 && integer(r.start) && integer(r.end) && typeof r.forfeit === 'boolean', 'Invalid war fields.');
  check(Array.isArray(r.factions) && r.factions.length === 2 && r.factions.every(isRecord), 'Expected two factions.');
  const factions = r.factions as Record<string, unknown>[];
  check(factions.every(f => integer(f.id) && isRecord(f.rank) && typeof f.rank.before === 'string'), 'Missing starting ranks.');
  check(factions[0].id !== factions[1].id, 'Duplicate factions.');
  let classification = 'eligible';
  check(r.end > r.start, 'Torn returned an unfinished report; a final report is still needed.');
  if (r.forfeit) classification = 'forfeit';
  else if (factions.some(f => !String((f.rank as Record<string, unknown>).before).trim().toLowerCase().startsWith('platinum'))) classification = 'not_platinum_vs_platinum';
  else {
    check(factions.some(f => f.id === r.winner), 'Invalid winner.');
    check(factions.every(f => /^Platinum\s+(IV|III|II|I|[1-4])$/i.test(String((f.rank as Record<string, unknown>).before).trim())), 'Unrecognised Platinum division.');
    for (const f of factions) {
      check(integer(f.attacks) && typeof f.score === 'number' && Number.isFinite(f.score) && f.score >= 0, 'Invalid faction totals.');
      check(Array.isArray(f.members) && f.members.length > 0 && f.members.every(m => isRecord(m) && integer(m.id) && integer(m.attacks) && typeof m.score === 'number' && Number.isFinite(m.score) && m.score >= 0), 'Invalid member details.');
      check(new Set(f.members.map(m => (m as Record<string, unknown>).id)).size === f.members.length, 'Duplicate members.');
      check(isRecord(f.rewards) && integer(f.rewards.points) && Array.isArray(f.rewards.items), 'Missing rewards.');
      check(f.rewards.items.every(i => isRecord(i) && integer(i.id) && typeof i.name === 'string' && i.name.length > 0 && integer(i.quantity)), 'Invalid reward items.');
      if (f.rewards.points > 0) classification = 'legacy_points_rewards';
    }
  }
  return { id: r.id, start: r.start, end: r.end, classification, raw: JSON.stringify({ rankedwarreport: r }) };
}

export function researchNextCursor(value: unknown, run: Pick<ResearchRun, 'from_ts' | 'to_ts'>): string | null {
  if (value === null || value === '') return null;
  check(typeof value === 'string', 'Torn pagination is missing. Collection paused to avoid skipping wars.');
  const url = new URL(value, ROOT + 'warfareranked');
  check(url.origin === 'https://api.torn.com' && url.pathname.replace(/\/$/, '') === '/v2/faction/warfareranked' && !url.username && !url.password, 'Unexpected Torn pagination URL.');
  const from = Number(url.searchParams.get('from'));
  const to = Number(url.searchParams.get('to'));
  check(url.searchParams.has('from') && url.searchParams.has('to') && integer(from) && integer(to) && from >= run.from_ts - 1 && to <= run.to_ts && from <= to, 'Pagination left the selected date range.');
  check(url.searchParams.get('sort') === 'ASC', 'Unexpected pagination order.');
  const clean = new URL(ROOT + 'warfareranked');
  clean.search = new URLSearchParams({ from: String(from), to: String(to), sort: 'ASC', limit: '100' }).toString();
  if (url.searchParams.has('offset')) {
    const offset = Number(url.searchParams.get('offset'));
    check(integer(offset), 'Invalid pagination offset.');
    clean.searchParams.set('offset', String(offset));
  }
  return clean.toString();
}

export async function reserveResearchAttempt(env: Env, runId: string, lease: string, candidate: TornKeyPoolCandidate, now: number, id: string = crypto.randomUUID(), warId: number | null = null): Promise<boolean> {
  const window = now - now % 60;
  // D1 batch is transactional. Reserve before sending and count failed attempts too.
  const result = await env.DB.batch([
    env.DB.prepare(`INSERT INTO ranked_research_attempts(id, run_id, key_id, owner_id, attempted_at, war_id)
      SELECT ?, r.id, k.id, k.owner_torn_user_id, ?, ? FROM ranked_research_runs r, torn_api_keys k
      WHERE r.id = ? AND r.status = 'running' AND r.lease_token = ? AND r.lease_until > ? AND r.requests < r.request_limit
      AND r.retry_at <= ?
      AND k.id = ? AND k.owner_torn_user_id IS NOT NULL AND k.status = 'active'
      AND (k.paused_until IS NULL OR k.paused_until <= ?)
      AND NOT EXISTS (SELECT 1 FROM ranked_research_key_cooldowns h WHERE h.key_id = k.id AND h.until_ts > ?)
      AND EXISTS (SELECT 1 FROM json_each(k.allowed_features_json) WHERE value = 'ranked_war_research')
      AND (SELECT COUNT(*) FROM ranked_research_attempts a WHERE a.owner_id = k.owner_torn_user_id AND a.attempted_at > ?) < 20
      AND (SELECT COUNT(*) FROM torn_api_call_log l JOIN torn_api_keys owner_key ON l.key_source = 'key_pool:' || owner_key.id
        WHERE owner_key.owner_torn_user_id = k.owner_torn_user_id AND l.requested_at > ?) < 50
      AND COALESCE((SELECT request_count FROM torn_api_key_usage_windows WHERE key_id = k.id AND window_start = ?), 0) < COALESCE(k.max_requests_per_minute, 35) - 5`)
      .bind(id, now, warId, runId, lease, now, now, candidate.id, now, now, now - 60, now - 60, window),
    env.DB.prepare(`INSERT INTO torn_api_key_usage_windows(key_id, window_start, request_count)
      SELECT ?, ?, 1 WHERE EXISTS (SELECT 1 FROM ranked_research_attempts WHERE id = ?)
      ON CONFLICT(key_id, window_start) DO UPDATE SET request_count = request_count + 1`).bind(candidate.id, window, id),
    env.DB.prepare(`UPDATE ranked_research_runs SET requests = requests + 1 WHERE id = ? AND EXISTS (SELECT 1 FROM ranked_research_attempts WHERE id = ?)`).bind(runId, id),
    env.DB.prepare(`UPDATE torn_api_keys SET last_used_at = ?, last_used_feature = ?, updated_at = ?
      WHERE id = ? AND EXISTS (SELECT 1 FROM ranked_research_attempts WHERE id = ?)`).bind(now, FEATURE, now, candidate.id, id),
  ]);
  return (result[0].meta.changes ?? 0) > 0;
}

function apiFailure(data: Record<string, unknown>): ResearchRequestError | null {
  if (!data.error) return null;
  const code = isRecord(data.error) && integer(data.error.code) ? data.error.code : undefined;
  // Never persist upstream error text, which can contain authenticated URLs.
  if (code !== undefined && [1, 2, 7, 10, 13, 16, 18].includes(code)) return new ResearchRequestError(`Torn key unavailable (code ${code}); research use cooled down for 24 hours. Check its status and permissions in Settings.`, 'key', code);
  if (code === 5 || code === 14) return new ResearchRequestError(`Torn owner limit reached (code ${code}); waiting before using this owner's keys.`, 'rate', code);
  if (code === 6) return new ResearchRequestError('Torn could not find this war report (code 6).', 'report', code);
  if (code !== undefined && [0, 8, 9, 12, 15, 17, 24].includes(code)) return new ResearchRequestError(`Torn temporarily unavailable (code ${code}).`, 'temporary', code);
  return new ResearchRequestError(`Unexpected Torn API error${code === undefined ? '' : ` (code ${code})`}. Check the endpoint before resuming.`, 'fatal', code);
}

async function requestTorn(env: Env, run: ResearchRun, url: string, warId: number | null, deadline: number) {
  const candidates = await readAvailableTornApiKeys(env, FEATURE, nowSeconds(), { includeFallback: false });
  for (const candidate of candidates) {
    if (Date.now() >= deadline) return null;
    const attemptId = crypto.randomUUID();
    if (!(await reserveResearchAttempt(env, run.id, run.lease_token!, candidate, nowSeconds(), attemptId, warId))) continue;
    let data: Record<string, unknown>;
    try {
      data = await fetchTrackedTornJson<Record<string, unknown>>(env, url,
        { headers: { Authorization: `ApiKey ${candidate.key}` } },
        { feature: FEATURE, keySource: candidate.keySource, timeoutMs: Math.max(1, Math.min(15000, deadline - Date.now())) }, { rejectApiError: false });
      if (!isRecord(data)) throw new ResearchRequestError('Torn returned an unexpected response.', warId === null ? 'fatal' : 'report');
      const failure = apiFailure(data);
      if (failure) throw failure;
    } catch (error) {
      const status = error instanceof ExternalApiError ? error.status : null;
      const failure = error instanceof ResearchRequestError ? error
        : new ResearchRequestError(status ? `Torn request failed (HTTP ${status}).` : 'Torn request timed out or could not connect.',
          status === 429 ? 'rate' : status === 401 || status === 403 ? 'key' : status === 404 && warId !== null ? 'report'
          : status !== null && status >= 400 && status < 500 && status !== 408 ? 'fatal' : 'temporary');
      await env.DB.prepare("UPDATE ranked_research_attempts SET outcome = 'failed' WHERE id = ?").bind(attemptId).run();
      if (failure.kind === 'key' || failure.kind === 'rate') {
        const delay = failure.kind === 'key' || failure.code === 14 ? 86400 : 120;
        if (failure.kind === 'key') {
          await env.DB.prepare(`INSERT INTO ranked_research_key_cooldowns(key_id, until_ts, last_error) VALUES (?, ?, ?)
            ON CONFLICT(key_id) DO UPDATE SET until_ts = excluded.until_ts, last_error = excluded.last_error`)
            .bind(candidate.id, nowSeconds() + delay, failure.message).run();
        } else {
          await markTornKeyFailure(env, candidate.id, failure.message, nowSeconds(), delay);
          await env.DB.prepare(`UPDATE torn_api_keys SET paused_until = MAX(COALESCE(paused_until, 0), ?)
            WHERE owner_torn_user_id = (SELECT owner_torn_user_id FROM torn_api_keys WHERE id = ?)`).bind(nowSeconds() + delay, candidate.id).run();
        }
        await env.DB.prepare('UPDATE ranked_research_runs SET last_error = ? WHERE id = ?').bind(failure.message, run.id).run();
        // One reserved request per scheduler step, including key failures.
        return { keyFailure: true as const };
      }
      throw failure;
    }
    return { data, attemptId, keyFailure: false as const };
  }
  return null;
}

async function deferReport(env: Env, runId: string, warId: number, message: string) {
  const previous = await env.DB.prepare('SELECT failures FROM ranked_research_report_retries WHERE run_id = ? AND war_id = ?').bind(runId, warId).first<{ failures: number }>();
  const failures = (previous?.failures ?? 0) + 1;
  await env.DB.prepare(`INSERT INTO ranked_research_report_retries(run_id, war_id, failures, next_attempt_at, last_error) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(run_id, war_id) DO UPDATE SET failures = excluded.failures, next_attempt_at = excluded.next_attempt_at, last_error = excluded.last_error`)
    .bind(runId, warId, failures, nowSeconds() + retryDelay(failures), message).run();
}

async function readRun(env: Env, id: string) {
  return env.DB.prepare('SELECT * FROM ranked_research_runs WHERE id = ?').bind(id).first<ResearchRun>();
}

export async function runRankedResearchTick(env: Env) {
  const now = nowSeconds();
  const token = crypto.randomUUID();
  // One lease across all research jobs, including overlapping scheduled invocations.
  const run = await env.DB.prepare(`UPDATE ranked_research_runs SET lease_until = ?, lease_token = ?, last_tick_at = ?
    WHERE id = (SELECT id FROM ranked_research_runs WHERE status = 'running' AND lease_until <= ? AND retry_at <= ? ORDER BY COALESCE(last_tick_at, 0), created_at LIMIT 1)
      AND NOT EXISTS (SELECT 1 FROM ranked_research_runs WHERE lease_until > ?)
    RETURNING *`).bind(now + 180, token, now, now, now, now).first<ResearchRun>();
  if (!run) return;
  const deadline = Date.now() + 45000;
  let activeAttemptId: string | null = null;
  try {
    // Independent owners can each contribute up to 20 calls. Bound total work
    // and elapsed time as well; reservations remain the authority for limits.
    for (let step = 0; step < 60 && Date.now() < deadline; step++) {
      const current = await readRun(env, run.id);
      if (!current || current.status !== 'running' || current.lease_token !== token) break;
      if (current.requests >= current.request_limit) {
        await env.DB.prepare("UPDATE ranked_research_runs SET status = 'paused', message = 'Request budget reached. Freeze this sample or explicitly increase the budget to continue.' WHERE id = ? AND status = 'running'").bind(run.id).run();
        break;
      }
      const pending = await env.DB.prepare(`SELECT p.war_id FROM ranked_research_run_wars w JOIN ranked_research_reports p USING(war_id)
        LEFT JOIN ranked_research_report_retries t ON t.run_id = w.run_id AND t.war_id = w.war_id
        WHERE w.run_id = ? AND p.report_json IS NULL AND COALESCE(t.failures, 0) < ? AND COALESCE(t.next_attempt_at, 0) <= ?
        ORDER BY COALESCE(t.failures, 0), p.start, p.war_id LIMIT 1`).bind(run.id, MAX_FAILURES, nowSeconds()).first<{ war_id: number }>();
      if (!pending && current.discovery_done) {
        const waiting = await env.DB.prepare(`SELECT COUNT(*) AS pending, SUM(COALESCE(t.failures, 0) < ?) AS retryable,
          MIN(CASE WHEN COALESCE(t.failures, 0) < ? THEN t.next_attempt_at END) AS retry_at
          FROM ranked_research_run_wars w JOIN ranked_research_reports p USING(war_id)
          LEFT JOIN ranked_research_report_retries t ON t.run_id = w.run_id AND t.war_id = w.war_id
          WHERE w.run_id = ? AND p.report_json IS NULL`).bind(MAX_FAILURES, MAX_FAILURES, run.id).first<{ pending: number; retryable: number; retry_at: number | null }>();
        const status = !waiting?.pending ? 'complete' : waiting.retryable ? 'running' : 'paused';
        const message = status === 'complete' ? 'All discovered reports saved. Freeze the dataset to analyse it.'
          : status === 'running' ? 'Waiting for deferred reports to become eligible for retry.'
          : 'Some reports reached five failed attempts. Resume to retry them, or freeze this explicitly incomplete sample.';
        await env.DB.prepare('UPDATE ranked_research_runs SET status = ?, retry_at = ?, message = ? WHERE id = ? AND status = \'running\'')
          .bind(status, waiting?.retry_at ?? 0, message, run.id).run();
        break;
      }
      const url = pending ? ROOT + pending.war_id + '/rankedwarreport' : current.cursor!;
      let response: Awaited<ReturnType<typeof requestTorn>>;
      try {
        response = await requestTorn(env, current, url, pending?.war_id ?? null, deadline);
      } catch (error) {
        if (error instanceof ResearchRequestError && error.kind === 'report' && pending) {
          await deferReport(env, run.id, pending.war_id, error.message);
          continue;
        }
        if (error instanceof ResearchRequestError && error.kind === 'temporary') {
          const failures = current.consecutive_failures + 1;
          await env.DB.prepare(`UPDATE ranked_research_runs SET consecutive_failures = ?, retry_at = ?, last_error = ?,
            status = ?, message = ? WHERE id = ? AND status = 'running'`)
            .bind(failures, nowSeconds() + retryDelay(failures), error.message, failures >= MAX_FAILURES ? 'paused' : 'running',
              failures >= MAX_FAILURES ? 'Five consecutive service failures. Saved progress is safe; check service health and resume.'
                : `Temporary service failure ${failures}/${MAX_FAILURES}; automatic retry scheduled.`, run.id).run();
          break;
        }
        if (error instanceof ResearchRequestError) throw new ResearchInputError(error.message);
        throw error;
      }
      if (!response) {
        await env.DB.prepare("UPDATE ranked_research_runs SET message = 'Waiting for spare capacity or healthy keys opted into War research.' WHERE id = ? AND status = 'running'").bind(run.id).run();
        break;
      }
      if (response.keyFailure) continue;
      const { data, attemptId } = response;
      activeAttemptId = attemptId;
      if (pending) {
        let report: ReturnType<typeof validateResearchReport>;
        try {
          report = validateResearchReport(data);
          check(report.id === pending.war_id, 'Torn returned a different war.');
          check(report.start >= run.from_ts && report.start <= run.to_ts, 'Report start is outside this dataset.');
        } catch (error) {
          if (!(error instanceof ResearchInputError)) throw error;
          await env.DB.prepare("UPDATE ranked_research_attempts SET outcome = 'failed' WHERE id = ?").bind(attemptId).run();
          await deferReport(env, run.id, pending.war_id, error.message);
          activeAttemptId = null;
          continue;
        }
        await env.DB.prepare(`UPDATE ranked_research_reports SET report_json = ?, classification = ?, start = ?, end = ?, fetched_at = ?
          WHERE war_id = ? AND report_json IS NULL`).bind(report.raw, report.classification, report.start, report.end, nowSeconds(), report.id).run();
        await env.DB.prepare('UPDATE ranked_research_runs SET last_saved_at = ? WHERE id = ?').bind(nowSeconds(), run.id).run();
      } else {
        check(Array.isArray(data.warfareranked), 'Torn returned an unexpected war listing.');
        const metadata = isRecord(data._metadata) && isRecord(data._metadata.links) ? data._metadata.links : {};
        const next = researchNextCursor(metadata.next, run);
        const seen = next && await env.DB.prepare('SELECT 1 FROM ranked_research_cursors WHERE run_id = ? AND cursor = ?').bind(run.id, next).first();
        check(next !== url && !seen, 'Torn repeated a pagination cursor. Collection paused without skipping wars.');
        const statements: D1PreparedStatement[] = [];
        for (const entry of data.warfareranked) {
          check(isRecord(entry) && integer(entry.id) && entry.id > 0 && integer(entry.start) && integer(entry.end), 'Invalid war listing entry.');
          check(entry.start >= run.from_ts && entry.start <= run.to_ts, 'Listing left the selected date range.');
          if (entry.end <= entry.start) continue;
          statements.push(env.DB.prepare('INSERT OR IGNORE INTO ranked_research_reports(war_id, start, end) VALUES (?, ?, ?)').bind(entry.id, entry.start, entry.end));
          statements.push(env.DB.prepare(`INSERT OR IGNORE INTO ranked_research_run_wars(run_id, war_id, reused)
            SELECT ?, war_id, report_json IS NOT NULL FROM ranked_research_reports WHERE war_id = ?`).bind(run.id, entry.id));
        }
        statements.push(env.DB.prepare('INSERT OR IGNORE INTO ranked_research_cursors(run_id, cursor) VALUES (?, ?)').bind(run.id, url));
        statements.push(env.DB.prepare('UPDATE ranked_research_runs SET cursor = ?, discovery_done = ? WHERE id = ?').bind(next, next === null ? 1 : 0, run.id));
        await env.DB.batch(statements);
      }
      await env.DB.prepare("UPDATE ranked_research_attempts SET outcome = 'saved' WHERE id = ?").bind(attemptId).run();
      activeAttemptId = null;
      await env.DB.prepare("UPDATE ranked_research_runs SET consecutive_failures = 0, retry_at = 0, last_success_at = ?, message = 'Collecting; saved reports are reused automatically.' WHERE id = ? AND status = 'running'").bind(nowSeconds(), run.id).run();
    }
  } catch (error) {
    if (activeAttemptId && error instanceof ResearchInputError) await env.DB.prepare("UPDATE ranked_research_attempts SET outcome = 'failed' WHERE id = ?").bind(activeAttemptId).run();
    const message = error instanceof ResearchInputError ? error.message : 'Collection paused after a storage or response error. Saved progress is retained.';
    await env.DB.prepare("UPDATE ranked_research_runs SET status = 'paused', message = ? WHERE id = ? AND status = 'running'").bind(message, run.id).run();
  } finally {
    await env.DB.prepare('UPDATE ranked_research_runs SET lease_until = 0, lease_token = NULL WHERE id = ? AND lease_token = ?').bind(run.id, token).run();
  }
}

export async function handleRankedResearch(request: Request, env: Env, url: URL): Promise<Response> {
  try {
    const base = '/api/admin/ranked-research';
    if (url.pathname === base && request.method === 'GET') {
      const rows = await env.DB.prepare(`SELECT r.*, COUNT(p.report_json) AS reports,
        COALESCE(SUM(p.classification = 'eligible'), 0) AS eligible,
        COUNT(w.war_id) - COUNT(p.report_json) AS pending, COALESCE(SUM(w.reused), 0) AS reused,
        COALESCE(SUM(p.report_json IS NULL AND t.failures > 0 AND t.failures < 5), 0) AS deferred,
        COALESCE(SUM(p.report_json IS NULL AND t.failures >= 5), 0) AS exhausted
        FROM ranked_research_runs r LEFT JOIN ranked_research_run_wars w ON w.run_id = r.id
        LEFT JOIN ranked_research_reports p ON p.war_id = w.war_id
        LEFT JOIN ranked_research_report_retries t ON t.run_id = w.run_id AND t.war_id = w.war_id
        GROUP BY r.id ORDER BY r.created_at DESC LIMIT 100`).all<ResearchRun>();
      return json({ ok: true, runs: rows.results });
    }
    const body = request.method === 'POST' ? await readJsonObject(request) : {};
    if (url.pathname === base && request.method === 'POST') {
      const dates = researchDates(body.start, body.end);
      check(integer(body.budget) && body.budget >= 1 && body.budget <= 50000, 'Choose a request budget from 1 to 50,000.');
      check(typeof body.name === 'string' && body.name.trim().length > 0 && body.name.length <= 100, 'Give this dataset a name (up to 100 characters).');
      const id = crypto.randomUUID();
      const cursor = ROOT + 'warfareranked?' + new URLSearchParams({ from: String(dates.from - 1), to: String(dates.to), sort: 'ASC', limit: '100' });
      await env.DB.prepare(`INSERT INTO ranked_research_runs(id, name, start_date, end_date, from_ts, to_ts, request_limit, cursor, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, body.name.trim(), dates.start, dates.end, dates.from, dates.to, body.budget, cursor, nowSeconds()).run();
      return json({ ok: true, id });
    }
    const match = url.pathname.match(/^\/api\/admin\/ranked-research\/([a-f0-9-]+)\/(resume|pause|freeze|export|analysis|health)$/);
    if (!match) return json({ error: 'Not found' }, 404);
    const [, id, action] = match;
    const run = await readRun(env, id);
    if (!run) return json({ error: 'Dataset not found' }, 404);
    if (request.method === 'GET' && action === 'health') {
      const now = nowSeconds();
      const after = Number(url.searchParams.get('after') ?? 0);
      check(integer(after), 'Invalid issue cursor.');
      const recent = await env.DB.prepare(`SELECT COUNT(*) AS requests_last_five_minutes,
        COALESCE(SUM(attempted_at > ?), 0) AS requests_last_minute, COALESCE(SUM(outcome = 'failed'), 0) AS failures_last_five_minutes
        FROM ranked_research_attempts WHERE run_id = ? AND attempted_at > ?`).bind(now - 60, id, now - 300)
        .first<{ requests_last_five_minutes: number; requests_last_minute: number; failures_last_five_minutes: number }>();
      const keys = await env.DB.prepare(`SELECT COUNT(DISTINCT owner_torn_user_id) AS opted_in_owners,
        COALESCE(SUM(COALESCE(paused_until, 0) > ? OR COALESCE(h.until_ts, 0) > ?), 0) AS cooling_keys
        FROM torn_api_keys k LEFT JOIN ranked_research_key_cooldowns h ON h.key_id = k.id
        WHERE status = 'active' AND owner_torn_user_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM json_each(allowed_features_json) WHERE value = 'ranked_war_research')`).bind(now, now)
        .first<{ opted_in_owners: number; cooling_keys: number }>();
      const issueFilter = run.status === 'frozen' ? 't.unresolved_at_freeze = 1' : 'p.report_json IS NULL';
      const issues = await env.DB.prepare(`SELECT t.war_id, t.failures, t.next_attempt_at, t.last_error
        FROM ranked_research_report_retries t JOIN ranked_research_reports p USING(war_id)
        WHERE t.run_id = ? AND ${issueFilter} AND t.war_id > ? ORDER BY t.war_id LIMIT 100`).bind(id, after).all<{ war_id: number }>();
      const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ranked_research_report_retries t JOIN ranked_research_reports p USING(war_id)
        WHERE t.run_id = ? AND ${issueFilter}`).bind(id).first<{ n: number }>();
      const remaining = Math.max(0, run.request_limit - run.requests);
      return json({ ok: true, health: { ...recent, ...keys, remaining_budget: remaining,
        budget_minutes: run.status === 'running' && recent?.requests_last_five_minutes ? Math.ceil(remaining * 5 / recent.requests_last_five_minutes) : null,
        issues: issues.results, issue_count: count?.n ?? 0,
        next_issue: issues.results.length === 100 ? issues.results[99].war_id : null } });
    }
    if (request.method === 'GET' && action === 'analysis') {
      const result = await env.DB.prepare('SELECT id, result_json, created_at FROM ranked_research_analyses WHERE run_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').bind(id).first<{ id: string; result_json: string }>();
      return json({ ok: true, analysis: result ? JSON.parse(result.result_json) : null });
    }
    if (request.method === 'GET' && action === 'export') {
      check(run.status === 'frozen', 'Freeze the dataset before exporting it.');
      const after = Number(url.searchParams.get('after') ?? 0);
      check(integer(after), 'Invalid export cursor.');
      const rows = await env.DB.prepare(`SELECT p.war_id, p.report_json FROM ranked_research_run_wars w JOIN ranked_research_reports p USING(war_id)
        WHERE w.run_id = ? AND p.report_json IS NOT NULL AND p.war_id > ? ORDER BY p.war_id LIMIT 100`).bind(id, after).all<{ war_id: number; report_json: string }>();
      return json({ ok: true, dataset: { id, name: run.name, start: run.start_date, end: run.end_date, snapshot_token: run.snapshot_token, requests: run.requests, budget: run.request_limit,
        collection: run.collection_json ? JSON.parse(run.collection_json) : null },
        reports: rows.results.map(r => JSON.parse(r.report_json)), next: rows.results.length === 100 ? rows.results[99].war_id : null });
    }
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    if (action === 'health') return json({ error: 'Method not allowed' }, 405);
    if (action === 'analysis') {
      check(run.status === 'frozen' && body.snapshot_token === run.snapshot_token, 'This analysis does not match the frozen dataset.');
      const result = validateResearchAnalysis(body.result);
      const range = result.range as Record<string, unknown>;
      check(range.start === run.start_date && range.end === run.end_date, 'Analysis date range does not match.');
      const data = JSON.stringify(result);
      check(data.length <= 1500000, 'Analysis is too large. Upload the compact research result.');
      await env.DB.prepare('INSERT INTO ranked_research_analyses(id, run_id, snapshot_token, result_json, created_at) VALUES (?, ?, ?, ?, ?)').bind(crypto.randomUUID(), id, run.snapshot_token, data, nowSeconds()).run();
      return json({ ok: true });
    }
    check(run.status !== 'frozen', 'Frozen datasets are read-only. Create a separate run for new data.');
    if (action === 'pause') {
      await env.DB.prepare("UPDATE ranked_research_runs SET status = 'paused', message = 'Paused by an administrator; an in-flight request may still finish.' WHERE id = ? AND status <> 'frozen'").bind(id).run();
    } else {
      check(run.lease_until <= nowSeconds(), 'A batch is finishing. Try again shortly.');
      if (action === 'resume') {
        const budget = body.budget ?? run.request_limit;
        check(integer(budget) && budget > run.requests && budget <= 50000 && budget >= run.request_limit, 'Choose a total budget above requests used, up to 50,000.');
        // Only explicit resume renews exhausted report/service retry allowances.
        // Do not bypass a report's pending delay or owner-wide rate cooldowns.
        const resumed = await env.DB.batch([
          env.DB.prepare("UPDATE ranked_research_runs SET status = 'running', retry_at = 0, consecutive_failures = 0, request_limit = ?, message = 'Queued for the next collection batch.' WHERE id = ? AND status <> 'frozen' AND lease_until <= ?").bind(budget, id, nowSeconds()),
          env.DB.prepare(`UPDATE ranked_research_report_retries SET failures = 0 WHERE run_id = ? AND failures >= ?
            AND EXISTS (SELECT 1 FROM ranked_research_runs WHERE id = ? AND status = 'running' AND lease_until <= ?)`).bind(id, MAX_FAILURES, id, nowSeconds()),
          env.DB.prepare(`DELETE FROM ranked_research_key_cooldowns WHERE EXISTS
            (SELECT 1 FROM ranked_research_runs WHERE id = ? AND status = 'running' AND lease_until <= ?)`)
            .bind(id, nowSeconds()),
        ]);
        check(resumed[0].meta.changes, 'Collection state changed. Refresh and try again.');
      } else if (action === 'freeze') {
        check(run.status !== 'running', 'Pause collection before freezing the dataset.');
        const snapshot = crypto.randomUUID();
        const changed = await env.DB.batch([
          env.DB.prepare(`UPDATE ranked_research_runs SET status = 'frozen', snapshot_token = ?, collection_json = (
            SELECT json_object('discovery_done', json(CASE WHEN discovery_done = 1 THEN 'true' ELSE 'false' END),
              'discovered_wars', COUNT(*), 'saved_reports', COUNT(p.report_json),
              'pending_reports', COUNT(*) - COUNT(p.report_json),
              'deferred_reports', COALESCE(SUM(p.report_json IS NULL AND t.failures > 0 AND t.failures < 5), 0),
              'failed_reports', COALESCE(SUM(p.report_json IS NULL AND t.failures >= 5), 0))
            FROM ranked_research_run_wars w JOIN ranked_research_reports p USING(war_id)
            LEFT JOIN ranked_research_report_retries t ON t.run_id = w.run_id AND t.war_id = w.war_id WHERE w.run_id = ranked_research_runs.id),
            message = 'Frozen saved reports. Uncollected reports excluded. Analysis and viewing use no Torn requests.'
            WHERE id = ? AND status NOT IN ('running', 'frozen') AND lease_until <= ?`).bind(snapshot, id, nowSeconds()),
          env.DB.prepare(`UPDATE ranked_research_report_retries SET unresolved_at_freeze = 1 WHERE run_id = ?
            AND war_id IN (SELECT war_id FROM ranked_research_reports WHERE report_json IS NULL)
            AND EXISTS (SELECT 1 FROM ranked_research_runs WHERE id = ? AND snapshot_token = ?)`).bind(id, id, snapshot),
          env.DB.prepare(`DELETE FROM ranked_research_run_wars WHERE run_id = ? AND war_id IN
            (SELECT war_id FROM ranked_research_reports WHERE report_json IS NULL)
            AND EXISTS (SELECT 1 FROM ranked_research_runs WHERE id = ? AND snapshot_token = ?)`).bind(id, id, snapshot),
        ]);
        check(changed[0].meta.changes, 'Collection state changed. Refresh and try again.');
      }
    }
    return json({ ok: true });
  } catch (error) {
    if (error instanceof ResearchInputError) return json({ error: error.message }, 400);
    return json({ error: 'War research could not complete the operation. Check that its database migration is installed.' }, 500);
  }
}
