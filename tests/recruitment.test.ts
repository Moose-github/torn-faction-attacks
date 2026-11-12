import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { controlRecruitmentScan, parseRecruitmentHof, readRecruitmentScan, recruitmentCandidates,
  reserveRecruitmentCall, runRecruitmentTick, saveRecruitmentPage } from '../src/recruitment';
import { importRecruitmentSnapshot, parseRecruitmentSnapshot } from '../src/recruitmentSnapshot';
import { readRecruitmentKeys } from '../src/recruitmentKeys';
import { routeRecruitmentApi } from '../src/http/recruitmentRoutes';
import { fetchTrackedTornJson } from '../src/external/torn';
import type { Env } from '../src/types';
import type { TornKeyPoolCandidate } from '../src/tornKeyPool';
import type { RouteContext } from '../src/http/context';

vi.mock('../src/external/torn', () => ({ fetchTrackedTornJson: vi.fn() }));
vi.mock('../src/tornKeyPool', async importOriginal => ({ ...await importOriginal<object>(), decryptTornApiKey: vi.fn(async value => value) }));
vi.mock('../src/auth', () => ({
  requireMember: vi.fn(async (req: Request) => req.headers.get('Authorization') ? null : Response.json({error:'Unauthorized'}, {status:401})),
  requireAdmin: vi.fn(async (req: Request) => req.headers.get('Authorization') === 'Bearer admin' ? null : Response.json({error:'Forbidden'}, {status:403})),
}));

let db: DatabaseSync;
let env: Env;
let now: number;
const candidate = (id: string): TornKeyPoolCandidate => ({ id, key: 'test-' + id, keySource: 'key_pool:' + id,
  sourceType: 'submitted', maxRequestsPerMinute: 75, currentMinuteUsage: 0, lastUsedAt: null, monitorLastUsedAt: null });
const header = 'id,name,company,job,level,faction,fed,fed_reason';
const csv = `${header}\n1,Alice,,,50,,0,\n2,Bob,,Army,20,8,0,\n3,Cara,222,,70,,0,\n4,Dan,222,Director,80,,0,\n5,Eve,,,50,,999,"Reason, with a comma"\n6,Fay,,Law,60,,0,\n`;
function hof(offset = 0, values = Array(100).fill(200000), hasNext = true) {
  return { hof: values.map((value, i) => ({ id: offset + i + 1, username: 'Player' + (offset+i+1), value, position: offset+i+1 })),
    _metadata: { links: { next: hasNext ? `https://api.torn.com/v2/torn/hof?cat=workstats&limit=100&offset=${offset+100}&key=do-not-save` : null } } };
}
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
  now = 1_800_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now*1000);
  db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  db.exec(readFileSync(new URL('../migrations/0120_create_torn_key_pool.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../migrations/0210_create_recruitment.sql', import.meta.url), 'utf8'));
  class Statement {
    constructor(readonly sql: string, readonly values: SQLInputValue[] = []) {}
    bind(...values: SQLInputValue[]) { return new Statement(this.sql, values); }
    execute() {
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
afterEach(() => { vi.restoreAllMocks(); db.close(); });

describe('HOF parsing and checkpoint safety', () => {
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
    expect(db.prepare('SELECT COUNT(*) AS n FROM recruitment_work_stats').get()!.n).toBe(100);
    expect(JSON.stringify(db.prepare('SELECT * FROM recruitment_scan').get())).not.toContain('do-not-save');
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

describe('snapshot imports and local matching', () => {
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
    await importRecruitmentSnapshot(env,csv,'2026-11-12',now);
    const matched=await recruitmentCandidates(env,new URLSearchParams());
    expect(matched).toMatchObject({total:2,matched:2,unknown:1});
    expect(matched.candidates.map(p=>p.username)).toEqual(['Alice','Bob']);
    const unknown=await recruitmentCandidates(env,new URLSearchParams({coverage:'unknown',min:'',max:'1'}));
    expect(unknown.candidates[0]).toMatchObject({player_id:6,total_work_stats:null});
    expect((await recruitmentCandidates(env,new URLSearchParams({job:'unemployed',min:'150000'}))).total).toBe(1);
    expect(fetchTrackedTornJson).not.toHaveBeenCalled();
  });
  it('keeps the old snapshot visible if an import fails and rejects older snapshots taking over', async () => {
    const original=await importRecruitmentSnapshot(env,csv,'2026-11-12',now);
    db.exec("CREATE TRIGGER fail_snapshot BEFORE INSERT ON recruitment_snapshot_players WHEN NEW.player_id=99 BEGIN SELECT RAISE(ABORT,'failed import'); END");
    await expect(importRecruitmentSnapshot(env,`${header}\n99,New,,,10,,0,`,'2026-11-12',now+1)).rejects.toThrow();
    expect(db.prepare('SELECT snapshot_id FROM recruitment_current_snapshot').get()!.snapshot_id).toBe(original.id);
    await importRecruitmentSnapshot(env,csv,'2026-11-11',now+2);
    expect(db.prepare('SELECT snapshot_id FROM recruitment_current_snapshot').get()!.snapshot_id).toBe(original.id);
  });
  it('requires member access to read and admin access to mutate', async () => {
    const route=async(path:string,method:string,token?:string,body?:string)=>{
      const request=new Request('https://test'+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body});
      return routeRecruitmentApi({request,env,url:new URL(request.url),ctx:{}} as RouteContext);
    };
    expect((await route('/api/recruitment/status','GET'))!.status).toBe(401);
    expect((await route('/api/recruitment/status','GET','member'))!.status).toBe(200);
    expect((await route('/api/recruitment/scan/start','POST','member','{}'))!.status).toBe(403);
    expect((await route('/api/recruitment/snapshot?date=2026-11-12','POST','member',csv))!.status).toBe(403);
    expect((await route('/api/recruitment/scan/start','POST','admin','{"run_id":""}'))!.status).toBe(200);
    expect(fetchTrackedTornJson).not.toHaveBeenCalled();
  });
});
