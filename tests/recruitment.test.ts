import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { controlRecruitmentScan, parseRecruitmentHof, readRecruitmentScan,
  reserveRecruitmentCall, runRecruitmentTick, saveRecruitmentPage } from '../src/recruitment';
import { saveRecruitmentSnapshot, parseRecruitmentSnapshot, refreshRecruitmentSnapshot } from '../src/recruitmentSnapshot';
import { readRecruitmentResults, rebuildRecruitmentResults } from '../src/recruitmentResults';
import { filterRecruitmentCandidates } from '../dashboard/src/utils/recruitmentCandidates';
import { readRecruitmentKeys } from '../src/recruitmentKeys';
import { routeRecruitmentApi } from '../src/http/recruitmentRoutes';
import { fetchTrackedTornJson, fetchTrackedTornResponse } from '../src/external/torn';
import type { Env } from '../src/types';
import type { TornKeyPoolCandidate } from '../src/tornKeyPool';
import type { RouteContext } from '../src/http/context';

vi.mock('../src/external/torn', () => ({ fetchTrackedTornJson: vi.fn(), fetchTrackedTornResponse: vi.fn() }));
vi.mock('../src/tornKeyPool', async importOriginal => ({ ...await importOriginal<object>(), decryptTornApiKey: vi.fn(async value => value) }));
vi.mock('../src/auth', () => ({
  requireMember: vi.fn(async (req: Request) => req.headers.get('Authorization') ? null : Response.json({error:'Unauthorized'}, {status:401})),
  requireAdmin: vi.fn(async (req: Request) => req.headers.get('Authorization') === 'Bearer admin' ? null : Response.json({error:'Forbidden'}, {status:403})),
}));

let db: DatabaseSync;
let env: Env;
let now: number;
let executedSql: string[];
const candidate = (id: string): TornKeyPoolCandidate => ({ id, key: 'test-' + id, keySource: 'key_pool:' + id,
  sourceType: 'submitted', maxRequestsPerMinute: 75, currentMinuteUsage: 0, lastUsedAt: null, monitorLastUsedAt: null });
const header = 'id,name,company,job,level,faction,fed,fed_reason';
const csv = `${header}\n1,Alice,,,50,,0,\n2,Bob,,Army,20,8,0,\n3,Cara,222,,70,,0,\n4,Dan,222,Director,80,,0,\n5,Eve,,,50,,999,"Reason, with a comma"\n6,Fay,,Law,60,,0,\n`;
function hof(offset = 0, values = Array(100).fill(200000), hasNext = true) {
  return { hof: values.map((value, i) => ({ id: offset + i + 1, username: 'Player' + (offset+i+1), value, position: offset+i+1 })),
    _metadata: { links: { next: hasNext ? `https://api.torn.com/v2/torn/hof?cat=workstats&limit=100&offset=${offset+100}&key=do-not-save` : null } } };
}
// Captured offset-1000 response, with player identities replaced and key-free links.
const tiedHofPage = JSON.parse(readFileSync(new URL('./fixtures/recruitment-hof-tied-ranks.json', import.meta.url), 'utf8'));
function key(id: string, label = id, owner = Number(id.replace(/\D/g,'')) || 1) {
  db.prepare(`INSERT INTO torn_api_keys(id,label,encrypted_key,key_fingerprint,owner_torn_user_id,status,allowed_features_json,
    max_requests_per_minute,created_at,updated_at) VALUES(?,?,?,?,?,'active','[]',75,?,?)`).run(id,label,'test-'+id,id,owner,now,now);
}
async function running() {
  await controlRecruitmentScan(env, 'start', '', now);
  db.prepare('UPDATE recruitment_scan SET lease_token=?,lease_until=?').run('lease',now+90);
  return readRecruitmentScan(env);
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('caches', {default:{match:vi.fn(async()=>undefined), put:vi.fn(async()=>undefined)}});
  now = 1_800_000_000;
  executedSql = [];
  vi.spyOn(Date, 'now').mockImplementation(() => now*1000);
  db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  db.exec(readFileSync(new URL('../migrations/0002_create_torn_attack_tables.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../migrations/0120_create_torn_key_pool.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../migrations/0210_create_recruitment.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../migrations/0211_cache_recruitment_results.sql', import.meta.url), 'utf8'));
  db.exec('UPDATE recruitment_scan SET results_pending=0');
  class Statement {
    constructor(readonly sql: string, readonly values: SQLInputValue[] = []) {}
    bind(...values: SQLInputValue[]) { return new Statement(this.sql, values); }
    execute() {
      executedSql.push(this.sql);
      const before = Number(db.prepare('SELECT total_changes() AS n').get()!.n);
      const results = db.prepare(this.sql).all(...this.values);
      return { results, success: true, meta: { changes: Number(db.prepare('SELECT total_changes() AS n').get()!.n) - before } };
    }
    async first() { return this.execute().results[0] ?? null; }
    async all() { return this.execute(); }
    async run() { return this.execute(); }
  }
  env = { TORN_KEY_STORAGE_SECRET: 'test-secret', TORN_API_KEY: { get: vi.fn(() => { throw new Error('Fallback must never be read'); }) }, DB: {
    prepare: (sql: string) => new Statement(sql),
    batch: async (statements: Statement[]) => {
      db.exec('BEGIN');
      try { const results = statements.map(s => s.execute()); db.exec('COMMIT'); return results; }
      catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  } } as unknown as Env;
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close(); });

describe('HOF parsing and checkpoint safety', () => {
  it('accepts the reported page with shared position 1070 and keeps the next row offset', () => {
    const page = parseRecruitmentHof(tiedHofPage,1000);
    expect(page).toMatchObject({complete:false,nextOffset:1100});
    expect(page.players).toHaveLength(100);
    expect(page.players.slice(69,72).map(p => [p.hof_position,p.total_work_stats])).toEqual([
      [1070,833151],[1070,833151],[1072,833075],
    ]);
  });
  it('accepts ties spanning pages and continues past a full page tied at the cutoff', () => {
    const data = hof(1000,Array(100).fill(100000));
    data.hof.forEach(player => { player.position=999; });
    expect(parseRecruitmentHof(data,1000)).toMatchObject({complete:false,nextOffset:1100});
    const final = hof(1100,[100000,99999],false);
    final.hof[0].position=999;
    expect(parseRecruitmentHof(final,1100)).toMatchObject({complete:true,nextOffset:1102});
    expect(parseRecruitmentHof(final,1100).players).toHaveLength(1);
  });
  it('rejects shared ranks for different totals and invalid rank jumps', () => {
    const data = hof(1000,[200000,199999],false);
    data.hof[1].position=1001;
    expect(() => parseRecruitmentHof(data,1000)).toThrow('row 2');
    data.hof[1].position=1003;
    expect(() => parseRecruitmentHof(data,1000)).toThrow('row 2');
  });
  it('keeps the inclusive cutoff and continues past a full page tied at 100,000', () => {
    expect(parseRecruitmentHof(hof(0, Array(100).fill(100000)), 0).complete).toBe(false);
    const page = parseRecruitmentHof(hof(100, [100001,100000,99999], false),100);
    expect(page.players.map(p=>p.total_work_stats)).toEqual([100001,100000]);
    expect(page).toMatchObject({complete:true,nextOffset:103,last:99999});
  });
  it('rejects wrong pages, ascending values, unsafe numbers and untrusted pagination', () => {
    expect(()=>parseRecruitmentHof(hof(100),0)).toThrow();
    expect(()=>parseRecruitmentHof(hof(0,[100000,200000],false),0)).toThrow();
    expect(()=>parseRecruitmentHof(hof(0,[Number.MAX_SAFE_INTEGER+1],false),0)).toThrow();
    const data = hof(); data._metadata.links.next = 'https://evil.test/?offset=100';
    expect(()=>parseRecruitmentHof(data,0)).toThrow();
    const duplicate = hof(); duplicate.hof[1].id = 1;
    expect(()=>parseRecruitmentHof(duplicate,0)).toThrow();
  });
  it('saves in-flight work after pause and resumes at the saved offset', async () => {
    const scan = await running();
    await controlRecruitmentScan(env,'pause',scan.run_id,now);
    await saveRecruitmentPage(env,scan,hof(),now);
    expect(await readRecruitmentScan(env)).toMatchObject({status:'paused',next_offset:100,pages_saved:1});
    await controlRecruitmentScan(env,'resume',scan.run_id,now);
    expect(await readRecruitmentScan(env)).toMatchObject({status:'running',next_offset:100});
    expect(db.prepare('SELECT COUNT(*) AS n FROM recruitment_scan_stats').get()!.n).toBe(100);
    expect(JSON.stringify(db.prepare('SELECT * FROM recruitment_scan').get())).not.toContain('do-not-save');
  });
  it('identifies the rejected row and field without exposing raw response strings', () => {
    const data = hof(1000);
    data.hof[4].position = 1003;
    expect(() => parseRecruitmentHof(data,1000)).toThrow('HOF offset 1000, row 5: expected position 1005 or a tied rank, received 1003');
    data.hof[4].position = 1005;
    data.hof[4].value = 200001;
    expect(() => parseRecruitmentHof(data,1000)).toThrow('HOF offset 1000, row 5: work-stat total increased from 200000 to 200001');
    const malformed = {...data, hof:[{...data.hof[0], value:'secret upstream text'}]};
    expect(() => parseRecruitmentHof(malformed,1000)).toThrow('HOF offset 1000, row 1: invalid work-stat total. Saved progress retained.');
  });
  it('retains the checkpoint and staged records when a later page fails validation', async () => {
    const scan = await running();
    for (let offset=0;offset<1000;offset+=100) {
      await saveRecruitmentPage(env,await readRecruitmentScan(env),hof(offset),now);
    }
    const invalid = hof(1000);
    invalid.hof[10].position = 1012;
    await expect(saveRecruitmentPage(env,await readRecruitmentScan(env),invalid,now)).rejects.toThrow('offset 1000, row 11');
    expect(await readRecruitmentScan(env)).toMatchObject({next_offset:1000,players_saved:1000,pages_saved:10});
    expect(db.prepare('SELECT COUNT(*) AS n FROM recruitment_scan_stats').get()!.n).toBe(1000);
    await controlRecruitmentScan(env,'pause',scan.run_id,now);
    await controlRecruitmentScan(env,'resume',scan.run_id,now);
    await saveRecruitmentPage(env,await readRecruitmentScan(env),hof(1000),now);
    expect(await readRecruitmentScan(env)).toMatchObject({next_offset:1100,players_saved:1100,pages_saved:11});
  });
  it('rolls the stats and offset back together on a storage failure', async () => {
    const scan = await running();
    db.exec("CREATE TRIGGER fail_checkpoint BEFORE UPDATE OF next_offset ON recruitment_scan BEGIN SELECT RAISE(ABORT,'disk error'); END");
    await expect(saveRecruitmentPage(env,scan,hof(),now)).rejects.toThrow('disk error');
    expect(db.prepare('SELECT COUNT(*) AS n FROM recruitment_work_stats').get()!.n).toBe(0);
    expect((await readRecruitmentScan(env)).next_offset).toBe(0);
  });
  it('fences a stale worker and rejects a stale control request', async () => {
    const scan = await running();
    db.prepare('UPDATE recruitment_scan SET lease_token=?').run('replacement');
    await expect(saveRecruitmentPage(env,scan,hof(),now)).rejects.toThrow();
    expect(db.prepare('SELECT COUNT(*) AS n FROM recruitment_work_stats').get()!.n).toBe(0);
    await expect(controlRecruitmentScan(env,'pause','old-run',now)).rejects.toThrow();
  });
});

describe('pool limits and scanner lifecycle', () => {
  it('resumes the failed offset-1000 scan with the reported tied ranks and publishes all saved work', async () => {
    key('k1');
    const scan = await running();
    for(let offset=0;offset<1000;offset+=100) {
      await saveRecruitmentPage(env,await readRecruitmentScan(env),hof(offset,Array(100).fill(900000)),now);
    }
    db.exec("UPDATE recruitment_scan SET status='failed',lease_until=0");
    await controlRecruitmentScan(env,'resume',scan.run_id,now);
    vi.mocked(fetchTrackedTornJson).mockResolvedValueOnce(tiedHofPage).mockResolvedValueOnce(hof(1100,[99999],false));
    await runRecruitmentTick(env);
    expect(await readRecruitmentScan(env)).toMatchObject({status:'completed',next_offset:1101,players_saved:1100,calls_used:2});
    expect(vi.mocked(fetchTrackedTornJson).mock.calls.map(call => new URL(String(call[1])).searchParams.get('offset'))).toEqual(['1000','1100']);
    expect(db.prepare('SELECT COUNT(*) AS n FROM recruitment_work_stats').get()!.n).toBe(1100);
    expect(db.prepare('SELECT hof_position FROM recruitment_work_stats WHERE player_id IN (1070,1071)').all()).toEqual([{hof_position:1070},{hof_position:1070}]);
  });
  it('uses all active submitted keys, excludes named Fallback and never loads the environment key', async () => {
    key('k1'); key('k2',' Fallback '); key('k3','Fallback key'); key('k4'); key('k5');
    db.exec("UPDATE torn_api_keys SET status='disabled' WHERE id='k4'");
    db.prepare("UPDATE torn_api_keys SET paused_until=? WHERE id='k5'").run(now+60);
    expect((await readRecruitmentKeys(env,now)).map(k=>k.id)).toEqual(['k1']);
  });
  it('caps each key at ten in a rolling minute, including concurrent reservations and pause/resume', async () => {
    key('k1'); const scan = await running();
    const allowed = await Promise.all(Array.from({length:12},()=>reserveRecruitmentCall(env,scan,candidate('k1'),now)));
    expect(allowed.filter(Boolean)).toHaveLength(10);
    await controlRecruitmentScan(env,'pause',scan.run_id,now);
    await controlRecruitmentScan(env,'resume',scan.run_id,now);
    expect(await reserveRecruitmentCall(env,scan,candidate('k1'),now+59)).toBe(false);
    expect(await reserveRecruitmentCall(env,scan,candidate('k1'),now+60)).toBe(true);
    expect((await readRecruitmentScan(env)).calls_used).toBe(11);
  });
  it('also enforces shared pool capacity, owner capacity, pause and non-pool rejection', async () => {
    key('k1'); key('k2','Other',1); const scan = await running();
    expect(await reserveRecruitmentCall(env,scan,{...candidate('k1'),sourceType:'env'},now)).toBe(false);
    db.prepare('INSERT INTO torn_api_key_usage_windows VALUES(?,?,?)').run('k2',now,90);
    expect(await reserveRecruitmentCall(env,scan,candidate('k1'),now)).toBe(false);
    db.exec('DELETE FROM torn_api_key_usage_windows');
    db.prepare('INSERT INTO torn_api_key_usage_windows VALUES(?,?,?)').run('k1',now,75);
    expect(await reserveRecruitmentCall(env,scan,candidate('k1'),now)).toBe(false);
    db.exec('DELETE FROM torn_api_key_usage_windows');
    await controlRecruitmentScan(env,'pause',scan.run_id,now);
    expect(await reserveRecruitmentCall(env,scan,candidate('k1'),now)).toBe(false);
  });
  it('runs six keys at 60 calls, stops on pause, and advances after resume without browser polling', async () => {
    for(let i=1;i<=6;i++) key('k'+i);
    await controlRecruitmentScan(env,'start','',now);
    vi.mocked(fetchTrackedTornJson).mockImplementation(async (_env,url)=>hof(Number(new URL(String(url)).searchParams.get('offset'))));
    await runRecruitmentTick(env);
    expect(fetchTrackedTornJson).toHaveBeenCalledTimes(60);
    expect(await readRecruitmentScan(env)).toMatchObject({next_offset:6000,calls_used:60,players_saved:6000});
    await runRecruitmentTick(env);
    expect(fetchTrackedTornJson).toHaveBeenCalledTimes(60);
    const scan=await readRecruitmentScan(env);
    await controlRecruitmentScan(env,'pause',scan.run_id,now); now+=61;
    await runRecruitmentTick(env); expect(fetchTrackedTornJson).toHaveBeenCalledTimes(60);
    await controlRecruitmentScan(env,'resume',scan.run_id,now);
    vi.mocked(fetchTrackedTornJson).mockResolvedValue(hof(6000,[100000,99999],false));
    await runRecruitmentTick(env);
    expect(await readRecruitmentScan(env)).toMatchObject({status:'completed',next_offset:6002,calls_used:61,players_saved:6001});
    await runRecruitmentTick(env); expect(fetchTrackedTornJson).toHaveBeenCalledTimes(61);
  });
  it('keeps the failed offset, counts failures and backs off without leaking upstream text', async () => {
    key('k1'); await controlRecruitmentScan(env,'start','',now);
    vi.mocked(fetchTrackedTornJson).mockResolvedValue({error:{code:17,error:'secret credential'}});
    await runRecruitmentTick(env);
    expect(await readRecruitmentScan(env)).toMatchObject({next_offset:0,calls_used:1,status:'running',retry_at:now+60});
    expect((await readRecruitmentScan(env)).last_error).not.toContain('secret');
    await runRecruitmentTick(env); expect(fetchTrackedTornJson).toHaveBeenCalledTimes(1);
    now+=61; vi.mocked(fetchTrackedTornJson).mockResolvedValue(hof(0,[100000,99999],false));
    await runRecruitmentTick(env);
    expect(await readRecruitmentScan(env)).toMatchObject({status:'completed',calls_used:2});
  });
  it('pauses owner keys on rate errors and tries another owner without skipping a page', async () => {
    key('k1'); key('k2'); await controlRecruitmentScan(env,'start','',now);
    vi.mocked(fetchTrackedTornJson).mockResolvedValueOnce({error:{code:5}}).mockResolvedValueOnce(hof(0,[100000],false));
    await runRecruitmentTick(env);
    expect(fetchTrackedTornJson).toHaveBeenCalledTimes(2);
    expect(await readRecruitmentScan(env)).toMatchObject({status:'completed',next_offset:1,calls_used:2});
    expect(db.prepare("SELECT paused_until FROM torn_api_keys WHERE id='k1'").get()!.paused_until).toBe(now+120);
  });
  it('does no Torn work while idle, paused, completed, or held by another worker', async () => {
    key('k1'); await runRecruitmentTick(env);
    const scan=await running(); await runRecruitmentTick(env);
    await controlRecruitmentScan(env,'pause',scan.run_id,now); await runRecruitmentTick(env);
    expect(fetchTrackedTornJson).not.toHaveBeenCalled();
  });
});

describe('snapshot refreshes and local matching', () => {
  it('reuses today’s snapshot and result version without another Torn request or comparison', async () => {
    key('k1');
    vi.mocked(fetchTrackedTornResponse).mockResolvedValueOnce(new Response(csv));
    await refreshRecruitmentSnapshot(env);
    const first = await readRecruitmentResults(env);
    executedSql=[];
    await refreshRecruitmentSnapshot(env);
    expect((await readRecruitmentResults(env)).version).toBe(first.version);
    expect(fetchTrackedTornResponse).toHaveBeenCalledTimes(1);
    expect(executedSql.some(sql=>sql.includes('LEFT JOIN recruitment_work_stats'))).toBe(false);
  });
  it('keeps published stats stable through partial pages and publishes one new result on completion', async () => {
    db.prepare('INSERT INTO recruitment_work_stats VALUES(1,?,?,?,?)').run('Old',150000,1,now-100);
    await saveRecruitmentSnapshot(env,csv,'2026-11-12',now);
    const before=await readRecruitmentResults(env);
    const scan=await running();
    await saveRecruitmentPage(env,scan,hof(),now);
    expect((await readRecruitmentResults(env)).version).toBe(before.version);
    // A new snapshot during the scan still uses the previously published stats.
    await saveRecruitmentSnapshot(env,csv,'2026-11-12',now+1);
    expect((await readRecruitmentResults(env)).candidates[0].total_work_stats).toBe(150000);
    executedSql=[];
    await saveRecruitmentPage(env,await readRecruitmentScan(env),hof(100,[99999],false),now+2);
    expect(executedSql.filter(sql=>sql.includes('LEFT JOIN recruitment_work_stats'))).toHaveLength(1);
    const after=await readRecruitmentResults(env);
    expect(after.candidates[0].total_work_stats).toBe(200000);
    expect(after.version).toBe(before.version+2);
    expect((await readRecruitmentScan(env)).results_pending).toBe(0);
  });
  it('reads a multi-chunk saved result with one query and never compares on page reads', async () => {
    const largeCsv=header+'\n'+Array.from({length:1101},(_,i)=>`${i+1},P${i+1},,,10,,0,`).join('\n');
    await saveRecruitmentSnapshot(env,largeCsv,'2026-11-12',now);
    expect(db.prepare('SELECT COUNT(*) AS n FROM recruitment_result_chunks').get()!.n).toBe(3);
    executedSql=[];
    expect((await readRecruitmentResults(env)).candidates).toHaveLength(1101);
    expect(executedSql).toHaveLength(1);
    expect(executedSql[0]).not.toMatch(/recruitment_work_stats|recruitment_snapshot_players/);
  });
  it('recovers a failed materialization after completion without making another Torn request', async () => {
    await saveRecruitmentSnapshot(env,csv,'2026-11-12',now);
    const previous=await readRecruitmentResults(env);
    const scan=await running();
    db.exec("CREATE TRIGGER fail_result BEFORE INSERT ON recruitment_results BEGIN SELECT RAISE(ABORT,'result write failed'); END");
    await expect(saveRecruitmentPage(env,scan,hof(0,[200000,99999],false),now)).rejects.toThrow();
    expect((await readRecruitmentResults(env)).version).toBe(previous.version);
    expect(await readRecruitmentScan(env)).toMatchObject({status:'completed',results_pending:1});
    db.exec('DROP TRIGGER fail_result');
    db.exec('UPDATE recruitment_scan SET lease_until=0');
    await runRecruitmentTick(env);
    expect((await readRecruitmentResults(env)).version).toBe(previous.version+1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM recruitment_scan_stats').get()!.n).toBe(0);
    expect(fetchTrackedTornJson).not.toHaveBeenCalled();
  });
  it('serves authenticated cached results without D1 version checks', async () => {
    await saveRecruitmentSnapshot(env,csv,'2026-11-12',now);
    const version=(await readRecruitmentResults(env)).version;
    const request=new Request(`https://cache-test/api/recruitment/candidates?version=${version}`,{headers:{Authorization:'Bearer member'}});
    const context={request,env,url:new URL(request.url),ctx:{waitUntil:()=>undefined}} as unknown as RouteContext;
    executedSql=[];
    expect((await routeRecruitmentApi(context))!.status).toBe(200);
    expect(executedSql).toHaveLength(1);
    executedSql=[];
    expect((await routeRecruitmentApi(context))!.status).toBe(200);
    expect(executedSql).toHaveLength(0);
  });
  it('handles CSV quoting, city jobs, directors, unemployment and fed exclusions', () => {
    const parsed=parseRecruitmentSnapshot(csv);
    expect(parsed).toMatchObject({total_players:6,unemployed:1,city_jobs:2,excluded_fed:1});
    expect(parsed.players.map(p=>p.player_id)).toEqual([1,2,6]);
    expect(parseRecruitmentSnapshot(`${header}\n7,"A ""quoted""\nname",,,12,,0,`).players[0].username).toBe('A "quoted"\nname');
    expect(()=>parseRecruitmentSnapshot(csv+'1,Duplicate,,,10,,0,\n')).toThrow('duplicate');
    expect(()=>parseRecruitmentSnapshot(`${header}\n7,A,,Unknown,12,,0,`)).toThrow('Unknown city job');
  });
  it('joins by ID, uses current names, keeps unknowns explicit and filters without Torn calls', async () => {
    const scan=await running(); await saveRecruitmentPage(env,scan,hof(0,[200000,100000,99999],false),now);
    await saveRecruitmentSnapshot(env,csv,'2026-11-12',now);
    const matched=await readRecruitmentResults(env);
    expect(matched).toMatchObject({total:3,matched:2,unknown:1});
    expect(matched.candidates.map(p=>p.username)).toEqual(['Alice','Bob','Fay']);
    const unknown=filterRecruitmentCandidates(await readRecruitmentResults(env),{coverage:'unknown',job:'all',min:'',max:'1',q:''},0);
    expect(unknown.candidates[0]).toMatchObject({player_id:6,total_work_stats:null});
    expect((filterRecruitmentCandidates(await readRecruitmentResults(env),{job:'unemployed',min:'150000',coverage:'matched',max:'',q:''},0)).total).toBe(1);
    expect(fetchTrackedTornJson).not.toHaveBeenCalled();
    expect(fetchTrackedTornResponse).not.toHaveBeenCalled();
  });
  it('keeps the old snapshot visible if saving fails and rejects older snapshots taking over', async () => {
    const original=await saveRecruitmentSnapshot(env,csv,'2026-11-12',now);
    db.exec("CREATE TRIGGER fail_snapshot BEFORE INSERT ON recruitment_snapshot_players WHEN NEW.player_id=99 BEGIN SELECT RAISE(ABORT,'failed import'); END");
    await expect(saveRecruitmentSnapshot(env,`${header}\n99,New,,,10,,0,`,'2026-11-12',now+1)).rejects.toThrow();
    expect(db.prepare('SELECT snapshot_id FROM recruitment_current_snapshot').get()!.snapshot_id).toBe(original.id);
    await saveRecruitmentSnapshot(env,csv,'2026-11-11',now+2);
    expect(db.prepare('SELECT snapshot_id FROM recruitment_current_snapshot').get()!.snapshot_id).toBe(original.id);
  });
  it('fetches candidates directly from Torn with one pool call, sharing the HOF limit and excluding Fallback', async () => {
    key('k1'); key('k2','Fallback key');
    const scan=await running();
    await saveRecruitmentPage(env,scan,hof(),now);
    vi.mocked(fetchTrackedTornResponse).mockResolvedValueOnce(new Response(csv,{headers:{'Content-Type':'text/csv'}}));
    await refreshRecruitmentSnapshot(env);
    expect(fetchTrackedTornResponse).toHaveBeenCalledExactlyOnceWith(env,
      `https://api.torn.com/v2/user/snapshot?timestamp=${now}`,
      {headers:{Authorization:'ApiKey test-k1'}},
      {feature:'company_recruitment',keySource:'key_pool:k1',timeoutMs:15000});
    expect(await readRecruitmentResults(env)).toMatchObject({total:3,matched:0,unknown:3});
    const savedScan=await readRecruitmentScan(env);
    expect(savedScan).toMatchObject({calls_used:0,next_offset:100,status:'running'});
    for(let i=0;i<9;i++) expect(await reserveRecruitmentCall(env,savedScan,candidate('k1'),now)).toBe(true);
    expect(await reserveRecruitmentCall(env,savedScan,candidate('k1'),now)).toBe(false);
  });
  it('allows only one concurrent candidate refresh and makes no requests when key capacity is exhausted', async () => {
    key('k1');
    vi.mocked(fetchTrackedTornResponse).mockResolvedValueOnce(new Response(csv));
    const refreshes=await Promise.allSettled([refreshRecruitmentSnapshot(env),refreshRecruitmentSnapshot(env)]);
    expect(refreshes.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect(fetchTrackedTornResponse).toHaveBeenCalledTimes(1);
    now+=86400;
    db.prepare('INSERT INTO torn_api_key_usage_windows VALUES(?,?,?)').run('k1',now,75);
    await expect(refreshRecruitmentSnapshot(env)).rejects.toThrow('No pool key has capacity');
    expect(fetchTrackedTornResponse).toHaveBeenCalledTimes(1);
  });
  it.each([200,429,503])('preserves candidates after a failed snapshot response (HTTP %s)', async status => {
    key('k1');
    const original=await saveRecruitmentSnapshot(env,csv,'2026-11-12',now);
    vi.mocked(fetchTrackedTornResponse).mockResolvedValueOnce(new Response(JSON.stringify({error:{code:status===429?5:17,error:'upstream secret'}}),{status}));
    await expect(refreshRecruitmentSnapshot(env)).rejects.toThrow('Saved candidates are unchanged');
    expect(db.prepare('SELECT snapshot_id FROM recruitment_current_snapshot').get()!.snapshot_id).toBe(original.id);
    expect(db.prepare('SELECT COUNT(*) AS n FROM recruitment_attempts').get()!.n).toBe(1);
    expect(JSON.stringify(db.prepare('SELECT last_error FROM torn_api_keys').get())).not.toContain('upstream secret');
    if(status===429) expect(db.prepare('SELECT paused_until FROM torn_api_keys').get()!.paused_until).toBe(now+120);
  });
  it('rejects malformed and oversized API snapshots without changing saved candidates', async () => {
    key('k1');
    const original=await saveRecruitmentSnapshot(env,csv,'2026-11-12',now);
    vi.mocked(fetchTrackedTornResponse).mockResolvedValueOnce(new Response('<html>Unavailable</html>'));
    await expect(refreshRecruitmentSnapshot(env)).rejects.toThrow('expected player snapshot');
    now+=120;
    vi.mocked(fetchTrackedTornResponse).mockResolvedValueOnce(new Response(csv,{headers:{'Content-Length':String(21*1024*1024)}}));
    await expect(refreshRecruitmentSnapshot(env)).rejects.toThrow('supported size');
    expect(db.prepare('SELECT snapshot_id FROM recruitment_current_snapshot').get()!.snapshot_id).toBe(original.id);
  });
  it('requires member access to read and admin access to mutate', async () => {
    const route=async(path:string,method:string,token?:string,body?:string)=>{
      const request=new Request('https://test'+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body});
      return routeRecruitmentApi({request,env,url:new URL(request.url),ctx:{waitUntil:()=>undefined}} as unknown as RouteContext);
    };
    expect((await route('/api/recruitment/status','GET'))!.status).toBe(401);
    expect((await route('/api/recruitment/status','GET','member'))!.status).toBe(200);
    expect((await route('/api/recruitment/scan/start','POST','member','{}'))!.status).toBe(403);
    expect((await route('/api/recruitment/candidates/refresh','POST','member'))!.status).toBe(403);
    expect((await route('/api/recruitment/snapshot?date=2026-11-12','POST','admin',csv))!.status).toBe(404);
    expect((await route('/api/recruitment/scan/start','POST','admin','{"run_id":""}'))!.status).toBe(200);
    expect(fetchTrackedTornJson).not.toHaveBeenCalled();
    expect(fetchTrackedTornResponse).not.toHaveBeenCalled();
    key('k1');
    vi.mocked(fetchTrackedTornResponse).mockResolvedValueOnce(new Response(csv));
    expect((await route('/api/recruitment/candidates/refresh','POST','admin'))!.status).toBe(200);
    expect(fetchTrackedTornResponse).toHaveBeenCalledTimes(1);
  });
});
