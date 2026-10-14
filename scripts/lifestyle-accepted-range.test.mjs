import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MEMBER_LIFESTYLE_CACHE_VERSION_NAME } from "../src/cacheVersions.ts";
import { acceptDailyStatsIssueFromRequest } from "../src/lifestyleStats/dailyAttention.ts";
import { readCompleteLifestyleSnapshotDateRange } from "../src/lifestyleStats/queries.ts";
import { getMemberLifestyleDailyChart, getMemberLifestyleStats } from "../src/lifestyleStats/reports.ts";

vi.mock("../src/auth", () => ({ readAuthenticatedUserId: vi.fn(async () => 9001) }));

let db;
let env;
const dates = ["2026-10-01", "2026-10-11", "2026-10-12"];
const allowGaps = { allowAcceptedPersonalGaps: true };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-14T15:00:00Z"));
  db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../schema/current.sql", import.meta.url), "utf8"));
  // The schema snapshot omits this existing production migration.
  db.exec(readFileSync(new URL("../migrations/0090_add_lifestyle_snapshot_gym_error.sql", import.meta.url), "utf8"));
  db.exec(`
    INSERT INTO home_faction_members (member_id, faction_id, name, current_join_date)
      VALUES (101, 8803, 'Missing member', '2026-09-30'), (102, 8803, 'Ready member', NULL);
    INSERT INTO member_lifestyle_stat_snapshots
      (member_id, snapshot_date, personal_ready, gym_ready, fully_ready, captured_at)
      VALUES (102, '2026-09-29', 1, 1, 1, 1);
  `);
  for (const date of [...dates, "2026-10-13"]) {
    for (const member of [101, 102]) {
      db.prepare(`INSERT INTO member_lifestyle_stat_snapshots
        (member_id, member_name, snapshot_date, personal_ready, gym_ready, fully_ready,
         xantaken, networth, gymenergy, captured_at)
        VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, 1)`)
        .run(member, `Member ${member}`, date, member === 102 ? 1 : 0, member === 102 ? 1 : 0,
          member === 102 ? Number(date.slice(-2)) : 999, member === 102 ? 1000 : 999999, 100);
    }
    db.prepare(`INSERT INTO member_personal_stats_recent
      (member_id, snapshot_date, status, error, target_timestamp, updated_at)
      VALUES (101, ?, 'pending', ?, 1, 1)`)
      .run(date, `PERSONALSTATS_BUCKET_MISMATCH: requested ${date}, received 2025-08-07`);
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

async function acceptDates() {
  for (const date of dates) {
    const issue = db.prepare("SELECT member_id, snapshot_date, status, error FROM member_personal_stats_recent WHERE member_id = 101 AND snapshot_date = ?").get(date);
    const response = await acceptDailyStatsIssueFromRequest(new Request("https://test/api/admin/data-health/daily-stats/accept", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(issue),
    }), env);
    expect(response.status).toBe(200);
  }
}

async function chart(metric, memberId = 101) {
  return (await getMemberLifestyleDailyChart(new URL(`https://test/api/member-lifestyle-stats/daily?start_date=2026-10-11&end_date=2026-10-12&metric=${metric}&member_id=${memberId}`), env)).json();
}

describe("accepted personal gaps in the Daily stats date range", () => {
  it("unlocks October reports and charts without fabricating values or changing competition completeness", async () => {
    const url = new URL("https://test/api/member-lifestyle-stats?start_date=2026-10-01&end_date=2026-10-14");
    const before = await (await getMemberLifestyleStats(url, env)).json();
    expect(before.period.available_end_date).toBe("2026-09-29");
    await acceptDates();
    const after = await (await getMemberLifestyleStats(url, env)).json();
    expect(after.period).toMatchObject({ start_date: "2026-10-01", end_date: "2026-10-12", available_end_date: "2026-10-12" });
    expect(after.members.map(row => row.member_id)).toEqual([102]);
    expect(after.summary).toMatchObject({ members: 1, total_xantaken: 11 });
    const missingChart = await chart("networth");
    expect(missingChart.period.end_date).toBe("2026-10-12");
    expect(missingChart.series[0].points.map(point => point.value)).toEqual([null, null]);
    expect((await chart("xantaken", 102)).series[0].points.at(-1)).toEqual({ date: "2026-10-12", value: 1 });
    expect((await readCompleteLifestyleSnapshotDateRange(env, "personal_ready")).end_date).toBe("2026-09-29");
    expect(db.prepare("SELECT last_started FROM sync_state WHERE name = ?").get(MEMBER_LIFESTYLE_CACHE_VERSION_NAME).last_started)
      .toBe(Math.floor(Date.now() / 1000));
    expect(db.prepare("SELECT personal_ready, fully_ready, xantaken FROM member_lifestyle_stat_snapshots WHERE member_id = 101 AND snapshot_date = '2026-10-12'").get())
      .toEqual({ personal_ready: 0, fully_ready: 0, xantaken: 999 });
  });

  it("matches accepted missing-data errors through retries but blocks a different failure", async () => {
    await acceptDates();
    db.exec("UPDATE member_personal_stats_recent SET status = 'retry_expired', error = 'PERSONALSTATS_BUCKET_MISMATCH: newer stale bucket' WHERE snapshot_date = '2026-10-12'");
    expect((await readCompleteLifestyleSnapshotDateRange(env, "fully_ready", allowGaps)).end_date).toBe("2026-10-12");
    db.exec("UPDATE member_personal_stats_recent SET error = 'Invalid API key' WHERE snapshot_date = '2026-10-12'");
    expect((await readCompleteLifestyleSnapshotDateRange(env, "fully_ready", allowGaps)).end_date).toBe("2026-10-11");
  });

  it("never waives missing gym data when a personal gap is accepted", async () => {
    await acceptDates();
    db.exec("UPDATE member_lifestyle_stat_snapshots SET gym_ready = 0 WHERE member_id = 101 AND snapshot_date >= '2026-10-12'");
    for (const filter of ["fully_ready", "gym_ready"]) {
      expect((await readCompleteLifestyleSnapshotDateRange(env, filter, allowGaps)).end_date).toBe("2026-10-11");
    }
    expect((await readCompleteLifestyleSnapshotDateRange(env, "personal_ready", allowGaps)).end_date).toBe("2026-10-12");
  });

  it("uses the member and date to match acceptances even without a queue or snapshot row", async () => {
    db.exec("DELETE FROM member_personal_stats_recent WHERE snapshot_date = '2026-10-12'; DELETE FROM member_lifestyle_stat_snapshots WHERE member_id = 101 AND snapshot_date = '2026-10-12'");
    const response = await acceptDailyStatsIssueFromRequest(new Request("https://test/accept", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ member_id: 101, snapshot_date: "2026-10-12", status: "pending", error: null }),
    }), env);
    expect(response.status).toBe(200);
    expect((await readCompleteLifestyleSnapshotDateRange(env, "personal_ready", allowGaps)).end_date).toBe("2026-10-12");
    expect((await chart("networth")).series[0].points.every(point => point.value === null)).toBe(true);
    expect((await readCompleteLifestyleSnapshotDateRange(env, "fully_ready", allowGaps)).end_date).toBe("2026-09-29");
  });

  it("keeps partial gym imports with errors from becoming fully available", async () => {
    await acceptDates();
    db.exec("UPDATE member_lifestyle_stat_snapshots SET gym_error = 'Missing gym contributor totals' WHERE member_id = 101 AND snapshot_date = '2026-10-12'");
    expect((await readCompleteLifestyleSnapshotDateRange(env, "fully_ready", allowGaps)).end_date).toBe("2026-10-11");
    expect((await readCompleteLifestyleSnapshotDateRange(env, "personal_ready", allowGaps)).end_date).toBe("2026-10-12");
  });
});
