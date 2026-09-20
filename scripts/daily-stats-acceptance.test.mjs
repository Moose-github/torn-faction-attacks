import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOME_FACTION_ID } from "../src/constants.ts";
import { acceptDailyStatsIssueFromRequest } from "../src/lifestyleStats/dailyAttention.ts";
import { readDailyStatsAttentionCounts, readDailyStatsAttentionMembers } from "../src/lifestyleStats/queries.ts";
import { readPersonalStatsCoverage, readPersonalStatsCoverageGaps } from "../src/dataHealth/queries.ts";
import { MISSING_DONATOR_DAYS_ERROR_CODE } from "../src/lifestyleStats/model.ts";

vi.mock("../src/auth", () => ({ readAuthenticatedUserId: vi.fn(async () => 9001) }));

const activeDates = ["2026-06-04", "2026-06-05"];
let sqlite;
let env;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-06T12:00:00Z"));
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE home_faction_members (
      member_id INTEGER PRIMARY KEY, faction_id INTEGER, name TEXT,
      is_current INTEGER DEFAULT 1, report_exempt INTEGER DEFAULT 0, current_join_date TEXT
    );
    CREATE TABLE member_lifestyle_stat_snapshots (
      member_id INTEGER, snapshot_date TEXT, personal_ready INTEGER,
      PRIMARY KEY (member_id, snapshot_date)
    );
  `);
  for (const file of ["0080_create_member_personal_stats_recent.sql", "0151_create_daily_stats_issue_acceptances.sql"]) {
    sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  }
  sqlite.prepare("INSERT INTO home_faction_members (member_id, faction_id, name, current_join_date) VALUES (?, ?, ?, ?)")
    .run(101, HOME_FACTION_ID, "Holiday Member", "2026-01-01");
  sqlite.prepare("INSERT INTO home_faction_members (member_id, faction_id, name) VALUES (?, ?, ?)")
    .run(102, HOME_FACTION_ID, "Other Member");
  env = { DB: { prepare(sql) {
    const statement = sqlite.prepare(sql);
    let params = [];
    return {
      bind(...values) { params = values; return this; },
      async all() { return { results: statement.all(...params) }; },
      async first() { return statement.get(...params) ?? null; },
      async run() { return { meta: { changes: Number(statement.run(...params).changes) } }; },
    };
  } } };
});

afterEach(() => { sqlite.close(); vi.useRealTimers(); });

function addIssue(overrides = {}) {
  const issue = { member_id: 101, snapshot_date: "2026-06-03", status: "retry_expired", error: "Stats stale", ...overrides };
  sqlite.prepare(`INSERT INTO member_personal_stats_recent
    (member_id, snapshot_date, status, error, requested_at, updated_at) VALUES (?, ?, ?, ?, 1, 2)`)
    .run(issue.member_id, issue.snapshot_date, issue.status, issue.error);
  return issue;
}

function accept(issue) {
  return acceptDailyStatsIssueFromRequest(new Request("https://worker.test/api/admin/data-health/daily-stats/accept", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(issue),
  }), env);
}

describe("daily stats issue acceptance against SQLite", () => {
  it("accepts only the selected day, preserves raw data, and updates both list and counts", async () => {
    const issue = addIssue();
    addIssue({ snapshot_date: "2026-06-02" });
    addIssue({ member_id: 102 });
    const before = sqlite.prepare("SELECT * FROM member_personal_stats_recent ORDER BY member_id, snapshot_date").all();
    expect((await accept(issue)).status).toBe(200);
    const remaining = await readDailyStatsAttentionMembers(env, activeDates);
    expect(remaining.map(row => [row.member_id, row.snapshot_date])).toEqual([[101, "2026-06-02"], [102, "2026-06-03"]]);
    expect(await readDailyStatsAttentionCounts(env, activeDates)).toEqual({ stale_personalstats: 2, missing_donator_days: 0 });
    expect(sqlite.prepare("SELECT * FROM member_personal_stats_recent ORDER BY member_id, snapshot_date").all()).toEqual(before);
    expect(sqlite.prepare("SELECT * FROM daily_stats_issue_acceptances").get()).toMatchObject({
      member_id: 101, snapshot_date: "2026-06-03", issue_status: "retry_expired", issue_error: "Stats stale", accepted_by: 9001,
    });
    expect((await accept(issue)).status).toBe(200);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM daily_stats_issue_acceptances").get().count).toBe(1);
  });

  it("keeps acceptance after routine retries but surfaces new days and different failures", async () => {
    const issue = addIssue();
    await accept(issue);
    sqlite.exec("UPDATE member_personal_stats_recent SET updated_at = 50, attempted_at = 50");
    expect(await readDailyStatsAttentionMembers(env, activeDates)).toEqual([]);
    addIssue({ snapshot_date: "2026-06-01" });
    expect(await readDailyStatsAttentionMembers(env, activeDates)).toHaveLength(1);
    sqlite.exec("UPDATE member_personal_stats_recent SET error = 'Invalid API key' WHERE snapshot_date = '2026-06-03'");
    expect(await readDailyStatsAttentionMembers(env, activeDates)).toHaveLength(2);
    expect((await accept(issue)).status).toBe(409);
    expect(await readDailyStatsAttentionCounts(env, activeDates)).toMatchObject({ stale_personalstats: 2 });
  });

  it("handles issues with no error text and missing donator data", async () => {
    const stale = addIssue({ error: null });
    const donator = addIssue({ member_id: 102, status: "failed", error: `${MISSING_DONATOR_DAYS_ERROR_CODE}: missing` });
    expect(await readDailyStatsAttentionCounts(env, activeDates)).toEqual({ stale_personalstats: 1, missing_donator_days: 1 });
    expect((await accept(stale)).status).toBe(200);
    expect((await accept(donator)).status).toBe(200);
    expect(await readDailyStatsAttentionMembers(env, activeDates)).toEqual([]);
    expect(await readDailyStatsAttentionCounts(env, activeDates)).toEqual({ stale_personalstats: 0, missing_donator_days: 0 });
  });

  it("keeps real coverage figures while excluding matching accepted gaps from triage", async () => {
    const issue = addIssue({ snapshot_date: "2026-06-04" });
    sqlite.exec("INSERT INTO member_lifestyle_stat_snapshots VALUES (102, '2026-06-04', 1)");
    expect((await accept(issue)).status).toBe(200);
    const coverage = await readPersonalStatsCoverage(env, "2026-06-05");
    expect(coverage[0]).toEqual({ snapshot_date: "2026-06-04", ready_members: 1, accepted_members: 1, total_members: 2 });
    const gaps = await readPersonalStatsCoverageGaps(env, "2026-06-05");
    expect(gaps.map(row => [row.member_id, row.snapshot_date])).toEqual([[101, "2026-06-05"], [102, "2026-06-05"]]);
    sqlite.exec("UPDATE member_personal_stats_recent SET error = 'Different failure'");
    expect((await readPersonalStatsCoverage(env, "2026-06-05"))[0].accepted_members).toBe(0);
    expect(await readPersonalStatsCoverageGaps(env, "2026-06-05")).toHaveLength(3);
  });

  it.each([
    { member_id: 0 }, { member_id: 1.5 }, { member_id: "101" },
    { snapshot_date: "2026-02-30" }, { snapshot_date: "invalid" },
    { status: "accepted" }, { error: undefined }, { error: {} },
  ])("rejects invalid acceptance payloads: %j", async overrides => {
    const issue = addIssue();
    expect((await accept({ ...issue, ...overrides })).status).toBe(400);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM daily_stats_issue_acceptances").get().count).toBe(0);
  });

  it.each([
    "UPDATE home_faction_members SET is_current = 0 WHERE member_id = 101",
    "UPDATE home_faction_members SET report_exempt = 1 WHERE member_id = 101",
    "UPDATE home_faction_members SET current_join_date = '2026-06-04' WHERE member_id = 101",
    "UPDATE member_personal_stats_recent SET status = 'completed', error = NULL",
    "DELETE FROM member_personal_stats_recent",
  ])("rejects stale actions after the issue stops qualifying: %s", async sql => {
    const issue = addIssue();
    sqlite.exec(sql);
    expect((await accept(issue)).status).toBe(409);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM daily_stats_issue_acceptances").get().count).toBe(0);
  });

  it("does not accept a healthy row or a recent pending row", async () => {
    const healthy = addIssue({ status: "completed", error: null });
    const pending = addIssue({ snapshot_date: "2026-06-05", status: "pending", error: "Waiting on upstream" });
    expect((await accept(healthy)).status).toBe(409);
    expect((await accept(pending)).status).toBe(409);
  });
});
