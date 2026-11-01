import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyIncrementalWarSummaries, rebuildWarStatsFromRaw, refreshPendingWarSummaries } from "../src/warStats";
import type { Env } from "../src/types";

const schema = readFileSync(new URL("../schema/current.sql", import.meta.url), "utf8");
let db: DatabaseSync;
let env: Env;
let nextId: number;
function statement(sql: string, values: SQLInputValue[] = []) {
  const runSync = () => ({ success: true, meta: { changes: Number(db.prepare(sql).run(...values).changes) } });
  return {
    sql, values,
    bind: (...args: SQLInputValue[]) => statement(sql, args),
    first: async () => db.prepare(sql).get(...values) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...values) }),
    run: async () => runSync(), runSync,
  };
}
function attack(overrides: Record<string, SQLInputValue> = {}) {
  const row = { id: ++nextId, war_id: 1, started: 1500, ended: 1501,
    attacker_id: 10, attacker_name: "Member", attacker_faction_id: 8803,
    defender_id: 20, defender_name: "Enemy", defender_faction_id: 99,
    result: "Attacked", respect_gain: 4, chain: 1, m_fair_fight: 2, ...overrides };
  db.prepare(`INSERT INTO attacks (${Object.keys(row)}) VALUES (${Object.keys(row).map(() => "?")})`).run(...Object.values(row));
  return row.id;
}
const incoming = { attacker_id: 20, attacker_faction_id: 99, defender_id: 10, defender_faction_id: 8803 };
function snapshot(warId = 1) {
  const summary = { ...db.prepare("SELECT * FROM war_summary WHERE war_id=?").get(warId) };
  delete summary.updated_at;
  return {
    members: db.prepare("SELECT * FROM war_member_stats WHERE war_id=? ORDER BY member_id").all(warId),
    buckets: db.prepare("SELECT * FROM war_member_combat_buckets WHERE war_id=? ORDER BY member_id,bucket_start").all(warId),
    summary,
  };
}
async function matchesRaw(warId = 1) {
  const actual = snapshot(warId);
  await rebuildWarStatsFromRaw(env, { scope: "single-war", warId, reason: "admin" });
  expect(actual).toEqual(snapshot(warId));
}
beforeEach(() => {
  nextId = 0;
  db = new DatabaseSync(":memory:");
  db.exec(schema);
  env = { DB: { prepare: statement, batch: async (items: ReturnType<typeof statement>[]) => {
    db.exec("BEGIN");
    try { const results = items.map(item => item.runSync()); db.exec("COMMIT"); return results; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  } } } as unknown as Env;
  db.exec(`INSERT INTO wars (id,name,status,war_type,enemy_faction_id,practical_start_time,practical_finish_time)
    VALUES (1,'Normal','active','real',99,1000,10000), (2,'Ended','ended','real',99,1000,10000);`);
});
afterEach(() => { vi.restoreAllMocks(); db.close(); });

describe("durable war corrections", () => {
  it.each([
    "UPDATE attacks SET respect_gain=12, m_fair_fight=3, m_retaliation=2 WHERE id=1",
    "UPDATE attacks SET attacker_id=11, attacker_name='Renamed', started=2800, ended=2801 WHERE id=1",
    "UPDATE attacks SET defender_id=11, defender_name='Renamed' WHERE id=3",
    "UPDATE attacks SET result='Lost', chain=10 WHERE id=1",
    "UPDATE attacks SET attacker_faction_id=123, defender_faction_id=8803, defender_id=12 WHERE id=1",
    "UPDATE attacks SET attacker_id=NULL, attacker_faction_id=NULL, is_ranked_war=1 WHERE id=3",
    "UPDATE attacks SET respect_gain=NULL WHERE id=1",
    "UPDATE attacks SET started=NULL, ended=NULL WHERE id=1",
    "DELETE FROM attacks WHERE id IN (1,3)",
    "DELETE FROM attacks",
  ])("matches an independent raw rebuild after %s", async sql => {
    attack();
    attack({ chain: 10, respect_gain: 100, started: 2400, ended: 2401 });
    attack({ ...incoming, respect_gain: 6 });
    attack({ ...incoming, chain: 25, respect_gain: 100, started: 3000, ended: 3001 });
    await refreshPendingWarSummaries(env);
    db.exec(sql);
    await refreshPendingWarSummaries(env);
    await matchesRaw();
    expect(db.prepare("SELECT * FROM war_stats_dirty").all()).toEqual([]);
  });

  it("revalues historical bonus buckets, fallback members and legacy null timestamps immediately", async () => {
    attack({ chain: 10, respect_gain: 100, attacker_id: 11 });
    attack({ chain: 25, respect_gain: 100, attacker_id: 12, started: null, ended: null });
    attack({ ...incoming, chain: 10, respect_gain: 100, attacker_id: 22 });
    await refreshPendingWarSummaries(env);
    attack({ respect_gain: 8, started: 2800, ended: 2801 });
    attack({ ...incoming, respect_gain: 6, started: 2800, ended: 2801 });
    const prepare = vi.spyOn(env.DB, "prepare");
    await refreshPendingWarSummaries(env);
    expect(prepare.mock.calls.some(([sql]) => /AVG\(a\.respect_gain\)/.test(sql))).toBe(false);
    expect(snapshot().summary).toMatchObject({ total_respect_gain: 24, total_respect_lost: 12 });
    await matchesRaw();
  });

  it("repairs both sides of reassignment and removal, including an ended war", async () => {
    attack();
    attack({ war_id: 2, respect_gain: 8 });
    await refreshPendingWarSummaries(env);
    db.exec("UPDATE attacks SET war_id=2 WHERE id=1");
    await refreshPendingWarSummaries(env);
    await matchesRaw(1); await matchesRaw(2);
    expect(snapshot(2).summary).toMatchObject({ total_respect_gain: 12 });
    db.exec("UPDATE attacks SET war_id=NULL WHERE id=1");
    await refreshPendingWarSummaries(env);
    await matchesRaw(2);
    expect(db.prepare("SELECT status FROM wars WHERE id=2").get()?.status).toBe("ended");
  });

  it("preserves report-only members when their last raw attack is removed", async () => {
    attack(); await refreshPendingWarSummaries(env);
    db.exec("UPDATE war_member_stats SET added_from_report=1 WHERE war_id=1; DELETE FROM attacks");
    await refreshPendingWarSummaries(env);
    expect(snapshot().members).toHaveLength(1);
    expect(snapshot().members[0]).toMatchObject({ added_from_report: 1, respect_gained: 0, attacks_vs_enemy_total: 0 });
    expect(snapshot().buckets).toEqual([]);
    await matchesRaw();
  });

  it("reconciles eligibility edits once and removes obsolete buckets", async () => {
    attack(); attack({ started: 3000, ended: 3001, attacker_id: 11 });
    await refreshPendingWarSummaries(env);
    for (const sql of [
      "UPDATE wars SET practical_start_time=2000 WHERE id=1",
      "UPDATE wars SET practical_start_time=1000, practical_finish_time=2000 WHERE id=1",
      "UPDATE wars SET enemy_faction_id=123 WHERE id=1",
      "UPDATE wars SET practical_finish_time=NULL, enemy_faction_id=99 WHERE id=1",
    ]) {
      db.exec(sql);
      expect(db.prepare("SELECT * FROM war_stats_dirty WHERE member_id=-1").all()).toHaveLength(1);
      await refreshPendingWarSummaries(env); await matchesRaw();
    }
  });

  it("reconciles termed phase additions, edits and removal without a periodic rebuild", async () => {
    db.exec("UPDATE wars SET war_type='termed' WHERE id=1");
    attack(); attack({ started: 3000, ended: 3001 });
    await refreshPendingWarSummaries(env);
    for (const sql of [
      "INSERT INTO war_practical_phases (id,war_id,target,scheduled_start,start_time,finish_time,status) VALUES ('phase',1,9000,1000,1000,2000,'completed')",
      "UPDATE war_practical_phases SET finish_time=4000 WHERE id='phase'",
      "UPDATE wars SET official_end_time=2000 WHERE id=1",
      "UPDATE war_practical_phases SET removed_at=5000 WHERE id='phase'",
      "UPDATE war_practical_phases SET removed_at=NULL WHERE id='phase'",
      "DELETE FROM war_practical_phases WHERE id='phase'",
    ]) {
      db.exec(sql); await refreshPendingWarSummaries(env); await matchesRaw();
    }
  });

  it("does no historical work or writes when idle or after metadata-only updates", async () => {
    attack(); await refreshPendingWarSummaries(env);
    db.exec("UPDATE attacks SET stats_pending=0, ingest_run_id='metadata', respect_gain=respect_gain");
    db.exec("UPDATE wars SET official_home_score=100, practical_revision=1 WHERE id=1");
    const prepare = vi.spyOn(env.DB, "prepare");
    await refreshPendingWarSummaries(env);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(prepare.mock.calls[0][0]).toContain("SELECT DISTINCT war_id FROM war_stats_dirty");
  });

  it("rolls back and retries failed corrections while allowing other wars to proceed", async () => {
    attack(); attack({ war_id: 2 }); await refreshPendingWarSummaries(env);
    const before = snapshot();
    db.exec(`UPDATE attacks SET respect_gain=12;
      CREATE TRIGGER fail_summary BEFORE INSERT ON war_summary WHEN NEW.war_id=1
        BEGIN SELECT RAISE(ABORT, 'correction failure'); END;`);
    await expect(refreshPendingWarSummaries(env)).rejects.toThrow("Unable to apply queued war corrections");
    expect(snapshot()).toEqual(before);
    expect(snapshot(2).summary).toMatchObject({ total_respect_gain: 12 });
    expect(db.prepare("SELECT DISTINCT war_id FROM war_stats_dirty").all()).toEqual([{ war_id: 1 }]);
    db.exec("DROP TRIGGER fail_summary");
    await refreshPendingWarSummaries(env); await matchesRaw();
    const prepare = vi.spyOn(env.DB, "prepare");
    await applyIncrementalWarSummaries(env, 1);
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it("uses member and bucket indexes and rewrites no unrelated combat buckets", async () => {
    for (let i = 0; i < 100; i++) attack({ started: 1500 + i * 20, ended: 1501 + i * 20, attacker_id: 100 + i });
    await refreshPendingWarSummaries(env);
    db.exec(`CREATE TABLE bucket_writes(member_id INTEGER);
      CREATE TRIGGER audit_bucket_update AFTER UPDATE ON war_member_combat_buckets BEGIN INSERT INTO bucket_writes VALUES(NEW.member_id); END;
      CREATE TRIGGER audit_bucket_delete AFTER DELETE ON war_member_combat_buckets BEGIN INSERT INTO bucket_writes VALUES(OLD.member_id); END;
      UPDATE attacks SET respect_gain=8 WHERE id=1;`);
    const plans: string[] = [];
    const batch = env.DB.batch.bind(env.DB);
    vi.spyOn(env.DB, "batch").mockImplementation((async (items: ReturnType<typeof statement>[]) => {
      for (const { sql, values } of items) plans.push(...db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...values).map(row => String(row.detail)));
      return batch(items as unknown as D1PreparedStatement[]);
    }) as typeof env.DB.batch);
    await refreshPendingWarSummaries(env);
    expect(db.prepare("SELECT * FROM bucket_writes").all()).toEqual([{ member_id: 100 }]);
    expect(plans).toContainEqual(expect.stringMatching(/idx_attacks_war_attacker_started \(war_id=\? AND attacker_id=\? AND started>\? AND started<\?\)/));
    expect(plans).toContainEqual(expect.stringMatching(/idx_attacks_war_defender_started \(war_id=\? AND defender_id=\? AND started>\? AND started<\?\)/));
    expect(plans).toContainEqual(expect.stringContaining("idx_attacks_war_bonus"));
    await matchesRaw();
  });

  it("seeds existing open wars once during migration without changing raw attacks", async () => {
    attack(); await refreshPendingWarSummaries(env);
    for (const row of db.prepare("SELECT name FROM sqlite_schema WHERE type='trigger' AND name LIKE 'war_stats_%'").all()) db.exec(`DROP TRIGGER ${row.name}`);
    db.exec("DROP TABLE war_stats_dirty; DROP INDEX idx_attacks_war_bonus; DROP INDEX idx_attacks_pending_stats; UPDATE war_member_stats SET respect_gained=999 WHERE war_id=1");
    // 0192 ran while 0190's event queue existed; 0197 later merged it into war_stats_dirty.
    db.exec("CREATE TABLE event_stats_dirty (war_id INTEGER NOT NULL, member_id INTEGER NOT NULL, bucket_start INTEGER NOT NULL, PRIMARY KEY (war_id, member_id, bucket_start))");
    const raw = db.prepare("SELECT * FROM attacks").all();
    db.exec(readFileSync(new URL("../migrations/0192_war_stats_corrections.sql", import.meta.url), "utf8"));
    expect(db.prepare("SELECT * FROM attacks").all()).toEqual(raw);
    expect(db.prepare("SELECT * FROM war_stats_dirty").all()).toEqual([{ war_id: 1, member_id: -1, bucket_start: -1 }]);
    await refreshPendingWarSummaries(env); await matchesRaw();
  });
});
