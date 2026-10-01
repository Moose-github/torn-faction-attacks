import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isPracticalAttack, practicalDuration, resolvePhase, type PracticalPhase } from "../shared/practicalPhases";
import { closePracticalPhase, mutatePracticalPhases, practicalPhaseSummary, processPracticalPhases, readPracticalPhases } from "../src/practicalPhases";
import { HOME_FACTION_ID } from "../src/constants";
import { OUTGOING_ACTION_WINDOW_SQL } from "../src/sql";
import { exportWarAttacksCsv } from "../src/warExports";
import { getWarReportDiscrepancies } from "../src/reports";
import { reportAdjustmentTotals } from "../dashboard/src/components/ReportDiscrepancies";
import type { ReportDiscrepanciesResponse } from "../dashboard/src/api";
import type { Env } from "../src/types";
import { runPracticalPhaseHooks } from "../src/war/lifecycleHooks";
import { applyIncrementalWarSummaries, rebuildWarStatsFromRaw } from "../src/warStats";
import { updateOfficialWar } from "../src/wars";
import { toPracticalWarEditPayload, warToForm } from "../dashboard/src/views/AdminControls";
import type { WarSummary } from "../dashboard/src/api";

vi.mock("../src/ingestion", async (original) => ({
  ...await original<typeof import("../src/ingestion")>(),
  runIngestion: vi.fn(async (env: Env) => {
    const state = await env.DB.prepare("SELECT official_home_score FROM wars WHERE id=1").first<{ official_home_score: number }>();
    await processPracticalPhases(env, 1, state?.official_home_score ?? 0, Math.floor(Date.now() / 1000));
  }),
}));

vi.mock("../src/auth", () => ({ readAuthenticatedUserId: vi.fn(async () => 123) }));
vi.mock("../src/war/lifecycleHooks", async (original) => ({
  ...await original<typeof import("../src/war/lifecycleHooks")>(), runPracticalPhaseHooks: vi.fn(async () => true),
}));

let db: DatabaseSync, env: Env;
const base = 1_790_000_000;
const schema = readFileSync(new URL("../schema/current.sql", import.meta.url), "utf8");
function statement(sql: string, args: SQLInputValue[] = []) {
  return {
    sql,
    bind: (...values: SQLInputValue[]) => statement(sql, values),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => {
      const prepared = db.prepare(sql);
      const rows = prepared.columns().length ? prepared.all(...args) : [];
      const changes = prepared.columns().length ? Number(db.prepare("SELECT changes() AS n").get()!.n) : Number(prepared.run(...args).changes);
      return { results: rows, success: true, meta: { changes } };
    },
  };
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime((base + 25 * 3600) * 1000); vi.clearAllMocks();
  db = new DatabaseSync(":memory:"); db.exec(schema);
  env = { DB: { prepare: statement, batch: async (items: ReturnType<typeof statement>[]) => {
    db.exec("BEGIN");
    try { const result = []; for (const item of items) result.push(await item.run()); db.exec("COMMIT"); return result; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  } } } as unknown as Env;
});
afterEach(() => { db.close(); vi.useRealTimers(); });

function war(finish: number | null = base + 12 * 3600, target: number | null = 7000) {
  db.prepare(`INSERT INTO wars (id, name, status, war_type, practical_start_time, practical_finish_time,
    official_start_time, enemy_faction_id, faction_respect_limit, auto_end_enabled)
    VALUES (1, 'Test', 'active', 'termed', ?, ?, ?, 99, ?, 0)`).run(base, finish, base, target);
  db.prepare("INSERT INTO sync_state(name, last_started, active_war_id, war_state) VALUES ('attacks', 0, 1, ?)").run(finish === null ? "current" : "practically_finished");
}
function attack(id: number, at: number, respect: number, run: string | null = null) {
  db.prepare(`INSERT INTO attacks(id, war_id, started, ended, attacker_id, attacker_name, attacker_faction_id,
    defender_id, defender_faction_id, result, respect_gain, ingest_run_id)
    VALUES (?, 1, ?, ?, 10, 'Member', ?, 20, 99, 'Hospitalized', ?, ?)`).run(id, at - 10, at, HOME_FACTION_ID, respect, run);
}
async function command(body: Record<string, unknown>) {
  const url = new URL("https://test/api/wars/Test/practical-phases");
  return mutatePracticalPhases(new Request(url, { method: "POST", body: JSON.stringify(body) }), url, env);
}
async function schedule(target = 9000) {
  // Schedule in advance, then advance the worker clock.
  vi.setSystemTime((base + 13 * 3600) * 1000);
  const revision = (await practicalPhaseSummary(env, 1)).practical_revision;
  const response = await command({ action: "schedule", target, start_time: base + 24 * 3600, revision });
  expect(response.status).toBe(200);
  vi.setSystemTime((base + 25 * 3600) * 1000);
  return (await readPracticalPhases(env, 1))[1];
}

describe("practical phase database and lifecycle", () => {
  it.each([
    ["add_history", undefined], ["add_history", null], ["edit_history", ""],
  ])("calculates the historical target crossing for %s with finish %s", async (action, finish) => {
    war();
    attack(1, base + 12 * 3600, 7000);
    attack(2, base + 13 * 3600, 500); // Gap respect contributes to the cumulative target.
    attack(3, base + 15 * 3600, 500);
    attack(4, base + 16 * 3600, 1000);
    attack(5, base + 19 * 3600, 500.75);
    db.exec(`UPDATE wars SET status='ended', official_end_time=${base + 20 * 3600}, official_home_score=9500 WHERE id=1`);
    let revision = 0;
    let phaseId: string | undefined;
    if (action === "edit_history") {
      expect((await command({ action: "add_history", revision, target: 9000,
        start_time: base + 14 * 3600, finish_time: base + 18 * 3600 })).status).toBe(200);
      phaseId = (await readPracticalPhases(env, 1)).at(-1)!.id;
      revision++;
    }
    const response = await command({ action, phase_id: phaseId, revision, target: 8000,
      start_time: base + 14 * 3600, finish_time: finish });
    expect(response.status).toBe(200);
    expect((await readPracticalPhases(env, 1)).at(-1)).toMatchObject({
      start_time: base + 14 * 3600, finish_time: base + 15 * 3600,
      target: 8000, status: "completed", reason: "target_reached", effects_pending: 0,
    });
    expect(db.prepare("SELECT practical_finish_time, practical_revision FROM wars WHERE id=1").get())
      .toEqual({ practical_finish_time: base + 15 * 3600, practical_revision: revision + 1 });
    expect(db.prepare("SELECT respect_gained_raw FROM war_member_stats WHERE war_id=1").get()!.respect_gained_raw).toBe(7500);
    expect(runPracticalPhaseHooks).not.toHaveBeenCalled();
  });

  it("keeps an unfinished target phase open and closes at the future crossing attack", async () => {
    war(); attack(1, base + 12 * 3600, 7000); attack(2, base + 13 * 3600, 500);
    db.exec("UPDATE wars SET official_home_score=7500 WHERE id=1");
    expect((await command({ action: "add_history", revision: 0, target: 8000,
      start_time: base + 14 * 3600 })).status).toBe(200);
    expect((await readPracticalPhases(env, 1)).at(-1)).toMatchObject({ status: "active", finish_time: null });
    expect(db.prepare("SELECT practical_finish_time FROM wars WHERE id=1").get()!.practical_finish_time).toBeNull();
    expect(db.prepare("SELECT war_state FROM sync_state WHERE name='attacks'").get()!.war_state).toBe("current");
    attack(3, base + 26 * 3600, 600);
    vi.setSystemTime((base + 27 * 3600) * 1000);
    await processPracticalPhases(env, 1, 8100, base + 27 * 3600);
    expect((await readPracticalPhases(env, 1)).at(-1)).toMatchObject({
      status: "completed", finish_time: base + 26 * 3600, reason: "target_reached",
    });
    expect(db.prepare("SELECT respect_gained_raw FROM war_member_stats WHERE war_id=1").get()!.respect_gained_raw).toBe(7600);
  });

  it.each([
    { score: null, target: 8000, error: "attack history matches" },
    { score: 9000, target: 8000, error: "attack history matches" },
    { score: 8000, target: 7000, error: "before this phase starts" },
    { score: 8000, target: 9000, error: "not reached before the war ended" },
  ])("rejects unresolvable automatic history without saving ($error, score $score)", async ({ score, target, error }) => {
    war(); attack(1, base + 12 * 3600, 7000); attack(2, base + 16 * 3600, 1000);
    db.prepare("UPDATE wars SET status='ended', official_end_time=?, official_home_score=? WHERE id=1")
      .run(base + 20 * 3600, score);
    const response = await command({ action: "add_history", revision: 0, target, start_time: base + 14 * 3600 });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ saved: false, error: expect.stringContaining(error) });
    expect((await practicalPhaseSummary(env, 1)).practical_revision).toBe(0);
    expect(await readPracticalPhases(env, 1)).toHaveLength(1);
    expect(db.prepare("SELECT COUNT(*) AS n FROM war_practical_phase_audit").get()!.n).toBe(0);
  });

  it("rejects a calculated finish that overlaps another recorded phase", async () => {
    war(); attack(1, base + 12 * 3600, 7000); attack(2, base + 16 * 3600, 1000);
    db.exec("UPDATE wars SET official_home_score=8000 WHERE id=1");
    expect((await command({ action: "add_history", revision: 0, target: 9000,
      start_time: base + 14 * 3600, finish_time: base + 18 * 3600 })).status).toBe(200);
    const response = await command({ action: "edit_history", phase_id: "initial-1", revision: 1,
      target: 8000, start_time: base, finish_time: null });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ saved: false, error: expect.stringContaining("must not overlap") });
    expect((await readPracticalPhases(env, 1))[0].finish_time).toBe(base + 12 * 3600);
  });

  it("reconciles automatic closure against a truncated final report score", async () => {
    war(null); attack(1, base + 12 * 3600, 7000.75);
    await processPracticalPhases(env, 1, 7000, base + 25 * 3600, base + 20 * 3600);
    expect((await readPracticalPhases(env, 1))[0]).toMatchObject({
      status: "completed", finish_time: base + 12 * 3600, reason: "target_reached",
    });
  });

  it.each([false, true])("reconciles all excluded windows with a reopened phase (active: %s)", async (active) => {
    war();
    db.exec(`UPDATE wars SET official_start_time=${base - 3600}, official_end_time=${base + 30 * 3600} WHERE id=1`);
    attack(1, base - 1800, 12); // Before the first practical phase, within the official war.
    attack(2, base + 12 * 3600, 20); // Inclusive phase finish.
    attack(3, base + 13 * 3600, 30); // Gap.
    attack(4, base + 14 * 3600 + 10, 40); // Starts exactly at reopening.
    attack(5, base + 16 * 3600, 50); // Inclusive second finish.
    attack(6, base + 17 * 3600, 60); // After the last completed phase.
    attack(7, base + 14 * 3600 + 5, 7); // Starts in the gap, ends inside phase two.
    attack(8, base + 13 * 3600 + 10, 0);
    attack(9, base + 15 * 3600, 0);
    db.exec("UPDATE attacks SET result='Unknown' WHERE id IN (8,9)");
    db.exec("UPDATE attacks SET chain=10 WHERE id IN (3,5)"); // Adjust only the bonus inside a phase.
    expect((await command({ action: "add_history", revision: 0, target: 9000,
      start_time: base + 14 * 3600, finish_time: base + 16 * 3600 })).status).toBe(200);
    if (active) {
      db.exec("UPDATE war_practical_phases SET status='active', finish_time=NULL WHERE reason='history_correction'");
      db.exec("UPDATE wars SET practical_finish_time=NULL WHERE id=1");
    }
    await rebuildWarStatsFromRaw(env, { scope: "single-war", warId: 1 });
    const response = await getWarReportDiscrepancies(new URL("https://test/api/wars/Test/report-discrepancies"), env);
    expect(response.status).toBe(200);
    const report = await response.json() as ReportDiscrepanciesResponse;
    const excludedIds = active ? [1, 3, 7] : [1, 3, 6, 7];
    expect(report.groups.after_practical_finish.attacks.map((row) => row.id).sort((a, b) => a - b)).toEqual(excludedIds);
    expect(report.groups.after_practical_finish.respect_gain).toBe(active ? 49 : 109);
    expect(report.groups.uncounted_enemy_results.attacks.map((row) => row.id)).toEqual([9]);
    expect(report.groups.chain_bonus_adjustments.attacks.map((row) => row.id)).toEqual([5]);
    const adjustment = reportAdjustmentTotals(report);
    const stats = db.prepare("SELECT SUM(attacks_vs_enemy_successful) AS attacks, SUM(respect_gained) AS respect FROM war_member_stats WHERE war_id=1").get()!;
    expect(7 + adjustment.attackDelta).toBe(stats.attacks);
    expect(219 + adjustment.respectDelta).toBe(stats.respect);
  });

  it.each(["real", "termed"])("bounds single-window report adjustments by official times (%s)", async (type) => {
    war();
    db.prepare("UPDATE wars SET war_type=?, official_start_time=?, official_end_time=? WHERE id=1")
      .run(type, base - 3600, base + 20 * 3600);
    attack(1, base - 3600, 5); // Starts outside the official war.
    attack(2, base - 1800, 10); // Before practical start.
    attack(3, base + 12 * 3600, 20); // At practical finish.
    attack(4, base + 20 * 3600, 30); // At official finish.
    attack(5, base + 20 * 3600 + 1, 40); // Ends outside the official war.
    const response = await getWarReportDiscrepancies(new URL("https://test/api/wars/Test/report-discrepancies"), env);
    expect(response.status).toBe(200);
    const report = await response.json() as ReportDiscrepanciesResponse;
    expect(report.groups.after_practical_finish.count).toBe(2);
    expect(report.groups.after_practical_finish.respect_gain).toBe(40);
    expect(report.groups.after_practical_finish.attacks.map((row) => row.id).sort()).toEqual([2, 4]);
  });

  it("saves member and enemy targets from the admin form without rounding phase boundaries", async () => {
    war();
    const saved = db.prepare("SELECT * FROM wars WHERE id=1").get()!;
    const form = warToForm(saved as unknown as WarSummary);
    form.memberRespectLimit = "100";
    form.enemyTargetRespect = "5000";
    const payload = toPracticalWarEditPayload(1, form);
    expect(payload).not.toHaveProperty("practical_start_time");
    expect(payload).not.toHaveProperty("practical_finish_time");
    expect(payload).not.toHaveProperty("faction_respect_limit");
    const response = await updateOfficialWar(new Request("https://test/api/wars/update-official", {
      method: "POST", body: JSON.stringify(payload),
    }), env);
    expect(response.status).toBe(200);
    expect(db.prepare("SELECT * FROM wars WHERE id=1").get()).toMatchObject({
      practical_start_time: base, practical_finish_time: base + 12 * 3600,
      faction_respect_limit: 7000, member_respect_limit: 100, enemy_target_respect: 5000,
      practical_revision: 1,
    });
    expect((await readPracticalPhases(env, 1))[0]).toMatchObject({ start_time: base, finish_time: base + 12 * 3600 });
  });

  it("retains practical-window input when converting a real war to termed", () => {
    war();
    const form = warToForm({ ...db.prepare("SELECT * FROM wars WHERE id=1").get(), war_type: "real" } as unknown as WarSummary);
    form.warType = "termed";
    form.factionRespectLimit = "9000";
    expect(toPracticalWarEditPayload(1, form)).toMatchObject({
      practical_start_time: expect.any(Number), practical_finish_time: expect.any(Number), faction_respect_limit: 9000,
    });
  });

  it("rejects concurrent settings saves and phase edits with the old revision", async () => {
    war();
    const update = (target: number) => updateOfficialWar(new Request("https://test/api/wars/update-official", {
      method: "POST", body: JSON.stringify({ id: 1, practical_revision: 0, member_respect_limit: target }),
    }), env);
    const responses = await Promise.all([update(100), update(200)]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(await responses.find((response) => response.status === 409)!.json()).toMatchObject({ code: "STALE_PHASE_REVISION" });
    expect((await practicalPhaseSummary(env, 1)).practical_revision).toBe(1);
    expect((await command({ action: "schedule", revision: 0, target: 9000, start_time: base + 26 * 3600 })).status).toBe(409);
  });

  it.each(["before", "after"])("counts an ingestion batch once when a correction runs %s it", async (order) => {
    war(); attack(1, base + 9 * 3600, 500);
    await rebuildWarStatsFromRaw(env, { scope: "single-war", warId: 1 });
    attack(2, base + 10 * 3600, 500, "in-flight");
    const correct = async () => expect((await command({ action: "add_history", revision: 0, target: 9000,
      start_time: base + 14 * 3600, finish_time: base + 16 * 3600 })).status).toBe(200);
    if (order === "before") await correct();
    await applyIncrementalWarSummaries(env, 1, "in-flight");
    if (order === "after") await correct();
    await applyIncrementalWarSummaries(env, 1, "in-flight");
    expect(db.prepare("SELECT attacks_vs_enemy_total, respect_gained_raw FROM war_member_stats WHERE war_id=1").get())
      .toEqual({ attacks_vs_enemy_total: 2, respect_gained_raw: 1000 });
    expect(db.prepare("SELECT attacks_vs_enemy_total, total_respect_gain_raw FROM war_summary WHERE war_id=1").get())
      .toEqual({ attacks_vs_enemy_total: 2, total_respect_gain_raw: 1000 });
    expect(db.prepare("SELECT SUM(attacks_successful) AS n FROM war_member_combat_buckets WHERE war_id=1").get()!.n).toBe(2);
    expect(db.prepare("SELECT ingest_run_id, stats_pending FROM attacks WHERE id=2").get())
      .toEqual({ ingest_run_id: "in-flight", stats_pending: 0 });
  });

  it("does not consume later pages of the same ingestion run during a rebuild", async () => {
    war(); attack(1, base + 9 * 3600, 500, "paged");
    await rebuildWarStatsFromRaw(env, { scope: "single-war", warId: 1 });
    attack(2, base + 10 * 3600, 500, "paged");
    attack(3, base + 18 * 3600, 500, "paged"); // Gap attack is still acknowledged.
    await applyIncrementalWarSummaries(env, 1, "paged");
    await applyIncrementalWarSummaries(env, 1, "paged");
    expect(db.prepare("SELECT attacks_vs_enemy_total FROM war_member_stats WHERE war_id=1").get()!.attacks_vs_enemy_total).toBe(2);
    expect(db.prepare("SELECT COUNT(*) AS n FROM attacks WHERE stats_pending=1").get()!.n).toBe(0);
  });

  it("rechecks pending attacks inside the transaction if a rebuild wins after the initial count", async () => {
    war(); attack(1, base + 9 * 3600, 500, "racing");
    const batch = env.DB.batch.bind(env.DB);
    let intercepted = false;
    env.DB.batch = (async (items: Array<ReturnType<typeof statement>>) => {
      if (!intercepted && items[0].sql.includes("a.ingest_run_id = ?")) {
        intercepted = true;
        await rebuildWarStatsFromRaw(env, { scope: "single-war", warId: 1 });
      }
      return batch(items as unknown as D1PreparedStatement[]);
    }) as typeof env.DB.batch;
    await applyIncrementalWarSummaries(env, 1, "racing");
    expect(intercepted).toBe(true);
    expect(db.prepare("SELECT attacks_vs_enemy_total FROM war_member_stats WHERE war_id=1").get()!.attacks_vs_enemy_total).toBe(1);
  });

  it.each(["incremental", "rebuild"])("rolls back partial %s statistics and safely retries", async (mode) => {
    war(); attack(1, base + 9 * 3600, 500, "original");
    await applyIncrementalWarSummaries(env, 1, "original");
    attack(2, base + 10 * 3600, 500, "retry");
    db.exec("CREATE TRIGGER fail_review_stats BEFORE INSERT ON war_summary BEGIN SELECT RAISE(ABORT, 'simulated failure'); END;");
    const apply = () => mode === "incremental"
      ? applyIncrementalWarSummaries(env, 1, "retry")
      : rebuildWarStatsFromRaw(env, { scope: "single-war", warId: 1 });
    await expect(apply()).rejects.toThrow("simulated failure");
    expect(db.prepare("SELECT attacks_vs_enemy_total FROM war_member_stats WHERE war_id=1").get()!.attacks_vs_enemy_total).toBe(1);
    expect(db.prepare("SELECT stats_pending FROM attacks WHERE id=2").get()!.stats_pending).toBe(1);
    db.exec("DROP TRIGGER fail_review_stats");
    await apply();
    await applyIncrementalWarSummaries(env, 1, "retry");
    expect(db.prepare("SELECT attacks_vs_enemy_total FROM war_member_stats WHERE war_id=1").get()!.attacks_vs_enemy_total).toBe(2);
  });

  it("recovers failed ingestion on the next phase tick without needing another attack", async () => {
    war(); attack(1, base + 9 * 3600, 500, "failed-run");
    db.exec("CREATE TRIGGER fail_review_stats BEFORE INSERT ON war_summary BEGIN SELECT RAISE(ABORT, 'simulated failure'); END;");
    await expect(applyIncrementalWarSummaries(env, 1, "failed-run")).rejects.toThrow("simulated failure");
    expect((await practicalPhaseSummary(env, 1)).practical_rebuild_pending).toBe(1);
    db.exec("DROP TRIGGER fail_review_stats");
    await processPracticalPhases(env, 1, 500, base + 25 * 3600);
    expect((await practicalPhaseSummary(env, 1)).practical_rebuild_pending).toBe(0);
    expect(db.prepare("SELECT attacks_vs_enemy_total FROM war_member_stats WHERE war_id=1").get()!.attacks_vs_enemy_total).toBe(1);
    expect(db.prepare("SELECT stats_pending FROM attacks WHERE id=1").get()!.stats_pending).toBe(0);
  });

  it("reopens immediately using the requested timestamp and can start a pending phase now", async () => {
    war(); attack(1, base + 12 * 3600, 7000);
    db.exec("UPDATE wars SET official_home_score=7000 WHERE id=1");
    const now = Math.floor(Date.now() / 1000);
    expect((await command({ action: "reopen", target: 9000, revision: 0 })).status).toBe(200);
    expect((await readPracticalPhases(env, 1))[1]).toMatchObject({ status: "active", start_time: now });
    await closePracticalPhase(env, 1, now + 10);
    vi.setSystemTime((now + 20) * 1000);
    expect((await command({ action: "schedule", target: 10000, start_time: now + 3600, revision: 3 })).status).toBe(200);
    const pending = (await readPracticalPhases(env, 1)).at(-1)!;
    expect((await command({ action: "start_now", phase_id: pending.id, revision: 4 })).status).toBe(200);
    expect((await readPracticalPhases(env, 1)).at(-1)).toMatchObject({ status: "active", start_time: now + 20 });
  });

  it("exposes and recovers a saved correction whose stats rebuild failed", async () => {
    war(); attack(1, base + 12 * 3600, 7000);
    db.exec("CREATE TRIGGER fail_phase_stats BEFORE INSERT ON war_summary BEGIN SELECT RAISE(ABORT, 'simulated rebuild failure'); END;");
    const response = await command({ action: "add_history", revision: 0, target: 9000, start_time: base + 14 * 3600, finish_time: base + 16 * 3600 });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ saved: true, code: "PHASE_RECONCILIATION_PENDING" });
    expect((await practicalPhaseSummary(env, 1)).practical_rebuild_pending).toBe(1);
    db.exec("DROP TRIGGER fail_phase_stats");
    expect((await command({ action: "retry", revision: 1 })).status).toBe(200);
    expect((await practicalPhaseSummary(env, 1)).practical_rebuild_pending).toBe(0);
    expect(runPracticalPhaseHooks).not.toHaveBeenCalled();
  });

  it("retries incomplete lifecycle effects without duplicating the phase transition", async () => {
    war(); attack(1, base + 12 * 3600, 7000); await schedule();
    vi.mocked(runPracticalPhaseHooks).mockResolvedValueOnce(false);
    await processPracticalPhases(env, 1, 7000, base + 25 * 3600);
    expect((await readPracticalPhases(env, 1))[1].effects_pending).toBe(1);
    const revision = (await practicalPhaseSummary(env, 1)).practical_revision;
    await processPracticalPhases(env, 1, 7000, base + 25 * 3600);
    expect((await readPracticalPhases(env, 1))[1].effects_pending).toBe(0);
    expect((await practicalPhaseSummary(env, 1)).practical_revision).toBe(revision);
  });

  it("bounds unresolved active phases by official end and later reconciles the crossing", async () => {
    war(null); attack(1, base + 12 * 3600, 6000);
    const end = base + 20 * 3600;
    await processPracticalPhases(env, 1, 7000, base + 25 * 3600, end);
    expect((await readPracticalPhases(env, 1))[0]).toMatchObject({ status: "completed", finish_time: end, reason: "awaiting_reconciliation" });
    attack(2, base + 18 * 3600, 1000);
    await processPracticalPhases(env, 1, 7000, base + 25 * 3600, end);
    expect((await readPracticalPhases(env, 1))[0]).toMatchObject({ status: "completed", finish_time: base + 18 * 3600, reason: "target_reached" });
  });
  it("keeps gap attacks in the cumulative score but out of practical totals and duration", async () => {
    war(); attack(1, base + 12 * 3600, 7000); attack(2, base + 18 * 3600, 1000);
    await schedule(); attack(3, base + 25 * 3600, 1000);
    await processPracticalPhases(env, 1, 9000, base + 25 * 3600);
    const result = await practicalPhaseSummary(env, 1);
    expect(result.practical_phases.map((p) => p.status)).toEqual(["completed", "completed"]);
    expect(result.practical_duration_seconds).toBe(13 * 3600);
    const ids = db.prepare(`SELECT a.id FROM attacks a JOIN wars w ON w.id=a.war_id WHERE ${OUTGOING_ACTION_WINDOW_SQL} ORDER BY a.id`).all();
    expect(ids.map((row) => row.id)).toEqual([1, 3]);
    const stats = db.prepare("SELECT attacks_vs_enemy_total, respect_gained_raw FROM war_member_stats WHERE war_id=1").get();
    expect(stats).toMatchObject({ attacks_vs_enemy_total: 2, respect_gained_raw: 8000 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM attacks WHERE war_id=1").get()!.n).toBe(3);
  });

  it.each([23, 24])("skips a target reached by reopening (hour %i)", async (hour) => {
    war(); attack(1, base + 12 * 3600, 7000); attack(2, base + hour * 3600, 2000);
    await schedule(); await processPracticalPhases(env, 1, 9000, base + 25 * 3600);
    const result = await practicalPhaseSummary(env, 1);
    expect(result.practical_phases[1]).toMatchObject({ status: "skipped", start_time: null, finish_time: null });
    expect(result.practical_duration_seconds).toBe(12 * 3600);
    expect(runPracticalPhaseHooks).not.toHaveBeenCalled();
  });

  it("opens from the scheduled timestamp and processes a repeated tick only once", async () => {
    war(); attack(1, base + 12 * 3600, 7000); await schedule();
    await processPracticalPhases(env, 1, 7000, base + 25 * 3600);
    await processPracticalPhases(env, 1, 7000, base + 25 * 3600);
    expect((await readPracticalPhases(env, 1))[1]).toMatchObject({ status: "active", start_time: base + 24 * 3600 });
    expect(runPracticalPhaseHooks).toHaveBeenCalledTimes(1);
    expect(db.prepare("SELECT war_state FROM sync_state WHERE name='attacks'").get()!.war_state).toBe("current");
  });

  it("waits for complete evidence instead of guessing a delayed crossing", async () => {
    war(); attack(1, base + 12 * 3600, 7000); await schedule();
    await processPracticalPhases(env, 1, 9000, base + 25 * 3600);
    expect((await readPracticalPhases(env, 1))[1]).toMatchObject({ status: "scheduled", reason: "awaiting_reconciliation" });
    attack(2, base + 23 * 3600, 2000);
    await processPracticalPhases(env, 1, 9000, base + 25 * 3600);
    expect((await readPracticalPhases(env, 1))[1].status).toBe("skipped");
  });

  it("closes the initial phase regardless of the obsolete auto-end flag", async () => {
    war(null); attack(1, base + 12 * 3600, 7000);
    await processPracticalPhases(env, 1, 7000, base + 25 * 3600);
    expect((await readPracticalPhases(env, 1))[0]).toMatchObject({ status: "completed", finish_time: base + 12 * 3600 });
  });

  it("retains manual phase closure and leaves the official war open", async () => {
    war(null); await closePracticalPhase(env, 1, base + 3600);
    expect(db.prepare("SELECT status, practical_finish_time FROM wars WHERE id=1").get()).toMatchObject({ status: "active", practical_finish_time: base + 3600 });
  });

  it("rejects scheduling over an active phase and a second pending phase", async () => {
    war(null);
    expect((await command({ action: "schedule", target: 9000, start_time: base + 26 * 3600, revision: 0 })).status).toBe(400);
    await closePracticalPhase(env, 1, base + 12 * 3600); await schedule();
    expect((await command({ action: "schedule", target: 10000, start_time: base + 26 * 3600, revision: 2 })).status).toBe(400);
  });

  it("edits and cancels a pending phase, rejecting stale revisions", async () => {
    war(); const pending = await schedule();
    expect((await command({ action: "update", phase_id: pending.id, target: 10000, start_time: base + 26 * 3600, revision: 1 })).status).toBe(200);
    expect((await command({ action: "cancel", phase_id: pending.id, revision: 1 })).status).toBe(409);
    expect((await command({ action: "cancel", phase_id: pending.id, revision: 2 })).status).toBe(200);
    expect((await readPracticalPhases(env, 1))[1].status).toBe("cancelled");
  });

  it("cancels a future phase at official end", async () => {
    war(); await schedule(); await processPracticalPhases(env, 1, 7000, base + 25 * 3600, base + 23 * 3600);
    expect((await readPracticalPhases(env, 1))[1]).toMatchObject({ status: "cancelled", reason: "official_end" });
  });

  it("records an overdue phase that opened before official end", async () => {
    war(); attack(1, base + 12 * 3600, 7000); await schedule();
    await processPracticalPhases(env, 1, 7000, base + 25 * 3600, base + 24 * 3600 + 600);
    expect((await readPracticalPhases(env, 1))[1]).toMatchObject({ status: "completed", start_time: base + 24 * 3600, finish_time: base + 24 * 3600 + 600 });
  });

  it("audits add/edit/remove history and rebuilds totals without live hooks", async () => {
    war(); attack(1, base + 12 * 3600, 7000); attack(2, base + 15 * 3600, 1000);
    const added = await command({ action: "add_history", revision: 0, target: 9000, start_time: base + 14 * 3600, finish_time: base + 16 * 3600 });
    expect(added.status).toBe(200);
    const phase = (await readPracticalPhases(env, 1))[1];
    expect(db.prepare("SELECT attacks_vs_enemy_total FROM war_member_stats WHERE war_id=1").get()!.attacks_vs_enemy_total).toBe(2);
    expect((await command({ action: "edit_history", revision: 1, phase_id: phase.id, target: 10000, start_time: base + 15 * 3600, finish_time: base + 16 * 3600 })).status).toBe(200);
    expect(db.prepare("SELECT attacks_vs_enemy_total FROM war_member_stats WHERE war_id=1").get()!.attacks_vs_enemy_total).toBe(1);
    expect((await command({ action: "remove_history", revision: 2, phase_id: phase.id })).status).toBe(200);
    expect((await practicalPhaseSummary(env, 1)).practical_phases).toHaveLength(1);
    expect(db.prepare("SELECT actor_id FROM war_practical_phase_audit").all()).toHaveLength(3);
    expect(runPracticalPhaseHooks).not.toHaveBeenCalled();
  });

  it("rejects overlap and corrections outside official bounds", async () => {
    war();
    expect((await command({ action: "add_history", revision: 0, target: 9000, start_time: base + 3600, finish_time: base + 16 * 3600 })).status).toBe(400);
    expect((await command({ action: "add_history", revision: 0, target: 9000, start_time: base - 3600, finish_time: base - 100 })).status).toBe(400);
  });

  it("practical exports exclude gaps while official exports include them", async () => {
    war(); attack(1, base + 12 * 3600, 7000); attack(2, base + 18 * 3600, 1000); await schedule(); attack(3, base + 25 * 3600, 1000);
    await processPracticalPhases(env, 1, 9000, base + 25 * 3600);
    const practical = await (await exportWarAttacksCsv(new URL("https://test/api/wars/Test/attacks?window=practical"), env)).text();
    const official = await (await exportWarAttacksCsv(new URL("https://test/api/wars/Test/attacks?window=official"), env)).text();
    expect(practical.trim().split("\n")).toHaveLength(3); expect(official.trim().split("\n")).toHaveLength(4);
  });

  it("incremental counting and rebuilds agree for gap attacks", async () => {
    war(); attack(1, base + 12 * 3600, 7000, "run"); attack(2, base + 18 * 3600, 1000, "run");
    await applyIncrementalWarSummaries(env, 1, "run");
    const before = db.prepare("SELECT attacks_vs_enemy_total FROM war_member_stats WHERE war_id=1").get();
    await rebuildWarStatsFromRaw(env, { scope: "single-war", warId: 1 });
    expect(db.prepare("SELECT attacks_vs_enemy_total FROM war_member_stats WHERE war_id=1").get()).toEqual(before);
  });
});

describe("phase boundary rules", () => {
  const phase: PracticalPhase = { id: "a", war_id: 1, target: 9000, scheduled_start: 300, start_time: 300, finish_time: 400, status: "completed", reason: null, removed_at: null, effects_pending: 0 };
  it("requires start and finish in the same phase, including its target crossing hit", () => {
    expect(isPracticalAttack({ started: 299, ended: 310 }, [phase])).toBe(false);
    expect(isPracticalAttack({ started: 390, ended: 400 }, [phase])).toBe(true);
    expect(isPracticalAttack({ started: 390, ended: 401 }, [phase])).toBe(false);
    expect(isPracticalAttack({ started: 350, ended: null }, [phase])).toBe(true);
    expect(isPracticalAttack({ started: 390, ended: 400 }, [phase], 399)).toBe(false);
    expect(practicalDuration([phase], 999)).toBe(100);
  });
  it("does not invent a target for legacy data", () => {
    expect(resolvePhase({ ...phase, status: "active", target: null, finish_time: null }, { score: 9000, observed_at: 500, crossing_at: 400, complete: true }, 500, null).reason).toBe("target_required");
  });
});

it("adds pending-stat markers without rewriting attack data or ingestion metadata", () => {
  const legacy = new DatabaseSync(":memory:");
  try {
    legacy.exec(schema.match(/CREATE TABLE wars \([\s\S]*?\n\);/)![0]);
    legacy.exec(schema.match(/CREATE TABLE attacks \([\s\S]*?\n\);/)![0]
      .replace("  stats_pending INTEGER NOT NULL DEFAULT 1 CHECK (stats_pending IN (0, 1)),\n", ""));
    legacy.exec("INSERT INTO attacks(id, started, respect_gain, ingest_run_id) VALUES (1, 100, 12.5, 'original-run')");
    const before = legacy.prepare("SELECT * FROM attacks").get()!;
    legacy.exec(readFileSync(new URL("../migrations/0171_track_pending_attack_stats.sql", import.meta.url), "utf8"));
    const { stats_pending, ...after } = legacy.prepare("SELECT * FROM attacks").get()!;
    expect(after).toEqual(before);
    expect(stats_pending).toBe(1);
    legacy.exec("INSERT INTO attacks(id) VALUES (2)");
    expect(legacy.prepare("SELECT stats_pending FROM attacks WHERE id=2").get()!.stats_pending).toBe(1);
  } finally { legacy.close(); }
});

it("migrates existing windows without rewriting their boundaries or targets", () => {
  const legacy = new DatabaseSync(":memory:");
  try {
    const table = schema.match(/CREATE TABLE wars \([\s\S]*?\n\);/)![0]
      .replace("  practical_revision INTEGER NOT NULL DEFAULT 0,\n", "")
      .replace("  practical_rebuild_pending INTEGER NOT NULL DEFAULT 0,\n", "");
    legacy.exec(table);
    legacy.exec(`INSERT INTO wars(id,name,status,war_type,practical_start_time,practical_finish_time,faction_respect_limit)
      VALUES (1,'closed','ended','termed',100,200,7000), (2,'open','active','termed',300,NULL,9000),
        (3,'future','scheduled','termed',1000,NULL,5000), (4,'real','active','real',100,NULL,NULL);`);
    const before = legacy.prepare("SELECT * FROM wars ORDER BY id").all();
    legacy.exec(readFileSync(new URL("../migrations/0170_add_practical_phases.sql", import.meta.url), "utf8"));
    expect(legacy.prepare("SELECT war_id, status, start_time, finish_time, target FROM war_practical_phases ORDER BY war_id").all()).toEqual([
      { war_id: 1, status: "completed", start_time: 100, finish_time: 200, target: 7000 },
      { war_id: 2, status: "active", start_time: 300, finish_time: null, target: 9000 },
      { war_id: 3, status: "scheduled", start_time: null, finish_time: null, target: 5000 },
    ]);
    expect(legacy.prepare("SELECT * FROM wars ORDER BY id").all().map(({ practical_revision, practical_rebuild_pending, ...row }) => row)).toEqual(before);
  } finally { legacy.close(); }
});
