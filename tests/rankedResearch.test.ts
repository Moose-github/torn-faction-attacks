import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleRankedResearch, researchDates, researchNextCursor, reserveResearchAttempt, runRankedResearchTick, validateResearchReport, validateResearchAnalysis } from '../src/rankedResearch';
import { fetchTrackedTornJson } from '../src/external/torn';
import { readAvailableTornApiKeys, type TornKeyPoolCandidate } from '../src/tornKeyPool';
import type { Env } from '../src/types';
import { routeAdminApi } from '../src/http/adminRoutes';
import { ExternalApiError } from '../src/external/http';
import type { ResearchHealth } from '../shared/rankedResearch';
import { researchPlatinumLabel } from '../shared/rankedResearch';
import { getWarResearchResults } from '../src/warResearchResults';

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
    VALUES (?, 'encrypted', ?, ?, 'active', '["enemy_scouting"]', 35, 1, 1)`).run(id, id, owner);
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
  vi.mocked(fetchTrackedTornJson).mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-21T12:00:00Z'));
  db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema/current.sql', import.meta.url), 'utf8'));
  let transactionQueue = Promise.resolve();
  env = { DB: { prepare: statement, batch: (statements: ReturnType<typeof statement>[]) => {
    // D1 serializes transactions. Model that when report reservations overlap.
    const result = transactionQueue.then(async () => {
      db.exec('BEGIN');
      try { const results = []; for (const s of statements) results.push(await s.run()); db.exec('COMMIT'); return results; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    });
    transactionQueue = result.then(() => undefined, () => undefined);
    return result;
  } } } as unknown as Env;
  addKey(); vi.mocked(readAvailableTornApiKeys).mockResolvedValue([candidate()]);
});
afterEach(() => { db.close(); vi.useRealTimers(); });
function advance(seconds: number) { vi.setSystemTime(Date.now() + seconds * 1000); }
const listing = (ids = [123]) => ({ warfareranked: ids.map(id => ({ id, start, end: start + 3600 })), _metadata: { links: { next: null as string | null } } });

describe('finite ranked research', () => {
  it('returns only display data from the latest matching frozen analysis, without Torn calls', async () => {
    expect(await (await getWarResearchResults(env)).json()).toEqual({ ok: true, result: null });
    const id = await create(); await call(`/${id}/freeze`, {});
    const token = String(row(id).snapshot_token);
    const graph = { observations: 0, wars: 0, value_range: [0, 0], factors: [], points: [], distributions: [{ privateFixture: true }] };
    const saved = { generated_at: '2026-10-22', range: { start: '2026-09-01', end: '2026-09-30' }, prices: { 'Melee Cache': 100 },
      coverage: { saved_reports: 10 }, graphs: graph, whole_war: { graphs: graph, model: 'excluded' }, model: 'excluded', comparisons: ['excluded'], rows: ['raw report excluded'] };
    const insert = (analysisId: string, runId: string, snapshot: string, created: number, content: unknown) => db.prepare(
      'INSERT INTO ranked_research_analyses(id, run_id, snapshot_token, result_json, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(analysisId, runId, snapshot, JSON.stringify(content), created);
    insert('old', id, token, 1, { ...saved, generated_at: 'old' });
    insert('latest', id, token, 1, saved);
    insert('wrong-snapshot', id, 'wrong', 99, { ...saved, generated_at: 'wrong' });
    const pending = await create();
    insert('unfrozen', pending, 'pending', 100, { ...saved, generated_at: 'unfrozen' });
    const expectedGraph = { observations: 0, wars: 0, value_range: [0, 0], factors: [], points: [] };
    expect(await (await getWarResearchResults(env)).json()).toEqual({ ok: true, result: { name: 'Test sample', generated_at: saved.generated_at,
      range: saved.range, prices: saved.prices, coverage: saved.coverage, combined: expectedGraph, faction: expectedGraph } });
    const other = await create(); await call(`/${other}/freeze`, {});
    db.prepare('UPDATE ranked_research_runs SET name = ? WHERE id = ?').run('Newer sample', other);
    insert('other', other, String(row(other).snapshot_token), 101, saved);
    expect(await (await getWarResearchResults(env)).json()).toMatchObject({ result: { name: 'Newer sample' } });
    expect(fetchTrackedTornJson).not.toHaveBeenCalled();
  });
  it('uses only enemy-scouting opt-ins while keeping research usage attribution', async () => {
    db.prepare('UPDATE torn_api_keys SET allowed_features_json = ? WHERE id = ?').run('["ranked_war_research"]', 'key1');
    addKey('key2', 2);
    // Simulate a stale candidate list; the atomic reservation must recheck consent.
    vi.mocked(readAvailableTornApiKeys).mockResolvedValue([candidate(), candidate('key2')]);
    const id = await create(); await call(`/${id}/resume`, {});
    vi.mocked(fetchTrackedTornJson).mockResolvedValueOnce(listing()).mockResolvedValueOnce(report());
    await runRankedResearchTick(env);
    expect(row(id)).toMatchObject({ status: 'complete', requests: 2 });
    expect(readAvailableTornApiKeys).toHaveBeenCalledWith(env, 'enemy_scouting', expect.any(Number), { includeFallback: false });
    expect(db.prepare('SELECT DISTINCT key_id FROM ranked_research_attempts').all()).toEqual([{ key_id: 'key2' }]);
    expect(vi.mocked(fetchTrackedTornJson).mock.calls[0][3]).toMatchObject({ feature: 'ranked_war_research', keySource: 'key_pool:key2' });
    expect(await (await call(`/${id}/health`)).json()).toMatchObject({ health: { opted_in_owners: 1 } });
    db.prepare('UPDATE torn_api_keys SET allowed_features_json = ? WHERE id = ?').run('["stock_tools"]', 'key2');
    const other = await create(); await call(`/${other}/resume`, {});
    await runRankedResearchTick(env);
    expect(row(other)).toMatchObject({ requests: 0, status: 'running' });
    expect(String(row(other).message)).toContain('Enemy scouting');
    expect(await (await call(`/${other}/health`)).json()).toMatchObject({ health: { opted_in_owners: 0 } });
    expect(fetchTrackedTornJson).toHaveBeenCalledTimes(2);
  });
  it('migrates legacy data to recovery defaults without modifying snapshots', () => {
    const legacy = new DatabaseSync(':memory:');
    try {
      legacy.exec(readFileSync(new URL('../migrations/0176_ranked_war_research.sql', import.meta.url), 'utf8'));
      legacy.exec(readFileSync(new URL('../migrations/0177_ranked_research_coverage.sql', import.meta.url), 'utf8'));
      legacy.prepare(`INSERT INTO ranked_research_runs(id, name, start_date, end_date, from_ts, to_ts, request_limit, status, snapshot_token, collection_json, created_at)
        VALUES ('old', 'Old', '2026-09-01', '2026-09-30', 1, 2, 100, 'frozen', 'snapshot', '{}', 1)`).run();
      legacy.exec(readFileSync(new URL('../migrations/0178_ranked_research_recovery.sql', import.meta.url), 'utf8'));
      expect(legacy.prepare('SELECT * FROM ranked_research_runs').get()).toMatchObject({ status: 'frozen', snapshot_token: 'snapshot', collection_json: '{}', retry_at: 0, consecutive_failures: 0, last_saved_at: null });
    } finally { legacy.close(); }
  });
  it('persists increasing service backoff, stops after five failures and resumes explicitly', async () => {
    const id = await create(20); await call(`/${id}/resume`, {});
    vi.mocked(fetchTrackedTornJson).mockRejectedValue(new ExternalApiError('secret upstream URL', 'Torn', 503));
    for (let attempt = 1; attempt <= 5; attempt++) {
      const now = Math.floor(Date.now() / 1000);
      await runRankedResearchTick(env);
      expect(row(id)).toMatchObject({ requests: attempt, consecutive_failures: attempt, retry_at: now + Math.min(900, 60 * 2 ** (attempt - 1)) });
      await runRankedResearchTick(env);
      expect(fetchTrackedTornJson).toHaveBeenCalledTimes(attempt);
      advance(Math.min(900, 60 * 2 ** (attempt - 1)));
    }
    expect(row(id).status).toBe('paused');
    expect(db.prepare('SELECT failure_count FROM torn_api_keys').get()?.failure_count).toBe(0);
    expect(JSON.stringify(await (await call(`/${id}/health`)).json())).not.toContain('secret');
    await call(`/${id}/resume`, {});
    vi.mocked(fetchTrackedTornJson).mockResolvedValueOnce(listing()).mockResolvedValueOnce(report());
    await runRankedResearchTick(env);
    expect(row(id)).toMatchObject({ status: 'complete', requests: 7, consecutive_failures: 0, retry_at: 0 });
  });
  it('handles temporary Torn error bodies without poisoning a healthy key', async () => {
    const id = await create(); await call(`/${id}/resume`, {});
    vi.mocked(fetchTrackedTornJson).mockResolvedValue({ error: { code: 17, error: 'secret' } });
    await runRankedResearchTick(env);
    expect(row(id)).toMatchObject({ status: 'running', requests: 1, consecutive_failures: 1 });
    expect(row(id).last_error).toContain('code 17');
    expect(db.prepare('SELECT paused_until FROM torn_api_keys').get()?.paused_until).toBeNull();
  });
  it('rotates away from an invalid key and continues with a healthy owner', async () => {
    addKey('key2', 2);
    vi.mocked(readAvailableTornApiKeys).mockResolvedValue([candidate(), candidate('key2')]);
    const id = await create(); await call(`/${id}/resume`, {});
    vi.mocked(fetchTrackedTornJson).mockResolvedValueOnce({ error: { code: 2, error: 'secret' } }).mockResolvedValueOnce(listing()).mockResolvedValueOnce(report());
    await runRankedResearchTick(env);
    expect(row(id)).toMatchObject({ status: 'complete', requests: 3 });
    expect(db.prepare("SELECT until_ts FROM ranked_research_key_cooldowns WHERE key_id = 'key1'").get()?.until_ts).toBe(Math.floor(Date.now() / 1000) + 86400);
    expect(db.prepare("SELECT paused_until FROM torn_api_keys WHERE id = 'key1'").get()?.paused_until).toBeNull();
    expect(db.prepare("SELECT COUNT(*) AS n FROM ranked_research_attempts WHERE key_id = 'key1'").get()?.n).toBe(1);
    expect(String(row(id).last_error)).not.toContain('secret');
    expect(await (await call(`/${id}/health`)).json()).toMatchObject({ health: { cooling_keys: 1 } });
  });
  it('cools every key of a rate-limited owner while another owner continues', async () => {
    addKey('key2'); addKey('key3', 2);
    vi.mocked(readAvailableTornApiKeys).mockResolvedValue([candidate(), candidate('key2'), candidate('key3')]);
    const id = await create(); await call(`/${id}/resume`, {});
    vi.mocked(fetchTrackedTornJson).mockResolvedValueOnce({ error: { code: 5 } }).mockResolvedValueOnce(listing()).mockResolvedValueOnce(report());
    await runRankedResearchTick(env);
    expect(row(id)).toMatchObject({ status: 'complete', requests: 3 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM ranked_research_attempts WHERE key_id = 'key2'").get()?.n).toBe(0);
    expect(db.prepare("SELECT paused_until FROM torn_api_keys WHERE id = 'key2'").get()?.paused_until).toBe(Math.floor(Date.now() / 1000) + 120);
  });
  it('waits when all research keys are blocked and only explicitly clears research cooldowns', async () => {
    const id = await create(); await call(`/${id}/resume`, {});
    vi.mocked(fetchTrackedTornJson).mockResolvedValueOnce({ error: { code: 16 } });
    await runRankedResearchTick(env);
    expect(row(id)).toMatchObject({ status: 'running', requests: 1 });
    await runRankedResearchTick(env);
    expect(fetchTrackedTornJson).toHaveBeenCalledTimes(1);
    expect(db.prepare('SELECT paused_until FROM torn_api_keys').get()?.paused_until).toBeNull();
    const until = Math.floor(Date.now() / 1000) + 120;
    db.prepare('UPDATE torn_api_keys SET paused_until = ?').run(until);
    await call(`/${id}/pause`, {}); await call(`/${id}/resume`, {});
    expect(db.prepare('SELECT COUNT(*) AS n FROM ranked_research_key_cooldowns').get()?.n).toBe(0);
    expect(db.prepare('SELECT paused_until FROM torn_api_keys').get()?.paused_until).toBe(until);
    await runRankedResearchTick(env);
    expect(fetchTrackedTornJson).toHaveBeenCalledTimes(1);
    advance(120);
    vi.mocked(fetchTrackedTornJson).mockResolvedValueOnce(listing()).mockResolvedValueOnce(report());
    await runRankedResearchTick(env);
    expect(row(id).status).toBe('complete');
  });
  it('saves other wars while a bad report waits, then stops retrying it after five failures', async () => {
    const id = await create(20); await call(`/${id}/resume`, {});
    const malformed = report(); malformed.rankedwarreport.factions[0].members = [];
    vi.mocked(fetchTrackedTornJson).mockResolvedValueOnce(listing([123, 124])).mockResolvedValueOnce(malformed).mockResolvedValueOnce(report(124));
    await runRankedResearchTick(env);
    expect(row(id)).toMatchObject({ status: 'running', requests: 3 });
    expect(db.prepare('SELECT classification FROM ranked_research_reports WHERE war_id = 124').get()?.classification).toBe('eligible');
    vi.mocked(fetchTrackedTornJson).mockResolvedValue(malformed);
    for (let attempt = 2; attempt <= 5; attempt++) {
      advance(900); await runRankedResearchTick(env);
    }
    expect(row(id)).toMatchObject({ status: 'paused', requests: 7 });
    const before = vi.mocked(fetchTrackedTornJson).mock.calls.length;
    advance(3600); await runRankedResearchTick(env);
    expect(fetchTrackedTornJson).toHaveBeenCalledTimes(before);
    const health = (await (await call(`/${id}/health`)).json() as { health: ResearchHealth }).health;
    expect(health).toMatchObject({ issue_count: 1, issues: [{ war_id: 123, failures: 5 }] });
    await call(`/${id}/resume`, {});
    vi.mocked(fetchTrackedTornJson).mockResolvedValue(report());
    await runRankedResearchTick(env);
    expect(row(id).status).toBe('complete');
  });
  it('continues discovery when every report on the current page is deferred', async () => {
    const id = await create(); await call(`/${id}/resume`, {});
    const malformed = report(); malformed.rankedwarreport.end = 0;
    const first = listing(); first._metadata.links.next = `https://api.torn.com/v2/faction/warfareranked?from=${start}&to=${start + 86399}&sort=ASC&offset=100`;
    vi.mocked(fetchTrackedTornJson).mockResolvedValueOnce(first).mockResolvedValueOnce(malformed).mockResolvedValueOnce(listing([124])).mockResolvedValueOnce(report(124));
    await runRankedResearchTick(env);
    expect(row(id)).toMatchObject({ requests: 4, discovery_done: 1, status: 'running' });
  });
  it('uses separate owners up to the batch ceiling and still enforces the rolling owner cap', async () => {
    for (let i = 2; i <= 4; i++) addKey(`key${i}`, i);
    vi.mocked(readAvailableTornApiKeys).mockResolvedValue([1, 2, 3, 4].map(i => candidate(`key${i}`)));
    const id = await create(200); await call(`/${id}/resume`, {});
    vi.mocked(fetchTrackedTornJson).mockImplementation(async (_env, url) => String(url).includes('warfareranked') ? listing(Array.from({ length: 100 }, (_, i) => 100 + i)) : report(Number(String(url).match(/faction\/(\d+)/)![1])));
    await runRankedResearchTick(env);
    expect(row(id).requests).toBe(80);
    expect(db.prepare('SELECT MAX(n) AS n FROM (SELECT COUNT(*) AS n FROM ranked_research_attempts GROUP BY owner_id)').get()?.n).toBe(20);
    await runRankedResearchTick(env); // All four owners have spent their rolling allowance.
    expect(row(id).requests).toBe(80);
    await runRankedResearchTick(env);
    expect(row(id).requests).toBe(80);
    advance(60); await runRankedResearchTick(env);
    expect(row(id)).toMatchObject({ requests: 101, status: 'complete' });
  });
  it('stops starting requests when the elapsed batch deadline is reached', async () => {
    const id = await create(); await call(`/${id}/resume`, {});
    vi.mocked(fetchTrackedTornJson).mockImplementation(async () => { advance(45); return listing(); });
    await runRankedResearchTick(env);
    expect(row(id)).toMatchObject({ requests: 1, lease_until: 0 });
  });
  it('fetches four distinct reports concurrently, loads keys once and drains in-flight work before releasing the lease', async () => {
    const id = await create(30); await call(`/${id}/resume`, {});
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let waveStarted!: () => void;
    const started = new Promise<void>(resolve => { waveStarted = resolve; });
    const ids: number[] = [];
    vi.mocked(fetchTrackedTornJson).mockImplementation(async (_env, url, _init, usage) => {
      if (String(url).includes('warfareranked')) return listing([123, 124, 125, 126, 127]);
      const warId = Number(String(url).match(/faction\/(\d+)/)![1]);
      ids.push(warId);
      expect(usage.timeoutMs).toBe(15000);
      if (ids.length === 4) waveStarted();
      await gate;
      return report(warId);
    });
    const tick = runRankedResearchTick(env);
    await started;
    expect(ids).toEqual([123, 124, 125, 126]);
    expect(row(id).requests).toBe(5);
    expect(readAvailableTornApiKeys).toHaveBeenCalledTimes(1);
    await call(`/${id}/pause`, {});
    expect((await call(`/${id}/freeze`, {})).status).toBe(400);
    await runRankedResearchTick(env);
    expect(ids).toHaveLength(4);
    advance(3);
    release(); await tick;
    expect(row(id)).toMatchObject({ status: 'paused', requests: 5, lease_until: 0, last_saved_at: Math.floor(Date.now() / 1000) });
    expect(String(row(id).message)).toContain('Paused by an administrator');
    expect(db.prepare('SELECT COUNT(*) AS n FROM ranked_research_reports WHERE report_json IS NOT NULL').get()?.n).toBe(4);
    expect((await call(`/${id}/freeze`, {})).status).toBe(200);
  });
  it('never overspends a budget smaller than the report wave', async () => {
    const id = await create(3); await call(`/${id}/resume`, {});
    vi.mocked(fetchTrackedTornJson).mockImplementation(async (_env, url) => String(url).includes('warfareranked')
      ? listing([123, 124, 125, 126, 127]) : report(Number(String(url).match(/faction\/(\d+)/)![1])));
    await runRankedResearchTick(env);
    expect(row(id)).toMatchObject({ status: 'paused', requests: 3 });
    expect(fetchTrackedTornJson).toHaveBeenCalledTimes(3);
    expect(db.prepare('SELECT COUNT(*) AS n FROM ranked_research_reports WHERE report_json IS NOT NULL').get()?.n).toBe(2);
  });
  it('saves successful siblings without erasing service backoff or starting another wave', async () => {
    const id = await create(30); await call(`/${id}/resume`, {});
    vi.mocked(fetchTrackedTornJson).mockImplementation(async (_env, url) => {
      if (String(url).includes('warfareranked')) return listing([123, 124, 125, 126, 127]);
      const warId = Number(String(url).match(/faction\/(\d+)/)![1]);
      return warId === 123 ? { error: { code: 17 } } : report(warId);
    });
    await runRankedResearchTick(env);
    expect(row(id)).toMatchObject({ status: 'running', requests: 5, consecutive_failures: 1, retry_at: Math.floor(Date.now() / 1000) + 60 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM ranked_research_reports WHERE report_json IS NOT NULL').get()?.n).toBe(3);
    await runRankedResearchTick(env);
    expect(fetchTrackedTornJson).toHaveBeenCalledTimes(5);
  });
  it('rechecks revoked permission even with cached keys', async () => {
    const id = await create(30); await call(`/${id}/resume`, {});
    vi.mocked(fetchTrackedTornJson).mockImplementation(async () => {
      db.exec("UPDATE torn_api_keys SET allowed_features_json = '[]'");
      return listing([123, 124, 125, 126]);
    });
    await runRankedResearchTick(env);
    expect(row(id)).toMatchObject({ status: 'running', requests: 1 });
    expect(readAvailableTornApiKeys).toHaveBeenCalledTimes(1);
    expect(fetchTrackedTornJson).toHaveBeenCalledTimes(1);
  });
  it('bounds a batch at 120 attempts while distributing requests across owners', async () => {
    for (let i = 2; i <= 7; i++) addKey(`key${i}`, i);
    vi.mocked(readAvailableTornApiKeys).mockResolvedValue(Array.from({ length: 7 }, (_, i) => candidate(`key${i + 1}`)));
    const id = await create(200); await call(`/${id}/resume`, {});
    for (let i = 1; i <= 160; i++) {
      db.prepare('INSERT INTO ranked_research_reports(war_id, start, end) VALUES (?, ?, ?)').run(i, start, start + 3600);
      db.prepare('INSERT INTO ranked_research_run_wars(run_id, war_id) VALUES (?, ?)').run(id, i);
    }
    db.prepare('UPDATE ranked_research_runs SET discovery_done = 1 WHERE id = ?').run(id);
    vi.mocked(fetchTrackedTornJson).mockImplementation(async (_env, url) => report(Number(String(url).match(/faction\/(\d+)/)![1])));
    await runRankedResearchTick(env);
    expect(row(id).requests).toBe(120);
    expect(db.prepare('SELECT MAX(n) AS n FROM (SELECT COUNT(*) AS n FROM ranked_research_attempts GROUP BY owner_id)').get()?.n).toBeLessThanOrEqual(20);
    expect(readAvailableTornApiKeys).toHaveBeenCalledTimes(1);
  });
  it('honours a manual pause even when a temporary request failure arrives afterwards', async () => {
    const id = await create(); await call(`/${id}/resume`, {});
    vi.mocked(fetchTrackedTornJson).mockImplementation(async () => { await call(`/${id}/pause`, {}); throw new Error('timeout'); });
    await runRankedResearchTick(env);
    expect(row(id)).toMatchObject({ status: 'paused', retry_at: 0 });
    advance(120); await runRankedResearchTick(env);
    expect(fetchTrackedTornJson).toHaveBeenCalledTimes(1);
  });
  it('preserves frozen unresolved details even when another run later caches the report', async () => {
    const id = await create(); await call(`/${id}/resume`, {});
    const malformed = report(); malformed.rankedwarreport.end = 0;
    vi.mocked(fetchTrackedTornJson).mockResolvedValueOnce(listing()).mockResolvedValueOnce(malformed);
    await runRankedResearchTick(env); await call(`/${id}/pause`, {}); await call(`/${id}/freeze`, {});
    expect(await (await call(`/${id}/export`)).json()).toMatchObject({ dataset: { collection: { deferred_reports: 1, failed_reports: 0, pending_reports: 1 } }, reports: [] });
    const other = await create(); await call(`/${other}/resume`, {});
    vi.mocked(fetchTrackedTornJson).mockResolvedValueOnce(listing()).mockResolvedValueOnce(report());
    await runRankedResearchTick(env);
    expect(await (await call(`/${id}/health`)).json()).toMatchObject({ health: { issue_count: 1, issues: [{ war_id: 123 }] } });
    expect(await (await call(`/${id}/export`)).json()).toMatchObject({ reports: [] });
  });
  it('reports recent call pace, remaining budget and report reuse without Torn reads', async () => {
    const id = await create(100); await call(`/${id}/resume`, {});
    vi.mocked(fetchTrackedTornJson).mockResolvedValueOnce(listing()).mockResolvedValueOnce(report());
    await runRankedResearchTick(env);
    const other = await create(100); await call(`/${other}/resume`, {});
    vi.mocked(fetchTrackedTornJson).mockResolvedValueOnce(listing()); await runRankedResearchTick(env);
    expect(await (await call()).json()).toMatchObject({ runs: expect.arrayContaining([expect.objectContaining({ id: other, reused: 1, reports: 1, eligible: 1 })]) });
    expect(await (await call(`/${id}/health`)).json()).toMatchObject({ health: { requests_last_minute: 2, requests_last_five_minutes: 2, remaining_budget: 98, budget_minutes: null, opted_in_owners: 1 } });
    expect(fetchTrackedTornJson).toHaveBeenCalledTimes(3);
    advance(301);
    expect(await (await call(`/${id}/health`)).json()).toMatchObject({ health: { requests_last_minute: 0, requests_last_five_minutes: 0, budget_minutes: null } });
  });
  it('paginates all unresolved issue details and rejects invalid health cursors', async () => {
    const id = await create();
    for (let i = 1; i <= 105; i++) {
      db.prepare('INSERT INTO ranked_research_reports(war_id, start, end) VALUES (?, ?, ?)').run(i, start, start + 3600);
      db.prepare('INSERT INTO ranked_research_report_retries(run_id, war_id, failures, next_attempt_at, last_error) VALUES (?, ?, 1, 0, ?)').run(id, i, 'Invalid totals');
    }
    const first = (await (await call(`/${id}/health`)).json() as { health: ResearchHealth }).health;
    expect(first).toMatchObject({ issue_count: 105, next_issue: 100 });
    expect(first.issues).toHaveLength(100);
    const last = (await (await call(`/${id}/health?after=100`)).json() as { health: ResearchHealth }).health;
    expect(last.issues.map(i => i.war_id)).toEqual([101, 102, 103, 104, 105]);
    expect(last.next_issue).toBeNull();
    expect((await call(`/${id}/health?after=-1`)).status).toBe(400);
    expect((await call(`/${id}/health`, {})).status).toBe(405);
    expect(fetchTrackedTornJson).not.toHaveBeenCalled();
  });
  it('pauses on an unexpected listing and counts the response as failed', async () => {
    const id = await create(); await call(`/${id}/resume`, {});
    vi.mocked(fetchTrackedTornJson).mockResolvedValue({ raw: 'unexpected HTML' });
    const cursor = row(id).cursor;
    await runRankedResearchTick(env);
    expect(row(id)).toMatchObject({ status: 'paused', cursor, requests: 1 });
    expect(await (await call(`/${id}/health`)).json()).toMatchObject({ health: { failures_last_five_minutes: 1 } });
  });
  it('rotates eligible runs and leaves a backed-off run waiting', async () => {
    const a = await create(100); await call(`/${a}/resume`, {});
    advance(1);
    const b = await create(100); await call(`/${b}/resume`, {});
    vi.mocked(fetchTrackedTornJson).mockResolvedValueOnce({ error: { code: 17 } }).mockResolvedValueOnce(listing([]));
    await runRankedResearchTick(env);
    expect(row(a).consecutive_failures).toBe(1);
    await runRankedResearchTick(env);
    expect(row(b).status).toBe('complete');
    expect(row(a)).toMatchObject({ status: 'running', requests: 1 });
  });
  it('adds coverage metadata without changing existing frozen runs', () => {
    const legacy = new DatabaseSync(':memory:');
    try {
      legacy.exec(readFileSync(new URL('../migrations/0176_ranked_war_research.sql', import.meta.url), 'utf8'));
      legacy.prepare(`INSERT INTO ranked_research_runs(id, name, start_date, end_date, from_ts, to_ts, request_limit, status, snapshot_token, created_at)
        VALUES ('old', 'Old sample', '2026-09-01', '2026-09-30', 1, 2, 100, 'frozen', 'old-snapshot', 1)`).run();
      legacy.exec(readFileSync(new URL('../migrations/0177_ranked_research_coverage.sql', import.meta.url), 'utf8'));
      expect(legacy.prepare("SELECT status, snapshot_token, collection_json FROM ranked_research_runs WHERE id = 'old'").get())
        .toMatchObject({ status: 'frozen', snapshot_token: 'old-snapshot', collection_json: null });
    } finally { legacy.close(); }
  });
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
    const exported = await (await call(`/${id}/export`)).json() as { reports: unknown[]; dataset: { collection: unknown } };
    expect(exported.reports).toHaveLength(2);
    expect(exported.dataset.collection).toEqual({ discovery_done: true, discovered_wars: 2, saved_reports: 2, pending_reports: 0, deferred_reports: 0, failed_reports: 0 });
    expect((await call(`/${id}/resume`, { budget: 10 })).status).toBe(400);
    expect((await call(`/${id}/import`, { reports: [report(125)] })).status).toBe(404);
  });
  it('rejects raw report imports without writing reports or calling Torn', async () => {
    const id = await create();
    const unfinished = report(); unfinished.rankedwarreport.end = 0;
    for (const data of [report(), unfinished]) {
      expect((await call(`/${id}/import`, { reports: [data] })).status).toBe(404);
    }
    expect(db.prepare('SELECT COUNT(*) AS n FROM ranked_research_reports').get()).toMatchObject({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM ranked_research_run_wars').get()).toMatchObject({ n: 0 });
    expect(fetchTrackedTornJson).not.toHaveBeenCalled();
  });
  it('automatically retries unfinished reports after a persisted delay', async () => {
    const id = await create(); await call(`/${id}/resume`, {});
    const unfinished = report(); unfinished.rankedwarreport.end = 0;
    vi.mocked(fetchTrackedTornJson)
      .mockResolvedValueOnce({ warfareranked: [{ id: 123, start, end: start + 3600 }], _metadata: { links: { next: null } } })
      .mockResolvedValueOnce(unfinished);
    await runRankedResearchTick(env);
    expect(row(id)).toMatchObject({ status: 'running', requests: 2 });
    expect(db.prepare('SELECT last_error FROM ranked_research_report_retries WHERE run_id = ?').get(id)?.last_error).toContain('unfinished');
    expect(db.prepare('SELECT report_json, classification FROM ranked_research_reports WHERE war_id = 123').get())
      .toMatchObject({ report_json: null, classification: null });
    await runRankedResearchTick(env);
    expect(fetchTrackedTornJson).toHaveBeenCalledTimes(2);
    advance(61);
    vi.mocked(fetchTrackedTornJson).mockResolvedValueOnce(report());
    await runRankedResearchTick(env);
    expect(row(id)).toMatchObject({ status: 'complete', requests: 3 });
    expect(db.prepare('SELECT classification FROM ranked_research_reports WHERE war_id = 123').get()).toMatchObject({ classification: 'eligible' });
    expect(fetchTrackedTornJson).toHaveBeenCalledTimes(3);
  });
  it('counts failed attempts and backs off without leaking the upstream key/error', async () => {
    const id = await create(); await call(`/${id}/resume`, {});
    vi.mocked(fetchTrackedTornJson).mockRejectedValue(new Error('secret API key in upstream error'));
    await runRankedResearchTick(env);
    expect(row(id)).toMatchObject({ requests: 1, status: 'running', consecutive_failures: 1, lease_until: 0 });
    expect(String(row(id).message)).not.toContain('secret');
    expect(db.prepare('SELECT request_count FROM torn_api_key_usage_windows').get()).toMatchObject({ request_count: 1 });
  });
  it('shares the research cap across keys with the same owner, but allows another owner', async () => {
    const id = await create(100); await call(`/${id}/resume`, {});
    const now = Math.floor(Date.now() / 1000);
    db.prepare("UPDATE ranked_research_runs SET lease_token = 'lease', lease_until = ? WHERE id = ?").run(now + 100, id);
    addKey('key2'); addKey('key3', 2);
    for (let i = 0; i < 20; i++) expect(await reserveResearchAttempt(env, id, 'lease', candidate(i % 2 ? 'key2' : 'key1'), now)).toBe(true);
    expect(await reserveResearchAttempt(env, id, 'lease', candidate('key2'), now)).toBe(false);
    expect(await reserveResearchAttempt(env, id, 'lease', candidate('key3'), now)).toBe(true);
    expect(await reserveResearchAttempt(env, id, 'wrong-lease', candidate('key3'), now)).toBe(false);
  });
  it('counts in-flight reservations against owner-wide headroom before logs arrive', async () => {
    const id = await create(100); await call(`/${id}/resume`, {});
    const now = Math.floor(Date.now() / 1000);
    db.prepare("UPDATE ranked_research_runs SET lease_token = 'lease', lease_until = ? WHERE id = ?").run(now + 100, id);
    for (let i = 0; i < 49; i++) db.prepare(`INSERT INTO torn_api_call_log(requested_at, feature, key_source, method, endpoint, duration_ms)
      VALUES (?, 'live', 'key_pool:key1', 'GET', 'faction', 1)`).run(now);
    const results = await Promise.all(Array.from({ length: 4 }, () => reserveResearchAttempt(env, id, 'lease', candidate(), now)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(row(id).requests).toBe(1);
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
    const id = await create(2);
    const listing = { warfareranked: [123, 124].map(id => ({ id, start, end: start + 3600 })), _metadata: { links: { next: null } } };
    await call(`/${id}/resume`, {});
    vi.mocked(fetchTrackedTornJson).mockResolvedValueOnce(listing).mockResolvedValueOnce(report());
    await runRankedResearchTick(env);
    await call(`/${id}/freeze`, {});
    const other = await create(); await call(`/${other}/resume`, {});
    vi.mocked(fetchTrackedTornJson).mockResolvedValueOnce(listing).mockResolvedValueOnce(report(124));
    await runRankedResearchTick(env);
    expect(row(other)).toMatchObject({ status: 'complete', requests: 2 });
    const frozen = await (await call(`/${id}/export`)).json() as { reports: unknown[]; dataset: { collection: unknown } };
    expect(frozen.reports).toEqual([report()]);
    expect(frozen.dataset.collection).toEqual({ discovery_done: true, discovered_wars: 2, saved_reports: 1, pending_reports: 1, deferred_reports: 0, failed_reports: 0 });
    expect(fetchTrackedTornJson).toHaveBeenCalledTimes(4);
  });
  it('records incomplete discovery and keeps legacy completeness unknown', async () => {
    const id = await create(); await call(`/${id}/freeze`, {});
    const empty = await (await call(`/${id}/export`)).json() as { dataset: { collection: unknown } };
    expect(empty.dataset.collection).toEqual({ discovery_done: false, discovered_wars: 0, saved_reports: 0, pending_reports: 0, deferred_reports: 0, failed_reports: 0 });
    db.prepare('UPDATE ranked_research_runs SET collection_json = NULL WHERE id = ?').run(id);
    expect(await (await call(`/${id}/export`)).json()).toMatchObject({ dataset: { collection: null } });
  });
  it('collects subsequent pages when Torn lowercases the pagination sort', async () => {
    const id = await create(); await call(`/${id}/resume`, {});
    const first = listing();
    first._metadata.links.next = `https://api.torn.com/v2/faction/warfareranked?from=${start}&to=${row(id).to_ts}&sort=asc&limit=100&offset=100&key=secret`;
    vi.mocked(fetchTrackedTornJson)
      .mockResolvedValueOnce(first).mockResolvedValueOnce(report())
      .mockResolvedValueOnce(listing([124])).mockResolvedValueOnce(report(124));
    await runRankedResearchTick(env);
    expect(row(id)).toMatchObject({ status: 'complete', requests: 4, discovery_done: 1, cursor: null });
    expect(db.prepare('SELECT war_id FROM ranked_research_reports WHERE report_json IS NOT NULL ORDER BY war_id').all())
      .toEqual([{ war_id: 123 }, { war_id: 124 }]);
    const nextRequest = String(vi.mocked(fetchTrackedTornJson).mock.calls[2][1]);
    expect(nextRequest).toContain('sort=ASC');
    expect(nextRequest).toContain('offset=100');
    expect(nextRequest).not.toContain('secret');
    expect(JSON.stringify(db.prepare('SELECT cursor FROM ranked_research_cursors').all())).not.toContain('secret');
  });
  it.each(['ASC', 'asc', 'Asc'])('normalizes %s pagination without changing its bounds or offset', sort => {
    const bounds = { from_ts: start, to_ts: start + 86400 };
    const url = `https://api.torn.com/v2/faction/warfareranked?from=${start}&to=${bounds.to_ts}&sort=${sort}&offset=100`;
    expect(researchNextCursor(url, bounds)).toBe(`https://api.torn.com/v2/faction/warfareranked?from=${start}&to=${bounds.to_ts}&sort=ASC&limit=100&offset=100`);
  });
  it.each(['DESC', 'desc', '', 'unexpected'])('still rejects unsafe pagination order %s', sort => {
    const bounds = { from_ts: start, to_ts: start + 86400 };
    const url = `https://api.torn.com/v2/faction/warfareranked?from=${start}&to=${bounds.to_ts}${sort ? `&sort=${sort}` : ''}`;
    expect(() => researchNextCursor(url, bounds)).toThrow('Unexpected pagination order.');
  });
  it('preserves tie offsets, strips credentials, rejects external/repeated/missing cursors', async () => {
    const bounds = { from_ts: start, to_ts: start + 86400 };
    const url = `https://api.torn.com/v2/faction/warfareranked?from=${start}&to=${start + 86400}&sort=ASC&offset=100&key=secret`;
    expect(researchNextCursor(url, bounds)).toContain('offset=100');
    expect(researchNextCursor(url, bounds)).not.toContain('secret');
    expect(() => researchNextCursor(url.replace('api.torn.com', 'evil.test'), bounds)).toThrow();
    expect(() => researchNextCursor(url.replace(`to=${bounds.to_ts}`, `to=${bounds.to_ts + 1}`), bounds)).toThrow('Pagination left the selected date range.');
    expect(() => researchNextCursor(undefined, bounds)).toThrow();
    const id = await create(); await call(`/${id}/resume`, {});
    vi.mocked(fetchTrackedTornJson).mockResolvedValue({ ...listing(), _metadata: { links: { next: String(row(id).cursor).replace('sort=ASC', 'sort=asc') + '&key=secret' } } });
    await runRankedResearchTick(env);
    expect(row(id).status).toBe('paused'); expect(String(row(id).message)).toContain('repeated');
  });
  it('completes an empty final page whose next link points to itself', async () => {
    const id = await create(); await call(`/${id}/resume`, {});
    vi.mocked(fetchTrackedTornJson).mockResolvedValue({ ...listing([]), _metadata: { links: { next: String(row(id).cursor).replace('sort=ASC', 'sort=asc') } } });
    await runRankedResearchTick(env);
    expect(row(id)).toMatchObject({ status: 'complete', requests: 1, discovery_done: 1, cursor: null });
    expect(fetchTrackedTornJson).toHaveBeenCalledTimes(1);
  });
  it('finishes a short boundary-only final page, deduplicating old wars and saving new ones', async () => {
    const id = await create(); await call(`/${id}/resume`, {});
    const cursor = `https://api.torn.com/v2/faction/warfareranked?from=${start}&to=${row(id).to_ts}&sort=ASC&limit=100`;
    const first = listing(); first._metadata.links.next = cursor;
    const last = listing([123, 124]); last._metadata.links.next = cursor.replace('sort=ASC', 'sort=asc') + '&key=secret';
    vi.mocked(fetchTrackedTornJson).mockResolvedValueOnce(first).mockResolvedValueOnce(report())
      .mockResolvedValueOnce(last).mockResolvedValueOnce(report(124));
    await runRankedResearchTick(env);
    expect(row(id)).toMatchObject({ status: 'complete', requests: 4, discovery_done: 1, cursor: null });
    expect(db.prepare('SELECT war_id FROM ranked_research_run_wars ORDER BY war_id').all()).toEqual([{ war_id: 123 }, { war_id: 124 }]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM ranked_research_reports WHERE report_json IS NOT NULL').get()?.n).toBe(2);
    expect(fetchTrackedTornJson).toHaveBeenCalledTimes(4);
  });
  it.each(['full', 'earlier cursor', 'offset', 'shortened range', 'later starts', 'duplicate IDs', 'malformed entry'])('keeps unsafe repeated pagination paused: %s', async mode => {
    const id = await create(200); await call(`/${id}/resume`, {});
    const original = String(row(id).cursor);
    let cursor = original.replace(`from=${start - 1}`, `from=${start}`);
    if (mode === 'offset') cursor += '&offset=100';
    if (mode === 'shortened range') cursor = cursor.replace(`to=${row(id).to_ts}`, `to=${start + 86400}`);
    db.prepare('UPDATE ranked_research_runs SET cursor = ? WHERE id = ?').run(cursor, id);
    const page = listing(mode === 'full' ? Array.from({ length: 100 }, (_, i) => i + 1) : mode === 'duplicate IDs' ? [123, 123] : [123]);
    page._metadata.links.next = cursor;
    if (mode === 'earlier cursor') {
      db.prepare('INSERT INTO ranked_research_cursors(run_id, cursor) VALUES (?, ?)').run(id, original);
      page.warfareranked = [];
      page._metadata.links.next = original;
    }
    if (mode === 'later starts') page.warfareranked[0].start++;
    if (mode === 'malformed entry') page.warfareranked[0].id = -1;
    vi.mocked(fetchTrackedTornJson).mockResolvedValue(page);
    await runRankedResearchTick(env);
    expect(row(id)).toMatchObject({ status: 'paused', discovery_done: 0, cursor, requests: 1 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM ranked_research_run_wars').get()?.n).toBe(0);
    expect(fetchTrackedTornJson).toHaveBeenCalledTimes(1);
  });
  it('filters using both pre-war ranks and forfeits; rejects malformed Platinum reports', () => {
    const data = report(); expect(validateResearchReport(data).classification).toBe('eligible');
    data.rankedwarreport.factions[1].rank.before = 'Gold III';
    expect(validateResearchReport(data).classification).toBe('not_platinum_vs_platinum');
    data.rankedwarreport.forfeit = true; expect(validateResearchReport(data).classification).toBe('forfeit');
    data.rankedwarreport.forfeit = false; data.rankedwarreport.factions[1].rank.before = 'Platinum V';
    expect(() => validateResearchReport(data)).toThrow();
  });
  it('saves the unsuffixed Platinum base rank without rewriting it as Platinum I', async () => {
    const id = await create(); await call(`/${id}/resume`, {});
    const data = report(); data.rankedwarreport.factions[0].rank.before = 'Platinum';
    vi.mocked(fetchTrackedTornJson).mockResolvedValueOnce(listing()).mockResolvedValueOnce(data);
    await runRankedResearchTick(env);
    expect(row(id).status).toBe('complete');
    const saved = db.prepare('SELECT report_json, classification FROM ranked_research_reports WHERE war_id = 123').get()!;
    expect(saved.classification).toBe('eligible');
    expect(JSON.parse(String(saved.report_json))).toEqual(data);
    expect(researchPlatinumLabel(0)).toBe('Platinum');
    expect(researchPlatinumLabel(1)).toBe('Platinum 1');
  });
  it('rejects noncalendar/future dates and analysis for a different snapshot', async () => {
    expect(() => researchDates('2026-02-30', '2026-03-01')).toThrow();
    expect(() => researchDates('2026-09-01', '2099-10-01')).toThrow();
    const id = await create(); await call(`/${id}/freeze`, {});
    expect((await call(`/${id}/analysis`, { snapshot_token: 'wrong', result: {} })).status).toBe(400);
  });
  it('protects every collector/read/export action with existing admin authorization', async () => {
    for (const suffix of ['', '/abc/export', '/abc/resume', '/abc/analysis', '/abc/import', '/abc/health']) {
      const request = new Request(base + suffix, suffix.endsWith('/resume') || suffix.endsWith('/import') ? { method: 'POST' } : {});
      const response = await routeAdminApi({ request, env, url: new URL(request.url), ctx: {} as ExecutionContext });
      expect([401, 403]).toContain(response!.status);
    }
    expect(fetchTrackedTornJson).not.toHaveBeenCalled();
  });
  it('validates separate observed trends, adjusted overlap and fixed score bands', () => {
    const bounds = [0, 5000, 10000, 15000, 20000, 25000, 30000, 40000, 50000, null];
    const card = { field: 'score', question: 'Score and rewards?', unit: 'score', status: 'Positive association; overlapping factors', explanation: 'Direction retained, overlapping factors.',
      observations: 80, wars: 80, factions: 40, cautions: [], observed_difference: 300, observed_percent: 300,
      observed: { status: 'Positive observed trend', explanation: 'Means and medians rise across four groups.' },
      groups: [100, 200, 300, 400].map(v => ({ label: String(v), n: 20, wars: 20, factions: 10, mean_value: v, median_value: v })),
      adjusted: { range: [100, 400], difference: 10, percent_of_mean: 4, interval: [5, 15], stable_halves: true, sensitive_to_top_faction: false, overlap_vif: 22.36 },
      score_bands: bounds.slice(0, -1).map((low, i) => ({ low, high: bounds[i+1], n: i === 0 ? 80 : 0, wars: i === 0 ? 80 : 0,
        mean_value: i === 0 ? 250 : null, median_value: i === 0 ? 250 : null, middle_half: i === 0 ? [150, 350] : null })) };
    const result = { generated_at: '2026-10-22', scope: 'Platinum', eligible_wars: 80, observations: 80, distinct_factions: 40, model_observations: 80,
      range: { start: '2026-09-01', end: '2026-09-30' }, warnings: [], prices: {}, summaries: [], model: { available: false, reason: 'Fixture' }, comparisons: [card] };
    expect(() => validateResearchAnalysis(result)).not.toThrow();
    expect(() => validateResearchAnalysis({ ...result, comparisons: [{ ...card, observed: { ...card.observed, status: 'Proven causal effect' } }] })).toThrow('observed trend');
    expect(() => validateResearchAnalysis({ ...result, comparisons: [{ ...card, adjusted: { ...card.adjusted, overlap_vif: -1 } }] })).toThrow('factor overlap');
    expect(() => validateResearchAnalysis({ ...result, comparisons: [{ ...card, score_bands: card.score_bands.slice(1) }] })).toThrow('score bands');
    expect(() => validateResearchAnalysis({ ...result, comparisons: [{ ...card, score_bands: card.score_bands.map((b, i) => i === 0 ? { ...b, n: 81 } : b) }] })).toThrow('band counts');
    expect(() => validateResearchAnalysis({ ...result, comparisons: [{ ...card, score_bands: card.score_bands.map((b, i) => i === 0 ? { ...b, high: 6000 } : b) }] })).toThrow('band sample');
    expect(() => validateResearchAnalysis({ ...result, comparisons: [{ ...card, score_bands: card.score_bands.map((b, i) => i === 1 ? { ...b, median_value: 0 } : b) }] })).toThrow('band rewards');
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
    expect(() => validateResearchAnalysis({ ...result,
      summaries: [{ division: 0, won: 1, n: 1, median_value: 10, mean_value: 10 }],
      whole_war: { ...whole, summaries: [{ winner_division: 0, loser_division: 1, n: 1, median_value: 10, mean_value: 10 }] },
    })).not.toThrow();
    expect(() => validateResearchAnalysis({ ...result, whole_war: { ...whole, valued_wars: 1 } })).toThrow();
    expect(() => validateResearchAnalysis({ ...result, whole_war: { ...whole, model: { available: true, effects: [{}] } } })).toThrow();
    expect((await call(`/${id}/analysis`, { snapshot_token: row(id).snapshot_token, result: { ...result, whole_war: whole } })).status).toBe(200);
    expect(await (await call(`/${id}/analysis`)).json()).toMatchObject({ analysis: { whole_war: whole } });
    const coverage = { saved_reports: 0, eligible_wars: 0, valued_wars: 0, model_wars: 0, distinct_factions: 0,
      first_saved: null, last_saved: null, collection: null, weeks: [], division_pairs: [], rosters: [], top_factions: [], warnings: [] };
    expect(() => validateResearchAnalysis({ ...result, coverage: { ...coverage, division_pairs: [{ winner_division: 0, loser_division: 1, wars: 1 }] } })).not.toThrow();
    const card = { field: 'attacks', question: 'Are more attacks associated with greater rewards?', unit: 'attacks',
      status: 'Insufficient data', explanation: 'No sample', observations: 0, wars: 0, factions: 0, groups: [],
      observed_difference: null, observed_percent: null, adjusted: null, cautions: [] };
    const evidence = { ...result, coverage, comparisons: [card], whole_war: { ...whole, comparisons: [card] } };
    expect((await call(`/${id}/analysis`, { snapshot_token: row(id).snapshot_token, result: evidence })).status).toBe(200);
    expect(await (await call(`/${id}/analysis`)).json()).toMatchObject({ analysis: evidence });
    expect(() => validateResearchAnalysis({ ...evidence, coverage: { ...coverage, collection: { discovery_done: true, discovered_wars: 1, saved_reports: 0, pending_reports: 0 } } })).toThrow();
    expect(() => validateResearchAnalysis({ ...evidence, comparisons: [{ ...card, groups: [null] }] })).toThrow();
    expect(() => validateResearchAnalysis({ ...evidence, comparisons: [{ ...card, observations: 1 }] })).toThrow();
    expect(() => validateResearchAnalysis({ ...evidence, whole_war: { ...whole, comparisons: [{ ...card, adjusted: { range: [1], difference: 1 } }] } })).toThrow();
    expect(() => validateResearchAnalysis({ ...evidence, coverage: { ...coverage, weeks: [{ start: '2026-02-30', end: '2026-03-01', saved: 0, eligible: 0, valued: 0, factions: 0 }] } })).toThrow();
  });
});
