import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createManualEvent, updateEvent, deleteWar } from "../src/wars";
import { initializeIndependentEvents, refreshEventTracking } from "../src/eventTracking";
import { finishEventTracking } from "../src/warLifecycle";
import { rebuildWarStatsFromRaw, applyIncrementalWarSummaries } from "../src/warStats";
import { getWarAttacks, getWarMemberAttacks, getOverallStats } from "../src/warQueries";
import { exportWarAttacksCsv } from "../src/warExports";
import { relinkWarAttacks } from "../src/warRelink";
import { readChainWatchDemand } from "../src/chainWatchDemand";
import type { Env } from "../src/types";

// External collection is covered separately; these tests exercise the real SQL,
// lifecycle, summaries, and API readers using overlapping attack windows.
vi.mock("../src/chainWatchWar", () => ({ setChainWatchEnabledForWar: vi.fn() }));

const START = 1793404800;
const schema = readFileSync(new URL("../schema/current.sql", import.meta.url), "utf8");
let db: DatabaseSync;
let env: Env;
function statement(sql: string, values: SQLInputValue[] = []) {
  return {
    bind: (...args: SQLInputValue[]) => statement(sql, args),
    first: async () => db.prepare(sql).get(...values) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...values) }),
    run: async () => ({ success: true, meta: { changes: Number(db.prepare(sql).run(...values).changes) } }),
  };
}
function request(body: unknown) {
  return new Request("https://test/api/events", { method: "POST", body: JSON.stringify(body) });
}
function globalWar() { return db.prepare("SELECT active_war_id, war_state FROM sync_state WHERE name = 'attacks'").get(); }
function ownership() { return db.prepare("SELECT id, war_id FROM attacks ORDER BY id").all(); }
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
    try { const results = []; for (const item of items) results.push(await item.run()); db.exec("COMMIT"); return results; }
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
afterEach(() => { db.close(); vi.useRealTimers(); });

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
    await applyIncrementalWarSummaries(env, 1, "batch");
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
    vi.setSystemTime((START + 901) * 1000);
    await refreshEventTracking(env);
    expect(db.prepare("SELECT status FROM wars WHERE id = ?").get(eventId)?.status).toBe("ended");
    expect(db.prepare("SELECT final_requested_at FROM event_competition_state WHERE war_id = ?").get(eventId)?.final_requested_at).toBe(START + 901);
    expect(db.prepare("SELECT attacks_vs_enemy_total FROM war_summary WHERE war_id = ?").get(eventId)?.attacks_vs_enemy_total).toBe(1);
    expect(globalWar()).toEqual({ active_war_id: 1, war_state: "current" });
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
