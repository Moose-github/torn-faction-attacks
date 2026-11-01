import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createManualEvent, updateEvent, deleteWar } from "../src/wars";
import { initializeIndependentEvents, refreshEventTracking } from "../src/eventTracking";
import { finishEventTracking } from "../src/warLifecycle";
import { rebuildWarStatsFromRaw, applyIncrementalWarSummaries, applyIncrementalEventSummaries, refreshPendingWarSummaries } from "../src/warStats";
import { getWarAttacks, getWarMemberAttacks, getOverallStats } from "../src/warQueries";
import { exportWarAttacksCsv } from "../src/warExports";
import { relinkWarAttacks } from "../src/warRelink";
import { readChainWatchDemand } from "../src/chainWatchDemand";
import type { Env } from "../src/types";
import { memberRespectAveragesSql, respectAverageSql } from "../src/warStats/respectCounters";
import { buildHistoricalImportStatement, buildLiveInsertStatement } from "../src/ingestion";
import { auditRecentEventAttackLinks } from "../src/eventTracking";
import { EVENT_ATTACK_MATCH_SQL } from "../src/sql";
import type { TornAttack } from "../src/types";

// External collection is covered separately; these tests exercise the real SQL,
// lifecycle, summaries, and API readers using overlapping attack windows.
vi.mock("../src/chainWatchWar", () => ({ setChainWatchEnabledForWar: vi.fn() }));

const START = 1793404800;
const schema = readFileSync(new URL("../schema/current.sql", import.meta.url), "utf8");
let db: DatabaseSync;
let env: Env;
function statement(sql: string, values: SQLInputValue[] = []) {
  const runSync = () => ({ success: true, meta: { changes: Number(db.prepare(sql).run(...values).changes) } });
  return {
    sql,
    values,
    bind: (...args: SQLInputValue[]) => statement(sql, args),
    first: async () => db.prepare(sql).get(...values) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...values) }),
    run: async () => runSync(),
    runSync,
    accessedTables: () => {
      const tablesByPage = new Map(db.prepare("SELECT rootpage, tbl_name FROM sqlite_schema WHERE rootpage > 0")
        .all().map(row => [row.rootpage, row.tbl_name]));
      return [...new Set(db.prepare(`EXPLAIN ${sql}`).all(...values)
        .filter(row => ["OpenRead", "OpenWrite", "ReopenIdx"].includes(String(row.opcode)) && row.p3 === 0)
        .map(row => tablesByPage.get(row.p2)).filter(Boolean))].sort();
    },
  };
}
function request(body: unknown) {
  return new Request("https://test/api/events", { method: "POST", body: JSON.stringify(body) });
}
function globalWar() { return db.prepare("SELECT active_war_id, war_state FROM sync_state WHERE name = 'attacks'").get(); }
function ownership() { return db.prepare("SELECT id, war_id FROM attacks ORDER BY id").all(); }
function eventStats(warId: number) {
  const summary = { ...db.prepare("SELECT * FROM war_summary WHERE war_id = ?").get(warId) };
  delete summary.updated_at;
  return {
    members: db.prepare("SELECT * FROM war_member_stats WHERE war_id = ? ORDER BY member_id").all(warId),
    buckets: db.prepare("SELECT * FROM war_member_combat_buckets WHERE war_id = ? ORDER BY member_id, bucket_start").all(warId),
    summary,
  };
}
async function expectMatchesFullRebuild(warId: number) {
  const incremental = eventStats(warId);
  await rebuildWarStatsFromRaw(env, { scope: "single-war", warId, reason: "admin" });
  expect(incremental).toEqual(eventStats(warId));
}
function expectRespectCountersMatchRaw() {
  const projection = `SELECT a.war_id, 'outgoing' AS direction, COALESCE(a.attacker_id, 0) AS attacker_id, a.respect_gain
    FROM tracker_attacks a JOIN wars w ON w.id = a.war_id
    WHERE w.war_type = 'event' AND a.attacker_faction_id = 8803
      AND (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
      AND a.result IN ('Hospitalized','Mugged','Attacked','Arrested')
      AND (a.chain IS NULL OR a.chain NOT IN (10,25,50,100,250,500,1000,2500,5000,10000,25000,50000,100000))
    UNION ALL
    SELECT a.war_id, 'incoming', COALESCE(a.attacker_id, 0), a.respect_gain
    FROM tracker_attacks a JOIN wars w ON w.id = a.war_id
    WHERE w.war_type = 'event' AND a.defender_faction_id = 8803 AND a.defender_id IS NOT NULL
      AND a.result IN ('Hospitalized','Mugged','Attacked','Arrested')
      AND (a.chain IS NULL OR a.chain NOT IN (10,25,50,100,250,500,1000,2500,5000,10000,25000,50000,100000))`;
  const expected = db.prepare(`SELECT war_id, direction, attacker_id, SUM(respect_gain) AS respect_sum,
    COUNT(respect_gain) AS hit_count FROM (${projection})
    GROUP BY war_id, direction, attacker_id HAVING COUNT(respect_gain) > 0
    ORDER BY war_id, direction, attacker_id`).all();
  const actual = db.prepare(`SELECT * FROM war_respect_totals WHERE hit_count > 0
    AND war_id IN (SELECT id FROM wars WHERE war_type = 'event')
    ORDER BY war_id, direction, attacker_id`).all();
  expect(actual).toHaveLength(expected.length);
  actual.forEach((row, i) => {
    expect(row).toMatchObject({ ...expected[i], respect_sum: expect.any(Number) });
    expect(Number(row.respect_sum)).toBeCloseTo(Number(expected[i].respect_sum), 10);
  });
  expect(db.prepare("SELECT COUNT(*) AS count FROM war_respect_totals WHERE hit_count < 0 OR (hit_count = 0 AND respect_sum != 0)").get()?.count).toBe(0);
}
// attacks.event_id must always agree with the event windows, and no attack may be
// owned by an event through war_id, or tracker_attacks would list it twice.
function expectEventIdsMatchTracker() {
  expect(db.prepare("SELECT id, event_id FROM attacks WHERE event_id IS NOT NULL ORDER BY id").all())
    .toEqual(db.prepare(`SELECT a.id, w.id AS event_id FROM attacks a JOIN wars w ON ${EVENT_ATTACK_MATCH_SQL}
      ORDER BY a.id`).all());
  expect(db.prepare("SELECT id FROM attacks WHERE war_id IN (SELECT id FROM wars WHERE war_type = 'event')").all()).toEqual([]);
}
function attack(id: number, at: number, owner: number | null = 1) {
  db.prepare(`INSERT INTO attacks (id, war_id, started, ended, attacker_id, attacker_name,
    attacker_faction_id, defender_id, defender_faction_id, result, respect_gain, ingest_run_id)
    VALUES (?, ?, ?, ?, 10, 'Player', 8803, 20, 99, 'Hospitalized', 5, 'batch')`)
    .run(id, owner, at, at + 1);
}
async function create(overrides: Record<string, unknown> = {}) {
  const response = await createManualEvent(request({ name: "Halloween", event_type: "halloween",
    practical_start_time: START, practical_finish_time: START + 3600, ...overrides }), env);
  const body = await response.json() as { war_id: number; code?: string };
  expect(response.status, JSON.stringify(body)).toBe(201);
  return body.war_id;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime((START + 600) * 1000);
  db = new DatabaseSync(":memory:");
  db.exec(schema);
  env = { DB: { prepare: statement, batch: async (items: ReturnType<typeof statement>[]) => {
    db.exec("BEGIN");
    // D1 executes a batch as one transaction; do not yield between statements.
    try { const results = items.map(item => item.runSync()); db.exec("COMMIT"); return results; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  } } } as unknown as Env;
  db.prepare(`INSERT INTO wars (id, name, status, war_type, practical_start_time, enemy_faction_id, chain_watch_enabled)
    VALUES (1, 'Current war', 'active', 'real', ?, 99, 0)`).run(START - 3600);
  db.exec(`INSERT INTO sync_state (name, last_started, active_war_id, war_state) VALUES ('attacks', 0, 1, 'current');
    INSERT INTO home_faction_members (member_id, faction_id, name, is_current) VALUES (10, 8803, 'Player', 1);`);
  attack(1, START - 10);
  attack(2, START + 100);
  attack(3, START + 200, null);
});
afterEach(() => {
  try { expectEventIdsMatchTracker(); } finally { db.close(); vi.useRealTimers(); }
});

describe("independent event tracking", () => {
  it("starts Halloween over a current war, shares attacks, and leaves ownership and war totals intact", async () => {
    await rebuildWarStatsFromRaw(env, { scope: "single-war", warId: 1, reason: "admin" });
    const before = ownership();
    const warSummary = db.prepare("SELECT * FROM war_summary WHERE war_id = 1").get();
    const eventId = await create();
    expect(globalWar()).toEqual({ active_war_id: 1, war_state: "current" });
    expect(ownership()).toEqual(before);
    expect(db.prepare("SELECT * FROM war_summary WHERE war_id = 1").get()).toEqual(warSummary);
    expect(db.prepare("SELECT attacks_vs_enemy_total FROM war_summary WHERE war_id = ?").get(eventId))
      .toMatchObject({ attacks_vs_enemy_total: 2 });
    expect(db.prepare("SELECT member_id FROM event_competition_members WHERE war_id = ?").get(eventId))
      .toMatchObject({ member_id: 10 });

    attack(4, START + 300);
    await applyIncrementalWarSummaries(env, 1);
    await refreshEventTracking(env);
    expect(db.prepare("SELECT attacks_vs_enemy_total FROM war_summary WHERE war_id = 1").get())
      .toMatchObject({ attacks_vs_enemy_total: 3 });
    expect(db.prepare("SELECT attacks_vs_enemy_total FROM war_summary WHERE war_id = ?").get(eventId))
      .toMatchObject({ attacks_vs_enemy_total: 3 });
    const totals = await (await getOverallStats(new URL("https://test/api/stats?exclude_events=0"), env)).json() as any;
    expect(totals.overall.attacks_vs_enemy_total).toBe(3);
  });

  it("activates and finishes scheduled events while a war remains current", async () => {
    const eventId = await create({ practical_start_time: START + 700, practical_finish_time: START + 900, status: "scheduled" });
    expect(globalWar()).toEqual({ active_war_id: 1, war_state: "current" });
    await refreshEventTracking(env);
    expect(db.prepare("SELECT status FROM wars WHERE id = ?").get(eventId)?.status).toBe("scheduled");
    vi.setSystemTime((START + 750) * 1000);
    attack(4, START + 720);
    await refreshEventTracking(env);
    expect(db.prepare("SELECT status FROM wars WHERE id = ?").get(eventId)?.status).toBe("active");
    expect(globalWar()).toEqual({ active_war_id: 1, war_state: "current" });
    attack(5, START + 850);
    vi.setSystemTime((START + 901) * 1000);
    await refreshEventTracking(env);
    expect(db.prepare("SELECT status FROM wars WHERE id = ?").get(eventId)?.status).toBe("ended");
    expect(db.prepare("SELECT final_requested_at FROM event_competition_state WHERE war_id = ?").get(eventId)?.final_requested_at).toBe(START + 901);
    expect(db.prepare("SELECT attacks_vs_enemy_total FROM war_summary WHERE war_id = ?").get(eventId)?.attacks_vs_enemy_total).toBe(2);
    expect(globalWar()).toEqual({ active_war_id: 1, war_state: "current" });
  });

  it("updates new event buckets immediately without rewriting history on later minutes or hours", async () => {
    const eventId = await create({ practical_finish_time: START + 3 * 3600 });
    await refreshEventTracking(env);
    db.exec(`CREATE TABLE bucket_delete_audit (war_id INTEGER);
      CREATE TRIGGER audit_bucket_delete AFTER DELETE ON war_member_combat_buckets
      BEGIN INSERT INTO bucket_delete_audit VALUES (OLD.war_id); END;`);
    attack(4, START + 1800);
    for (let offset = 1800; offset < 3600; offset += 60) {
      vi.setSystemTime((START + offset) * 1000);
      await refreshEventTracking(env);
    }
    expect(db.prepare("SELECT COUNT(*) AS count FROM bucket_delete_audit").get()?.count).toBe(0);
    expect(db.prepare("SELECT attacks_vs_enemy_total FROM war_summary WHERE war_id = ?").get(eventId)?.attacks_vs_enemy_total).toBe(3);

    // Crossing an hour no longer triggers a full historical rebuild.
    vi.setSystemTime((START + 4200) * 1000);
    await refreshEventTracking(env);
    expect(db.prepare("SELECT attacks_vs_enemy_total FROM war_summary WHERE war_id = ?").get(eventId)?.attacks_vs_enemy_total).toBe(3);
    const deleted = db.prepare("SELECT COUNT(*) AS count FROM bucket_delete_audit").get()?.count;
    expect(deleted).toBe(0);
    await refreshEventTracking(env);
    expect(db.prepare("SELECT COUNT(*) AS count FROM bucket_delete_audit").get()?.count).toBe(deleted);
  });

  it("applies event changes exactly once when refreshes overlap", async () => {
    const eventId = await create();
    db.exec(`CREATE TABLE bucket_delete_audit (war_id INTEGER);
      CREATE TRIGGER audit_bucket_delete AFTER DELETE ON war_member_combat_buckets
      BEGIN INSERT INTO bucket_delete_audit VALUES (OLD.war_id); END;`);
    attack(4, START + 300);
    await Promise.all([refreshEventTracking(env), refreshEventTracking(env)]);
    expect(db.prepare("SELECT COUNT(*) AS count FROM bucket_delete_audit").get()?.count).toBe(0);
    expect(db.prepare("SELECT attacks_vs_enemy_total FROM war_summary WHERE war_id = ?").get(eventId)?.attacks_vs_enemy_total).toBe(3);
    expect(db.prepare("SELECT COUNT(*) AS count FROM war_stats_dirty WHERE war_id = ?").get(eventId)?.count).toBe(0);
  });

  it("rolls back partial updates and retains queued work for a retry", async () => {
    const eventId = await create();
    attack(4, START + 300);
    db.exec(`CREATE TRIGGER fail_rebuild BEFORE UPDATE ON war_member_combat_buckets
      BEGIN SELECT RAISE(ABORT, 'simulated rebuild failure'); END;`);
    await expect(refreshEventTracking(env)).rejects.toThrow("simulated rebuild failure");
    expect(db.prepare("SELECT attacks_vs_enemy_total FROM war_summary WHERE war_id = ?").get(eventId)?.attacks_vs_enemy_total).toBe(2);
    expect(db.prepare("SELECT COUNT(*) AS count FROM war_stats_dirty WHERE war_id = ?").get(eventId)?.count).toBeGreaterThan(0);
    db.exec("DROP TRIGGER fail_rebuild");
    await refreshEventTracking(env);
    expect(db.prepare("SELECT attacks_vs_enemy_total FROM war_summary WHERE war_id = ?").get(eventId)?.attacks_vs_enemy_total).toBe(3);
  });

  it("retries an event skipped because another rebuild held its lease", async () => {
    const eventId = await create();
    attack(4, START + 300);
    const lease = `war_stats_rebuild:${eventId}`;
    db.prepare("INSERT INTO sync_state (name, last_started, active_war_id) VALUES (?, ?, ?)")
      .run(lease, START + 600, eventId);
    await refreshEventTracking(env);
    expect(db.prepare("SELECT attacks_vs_enemy_total FROM war_summary WHERE war_id = ?").get(eventId)?.attacks_vs_enemy_total).toBe(2);
    db.prepare("DELETE FROM sync_state WHERE name = ?").run(lease);
    await refreshEventTracking(env);
    expect(db.prepare("SELECT attacks_vs_enemy_total FROM war_summary WHERE war_id = ?").get(eventId)?.attacks_vs_enemy_total).toBe(3);
  });

  it("processes late lower-ID attacks even after the war applied its queue", async () => {
    const eventId = await create();
    attack(100, START + 300);
    await applyIncrementalWarSummaries(env, 1);
    expect(db.prepare("SELECT COUNT(*) AS count FROM war_stats_dirty WHERE war_id = 1").get()?.count).toBe(0);
    await refreshEventTracking(env);
    attack(4, START + 50);
    await refreshEventTracking(env);
    expect(db.prepare("SELECT attacks_vs_enemy_total FROM war_summary WHERE war_id = ?").get(eventId)?.attacks_vs_enemy_total).toBe(4);
    await expectMatchesFullRebuild(eventId);
  });

  it("moves corrected attacks between members and buckets and removes obsolete rows", async () => {
    const eventId = await create();
    db.prepare("UPDATE attacks SET attacker_id = 11, started = ?, ended = ? WHERE id = 2").run(START + 1000, START + 1001);
    await refreshEventTracking(env);
    await expectMatchesFullRebuild(eventId);
    db.exec("DELETE FROM attacks WHERE id = 3");
    await refreshEventTracking(env);
    expect(db.prepare("SELECT member_id FROM war_member_stats WHERE war_id = ? AND member_id = 10").get(eventId)).toBeUndefined();
    await expectMatchesFullRebuild(eventId);
    // A formerly counted attack completes after the event's finish boundary.
    db.prepare("UPDATE attacks SET ended = ? WHERE id = 2").run(START + 3601);
    await refreshEventTracking(env);
    expect(db.prepare("SELECT COUNT(*) AS count FROM war_member_combat_buckets WHERE war_id = ?").get(eventId)?.count).toBe(0);
    await expectMatchesFullRebuild(eventId);
  });

  it("keeps historical outgoing and incoming bonus valuations exact as averages change", async () => {
    const eventId = await create({ practical_finish_time: START + 7200 });
    attack(4, START + 1000);
    db.exec("UPDATE attacks SET attacker_id = 11, chain = 10, respect_gain = 100 WHERE id = 4");
    attack(5, START + 1100);
    db.exec("UPDATE attacks SET attacker_faction_id = 99, defender_faction_id = 8803, attacker_id = NULL, defender_id = 12, chain = 10, respect_gain = 100 WHERE id = 5");
    await refreshEventTracking(env);
    await expectMatchesFullRebuild(eventId);
    attack(6, START + 2000);
    db.exec("UPDATE attacks SET respect_gain = 20 WHERE id = 6");
    attack(7, START + 2100);
    db.exec("UPDATE attacks SET attacker_faction_id = 99, defender_faction_id = 8803, defender_id = 13, respect_gain = 8 WHERE id = 7");
    await refreshEventTracking(env);
    expect(db.prepare("SELECT respect_gained FROM war_member_combat_buckets WHERE war_id = ? AND member_id = 11").get(eventId)?.respect_gained).toBe(10);
    expect(db.prepare("SELECT respect_lost FROM war_member_combat_buckets WHERE war_id = ? AND member_id = 12").get(eventId)?.respect_lost).toBe(8);
    await expectMatchesFullRebuild(eventId);
    db.exec("UPDATE attacks SET result = 'Lost', chain = NULL, respect_gain = 0 WHERE id = 5; DELETE FROM attacks WHERE id = 6;");
    await refreshEventTracking(env);
    await expectMatchesFullRebuild(eventId);
  });

  it("keeps zero-respect successes, assists and defenses when pruning corrected buckets", async () => {
    const eventId = await create({ practical_finish_time: START + 7200 });
    attack(4, START + 1000);
    db.exec("UPDATE attacks SET attacker_id = 11, result = 'Assist', respect_gain = 0 WHERE id = 4");
    attack(5, START + 1900);
    db.exec("UPDATE attacks SET attacker_id = 12, respect_gain = 0 WHERE id = 5");
    for (const [id, result] of [[6, null], [7, 'Lost'], [8, 'Hospitalized']] as const) {
      attack(id, START + (id - 3) * 900 + 100);
      db.prepare(`UPDATE attacks SET attacker_faction_id = 99, defender_faction_id = 8803,
        defender_id = ?, result = ?, respect_gain = 0 WHERE id = ?`).run(id + 7, result, id);
    }
    await refreshEventTracking(env);
    db.exec("UPDATE attacks SET result = 'Lost', respect_gain = 0 WHERE id IN (2, 3)");
    await refreshEventTracking(env);
    expect(db.prepare(`SELECT member_id FROM war_member_combat_buckets WHERE war_id = ? ORDER BY member_id`)
      .all(eventId)).toEqual([11, 12, 13, 14, 15].map(member_id => ({ member_id })));
    await expectMatchesFullRebuild(eventId);
  });

  it("ignores duplicate feeds and bookkeeping updates without writing event summaries", async () => {
    const eventId = await create();
    db.exec("UPDATE attacks SET stats_pending = 0, ingest_run_id = 'another-run', war_id = NULL WHERE id = 2;");
    db.exec("UPDATE attacks SET result = result, ended = ended WHERE id = 3;");
    db.exec("INSERT INTO attacks (id) VALUES (3) ON CONFLICT(id) DO NOTHING;");
    expect(db.prepare("SELECT COUNT(*) AS count FROM war_stats_dirty WHERE war_id = ?").get(eventId)?.count).toBe(0);
    const writes = db.prepare("SELECT total_changes() AS count").get()?.count;
    expect(await applyIncrementalEventSummaries(env, eventId)).toBe(false);
    expect(db.prepare("SELECT total_changes() AS count").get()?.count).toBe(writes);
  });

  it("preserves a change that arrives after an atomic update finishes", async () => {
    const eventId = await create();
    attack(4, START + 300);
    const batch = env.DB.batch.bind(env.DB);
    let injected = false;
    env.DB.batch = (async (...args: Parameters<typeof batch>) => {
      const result = await batch(...args);
      if (!injected) { injected = true; attack(5, START + 400); }
      return result;
    }) as typeof env.DB.batch;
    await applyIncrementalEventSummaries(env, eventId);
    expect(db.prepare("SELECT attacks_vs_enemy_total FROM war_summary WHERE war_id = ?").get(eventId)?.attacks_vs_enemy_total).toBe(3);
    expect(db.prepare("SELECT COUNT(*) AS count FROM war_stats_dirty WHERE war_id = ?").get(eventId)?.count).toBeGreaterThan(0);
    env.DB.batch = batch;
    await applyIncrementalEventSummaries(env, eventId);
    expect(db.prepare("SELECT attacks_vs_enemy_total FROM war_summary WHERE war_id = ?").get(eventId)?.attacks_vs_enemy_total).toBe(4);
  });

  it("incorporates attacks arriving late after finalization without reopening the event", async () => {
    const eventId = await create();
    vi.setSystemTime((START + 3601) * 1000);
    await refreshEventTracking(env);
    attack(4, START + 3500);
    await refreshEventTracking(env);
    expect(db.prepare("SELECT status FROM wars WHERE id = ?").get(eventId)?.status).toBe("ended");
    expect(db.prepare("SELECT attacks_vs_enemy_total FROM war_summary WHERE war_id = ?").get(eventId)?.attacks_vs_enemy_total).toBe(3);
    await expectMatchesFullRebuild(eventId);
  });

  it("carries pending event work into the shared queue when migrating", async () => {
    const eventId = await create();
    await refreshEventTracking(env);
    // Rebuild the pre-0197 schema: the event queue (seeded by 0190) and the 0195 indexes.
    db.exec("DROP INDEX idx_attacks_event_bonus; DROP TRIGGER war_stats_attack_event_update");
    db.exec(readFileSync(new URL("../migrations/0195_event_attack_lookup_indexes.sql", import.meta.url), "utf8"));
    db.exec(readFileSync(new URL("../migrations/0190_incremental_event_stats.sql", import.meta.url), "utf8"));
    attack(4, START + 300);
    db.exec("DELETE FROM war_stats_dirty");
    expect(db.prepare("SELECT COUNT(*) AS count FROM event_stats_dirty WHERE war_id = ?").get(eventId)?.count).toBeGreaterThan(0);
    db.exec(readFileSync(new URL("../migrations/0197_merge_event_stats_queue.sql", import.meta.url), "utf8"));
    expect(db.prepare("SELECT COUNT(*) AS count FROM war_stats_dirty WHERE war_id = ?").get(eventId)?.count).toBeGreaterThan(0);
    await refreshEventTracking(env);
    expect(db.prepare("SELECT attacks_vs_enemy_total FROM war_summary WHERE war_id = ?").get(eventId)?.attacks_vs_enemy_total).toBe(3);
    await expectMatchesFullRebuild(eventId);
  });

  it("queues an attack for its war and its event and applies both from the shared queue", async () => {
    const eventId = await create();
    await refreshEventTracking(env);
    await applyIncrementalWarSummaries(env, 1);
    attack(4, START + 300);
    expect(db.prepare("SELECT war_id, member_id FROM war_stats_dirty ORDER BY war_id, member_id").all())
      .toEqual([{ war_id: 1, member_id: 10 }, { war_id: eventId, member_id: 10 }]);
    await refreshPendingWarSummaries(env);
    expect(db.prepare("SELECT COUNT(*) AS count FROM war_stats_dirty").get()?.count).toBe(0);
    expect(db.prepare("SELECT war_id, attacks_vs_enemy_total FROM war_summary ORDER BY war_id").all())
      .toEqual([{ war_id: 1, attacks_vs_enemy_total: 3 }, { war_id: eventId, attacks_vs_enemy_total: 3 }]);
    await expectMatchesFullRebuild(eventId);
    await expectMatchesFullRebuild(1);
  });

  it("reads queued event attacks through the event_id indexes", async () => {
    const eventId = await create();
    db.exec("UPDATE attacks SET chain = 10 WHERE id = 2");
    await refreshEventTracking(env);
    db.exec("UPDATE attacks SET respect_gain = 8 WHERE id = 3");
    const plans: string[] = [];
    const batch = env.DB.batch.bind(env.DB);
    env.DB.batch = (async (items: ReturnType<typeof statement>[]) => {
      for (const { sql, values } of items) plans.push(...db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...values).map(row => String(row.detail)));
      return batch(items as unknown as D1PreparedStatement[]);
    }) as typeof env.DB.batch;
    expect(await applyIncrementalEventSummaries(env, eventId)).toBe(true);
    expect(plans).toContainEqual(expect.stringMatching(/idx_attacks_event_attacker_started \(event_id=\? AND attacker_id=\? AND started>\? AND started<\?\)/));
    expect(plans).toContainEqual(expect.stringMatching(/idx_attacks_event_defender_started \(event_id=\? AND defender_id=\? AND started>\? AND started<\?\)/));
    expect(plans).toContainEqual(expect.stringContaining("idx_attacks_event_bonus (event_id=?)"));
    expect(plans.filter(plan => /^SCAN (a|x)/.test(plan))).toEqual([]);
    await expectMatchesFullRebuild(eventId);
  });

  it("revalues fallback bonuses when an unknown outgoing attacker changes", async () => {
    const eventId = await create();
    attack(4, START + 1800);
    db.exec("UPDATE attacks SET attacker_id=11, chain=10, respect_gain=100 WHERE id=4");
    await refreshEventTracking(env);
    db.prepare(`INSERT INTO attacks (id, started, ended, attacker_id, attacker_faction_id,
      defender_id, defender_faction_id, result, respect_gain, chain)
      VALUES (5, ?, ?, NULL, 8803, 20, 99, 'Attacked', 20, 1)`).run(START + 300, START + 301);
    for (const [sql, expected] of [
      ["SELECT 1", 10],
      ["UPDATE attacks SET respect_gain=50 WHERE id=5", 20],
      ["DELETE FROM attacks WHERE id=5", 5],
    ] as const) {
      db.exec(sql);
      expect(db.prepare("SELECT * FROM war_stats_dirty WHERE war_id=? AND member_id=0 AND bucket_start=-1").all(eventId)).toHaveLength(1);
      await refreshEventTracking(env);
      expect(db.prepare("SELECT respect_gained FROM war_member_stats WHERE war_id=? AND member_id=11").get(eventId)?.respect_gained).toBe(expected);
      await expectMatchesFullRebuild(eventId);
    }
  });

  it("maintains respect counters through corrections, deleted hits and unknown attackers", async () => {
    const eventId = await create();
    expectRespectCountersMatchRaw();
    for (const [id, respect] of [[4, 0], [5, null], [6, 0.1], [7, 0.2]] as const) {
      attack(id, START + id * 100);
      db.prepare("UPDATE attacks SET respect_gain = ? WHERE id = ?").run(respect, id);
      expectRespectCountersMatchRaw();
    }
    db.exec("UPDATE attacks SET attacker_id = NULL WHERE id = 6");
    expectRespectCountersMatchRaw();
    db.exec("UPDATE attacks SET attacker_faction_id = 99, defender_faction_id = 8803, defender_id = 12 WHERE id IN (6, 7)");
    expectRespectCountersMatchRaw();
    db.exec("UPDATE attacks SET chain = 10 WHERE id = 7");
    expectRespectCountersMatchRaw();
    db.exec("UPDATE attacks SET chain = NULL, result = 'Lost' WHERE id = 7");
    expectRespectCountersMatchRaw();
    db.exec("UPDATE attacks SET result = 'Hospitalized', defender_id = NULL WHERE id = 7");
    expectRespectCountersMatchRaw();
    db.prepare("UPDATE attacks SET ended = ? WHERE id = 4").run(START + 3601);
    expectRespectCountersMatchRaw();
    db.prepare("UPDATE attacks SET ended = NULL, started = ? WHERE id = 4").run(START + 200);
    expectRespectCountersMatchRaw();
    db.exec("DELETE FROM attacks WHERE id IN (2, 3, 4, 5, 6, 7)");
    expectRespectCountersMatchRaw();
    await refreshEventTracking(env);
    await expectMatchesFullRebuild(eventId);
  });

  it("reads averages from counters without accessing raw attacks", async () => {
    const eventId = await create();
    attack(4, START + 300);
    db.exec("UPDATE attacks SET attacker_id = NULL, respect_gain = 20 WHERE id = 4");
    attack(5, START + 400);
    db.exec("UPDATE attacks SET respect_gain = NULL WHERE id = 5");
    const memberSql = memberRespectAveragesSql("outgoing");
    const eventSql = respectAverageSql("outgoing");
    expect(statement(memberSql, [eventId]).accessedTables()).toEqual(["war_respect_totals"]);
    expect(statement(eventSql, [eventId]).accessedTables()).toEqual(["war_respect_totals"]);
    // Unknown attackers never match a member join, so only known members are listed.
    expect(db.prepare(memberSql).all(eventId)).toEqual([
      { war_id: eventId, attacker_id: 10, avg_respect: 5 },
    ]);
    // Unknown attackers contribute to the fallback; NULL respect does not count.
    expect(db.prepare(eventSql).get(eventId)?.avg_respect).toBe(10);
    const prepared = vi.spyOn(env.DB, "prepare");
    await refreshEventTracking(env);
    expect(prepared.mock.calls.some(([sql]) => /AVG\(a\.respect_gain\)/.test(sql))).toBe(false);
    await expectMatchesFullRebuild(eventId);
  });

  it("does not rewrite counters for duplicate feeds, bookkeeping or nonqualifying changes", async () => {
    await create();
    db.exec(`CREATE TABLE respect_write_audit (operation TEXT);
      CREATE TRIGGER respect_audit_insert AFTER INSERT ON war_respect_totals BEGIN INSERT INTO respect_write_audit VALUES ('insert'); END;
      CREATE TRIGGER respect_audit_update AFTER UPDATE ON war_respect_totals BEGIN INSERT INTO respect_write_audit VALUES ('update'); END;`);
    db.exec("UPDATE attacks SET respect_gain = respect_gain, result = result WHERE id = 2");
    db.exec("UPDATE attacks SET stats_pending = 0, ingest_run_id = 'retry', war_id = NULL, attacker_name = 'New name' WHERE id = 3");
    db.prepare("UPDATE attacks SET ended = ? WHERE id = 2").run(START + 102);
    expect(db.prepare("SELECT COUNT(*) AS count FROM respect_write_audit").get()?.count).toBe(0);
    expectRespectCountersMatchRaw();
  });

  it("rolls back respect counters with the attack transaction", async () => {
    await create();
    const before = db.prepare("SELECT * FROM war_respect_totals ORDER BY war_id, direction, attacker_id").all();
    db.exec("BEGIN");
    db.exec("UPDATE attacks SET respect_gain = 25 WHERE id = 2; DELETE FROM attacks WHERE id = 3;");
    attack(4, START + 300);
    expectRespectCountersMatchRaw();
    db.exec("ROLLBACK");
    expect(db.prepare("SELECT * FROM war_respect_totals ORDER BY war_id, direction, attacker_id").all()).toEqual(before);
    expectRespectCountersMatchRaw();
  });

  it("initializes counters for existing events and rebuilds them when event windows change", async () => {
    const eventId = await create();
    for (const name of ["attack_insert", "attack_update", "attack_delete", "war_insert", "war_update", "phase_insert", "phase_update", "phase_delete"]) {
      db.exec(`DROP TRIGGER war_respect_${name}`);
    }
    db.exec("DROP VIEW war_respect_contributions");
    db.exec("DROP TABLE war_respect_totals");
    attack(4, START + 1100);
    db.exec(readFileSync(new URL("../migrations/0191_war_respect_totals.sql", import.meta.url), "utf8"));
    expectRespectCountersMatchRaw();
    // 0198 replaced 0191's contributions view; window edits rely on its event matching.
    db.exec(readFileSync(new URL("../migrations/0198_tracker_attacks_by_event_id.sql", import.meta.url), "utf8"));
    db.prepare("UPDATE wars SET practical_start_time = ?, practical_finish_time = ? WHERE id = ?")
      .run(START + 1000, START + 1800, eventId);
    expectRespectCountersMatchRaw();
    expect(db.prepare("SELECT respect_sum, hit_count FROM war_respect_totals WHERE war_id = ?").get(eventId))
      .toEqual({ respect_sum: 5, hit_count: 1 });
    db.prepare("UPDATE wars SET practical_start_time = ?, practical_finish_time = NULL WHERE id = ?").run(START, eventId);
    expectRespectCountersMatchRaw();
    db.prepare("UPDATE wars SET enemy_faction_id = 100 WHERE id = ?").run(eventId);
    expectRespectCountersMatchRaw();
    db.prepare("UPDATE wars SET war_type = 'real' WHERE id = ?").run(eventId);
    expectRespectCountersMatchRaw();
    db.prepare("UPDATE wars SET war_type = 'event', enemy_faction_id = NULL WHERE id = ?").run(eventId);
    expectRespectCountersMatchRaw();
  });

  it("adds one bucket without rewriting 2,000 historical buckets", async () => {
    const eventId = await create({ practical_finish_time: START + 3 * 86400 });
    db.exec("BEGIN");
    for (let i = 0; i < 2000; i++) {
      attack(i + 100, START + Math.floor(i / 10) * 900 + 10);
      db.prepare("UPDATE attacks SET attacker_id = ? WHERE id = ?").run(1000 + i % 10, i + 100);
    }
    db.exec("COMMIT");
    await refreshEventTracking(env);
    db.exec(`CREATE TABLE bucket_write_audit (operation TEXT);
      CREATE TRIGGER audit_insert AFTER INSERT ON war_member_combat_buckets BEGIN INSERT INTO bucket_write_audit VALUES ('insert'); END;
      CREATE TRIGGER audit_update AFTER UPDATE ON war_member_combat_buckets BEGIN INSERT INTO bucket_write_audit VALUES ('update'); END;
      CREATE TRIGGER audit_delete AFTER DELETE ON war_member_combat_buckets BEGIN INSERT INTO bucket_write_audit VALUES ('delete'); END;`);
    const cleanupTables: unknown[] = [];
    const batch = env.DB.batch.bind(env.DB);
    env.DB.batch = (async (items: ReturnType<typeof statement>[]) => {
      for (const item of items) {
        if (item.sql.includes("DELETE FROM war_member_combat_buckets")) cleanupTables.push(item.accessedTables());
      }
      return batch(items as unknown as D1PreparedStatement[]);
    }) as typeof env.DB.batch;
    attack(3000, START + 200 * 900 + 10);
    await refreshEventTracking(env);
    expect(db.prepare("SELECT operation, COUNT(*) AS count FROM bucket_write_audit GROUP BY operation").all()).toEqual([{ operation: "insert", count: 1 }]);
    // Inspect SQLite's actual table/index accesses, including trigger programs:
    // cleanup must not reread raw attacks to calculate the same buckets again.
    expect(cleanupTables).toHaveLength(1);
    expect(cleanupTables[0]).not.toContain("attacks");
    await refreshEventTracking(env);
    expect(db.prepare("SELECT COUNT(*) AS count FROM bucket_write_audit").get()?.count).toBe(1);
    // Removing the last contribution clears and deletes its stored bucket.
    db.exec("UPDATE attacks SET result = 'Lost', respect_gain = 0 WHERE id = 3000");
    await refreshEventTracking(env);
    expect(db.prepare("SELECT operation, COUNT(*) AS count FROM bucket_write_audit GROUP BY operation ORDER BY operation").all())
      .toEqual([{ operation: "delete", count: 1 }, { operation: "insert", count: 1 }, { operation: "update", count: 1 }]);
    // A new noncontributing attack must not insert a temporary empty bucket.
    attack(3001, START + 201 * 900 + 10);
    db.exec("UPDATE attacks SET result = 'Lost', respect_gain = 0 WHERE id = 3001");
    await refreshEventTracking(env);
    expect(db.prepare("SELECT COUNT(*) AS count FROM bucket_write_audit").get()?.count).toBe(3);
  });

  it("uses shared event membership for detail, member attacks, CSV and relinking without duplicate export rows", async () => {
    const eventId = await create();
    const before = ownership();
    const url = new URL("https://test/api/wars/Halloween/attacks");
    const result = await (await getWarAttacks(url, env)).json() as any;
    expect(result.attacks.map((row: any) => row.id)).toEqual([3, 2]);
    const member = await (await getWarMemberAttacks(new URL("https://test/api/wars/Halloween/members/10/attacks"), env)).json() as any;
    expect(member.attacks.map((row: any) => row.id)).toEqual([3, 2]);
    for (const linked of ["linked", "matching"]) {
      const csv = await exportWarAttacksCsv(new URL(`https://test/api/wars/Halloween/export?linked_status=${linked}`), env);
      expect(csv.status).toBe(200);
      expect((await csv.text()).trim().split(/\r?\n/)).toHaveLength(3);
    }
    const relink = await relinkWarAttacks(request({ war_id: eventId, dry_run: false }), env);
    expect(relink.status).toBe(200);
    expect(ownership()).toEqual(before);
  });

  it("edits, ends and deletes an event without modifying overlapping war attacks or controls", async () => {
    const eventId = await create();
    const before = ownership();
    const edited = await updateEvent(request({ id: eventId, practical_start_time: START + 150 }), env);
    expect(edited.status).toBe(200);
    expect(db.prepare("SELECT attacks_vs_enemy_total FROM war_summary WHERE war_id = ?").get(eventId)?.attacks_vs_enemy_total).toBe(1);
    await finishEventTracking(env, { warId: eventId, finishAt: START + 500 });
    const deleted = await deleteWar(request({ war_id: eventId }), env);
    expect(deleted.status).toBe(200);
    expect(ownership()).toEqual(before);
    expect(globalWar()).toEqual({ active_war_id: 1, war_state: "current" });
  });

  it("continues to reject overlapping event windows", async () => {
    await create();
    const response = await createManualEvent(request({ name: "Other event", practical_start_time: START + 200 }), env);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "TRACKER_OVERLAP" });
  });

  it("upgrades legacy ownership after deployment, keeping event history and current war control", async () => {
    const eventId = await create();
    db.prepare("UPDATE attacks SET war_id = ? WHERE id = 3").run(eventId);
    db.exec("DROP VIEW tracker_attacks");
    db.exec(readFileSync(new URL("../migrations/0181_independent_event_tracking.sql", import.meta.url), "utf8"));
    // Applying the schema alone is safe for the previous worker.
    expect(db.prepare("SELECT war_id FROM attacks WHERE id = 3").get()?.war_id).toBe(eventId);
    const before = db.prepare("SELECT * FROM tracker_attacks WHERE war_id = ? ORDER BY id").all(eventId);
    await initializeIndependentEvents(env);
    expect(db.prepare("SELECT war_id FROM attacks WHERE id = 3").get()?.war_id).toBeNull();
    expect(db.prepare("SELECT * FROM tracker_attacks WHERE war_id = ? ORDER BY id").all(eventId)).toEqual(before);
    expect(globalWar()).toEqual({ active_war_id: 1, war_state: "current" });
    expect(db.prepare("SELECT war_id FROM attacks WHERE id = 2").get()?.war_id).toBe(1);
    await initializeIndependentEvents(env);
    expect(globalWar()).toEqual({ active_war_id: 1, war_state: "current" });
  });

  it("clears only a legacy event's global slot and continues collecting without a current war", async () => {
    const eventId = await create();
    db.prepare("UPDATE sync_state SET active_war_id = ? WHERE name = 'attacks'").run(eventId);
    db.exec("UPDATE wars SET status = 'ended' WHERE id = 1");
    await initializeIndependentEvents(env);
    expect(globalWar()).toEqual({ active_war_id: null, war_state: "none" });
    attack(4, START + 400, null);
    await refreshEventTracking(env);
    expect(db.prepare("SELECT attacks_vs_enemy_total FROM war_summary WHERE war_id = ?").get(eventId)?.attacks_vs_enemy_total).toBe(3);
    expect(globalWar()).toEqual({ active_war_id: null, war_state: "none" });
  });

  it("preserves optional event chain watch while giving the war's monitor priority", async () => {
    const eventId = await create();
    db.prepare("UPDATE wars SET chain_watch_enabled = 1 WHERE id = ?").run(eventId);
    expect(await readChainWatchDemand(env)).toMatchObject({ active: true, war_id: eventId });
    db.exec("UPDATE wars SET chain_watch_enabled = 1 WHERE id = 1");
    expect(await readChainWatchDemand(env)).toMatchObject({ active: true, war_id: 1 });
    expect(globalWar()).toEqual({ active_war_id: 1, war_state: "current" });
  });
});

describe("attack event ids", () => {
  function tornAttack(id: number, started: number, ended: number | undefined, attackerFaction: number): TornAttack {
    return { id, started, ended, result: "Hospitalized", respect_gain: 5,
      attacker: { id: 10, name: "Player", faction: { id: attackerFaction, name: "Faction" } },
      defender: { id: 20, name: "Enemy", faction: { id: 99, name: "Enemy" } } } as TornAttack;
  }
  function eventIdOf(id: number) { return db.prepare("SELECT event_id FROM attacks WHERE id = ?").get(id)?.event_id; }

  it("sets event_id inline when ingesting, without relying on the insert trigger", async () => {
    const eventId = await create();
    db.exec("DROP TRIGGER attack_event_id_insert");
    await buildLiveInsertStatement(env, "live", 1, tornAttack(10, START + 300, START + 301, 8803)).run();
    await buildLiveInsertStatement(env, "live", null, tornAttack(11, START + 300, START + 301, 77)).run();
    await buildHistoricalImportStatement(env, null, "import", tornAttack(12, START + 3599, START + 3601, 8803)).run();
    await buildHistoricalImportStatement(env, null, "import", tornAttack(13, START + 1200, undefined, 8803)).run();
    expect([10, 11, 12, 13].map(eventIdOf)).toEqual([eventId, null, null, eventId]);
  });

  it("follows completion updates across the event finish time", async () => {
    const eventId = await create();
    db.prepare("INSERT INTO attacks (id, started, attacker_id, attacker_faction_id, defender_faction_id) VALUES (14, ?, 10, 8803, 99)")
      .run(START + 3590);
    expect(eventIdOf(14)).toBe(eventId);
    db.prepare("UPDATE attacks SET ended = ? WHERE id = 14").run(START + 3610);
    expect(eventIdOf(14)).toBeNull();
    db.prepare("UPDATE attacks SET ended = ? WHERE id = 14").run(START + 3595);
    expect(eventIdOf(14)).toBe(eventId);
  });

  it("moves links with event edits and clears them when the event is deleted", async () => {
    const eventId = await create();
    expect([1, 2, 3].map(eventIdOf)).toEqual([null, eventId, eventId]);
    db.prepare("UPDATE wars SET practical_start_time = ? WHERE id = ?").run(START - 60, eventId);
    expect([1, 2, 3].map(eventIdOf)).toEqual([eventId, eventId, eventId]);
    db.prepare("UPDATE wars SET practical_finish_time = ? WHERE id = ?").run(START + 150, eventId);
    expect([1, 2, 3].map(eventIdOf)).toEqual([eventId, eventId, null]);
    expect((await deleteWar(request({ war_id: eventId }), env)).status).toBe(200);
    expect(db.prepare("SELECT COUNT(*) AS count FROM attacks WHERE event_id IS NOT NULL").get()?.count).toBe(0);
  });

  it("backfills existing attacks with the migration's rule", async () => {
    await create();
    attack(4, START + 900, null);
    const linked = db.prepare("SELECT id, event_id FROM attacks ORDER BY id").all();
    db.exec("UPDATE attacks SET event_id = NULL");
    const migration = readFileSync(new URL("../migrations/0196_attack_event_ids.sql", import.meta.url), "utf8");
    db.exec(migration.match(/UPDATE attacks SET event_id = w\.id[\s\S]*?;/)![0]);
    expect(db.prepare("SELECT id, event_id FROM attacks ORDER BY id").all()).toEqual(linked);
  });

  it("audits recent links and reports any that disagree with the event windows", async () => {
    await create();
    await expect(auditRecentEventAttackLinks(env)).resolves.toMatchObject({ details: { checked: 3, mismatched: 0, eventOwned: 0 } });
    db.exec("UPDATE attacks SET event_id = NULL WHERE id = 2");
    await expect(auditRecentEventAttackLinks(env)).rejects.toThrow("1 of 3 recent attacks have the wrong event_id");
    db.exec("UPDATE attacks SET event_id = (SELECT id FROM wars WHERE war_type = 'event') WHERE id = 2");
    db.exec("UPDATE attacks SET war_id = (SELECT id FROM wars WHERE war_type = 'event') WHERE id = 3");
    await expect(auditRecentEventAttackLinks(env)).rejects.toThrow("1 attacks are owned by an event through war_id");
    db.exec("UPDATE attacks SET war_id = NULL WHERE id = 3");
  });
});
