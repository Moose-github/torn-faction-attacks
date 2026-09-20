import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOME_FACTION_ID } from "../src/constants.ts";
import { acceptDailyStatsIssueFromRequest } from "../src/lifestyleStats/dailyAttention.ts";
import { readDailyStatsAttentionCounts, readDailyStatsAttentionMembers } from "../src/lifestyleStats/queries.ts";
import { readPersonalStatsCoverage, readPersonalStatsCoverageGaps } from "../src/dataHealth/queries.ts";
import { MISSING_DONATOR_DAYS_ERROR_CODE, MISSING_PERSONALSTATS_BUCKET_ERROR_CODE } from "../src/lifestyleStats/model.ts";

vi.mock("../src/auth", () => ({ readAuthenticatedUserId: vi.fn(async () => 9001) }));

const now = () => Math.floor(Date.now() / 1000);
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
  for (const date of ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05"]) {
    for (const member of [101, 102]) sqlite.prepare("INSERT INTO member_lifestyle_stat_snapshots VALUES (?, ?, 1)").run(member, date);
  }
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
  sqlite.prepare("DELETE FROM member_lifestyle_stat_snapshots WHERE member_id = ? AND snapshot_date = ?").run(issue.member_id, issue.snapshot_date);
  return issue;
}

function accept(issue) {
  return acceptDailyStatsIssueFromRequest(new Request("https://worker.test/api/admin/data-health/daily-stats/accept", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(issue),
  }), env);
}

describe("daily stats issue acceptance against SQLite", () => {
  it("uses the same two-day boundary for lists, counts, coverage gaps and acceptance", async () => {
    const issues = ["2026-06-03", "2026-06-04", "2026-06-05", "2026-06-06"].map(snapshot_date =>
      addIssue({ snapshot_date, status: "pending", error: `PERSONALSTATS_BUCKET_MISMATCH: requested ${snapshot_date}, received 2026-06-02` }));
    expect((await readDailyStatsAttentionMembers(env, now())).map(row => row.snapshot_date)).toEqual(["2026-06-03", "2026-06-04"]);
    expect((await readPersonalStatsCoverageGaps(env, now())).map(row => row.snapshot_date)).toEqual(["2026-06-03", "2026-06-04"]);
    expect(await readDailyStatsAttentionCounts(env, now())).toEqual({ stale_personalstats: 2, missing_donator_days: 0, affected_member_count: 1, accepted_issues: 0 });
    for (let i = 0; i < issues.length; i++) expect((await accept(issues[i])).status).toBe(i < 2 ? 200 : 409);
  });

  it.each([null, `${MISSING_DONATOR_DAYS_ERROR_CODE}: missing`, `${MISSING_PERSONALSTATS_BUCKET_ERROR_CODE}: missing timestamp`])("starts surfacing a missing date at UTC midnight, before the next collection run: %s", async error => {
    addIssue({ snapshot_date: "2026-06-05", status: "pending", error });
    vi.setSystemTime(new Date("2026-06-06T23:59:59Z"));
    expect(await readDailyStatsAttentionMembers(env, now())).toEqual([]);
    vi.setSystemTime(new Date("2026-06-07T00:00:00Z"));
    expect((await readDailyStatsAttentionMembers(env, now())).map(row => row.snapshot_date)).toEqual(["2026-06-05"]);
  });

  it.each([MISSING_DONATOR_DAYS_ERROR_CODE, MISSING_PERSONALSTATS_BUCKET_ERROR_CODE])("applies the grace period to incomplete snapshots in every query: %s", async code => {
    // Include legacy failed/expired rows: their status must not bypass the grace period.
    const issues = ["2026-06-03", "2026-06-04", "2026-06-05", "2026-06-06"].map((snapshot_date, index) =>
      addIssue({ snapshot_date, status: index % 2 ? "retry_expired" : "failed", error: `${code}: incomplete response` }));
    const eligibleDates = ["2026-06-03", "2026-06-04"];
    expect((await readDailyStatsAttentionMembers(env, now())).map(row => row.snapshot_date)).toEqual(eligibleDates);
    expect((await readPersonalStatsCoverageGaps(env, now())).map(row => row.snapshot_date)).toEqual(eligibleDates);
    expect(await readDailyStatsAttentionCounts(env, now())).toEqual({
      stale_personalstats: code === MISSING_DONATOR_DAYS_ERROR_CODE ? 0 : 2,
      missing_donator_days: code === MISSING_DONATOR_DAYS_ERROR_CODE ? 2 : 0,
      affected_member_count: 1, accepted_issues: 0,
    });
    for (let i = 0; i < issues.length; i++) expect((await accept(issues[i])).status).toBe(i < 2 ? 200 : 409);
    expect(await readDailyStatsAttentionMembers(env, now())).toEqual([]);
    expect(await readPersonalStatsCoverageGaps(env, now())).toEqual([]);
  });

  it("finds and accepts missing snapshots without a retry row, including older gaps", async () => {
    sqlite.exec("DELETE FROM member_lifestyle_stat_snapshots WHERE member_id = 101 AND snapshot_date IN ('2026-06-03', '2026-06-04')");
    const rows = await readDailyStatsAttentionMembers(env, now());
    expect(rows.map(row => row.snapshot_date)).toEqual(["2026-06-03", "2026-06-04"]);
    for (const row of rows) expect((await accept(row)).status).toBe(200);
    expect(await readPersonalStatsCoverageGaps(env, now())).toEqual([]);
    expect((await readPersonalStatsCoverage(env, now()))[0]).toEqual({ snapshot_date: "2026-06-04", ready_members: 1, accepted_members: 1, total_members: 2 });
  });

  it("keeps acceptance through ageing and changes in the returned bucket, but shows a new failure", async () => {
    const issue = addIssue({ snapshot_date: "2026-06-04", status: "pending", error: "PERSONALSTATS_BUCKET_MISMATCH: requested 2026-06-04, received 2026-06-02" });
    expect((await accept(issue)).status).toBe(200);
    vi.setSystemTime(new Date("2026-06-07T12:00:00Z"));
    sqlite.exec("UPDATE member_personal_stats_recent SET status = 'retry_expired', error = 'PERSONALSTATS_BUCKET_MISMATCH: requested 2026-06-04, received 2026-06-03', updated_at = 99");
    expect(await readDailyStatsAttentionMembers(env, now())).toEqual([]);
    expect(await readPersonalStatsCoverageGaps(env, now())).toEqual([]);
    expect(await readDailyStatsAttentionCounts(env, now())).toMatchObject({ accepted_issues: 1 });
    sqlite.exec("UPDATE member_personal_stats_recent SET status = 'failed', error = 'Invalid API key'");
    expect(await readDailyStatsAttentionMembers(env, now())).toHaveLength(1);
    expect(await readPersonalStatsCoverageGaps(env, now())).toHaveLength(1);
  });

  it("reports genuine collection failures immediately and counts each expired donator issue once", async () => {
    addIssue({ snapshot_date: "2026-06-06", status: "failed", error: "Invalid API key" });
    addIssue({ snapshot_date: "2026-06-05", status: "failed", error: "Torn personalstats API error: 503" });
    addIssue({ snapshot_date: "2026-06-03", status: "retry_expired", error: "MISSING_DONATOR_DAYS: missing" });
    expect(await readDailyStatsAttentionCounts(env, now())).toEqual({ stale_personalstats: 2, missing_donator_days: 1, affected_member_count: 1, accepted_issues: 0 });
    expect(await readDailyStatsAttentionMembers(env, now())).toHaveLength(3);
    expect(await readPersonalStatsCoverageGaps(env, now())).toHaveLength(3);
  });

  it("uses membership dates and reporting eligibility in every query", async () => {
    sqlite.exec("INSERT INTO home_faction_members VALUES (103, 8803, 'New member', 1, 0, '2026-06-05')");
    addIssue({ member_id: 103, snapshot_date: "2026-06-04", error: null });
    addIssue({ member_id: 101, error: null });
    addIssue({ member_id: 102, error: null });
    sqlite.exec("UPDATE home_faction_members SET report_exempt = 1 WHERE member_id = 101");
    sqlite.exec("UPDATE home_faction_members SET is_current = 0 WHERE member_id = 102");
    expect(await readDailyStatsAttentionMembers(env, now())).toEqual([]);
    expect(await readPersonalStatsCoverageGaps(env, now())).toEqual([]);
    expect(await readDailyStatsAttentionCounts(env, now())).toMatchObject({ affected_member_count: 0 });
    expect(await readPersonalStatsCoverage(env, now())).toEqual([
      { snapshot_date: "2026-06-04", ready_members: 0, total_members: 0, accepted_members: 0 },
      { snapshot_date: "2026-06-05", ready_members: 0, total_members: 1, accepted_members: 0 },
    ]);
  });

  it("stops reporting repaired snapshots even when an old queue error remains", async () => {
    const issue = addIssue({ error: null });
    sqlite.exec("INSERT INTO member_lifestyle_stat_snapshots VALUES (101, '2026-06-03', 1)");
    expect(await readDailyStatsAttentionMembers(env, now())).toEqual([]);
    expect(await readPersonalStatsCoverageGaps(env, now())).toEqual([]);
    expect((await accept(issue)).status).toBe(409);
  });

  it("accepts only the selected day, preserves raw data, and updates both list and counts", async () => {
    const issue = addIssue();
    addIssue({ snapshot_date: "2026-06-02" });
    addIssue({ member_id: 102 });
    const before = sqlite.prepare("SELECT * FROM member_personal_stats_recent ORDER BY member_id, snapshot_date").all();
    expect((await accept(issue)).status).toBe(200);
    const remaining = await readDailyStatsAttentionMembers(env, now());
    expect(remaining.map(row => [row.member_id, row.snapshot_date])).toEqual([[101, "2026-06-02"], [102, "2026-06-03"]]);
    expect(await readDailyStatsAttentionCounts(env, now())).toMatchObject({ stale_personalstats: 2, missing_donator_days: 0 });
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
    expect(await readDailyStatsAttentionMembers(env, now())).toEqual([]);
    addIssue({ snapshot_date: "2026-06-01" });
    expect(await readDailyStatsAttentionMembers(env, now())).toHaveLength(1);
    sqlite.exec("UPDATE member_personal_stats_recent SET error = 'Invalid API key' WHERE snapshot_date = '2026-06-03'");
    expect(await readDailyStatsAttentionMembers(env, now())).toHaveLength(2);
    expect((await accept(issue)).status).toBe(409);
    expect(await readDailyStatsAttentionCounts(env, now())).toMatchObject({ stale_personalstats: 2 });
  });

  it("handles issues with no error text and missing donator data", async () => {
    const stale = addIssue({ error: null });
    const donator = addIssue({ member_id: 102, status: "failed", error: `${MISSING_DONATOR_DAYS_ERROR_CODE}: missing` });
    expect(await readDailyStatsAttentionCounts(env, now())).toMatchObject({ stale_personalstats: 1, missing_donator_days: 1 });
    expect((await accept(stale)).status).toBe(200);
    expect((await accept(donator)).status).toBe(200);
    expect(await readDailyStatsAttentionMembers(env, now())).toEqual([]);
    expect(await readDailyStatsAttentionCounts(env, now())).toMatchObject({ stale_personalstats: 0, missing_donator_days: 0 });
  });

  it("keeps real coverage figures while excluding matching accepted gaps from triage", async () => {
    const issue = addIssue({ snapshot_date: "2026-06-04" });
    sqlite.exec("INSERT OR REPLACE INTO member_lifestyle_stat_snapshots VALUES (102, '2026-06-04', 1)");
    expect((await accept(issue)).status).toBe(200);
    const coverage = await readPersonalStatsCoverage(env, now());
    expect(coverage[0]).toEqual({ snapshot_date: "2026-06-04", ready_members: 1, accepted_members: 1, total_members: 2 });
    const gaps = await readPersonalStatsCoverageGaps(env, now());
    expect(gaps.map(row => [row.member_id, row.snapshot_date])).toEqual([]);
    sqlite.exec("UPDATE member_personal_stats_recent SET error = 'Different failure'");
    expect((await readPersonalStatsCoverage(env, now()))[0].accepted_members).toBe(0);
    expect(await readPersonalStatsCoverageGaps(env, now())).toHaveLength(1);
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
    sqlite.exec("INSERT INTO member_lifestyle_stat_snapshots VALUES (101, '2026-06-03', 1)");
    const pending = addIssue({ snapshot_date: "2026-06-05", status: "pending", error: "PERSONALSTATS_BUCKET_MISMATCH: requested 2026-06-05, received 2026-06-04" });
    expect((await accept(healthy)).status).toBe(409);
    expect((await accept(pending)).status).toBe(409);
  });
});
