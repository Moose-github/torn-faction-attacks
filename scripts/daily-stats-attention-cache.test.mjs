import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDailyStatsAttention, acceptDailyStatsIssueFromRequest } from "../src/lifestyleStats/dailyAttention.ts";
import { bumpMemberLifestyleCacheVersion } from "../src/cacheVersions.ts";
import { getLatestMaintenanceRun } from "../src/maintenance.ts";
import { readDailyStatsAttentionSummary } from "../src/lifestyleStats/queries.ts";

vi.mock("../src/auth", () => ({ readAuthenticatedUserId: vi.fn(async () => 9001) }));
vi.mock("../src/xanaxCompetition", () => ({ reconcileXanaxCompetitionRollover: vi.fn() }));

let db, env, scans, store, edge, failNextScan;
const now = () => Math.floor(Date.now() / 1000);
function binding() {
  return { prepare(sql) {
    const statement = db.prepare(sql);
    let params = [];
    return {
      bind(...values) { params = values; return this; },
      async first() {
        if (sql.includes("affected_members_json")) {
          scans++;
          if (failNextScan) { failNextScan = false; throw new Error("read failed"); }
        }
        return statement.get(...params) ?? null;
      },
      async all() { return { results: statement.all(...params) }; },
      async run() { return { meta: { changes: Number(statement.run(...params).changes) } }; },
    };
  } };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-20T12:00:00Z"));
  db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../schema/current.sql", import.meta.url), "utf8"));
  db.exec(`INSERT INTO home_faction_members(member_id,faction_id,name,current_join_date)
    VALUES (101,8803,'Member 101','2026-09-16');
    INSERT INTO member_lifestyle_stat_snapshots(member_id,snapshot_date,personal_ready,captured_at)
    VALUES (101,'2026-09-16',1,1), (101,'2026-09-17',1,1),
      (101,'2026-09-18',1,1), (101,'2026-09-19',1,1);
    INSERT INTO home_faction_members(member_id,faction_id,name,current_join_date)
      VALUES (102,8803,'Member 102','2026-09-16');
    INSERT INTO member_lifestyle_stat_snapshots(member_id,snapshot_date,personal_ready,captured_at)
      SELECT 102,snapshot_date,1,1 FROM member_lifestyle_stat_snapshots WHERE member_id=101;`);
  env = { DB: binding() };
  scans = 0;
  failNextScan = false;
  store = new Map();
  edge = {
    match: vi.fn(async request => store.get(request.url)?.clone()),
    put: vi.fn(async (request, response) => { store.set(request.url, response.clone()); }),
  };
  vi.stubGlobal("caches", { open: vi.fn(async () => edge) });
});
afterEach(() => { db.close(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function missing(date) {
  db.prepare("DELETE FROM member_lifestyle_stat_snapshots WHERE member_id=101 AND snapshot_date = ?").run(date);
}

describe("shared daily attention calculation", () => {
  it("coalesces simultaneous health and maintenance reads and reuses the result", async () => {
    missing("2026-09-16");
    const [health, maintenance] = await Promise.all([
      getDailyStatsAttention(env), getLatestMaintenanceRun(env).then(r => r.json()),
    ]);
    expect(health).toEqual(maintenance.daily_stats_attention);
    expect(health.stale_personalstats).toBe(1);
    await getDailyStatsAttention(env);
    expect(scans).toBe(1);
  });

  it("shares across isolates without extending the original five-minute expiry", async () => {
    await getDailyStatsAttention(env);
    vi.advanceTimersByTime(299_000);
    const anotherIsolate = { DB: binding() };
    await getDailyStatsAttention(anotherIsolate);
    expect(scans).toBe(1);
    vi.advanceTimersByTime(1_000);
    await getDailyStatsAttention(anotherIsolate);
    expect(scans).toBe(2);
  });

  it("invalidates every acceptance even when two mutations finish in the same second", async () => {
    missing("2026-09-16");
    missing("2026-09-17");
    const before = await getDailyStatsAttention(env);
    for (let i = 0; i < 2; i++) {
      const response = await acceptDailyStatsIssueFromRequest(new Request("https://test/accept", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(before.affected_members[i]),
      }), env);
      expect(response.status).toBe(200);
      const attention = await getDailyStatsAttention({ DB: binding() });
      expect(attention.stale_personalstats).toBe(1 - i);
      expect(attention.accepted_issues).toBe(i + 1);
    }
    expect(scans).toBe(3);
  });

  it("refreshes repaired snapshots when the lifestyle version changes", async () => {
    missing("2026-09-16");
    expect((await getDailyStatsAttention(env)).stale_personalstats).toBe(1);
    db.exec(`INSERT INTO member_lifestyle_stat_snapshots(member_id,snapshot_date,personal_ready,captured_at)
      VALUES (101,'2026-09-16',1,2)`);
    await bumpMemberLifestyleCacheVersion(env);
    expect((await getDailyStatsAttention(env)).stale_personalstats).toBe(0);
    expect(scans).toBe(2);
  });

  it("surfaces newly overdue gaps at UTC midnight before TTL expiry", async () => {
    missing("2026-09-19");
    vi.setSystemTime(new Date("2026-09-20T23:59:59Z"));
    expect((await getDailyStatsAttention(env)).stale_personalstats).toBe(0);
    vi.advanceTimersByTime(1_000);
    expect((await getDailyStatsAttention(env)).affected_members[0].snapshot_date).toBe("2026-09-19");
    expect(scans).toBe(2);
  });

  it("retries failed database reads and tolerates an unavailable edge cache", async () => {
    edge.match.mockRejectedValue(new Error("cache unavailable"));
    edge.put.mockRejectedValue(new Error("cache unavailable"));
    failNextScan = true;
    await expect(getDailyStatsAttention(env)).rejects.toThrow("read failed");
    expect((await getDailyStatsAttention(env)).stale_personalstats).toBe(0);
    expect(scans).toBe(2);
  });

  it("counts all historical gaps while returning only the first twelve, with empty totals normalized", async () => {
    expect(await readDailyStatsAttentionSummary(env, now())).toEqual({
      stale_personalstats: 0, missing_donator_days: 0, affected_member_count: 0,
      accepted_issues: 0, affected_members: [],
    });
    db.exec("UPDATE home_faction_members SET current_join_date = '2026-08-01' WHERE member_id=101");
    for (let day = 1; day <= 20; day++) {
      const date = `2026-08-${String(day).padStart(2,'0')}`;
      db.prepare(`INSERT INTO member_personal_stats_recent
        (member_id,snapshot_date,status,error,target_timestamp,updated_at) VALUES (101,?,'pending',NULL,1,1)`).run(date);
    }
    const result = await readDailyStatsAttentionSummary(env, now());
    expect(result).toMatchObject({ stale_personalstats: 20, affected_member_count: 1 });
    expect(result.affected_members).toHaveLength(12);
    expect(result.affected_members[0].snapshot_date).toBe("2026-08-01");
    expect(result.affected_members[11].snapshot_date).toBe("2026-08-12");
  });
});
