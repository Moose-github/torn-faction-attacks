import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleRankedResearch, researchDates, researchNextCursor, reserveResearchAttempt, runRankedResearchTick, validateResearchReport, validateResearchAnalysis } from '../src/rankedResearch';
import { fetchTrackedTornJson } from '../src/external/torn';
import { readAvailableTornApiKeys, type TornKeyPoolCandidate } from '../src/tornKeyPool';
import type { Env } from '../src/types';
import { routeAdminApi } from '../src/http/adminRoutes';

vi.mock('../src/external/torn', () => ({ fetchTrackedTornJson: vi.fn() }));
vi.mock('../src/discordImageRenderer', () => ({}));
vi.mock('../src/tornKeyPool', async importOriginal => ({ ...await importOriginal<typeof import('../src/tornKeyPool')>(), readAvailableTornApiKeys: vi.fn() }));

let db: DatabaseSync;
let env: Env;
const base = 'https://worker.test/api/admin/ranked-research';
const start = Date.parse('2026-09-01T00:00:00Z') / 1000;
function statement(sql: string, args: SQLInputValue[] = []) {
  return {
    bind: (...values: SQLInputValue[]) => statement(sql, values),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => ({ success: true, meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
  };
}
function candidate(id = 'key1'): TornKeyPoolCandidate {
  return { id, key: 'not-a-real-key', keySource: `key_pool:${id}`, sourceType: 'submitted', maxRequestsPerMinute: 35, currentMinuteUsage: 0, lastUsedAt: null, monitorLastUsedAt: null };
}
function addKey(id = 'key1', owner = 1) {
  db.prepare(`INSERT INTO torn_api_keys(id, encrypted_key, key_fingerprint, owner_torn_user_id, status, allowed_features_json, max_requests_per_minute, created_at, updated_at)
    VALUES (?, 'encrypted', ?, ?, 'active', '["ranked_war_research"]', 35, 1, 1)`).run(id, id, owner);
}
function report(id = 123) {
  return { rankedwarreport: { id, start, end: start + 3600, winner: 1, forfeit: false, factions: [1, 2].map(n => ({
    id: n, name: `Faction ${n}`, rank: { before: 'Platinum II', after: 'Platinum II' }, attacks: 10, score: 10,
    rewards: { respect: 100, points: 0, items: [{ id: 1, name: 'Melee Cache', quantity: 2 }] },
    members: [{ id: n * 10, name: 'Member', attacks: 10, score: 10 }],
  })) } };
}
async function call(path = '', body?: unknown) {
  const req = new Request(base + path, body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return handleRankedResearch(req, env, new URL(req.url));
}
async function create(budget = 10) {
  const response = await call('', { name: 'Test sample', start: '2026-09-01', end: '2026-09-30', budget });
  return (await response.json() as { id: string }).id;
}
function row(id: string) { return db.prepare('SELECT * FROM ranked_research_runs WHERE id = ?').get(id)!; }
beforeEach(() => {
  vi.clearAllMocks();
  db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema/current.sql', import.meta.url), 'utf8'));
  env = { DB: { prepare: statement, batch: async (statements: ReturnType<typeof statement>[]) => {
    db.exec('BEGIN');
    try { const results = []; for (const s of statements) results.push(await s.run()); db.exec('COMMIT'); return results; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  } } } as unknown as Env;
  addKey(); vi.mocked(readAvailableTornApiKeys).mockResolvedValue([candidate()]);
});
afterEach(() => db.close());

describe('finite ranked research', () => {
  it('does no Torn work until explicitly resumed and never from viewing', async () => {
    await create(); await call(); await runRankedResearchTick(env);
    expect(fetchTrackedTornJson).not.toHaveBeenCalled();
  });
  it('counts listing + reports, stops at budget, resumes cached discovery and freezes', async () => {
    const id = await create(2);
    await call(`/${id}/resume`, {});
    vi.mocked(fetchTrackedTornJson).mockResolvedValueOnce({ warfareranked: [{ id: 123, start, end: start + 3600 }, { id: 124, start, end: start + 3600 }], _metadata: { links: { next: null } } }).mockResolvedValueOnce(report());
    await runRankedResearchTick(env);
    expect(row(id)).toMatchObject({ requests: 2, status: 'paused', discovery_done: 1 });
    expect(fetchTrackedTornJson).toHaveBeenCalledTimes(2);
    expect((await call(`/${id}/resume`, {})).status).toBe(400);
    expect((await call(`/${id}/resume`, { budget: 4 })).status).toBe(200);
    vi.mocked(fetchTrackedTornJson).mockResolvedValueOnce(report(124));
    await runRankedResearchTick(env);
    expect(row(id)).toMatchObject({ requests: 3, status: 'complete' });
    await call(`/${id}/freeze`, {});
    const exported = await (await call(`/${id}/export`)).json() as { reports: unknown[] };
    expect(exported.reports).toHaveLength(2);
    expect((await call(`/${id}/resume`, { budget: 10 })).status).toBe(400);
    expect((await call(`/${id}/import`, { reports: [report(125)] })).status).toBe(400);
  });
  it('counts failed attempts and pauses without leaking the upstream key/error', async () => {
    const id = await create(); await call(`/${id}/resume`, {});
    vi.mocked(fetchTrackedTornJson).mockRejectedValue(new Error('secret API key in upstream error'));
    await runRankedResearchTick(env);
    expect(row(id)).toMatchObject({ requests: 1, status: 'paused', lease_until: 0 });
    expect(String(row(id).message)).not.toContain('secret');
    expect(db.prepare('SELECT request_count FROM torn_api_key_usage_windows').get()).toMatchObject({ request_count: 1 });
  });
  it('shares the research cap across keys with the same owner, but allows another owner', async () => {
    const id = await create(100); await call(`/${id}/resume`, {});
    const now = Math.floor(Date.now() / 1000);
    db.prepare("UPDATE ranked_research_runs SET lease_token = 'lease', lease_until = ? WHERE id = ?").run(now + 100, id);
    addKey('key2'); addKey('key3', 2);
    for (let i = 0; i < 10; i++) expect(await reserveResearchAttempt(env, id, 'lease', candidate(i % 2 ? 'key2' : 'key1'), now)).toBe(true);
    expect(await reserveResearchAttempt(env, id, 'lease', candidate('key2'), now)).toBe(false);
    expect(await reserveResearchAttempt(env, id, 'lease', candidate('key3'), now)).toBe(true);
    expect(await reserveResearchAttempt(env, id, 'wrong-lease', candidate('key3'), now)).toBe(false);
  });
  it('waits for opt-in keys and prevents overlapping collectors', async () => {
    const id = await create(); await call(`/${id}/resume`, {});
    vi.mocked(readAvailableTornApiKeys).mockResolvedValue([]);
    await runRankedResearchTick(env);
    expect(row(id)).toMatchObject({ requests: 0, status: 'running' });
    expect(String(row(id).message)).toContain('Waiting');
    db.prepare('UPDATE ranked_research_runs SET lease_until = ? WHERE id = ?').run(Math.floor(Date.now() / 1000) + 180, id);
    await runRankedResearchTick(env);
    expect(fetchTrackedTornJson).not.toHaveBeenCalled();
    expect((await call(`/${id}/freeze`, {})).status).toBe(400);
  });
  it('leaves capacity for other dashboard features and requires explicit research permission', async () => {
    const id = await create(100); await call(`/${id}/resume`, {});
    const now = Math.floor(Date.now() / 1000);
    db.prepare("UPDATE ranked_research_runs SET lease_token = 'lease', lease_until = ? WHERE id = ?").run(now + 100, id);
    addKey('key2');
    for (let i = 0; i < 50; i++) db.prepare(`INSERT INTO torn_api_call_log(requested_at, feature, key_source, method, endpoint, duration_ms)
      VALUES (?, 'live', 'key_pool:key2', 'GET', 'faction', 1)`).run(now);
    expect(await reserveResearchAttempt(env, id, 'lease', candidate(), now)).toBe(false);
    db.exec('DELETE FROM torn_api_call_log');
    db.prepare('INSERT INTO torn_api_key_usage_windows VALUES (?, ?, 30)').run('key1', now - now % 60);
    expect(await reserveResearchAttempt(env, id, 'lease', candidate(), now)).toBe(false);
    db.exec("UPDATE torn_api_keys SET allowed_features_json = '[]' WHERE id='key2'");
    expect(await reserveResearchAttempt(env, id, 'lease', candidate('key2'), now)).toBe(false);
    expect(row(id).requests).toBe(0);
  });
  it('keeps a frozen partial sample unchanged when another run fills pending reports', async () => {
    const id = await create();
    await call(`/${id}/import`, { reports: [report()] });
    db.prepare('INSERT INTO ranked_research_reports(war_id, start, end) VALUES (124, ?, ?)').run(start, start + 3600);
    db.prepare('INSERT INTO ranked_research_run_wars VALUES (?, 124)').run(id);
    await call(`/${id}/freeze`, {});
    const other = await create(); await call(`/${other}/import`, { reports: [report(124)] });
    const frozen = await (await call(`/${id}/export`)).json() as { reports: unknown[] };
    expect(frozen.reports).toHaveLength(1);
    const changed = report(); changed.rankedwarreport.factions[0].attacks = 999;
    await call(`/${other}/import`, { reports: [changed] });
    expect(JSON.parse(String(db.prepare('SELECT report_json FROM ranked_research_reports WHERE war_id=123').get()!.report_json)).rankedwarreport.factions[0].attacks).toBe(10);
  });
  it('preserves tie offsets, strips credentials, rejects external/repeated/missing cursors', async () => {
    const bounds = { from_ts: start, to_ts: start + 86400 };
    const url = `https://api.torn.com/v2/faction/warfareranked?from=${start}&to=${start + 86400}&sort=ASC&offset=100&key=secret`;
    expect(researchNextCursor(url, bounds)).toContain('offset=100');
    expect(researchNextCursor(url, bounds)).not.toContain('secret');
    expect(() => researchNextCursor(url.replace('api.torn.com', 'evil.test'), bounds)).toThrow();
    expect(() => researchNextCursor(undefined, bounds)).toThrow();
    const id = await create(); await call(`/${id}/resume`, {});
    vi.mocked(fetchTrackedTornJson).mockResolvedValue({ warfareranked: [], _metadata: { links: { next: row(id).cursor } } });
    await runRankedResearchTick(env);
    expect(row(id).status).toBe('paused'); expect(String(row(id).message)).toContain('repeated');
  });
  it('filters using both pre-war ranks and forfeits; rejects malformed Platinum reports', () => {
    const data = report(); expect(validateResearchReport(data).classification).toBe('eligible');
    data.rankedwarreport.factions[1].rank.before = 'Gold III';
    expect(validateResearchReport(data).classification).toBe('not_platinum_vs_platinum');
    data.rankedwarreport.forfeit = true; expect(validateResearchReport(data).classification).toBe('forfeit');
    data.rankedwarreport.forfeit = false; data.rankedwarreport.factions[1].rank.before = 'Platinum V';
    expect(() => validateResearchReport(data)).toThrow();
  });
  it('rejects noncalendar/future dates and analysis for a different snapshot', async () => {
    expect(() => researchDates('2026-02-30', '2026-03-01')).toThrow();
    expect(() => researchDates('2026-09-01', '2099-10-01')).toThrow();
    const id = await create(); await call(`/${id}/freeze`, {});
    expect((await call(`/${id}/analysis`, { snapshot_token: 'wrong', result: {} })).status).toBe(400);
  });
  it('protects every collector/read/export action with existing admin authorization', async () => {
    for (const suffix of ['', '/abc/export', '/abc/resume', '/abc/analysis', '/abc/import']) {
      const request = new Request(base + suffix, suffix.endsWith('/resume') || suffix.endsWith('/import') ? { method: 'POST' } : {});
      const response = await routeAdminApi({ request, env, url: new URL(request.url), ctx: {} as ExecutionContext });
      expect([401, 403]).toContain(response!.status);
    }
    expect(fetchTrackedTornJson).not.toHaveBeenCalled();
  });
  it('validates display fields and saves a matching analysis without Torn calls', async () => {
    const id = await create(); await call(`/${id}/freeze`, {});
    const result = { generated_at: '2026-10-21T00:00:00Z', scope: 'Platinum', eligible_wars: 0, observations: 0, distinct_factions: 0, model_observations: 0,
      range: { start: '2026-09-01', end: '2026-09-30' }, warnings: [], prices: {}, summaries: [], model: { available: false, reason: 'More data needed' } };
    expect(() => validateResearchAnalysis({ ...result, warnings: [null] })).toThrow();
    expect(() => validateResearchAnalysis({ ...result, model: { available: true, effects: [{}] } })).toThrow();
    expect((await call(`/${id}/analysis`, { snapshot_token: row(id).snapshot_token, result })).status).toBe(200);
    expect(await (await call(`/${id}/analysis`)).json()).toMatchObject({ analysis: result });
    expect(fetchTrackedTornJson).not.toHaveBeenCalled();
    const whole = { eligible_wars: 0, valued_wars: 0, model_observations: 0, median_value: null, mean_value: null, summaries: [], model: { available: false, reason: 'More wars needed' } };
    expect(validateResearchAnalysis({ ...result, whole_war: whole }).whole_war).toEqual(whole);
    expect(() => validateResearchAnalysis({ ...result, whole_war: { ...whole, valued_wars: 1 } })).toThrow();
    expect(() => validateResearchAnalysis({ ...result, whole_war: { ...whole, model: { available: true, effects: [{}] } } })).toThrow();
    expect((await call(`/${id}/analysis`, { snapshot_token: row(id).snapshot_token, result: { ...result, whole_war: whole } })).status).toBe(200);
    expect(await (await call(`/${id}/analysis`)).json()).toMatchObject({ analysis: { whole_war: whole } });
  });
});
