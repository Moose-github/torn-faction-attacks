import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAdminDataHealth, getDataHealthSummary } from "../src/dataHealth.ts";
import { acceptDailyStatsIssueFromRequest } from "../src/lifestyleStats/dailyAttention.ts";

vi.mock("../src/auth", () => ({ readAuthenticatedUserId: vi.fn(async () => 9001) }));

let db;
let env;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-20T12:00:00Z"));
  db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../schema/current.sql", import.meta.url), "utf8"));
  for (const member of [101, 102]) {
    db.prepare("INSERT INTO home_faction_members (member_id, faction_id, name, current_join_date) VALUES (?, 8803, ?, '2026-09-16')")
      .run(member, `Member ${member}`);
    for (const date of ["2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19"]) {
      db.prepare("INSERT INTO member_lifestyle_stat_snapshots (member_id, snapshot_date, personal_ready, captured_at) VALUES (?, ?, 1, 1)").run(member, date);
    }
  }
  env = { DB: { prepare(sql) {
    const statement = db.prepare(sql);
    let params = [];
    return {
      bind(...values) { params = values; return this; },
      async all() { return { results: statement.all(...params) }; },
      async first(column) { const row = statement.get(...params); return column ? row?.[column] ?? null : row ?? null; },
      async run() { return { meta: { changes: Number(statement.run(...params).changes) } }; },
    };
  } } };
});
afterEach(() => { db.close(); vi.useRealTimers(); });

function missing(member, date) {
  db.prepare("DELETE FROM member_lifestyle_stat_snapshots WHERE member_id = ? AND snapshot_date = ?").run(member, date);
}
async function health() { return (await getAdminDataHealth(env)).json(); }
function personal(body) { return body.subsystems.find(row => row.key === "personal_stats"); }

describe("personal stats across the health API and acceptance", () => {
  it("keeps older gaps actionable, counts distinct members, and updates all panels after acceptance", async () => {
    missing(101, "2026-09-17");
    missing(101, "2026-09-18");
    missing(102, "2026-09-19");
    const before = await health();
    expect(personal(before)).toMatchObject({ status: "warn", summary: "2 personal stat issues across 1 member" });
    expect(before.details.daily_stats_attention).toMatchObject({ stale_personalstats: 2, affected_member_count: 1 });
    expect(before.details.personal_stats_coverage_gaps.map(row => row.snapshot_date)).toEqual(["2026-09-17", "2026-09-18"]);
    const memberSummary = await (await getDataHealthSummary(env)).json();
    expect(personal(memberSummary)).toMatchObject({ status: "warn", summary: personal(before).summary });
    for (const issue of before.details.daily_stats_attention.affected_members) {
      const response = await acceptDailyStatsIssueFromRequest(new Request("https://test/api/admin/data-health/daily-stats/accept", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(issue),
      }), env);
      expect(response.status).toBe(200);
    }
    const after = await health();
    expect(personal(after)).toMatchObject({ status: "good", summary: "Known personal stat gaps accepted" });
    expect(personal(after).metrics).toContainEqual({ label: "2026-09-18", value: "1/2" });
    expect(after.details.daily_stats_attention).toMatchObject({ stale_personalstats: 0, affected_member_count: 0, accepted_issues: 2, affected_members: [] });
    expect(after.details.personal_stats_coverage_gaps).toEqual([]);
    expect(after.issues.some(row => row.key === "personal_stats")).toBe(false);
  });

  it("keeps the warning when only an older outstanding gap remains", async () => {
    missing(101, "2026-09-16");
    const body = await health();
    expect(personal(body)).toMatchObject({ status: "warn", summary: "1 personal stat issue across 1 member" });
    expect(personal(body).metrics).toContainEqual({ label: "2026-09-18", value: "2/2" });
    expect(body.issues.find(row => row.key === "personal_stats").detail).toContain("Member 101");
  });

  it.each([null, "MISSING_DONATOR_DAYS: missing", "MISSING_PERSONALSTATS_BUCKET: missing timestamp"])("keeps yesterday's incomplete snapshot out of health warnings and Xanax issue details: %s", async error => {
    missing(101, "2026-09-19");
    if (error) {
      db.prepare(`INSERT INTO member_personal_stats_recent
        (member_id, snapshot_date, status, error, target_timestamp, updated_at)
        VALUES (101, '2026-09-19', 'failed', ?, 1, 1)`).run(error);
    }
    const pending = await health();
    expect(personal(pending).status).toBe("good");
    expect(pending.issues.some(row => row.key === "personal_stats")).toBe(false);
    expect(pending.details.daily_stats_attention).toMatchObject({ stale_personalstats: 0, missing_donator_days: 0, affected_member_count: 0, affected_members: [] });
    expect(personal(await (await getDataHealthSummary(env)).json()).status).toBe("good");
    db.exec(`INSERT INTO member_lifestyle_xantaken_rechecks
      (member_id, snapshot_date, status, reason, requested_at, next_check_at, created_at, updated_at)
      VALUES (101, '2026-09-18', 'needs_repair', 'impossible_delta', 1, 1, 1, 1)`);
    const body = await health();
    expect(personal(body)).toMatchObject({ status: "warn", summary: "1 Xanax recheck needs repair" });
    expect(body.issues.find(row => row.key === "personal_stats").detail).toBe("1 Xanax recheck needs repair");
    expect(body.details.personal_stats_coverage_gaps).toEqual([]);
    expect(body.details.daily_stats_attention.affected_members).toEqual([]);
    // Both causes remain visible when an overdue gap also exists.
    missing(102, "2026-09-18");
    const mixed = await health();
    expect(personal(mixed).summary).toContain("1 personal stat issue across 1 member; 1 Xanax recheck needs repair");
    expect(mixed.issues.find(row => row.key === "personal_stats").detail).toContain("Member 102 #102; 1 Xanax recheck needs repair");
    expect(mixed.details.personal_stats_coverage_gaps.map(row => row.snapshot_date)).toEqual(["2026-09-18"]);
  });
});
