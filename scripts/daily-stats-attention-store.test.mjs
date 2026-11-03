import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auditDailyStatsAttention } from "../src/lifestyleStats/attentionAudit";
import { readDailyStatsAttentionSummary, acceptDailyStatsAttentionIssue } from "../src/lifestyleStats/queries";
import { personalStatsAttentionCte, personalStatsAttentionParams } from "../src/lifestyleStats/attentionPolicy";
import { readPersonalStatsCoverageGaps } from "../src/dataHealth/queries";

const schema = readFileSync(new URL("../schema/current.sql", import.meta.url), "utf8");
const migration = readFileSync(new URL("../migrations/0206_save_daily_stats_attention.sql", import.meta.url), "utf8");
const beforeMigration = schema.slice(0, schema.indexOf("-- Saved missing member/date pairs"));
let db, env, sqlCalls, failBatch;
const now = () => Date.now() / 1000;
function binding() {
  return {
    prepare(sql) {
      sqlCalls.push(sql);
      const statement = db.prepare(sql);
      let params = [];
      return {
        bind(...values) { params = values; return this; },
        async first() { return statement.get(...params) ?? null; },
        async all() { return { results: statement.all(...params) }; },
        async run() { return { meta: { changes: Number(statement.run(...params).changes) } }; },
      };
    },
    async batch(statements) {
      db.exec("BEGIN");
      try {
        const results = [];
        for (let i = 0; i < statements.length; i++) {
          results.push(await statements[i].run());
          if (failBatch && i === 0) throw new Error("audit failed after delete");
        }
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}
function member(id = 101) {
  db.prepare(`INSERT INTO home_faction_members(member_id,faction_id,name,current_join_date)
    VALUES (?,8803,?,'2020-01-01')`).run(id, `Member ${id}`);
}
function snapshot(id, date, ready = 1) {
  db.prepare(`INSERT INTO member_lifestyle_stat_snapshots(member_id,snapshot_date,personal_ready,captured_at)
    VALUES (?,?,?,1) ON CONFLICT(member_id,snapshot_date) DO UPDATE SET personal_ready=excluded.personal_ready`)
    .run(id, date, ready);
}
function queue(id, date, error = null) {
  db.prepare(`INSERT INTO member_personal_stats_recent(member_id,snapshot_date,status,error,target_timestamp,updated_at)
    VALUES (?,?,'pending',?,1,1) ON CONFLICT(member_id,snapshot_date) DO UPDATE SET error=excluded.error`)
    .run(id, date, error);
}
function gaps() {
  return db.prepare("SELECT member_id,snapshot_date FROM daily_stats_attention_gaps ORDER BY member_id,snapshot_date").all();
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-20T12:00:00Z"));
  db = new DatabaseSync(":memory:");
  db.exec(schema);
  sqlCalls = [];
  failBatch = false;
  env = { DB: binding() };
});
afterEach(() => { db.close(); vi.useRealTimers(); });

describe("incremental attention gaps", () => {
  it("tracks failed attempts and successful repairs for only the written member/date", async () => {
    member(); member(102);
    queue(101, "2026-09-18", "Invalid API key");
    expect(gaps()).toEqual([{ member_id: 101, snapshot_date: "2026-09-18" }]);
    expect((await readDailyStatsAttentionSummary(env, now())).affected_members[0].error).toBe("Invalid API key");
    queue(101, "2026-09-18", "Torn unavailable");
    expect((await readDailyStatsAttentionSummary(env, now())).affected_members[0].error).toBe("Torn unavailable");
    snapshot(101, "2026-09-18", 0);
    expect(gaps()).toHaveLength(1);
    snapshot(101, "2026-09-18", 1);
    expect(gaps()).toEqual([]);
    // Queue retries/hydration after repair cannot resurrect a complete snapshot.
    queue(101, "2026-09-18", "stale queue error");
    expect((await readDailyStatsAttentionSummary(env, now())).stale_personalstats).toBe(0);
    snapshot(101, "2026-09-18", 0);
    expect(gaps()).toHaveLength(1);
  });

  it("keeps old issues, acceptance matching, grace periods and current membership rules", async () => {
    member();
    queue(101, "2026-08-01");
    queue(101, "2026-09-19");
    expect((await readDailyStatsAttentionSummary(env, now())).stale_personalstats).toBe(1);
    await acceptDailyStatsAttentionIssue(env,
      { member_id: 101, snapshot_date: "2026-08-01", status: "pending", error: null }, now(), 1);
    queue(101, "2026-08-01", "RETRY_EXPIRED_PERSONALSTATS: aged out");
    expect(await readDailyStatsAttentionSummary(env, now())).toMatchObject({ stale_personalstats: 0, accepted_issues: 1 });
    queue(101, "2026-08-01", "Invalid API key");
    expect(await readDailyStatsAttentionSummary(env, now())).toMatchObject({ stale_personalstats: 1, accepted_issues: 0 });
    db.exec("UPDATE home_faction_members SET report_exempt=1");
    expect((await readDailyStatsAttentionSummary(env, now())).stale_personalstats).toBe(0);
    db.exec("UPDATE home_faction_members SET report_exempt=0, current_join_date='2026-09-15'");
    expect((await readDailyStatsAttentionSummary(env, now())).stale_personalstats).toBe(0);
  });

  it("does not scan historical snapshots when reading health or accepting an issue", async () => {
    member(); queue(101, "2026-09-18");
    await readDailyStatsAttentionSummary(env, now());
    const read = sqlCalls.at(-1);
    expect(read).not.toContain("member_lifestyle_stat_snapshots");
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${read}`).all(...personalStatsAttentionParams(now())).map(r => r.detail).join("\n");
    expect(plan).toContain("SCAN gaps");
    expect(plan).toMatch(/SEARCH recent .*\(member_id=\? AND snapshot_date=\?\)/);
    await readPersonalStatsCoverageGaps(env, now());
    expect(sqlCalls.at(-1)).not.toContain("tracked_dates");
    expect(sqlCalls.at(-1)).toContain("FROM daily_stats_attention_gaps");
    await acceptDailyStatsAttentionIssue(env,
      { member_id: 101, snapshot_date: "2026-09-18", status: "pending", error: null }, now(), 1);
    expect(sqlCalls.at(-1)).not.toContain("UNION SELECT snapshot_date");
  });
});

describe("once-daily seven-day audit", () => {
  it("catches gaps with no queue row, includes exactly seven completed dates, and preserves older issues", async () => {
    member(); member(102);
    queue(101, "2026-08-01");
    // Only another member has these dates. No targeted write has checked 101.
    for (const date of ["2026-09-12", "2026-09-13", "2026-09-18", "2026-09-19", "2026-09-20"]) snapshot(102, date);
    expect((await auditDailyStatsAttention(env)).details.skipped).toBe(false);
    expect(gaps()).toEqual([
      { member_id: 101, snapshot_date: "2026-08-01" },
      { member_id: 101, snapshot_date: "2026-09-13" },
      { member_id: 101, snapshot_date: "2026-09-18" },
      { member_id: 101, snapshot_date: "2026-09-19" },
    ]);
    expect((await readDailyStatsAttentionSummary(env, now())).stale_personalstats).toBe(3);
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${personalStatsAttentionCte("week")} SELECT * FROM missing_stats`)
      .all(...personalStatsAttentionParams(now())).map(r => r.detail).join("\n");
    expect(plan).toMatch(/SEARCH member_lifestyle_stat_snapshots .*snapshot_date>\? AND snapshot_date<\?/);
    expect(plan).toMatch(/SEARCH daily_stats_issue_acceptances .*snapshot_date>\? AND snapshot_date<\?/);
  });

  it("waits until 06:15, catches up later, and does not repeat a successful audit", async () => {
    member();
    vi.setSystemTime(new Date("2026-09-20T06:14:00Z"));
    expect((await auditDailyStatsAttention(env)).details.skipped).toBe(true);
    expect(sqlCalls).toHaveLength(0);
    vi.setSystemTime(new Date("2026-09-20T07:00:00Z"));
    expect((await auditDailyStatsAttention(env)).details.skipped).toBe(false);
    sqlCalls.length = 0;
    expect((await auditDailyStatsAttention(env)).details.skipped).toBe(true);
    expect(sqlCalls.some(sql => sql.includes("tracked_dates"))).toBe(false);
    vi.setSystemTime(new Date("2026-09-21T06:15:00Z"));
    expect((await auditDailyStatsAttention(env)).details.skipped).toBe(false);
    expect(gaps()).toContainEqual({ member_id: 101, snapshot_date: "2026-09-19" });
  });

  it("rolls back a failed audit and permits retry without losing recent or historical gaps", async () => {
    member(); queue(101, "2026-08-01"); queue(101, "2026-09-18");
    const before = gaps();
    failBatch = true;
    await expect(auditDailyStatsAttention(env)).rejects.toThrow("audit failed after delete");
    expect(gaps()).toEqual(before);
    expect(db.prepare("SELECT * FROM sync_state WHERE name LIKE 'daily_stats_attention_audit%'").all()).toEqual([]);
    failBatch = false;
    expect((await auditDailyStatsAttention(env)).details.skipped).toBe(false);
  });

  it("does not clear a saved gap just because its last collection row disappeared", async () => {
    member(); queue(101, "2026-09-15");
    db.exec("DELETE FROM member_personal_stats_recent");
    await auditDailyStatsAttention(env);
    expect(gaps()).toContainEqual({ member_id: 101, snapshot_date: "2026-09-15" });
    snapshot(101, "2026-09-15");
    expect(gaps()).not.toContainEqual({ member_id: 101, snapshot_date: "2026-09-15" });
  });

  it("does not repeat an audit that completes between the gate read and lock claim", async () => {
    const prepare = env.DB.prepare;
    let finishedOtherRun = false;
    env.DB.prepare = sql => {
      const statement = prepare(sql);
      if (sql.includes("SELECT name, last_started")) {
        const first = statement.first;
        statement.first = async () => {
          const result = await first();
          if (!finishedOtherRun) {
            finishedOtherRun = true;
            db.prepare("INSERT INTO sync_state(name,last_started) VALUES ('daily_stats_attention_audit',?)").run(now());
          }
          return result;
        };
      }
      return statement;
    };
    expect((await auditDailyStatsAttention(env)).details.skipped).toBe(true);
    expect(sqlCalls.some(sql => sql.includes("tracked_dates"))).toBe(false);
    expect(db.prepare("SELECT * FROM sync_state WHERE name='daily_stats_attention_audit_lock'").get()).toBeUndefined();
  });
});

it("bootstraps existing historical gaps once and creates the same schema as a fresh database", async () => {
  const currentObjects = db.prepare("SELECT type,name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();
  db.close();
  db = new DatabaseSync(":memory:");
  db.exec(beforeMigration);
  member(); member(102);
  snapshot(102, "2020-01-02");
  queue(101, "2020-01-03");
  db.exec(migration);
  expect(gaps()).toContainEqual({ member_id: 101, snapshot_date: "2020-01-02" });
  expect(gaps()).toContainEqual({ member_id: 101, snapshot_date: "2020-01-03" });
  expect(db.prepare("SELECT type,name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all()).toEqual(currentObjects);
  snapshot(101, "2020-01-02");
  expect(gaps()).not.toContainEqual({ member_id: 101, snapshot_date: "2020-01-02" });
});
