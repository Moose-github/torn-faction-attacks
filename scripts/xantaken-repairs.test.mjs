import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAdminDataHealth, getDataHealthSummary } from "../src/dataHealth.ts";
import { createMemberLifestyleRepairJob } from "../src/lifestyleStats/repairJobs.ts";
import { queueImpossibleXantakenDeltaIfNeeded } from "../src/lifestyleStats/xantakenRechecks.ts";
import { readXantakenRepairDetails, reconcileXantakenRepairJob } from "../src/lifestyleStats/xantakenRepairs.ts";

vi.mock("../src/lifestyleStats/internal", async importOriginal => ({
  ...await importOriginal(),
  syncHomeFactionMemberList: vi.fn(async () => {}),
}));

let db;
let env;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-30T12:00:00Z"));
  db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../schema/current.sql", import.meta.url), "utf8"));
  env = { DB: {
    prepare(sql) {
      const statement = db.prepare(sql);
      let params = [];
      return {
        bind(...values) { params = values; return this; },
        async all() { return { results: statement.all(...params) }; },
        async first(column) { const row = statement.get(...params); return column ? row?.[column] ?? null : row ?? null; },
        async run() { return { meta: { changes: Number(statement.run(...params).changes) } }; },
      };
    },
    async batch(statements) { return Promise.all(statements.map(statement => statement.run())); },
  } };
  for (const member of [101, 102]) {
    db.prepare("INSERT INTO home_faction_members (member_id, faction_id, name, current_join_date) VALUES (?, 8803, ?, '2026-09-01')")
      .run(member, `Member ${member}`);
    for (const [date, total] of [["2026-09-27", 100], ["2026-09-28", 102], ["2026-09-29", 104]]) {
      db.prepare("INSERT INTO member_lifestyle_stat_snapshots (member_id, snapshot_date, personal_ready, captured_at, xantaken) VALUES (?, ?, 1, 1, ?)")
        .run(member, date, total);
    }
    db.prepare(`INSERT INTO member_lifestyle_xantaken_rechecks
      (member_id, member_name, snapshot_date, status, reason, requested_at, prior_xantaken, current_xantaken, next_xantaken,
       attempts, next_check_at, returned_bucket_date, returned_xantaken, last_error, created_at, updated_at)
      VALUES (?, ?, '2026-09-28', 'needs_repair', 'impossible_delta', 1, 100, 100, 109, 2, 1, '2026-09-28', 101, 'Impossible xantaken delta persisted after recheck', 1, 2)`)
      .run(member, `Member ${member}`);
  }
});
afterEach(() => { db.close(); vi.useRealTimers(); });

function request(overrides = {}) {
  return new Request("https://test/api/admin/member-lifestyle/repair-jobs", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ member_id: 101, start_date: "2026-09-28", end_date: "2026-09-29", xantaken_recheck_date: "2026-09-28", ...overrides }),
  });
}
async function create() {
  const response = await createMemberLifestyleRepairJob(request(), env);
  expect(response.status).toBe(200);
  return (await response.json()).job;
}
function completeItems(jobId) {
  db.prepare("UPDATE member_lifestyle_repair_items SET status = 'completed', returned_bucket_date = snapshot_date WHERE job_id = ?").run(jobId);
}
function status(memberId = 101) {
  return db.prepare("SELECT status FROM member_lifestyle_xantaken_rechecks WHERE member_id = ?").get(memberId).status;
}

describe("targeted Xanax repairs against SQLite", () => {
  it("returns the actual two issue records to admins without exposing details in the member summary", async () => {
    const body = await (await getAdminDataHealth(env)).json();
    expect(body.details.xantaken_rechecks.needs_repair).toBe(2);
    expect(body.details.xantaken_repair_details).toHaveLength(2);
    expect(body.details.xantaken_repair_details[0]).toMatchObject({
      member_id: 101, snapshot_date: "2026-09-28", attempts: 2, prior_xantaken: 100,
      current_xantaken: 100, next_xantaken: 109, returned_xantaken: 101,
      last_error: "Impossible xantaken delta persisted after recheck", repair_job_id: null,
    });
    const summary = await (await getDataHealthSummary(env)).json();
    expect(summary.details).toBeUndefined();
    expect(JSON.stringify(summary)).not.toContain("Member 101");
    expect(JSON.stringify(summary)).not.toContain("Impossible xantaken");
  });

  it("queues just the chosen member's three dates and reuses an active covering job", async () => {
    const job = await create();
    expect(job).toMatchObject({ member_id: 101, effective_start_date: "2026-09-27", end_date: "2026-09-29", total_items: 3 });
    expect(db.prepare("SELECT member_id, snapshot_date FROM member_lifestyle_repair_items ORDER BY snapshot_date").all()).toEqual([
      { member_id: 101, snapshot_date: "2026-09-27" },
      { member_id: 101, snapshot_date: "2026-09-28" },
      { member_id: 101, snapshot_date: "2026-09-29" },
    ]);
    expect((await create()).id).toBe(job.id);
    expect(db.prepare("SELECT COUNT(*) AS count FROM member_lifestyle_repair_jobs").get().count).toBe(1);
    expect((await readXantakenRepairDetails(env))[0]).toMatchObject({ repair_job_id: job.id, repair_status: "queued", repair_total_items: 3 });
    expect((await readXantakenRepairDetails(env))[1].repair_job_id).toBeNull();
  });

  it.each([
    { member_id: undefined }, { member_id: "oops" }, { member_id: 0 },
    { xantaken_recheck_date: "not-a-date" }, { end_date: "2026-09-28" }, { end_date: "2026-09-30" },
    { start_date: "2026-09-27" },
  ])("rejects invalid targeted scope: %j", async overrides => {
    const response = await createMemberLifestyleRepairJob(request(overrides), env);
    expect(response.status).toBe(400);
    expect(db.prepare("SELECT COUNT(*) AS count FROM member_lifestyle_repair_jobs").get().count).toBe(0);
  });

  it("does not reuse a job that predates the issue", async () => {
    const old = await create();
    db.prepare("UPDATE member_lifestyle_repair_jobs SET created_at = 0 WHERE id = ?").run(old.id);
    const fresh = await create();
    expect(fresh.id).not.toBe(old.id);
    expect((await readXantakenRepairDetails(env))[0].repair_job_id).toBe(fresh.id);
  });

  it("rejects an already resolved issue and a departed member", async () => {
    db.exec("UPDATE member_lifestyle_xantaken_rechecks SET status = 'auto_fixed' WHERE member_id = 101");
    expect((await createMemberLifestyleRepairJob(request(), env)).status).toBe(409);
    db.exec("UPDATE home_faction_members SET is_current = 0 WHERE member_id = 102");
    const response = await createMemberLifestyleRepairJob(request({ member_id: 102 }), env);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "MEMBER_NOT_CURRENT" });
  });

  it("only clears the selected warning after all three repaired days validate", async () => {
    const job = await create();
    await reconcileXantakenRepairJob(env, job.id);
    expect(status()).toBe("needs_repair");
    completeItems(job.id);
    await reconcileXantakenRepairJob(env, job.id);
    expect(status()).toBe("auto_fixed");
    expect(status(102)).toBe("needs_repair");
    const health = await (await getAdminDataHealth(env)).json();
    expect(health.details.xantaken_rechecks.needs_repair).toBe(1);
    expect(health.details.xantaken_repair_details.map(row => row.member_id)).toEqual([102]);
  });

  it.each([
    "UPDATE member_lifestyle_repair_items SET status = 'failed' WHERE snapshot_date = '2026-09-27'",
    "UPDATE member_lifestyle_repair_items SET status = 'skipped' WHERE snapshot_date = '2026-09-29'",
    "UPDATE member_lifestyle_repair_items SET returned_bucket_date = '2026-09-26' WHERE snapshot_date = '2026-09-27'",
    "UPDATE member_lifestyle_stat_snapshots SET xantaken = 109 WHERE snapshot_date = '2026-09-29'",
    "UPDATE member_lifestyle_stat_snapshots SET xantaken = 99 WHERE snapshot_date = '2026-09-29'",
    "UPDATE member_lifestyle_stat_snapshots SET xantaken = NULL WHERE snapshot_date = '2026-09-28'",
    "UPDATE member_lifestyle_stat_snapshots SET personal_ready = 0 WHERE snapshot_date = '2026-09-27'",
    "UPDATE member_lifestyle_repair_jobs SET status = 'cancelled'",
  ])("keeps the warning when repair cannot validate: %s", async mutation => {
    const job = await create();
    completeItems(job.id);
    db.exec(mutation);
    await reconcileXantakenRepairJob(env, job.id);
    expect(status()).toBe("needs_repair");
  });

  it("preserves an unresolved warning and its evidence when the evaluator sees another impossible delta", async () => {
    db.exec("UPDATE member_lifestyle_stat_snapshots SET xantaken = 109 WHERE member_id = 101 AND snapshot_date = '2026-09-29'");
    await queueImpossibleXantakenDeltaIfNeeded(env, 101, "2026-09-29");
    expect(status()).toBe("needs_repair");
    expect((await readXantakenRepairDetails(env))[0]).toMatchObject({ attempts: 2, returned_xantaken: 101, last_error: "Impossible xantaken delta persisted after recheck" });
  });
});
