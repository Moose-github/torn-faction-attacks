import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/xanaxCompetitionImageRenderer", () => ({ renderXanaxCompetitionReminderGif: vi.fn() }));

import { readPersonalStatsCoverageGaps } from "../src/dataHealth/queries";
import {
  readCompleteLifestyleSnapshotDateRange,
  readLatestCompletePersonalSnapshotDate,
} from "../src/lifestyleStats/queries";
import { getXanaxCompetition } from "../src/xanaxCompetition";

const schema = readFileSync(new URL("../schema/current.sql", import.meta.url), "utf8");
let db, env, statements;

function member(id, joinDate = "2020-01-01", exempt = 0) {
  db.prepare(`INSERT INTO home_faction_members (member_id, faction_id, name, current_join_date, report_exempt)
    VALUES (?, 8803, ?, ?, ?)`).run(id, `Member ${id}`, joinDate, exempt);
}
function snapshot(id, date, xantaken, ready = 1) {
  db.prepare(`INSERT INTO member_lifestyle_stat_snapshots (member_id, snapshot_date, personal_ready, xantaken, captured_at)
    VALUES (?, ?, ?, ?, 1)`).run(id, date, ready, xantaken);
}
function planFor(fragment) {
  const statement = statements.find(({ sql }) => sql.includes(fragment));
  return db.prepare(`EXPLAIN QUERY PLAN ${statement.sql}`).all(...statement.params).map((row) => row.detail).join("\n");
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-20T12:00:00Z"));
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
  db = new DatabaseSync(":memory:");
  db.exec(schema);
  statements = [];
  env = { DB: { prepare(sql) {
    const statement = db.prepare(sql);
    const record = { sql, params: [] };
    statements.push(record);
    return {
      bind(...values) { record.params = values; return this; },
      async all() { return { results: statement.all(...record.params) }; },
      async first() { return statement.get(...record.params) ?? null; },
      async run() { return { meta: { changes: Number(statement.run(...record.params).changes) } }; },
    };
  } } };
});

afterEach(() => { db.close(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("latest complete personal snapshot date", () => {
  beforeEach(() => {
    member(101); member(102);
    for (const date of ["2026-06-30", "2026-07-01", "2026-07-02"]) {
      snapshot(101, date, 10); snapshot(102, date, 20);
    }
    snapshot(101, "2026-07-03", 10);
    snapshot(102, "2026-07-03", 20, 0);
    snapshot(101, "2026-07-04", 10);
  });

  it("matches the end of the full range and stays within the requested month", async () => {
    const { end_date } = await readCompleteLifestyleSnapshotDateRange(env, "personal_ready");
    expect(end_date).toBe("2026-07-02");
    expect(await readLatestCompletePersonalSnapshotDate(env, "2026-07-01")).toBe(end_date);
    expect(await readLatestCompletePersonalSnapshotDate(env, "2026-07-03")).toBeNull();
  });

  it("applies the same report-exempt and join-date rules as the full range", async () => {
    member(103, "2026-07-04");
    member(104, "2020-01-01", 1);
    expect(await readLatestCompletePersonalSnapshotDate(env, "2026-07-01")).toBe("2026-07-02");
    snapshot(102, "2026-07-04", 20);
    expect(await readLatestCompletePersonalSnapshotDate(env, "2026-07-01")).toBe("2026-07-02");
    snapshot(103, "2026-07-04", 1);
    expect(await readLatestCompletePersonalSnapshotDate(env, "2026-07-01")).toBe("2026-07-04");
    expect((await readCompleteLifestyleSnapshotDateRange(env, "personal_ready")).end_date).toBe("2026-07-04");
  });

  it("walks the date index newest first without sorting or grouping every date", async () => {
    await readLatestCompletePersonalSnapshotDate(env, "2026-07-01");
    const plan = planFor("SELECT dates.snapshot_date");
    expect(plan).toMatch(/dates USING COVERING INDEX idx_member_lifestyle_snapshots_date/);
    expect(plan).not.toContain("TEMP B-TREE");
    expect(plan).not.toContain("CO-ROUTINE");
  });
});

describe("Xanax leaderboard reads", () => {
  it("returns month progress using each member's key instead of scanning the ready index", async () => {
    member(101); member(102, "2026-07-02");
    snapshot(101, "2026-06-30", 100);
    snapshot(101, "2026-07-02", 110);
    snapshot(102, "2026-07-02", 50);
    snapshot(101, "2026-07-10", 180);
    snapshot(102, "2026-07-10", 65);
    snapshot(101, "2026-07-11", 999, 0);

    const body = await (await getXanaxCompetition(env, 101)).json();

    expect(body.display).toMatchObject({ month_key: "2026-07", complete: false });
    expect(body.latest_snapshot_date).toBe("2026-07-10");
    expect(body.current_user_progress).toMatchObject({ member_id: 101, monthly_xanax: 80 });
    expect(body.leaderboard.find((row) => row.member_id === 102)).toMatchObject({ monthly_xanax: 15 });

    const plan = planFor("baseline.xantaken AS start_xantaken");
    expect(plan).not.toContain("personal_ready_latest");
    expect(plan).toMatch(/SEARCH member_lifestyle_stat_snapshots USING .*sqlite_autoindex_member_lifestyle_stat_snapshots_1 \(member_id=\? AND snapshot_date>\? AND snapshot_date<\?\)/);
    expect(plan).toMatch(/SEARCH member_lifestyle_stat_snapshots USING .*sqlite_autoindex_member_lifestyle_stat_snapshots_1 \(member_id=\? AND snapshot_date<\?\)/);
  });

  it("keeps the coverage gap lookup on the member key", async () => {
    member(101);
    snapshot(101, "2026-07-10", 10);
    db.prepare(`INSERT INTO member_personal_stats_recent (member_id, snapshot_date, status, error, target_timestamp, updated_at)
      VALUES (101, '2026-07-12', 'pending', NULL, 1, 1)`).run();

    const rows = await readPersonalStatsCoverageGaps(env, Date.now() / 1000);

    expect(rows[0]).toMatchObject({ member_id: 101, latest_personal_ready_date: "2026-07-10" });
    expect(planFor("latest_personal_ready_date")).not.toContain("personal_ready_latest");
  });
});
