import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env, WarRow } from "../src/types";
import {
  collectInitialHalloweenBaseline, ensureEventCompetitionStarted, parseCompetitionReading, parseEventCompetitionSettings,
  readEventCompetition, requestEventCompetitionFinish, rescheduleEventCompetition, runEventCompetitionCron,
  updateEliminationTeamStatus,
} from "../src/eventCompetition";
import { bumpWarCacheVersionById } from "../src/cacheVersions";
import { fetchTrackedTornJson } from "../src/external/torn";
import { createManualEvent, updateEvent } from "../src/wars";
import { captureEventChainHistory, eventChainSampleTimes, readEventChainHistory } from "../src/eventChainHistory";
import { HOME_FACTION_ID } from "../src/constants";
import { readEventSuccessfulAttackHistory, SUCCESSFUL_ATTACK_HISTORY_START } from "../src/eventSuccessfulAttackHistory";

vi.mock("../src/external/torn", () => ({ fetchTrackedTornJson: vi.fn() }));
vi.mock("../src/cacheVersions", () => ({ bumpWarCacheVersionById: vi.fn(), bumpWarCacheVersion: vi.fn() }));
vi.mock("../src/tornKeyPool", () => ({
  runWithTornKeyPool: async (_env: Env, options: { run: (context: unknown) => Promise<unknown> }) => ({
    result: await options.run({ key: "test-only", keySource: "fixture" }),
  }),
}));

let db: DatabaseSync;
let env: Env;
const START = 1793404800;
const schema = readFileSync(new URL("../schema/current.sql", import.meta.url), "utf8");
function at(seconds: number) { vi.setSystemTime(seconds * 1000); }
function statement(sql: string, values: SQLInputValue[] = []) {
  return {
    bind: (...args: SQLInputValue[]) => statement(sql, args),
    first: async () => db.prepare(sql).get(...values) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...values) }),
    run: async () => {
      const result = db.prepare(sql).run(...values);
      return { success: true, meta: { changes: Number(result.changes) } };
    },
  };
}
function war(type = "halloween", status = "active", hours = 6) {
  db.prepare(`INSERT INTO wars(id, name, status, practical_start_time, war_type, event_type, competition_refresh_hours)
    VALUES (1, 'Test event', ?, ?, 'event', ?, ?)`).run(status, START, type, hours);
}
function member(id = 1, current = 1) {
  db.prepare("INSERT INTO home_faction_members(member_id, faction_id, name, is_current) VALUES (?, 1, ?, ?)")
    .run(id, `Member ${id}`, current);
}
function halloween(treats: number) {
  return { competition: { name: "Halloween", treats_collected: treats, basket: { id: 123, name: "Spooky basket" } } };
}
function elimination(team: string) {
  return { competition: { name: "Elimination", team, team_id: null, score: 645, attacks: 11 } };
}
async function view() { return (await readEventCompetition(env, db.prepare("SELECT * FROM wars WHERE id = 1").get() as unknown as WarRow))!; }
async function setTeamStatus(body: unknown, name = "Test event") {
  const url = new URL(`https://test/api/wars/${encodeURIComponent(name)}/competition/team-status`);
  return updateEliminationTeamStatus(new Request(url, { method: "POST", body: JSON.stringify(body) }), url, env);
}
async function finish(seconds: number) {
  at(seconds);
  db.prepare("UPDATE wars SET status = 'ended', practical_finish_time = ? WHERE id = 1").run(seconds);
  await requestEventCompetitionFinish(env, 1, seconds);
}

beforeEach(() => {
  vi.useFakeTimers();
  at(START);
  vi.clearAllMocks();
  db = new DatabaseSync(":memory:");
  db.exec(schema);
  let batches: Promise<unknown> = Promise.resolve();
  env = { DB: {
    prepare: statement,
    batch: (statements: ReturnType<typeof statement>[]) => {
      const next = batches.then(async () => {
      db.exec("BEGIN");
      try {
        const results = [];
        for (const item of statements) results.push(await item.run());
        db.exec("COMMIT");
        return results;
      } catch (error) { db.exec("ROLLBACK"); throw error; }
      });
      batches = next.catch(() => {});
      return next;
    },
  } } as unknown as Env;
  vi.mocked(fetchTrackedTornJson).mockResolvedValue(halloween(1000));
});
afterEach(() => { db.close(); vi.useRealTimers(); });

describe("hourly Halloween chain history", () => {
  const hour = 3600;
  function hit(id: number, time: number, chain: number | null, faction = HOME_FACTION_ID, result = "Attacked") {
    db.prepare(`INSERT INTO attacks (id, started, ended, attacker_faction_id, defender_faction_id, result, chain)
      VALUES (?, ?, ?, ?, 999, ?, ?)`).run(id, time - 15, time, faction, result, chain);
  }
  function points() { return db.prepare("SELECT sampled_at, chain_count FROM event_chain_history ORDER BY sampled_at").all(); }

  it("samples event start once and subsequent clock hours, bounded by now and finish", () => {
    const start = START + 20 * 60;
    expect(eventChainSampleTimes(start, null, START + 2 * hour + 500)).toEqual([start, START + hour, START + 2 * hour]);
    expect(eventChainSampleTimes(START, START + hour + 500, START + 3 * hour)).toEqual([START, START + hour]);
    expect(eventChainSampleTimes(start, null, START)).toEqual([]);
  });

  it("backfills from the faction feed, includes pre-event hits, and preserves resets and gaps", async () => {
    war(); member();
    hit(1, START - 30, 900);
    hit(2, START + hour, 1500);
    hit(3, START + hour + 1, 1501); // A later hit must not leak into the hour boundary.
    hit(4, START + 2 * hour - 5, 2); // A new chain, not cumulative event attacks.
    hit(5, START + 3 * hour - 300, 90); // Expired exactly at the hour: unknown.
    hit(6, START + 3 * hour, 6000, 123); // Enemy chain must not count.
    hit(7, START + 3 * hour, 6001, HOME_FACTION_ID, "Lost");
    at(START + 3 * hour + 10);
    await runEventCompetitionCron(env);
    expect(points()).toEqual([
      { sampled_at: START, chain_count: 900 },
      { sampled_at: START + hour, chain_count: 1500 },
      { sampled_at: START + 2 * hour, chain_count: 2 },
      { sampled_at: START + 3 * hour, chain_count: null },
    ]);
    expect((await view()).chain_history.map(point => point.chain)).toEqual([900, 1500, 2, null]);
  });

  it("records a real zero and treats missing chain metadata as unknown", async () => {
    war();
    hit(1, START, 0);
    hit(2, START + hour - 5, 500);
    hit(3, START + hour, null);
    await captureEventChainHistory(env, START + hour);
    expect(points()).toEqual([{ sampled_at: START, chain_count: 0 }, { sampled_at: START + hour, chain_count: null }]);
  });

  it("catches up missed hours and reconciles delayed attacks without duplicate samples", async () => {
    war();
    await captureEventChainHistory(env, START + hour);
    hit(1, START - 10, 101);
    hit(2, START + hour - 2, 200);
    await captureEventChainHistory(env, START + hour + 60);
    expect(points()).toHaveLength(2);
    expect(points().map(point => point.chain_count)).toEqual([101, 200]);
    hit(3, START + hour - 1, 201);
    await captureEventChainHistory(env, START + hour + 120);
    expect(points()[1].chain_count).toBe(201);
    await captureEventChainHistory(env, START + 4 * hour + 60);
    expect(points()).toHaveLength(5);
  });

  it("resumes a large backfill in bounded batches and retries older missing readings", async () => {
    war();
    const now = START + 72 * hour;
    await captureEventChainHistory(env, now);
    expect(points()).toHaveLength(48);
    await captureEventChainHistory(env, now + 60);
    expect(points()).toHaveLength(73);
    hit(1, START, 123);
    await captureEventChainHistory(env, now + hour);
    expect(points()[0].chain_count).toBe(123);
  });

  it("stops at event finish, ignores future scheduled events, and respects edited windows", async () => {
    war("halloween", "scheduled");
    await captureEventChainHistory(env, START + 2 * hour);
    expect(points()).toEqual([]);
    db.prepare("UPDATE wars SET status = 'ended', practical_finish_time = ?").run(START + hour + 30);
    await captureEventChainHistory(env, START + 3 * hour);
    expect(points()).toHaveLength(2);
    const edited = { id: 1, practical_start_time: START + 30, practical_finish_time: START + hour + 30 };
    expect(await readEventChainHistory(env, edited, START + 3 * hour)).toEqual([
      { observed_at: START + 30, chain: null }, { observed_at: START + hour, chain: null },
    ]);
  });

  it("migrates existing events and removes their chain samples when the event is deleted", () => {
    war();
    db.exec("DROP TABLE event_chain_history");
    db.exec(readFileSync(new URL("../migrations/0186_add_event_chain_history.sql", import.meta.url), "utf8"));
    db.prepare("INSERT INTO event_chain_history VALUES (1, ?, 100, NULL, ?)").run(START, START);
    expect(points()).toHaveLength(1);
    db.exec("DELETE FROM wars WHERE id = 1");
    expect(points()).toEqual([]);
  });
});

describe("hourly Halloween successful attacks", () => {
  const cutoff = SUCCESSFUL_ATTACK_HISTORY_START;
  const hour = 3600;
  const window = { practical_start_time: cutoff - 2 * hour, practical_finish_time: null };
  function hit(id: number, time: number, result = "Attacked", faction = HOME_FACTION_ID, defender: number | null = 999) {
    db.prepare(`INSERT INTO attacks (id, started, ended, attacker_faction_id, defender_faction_id, result, chain)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(id, time - 15, time, faction, defender, result, id === 5 ? 1 : 1000 + id);
  }

  it("first plots at 29 October noon with the full event total, then counts exactly through each hour", async () => {
    expect(new Date(cutoff * 1000).toISOString()).toBe("2026-10-29T12:00:00.000Z");
    hit(1, window.practical_start_time - 1);
    hit(2, window.practical_start_time);
    hit(3, cutoff - 10);
    hit(4, cutoff);
    hit(5, cutoff + 1); // A reset chain still adds one successful attack.
    hit(6, cutoff + hour);
    hit(7, cutoff + hour + 1); // Must not leak into the last completed hour.
    expect(await readEventSuccessfulAttackHistory(env, window, cutoff + hour + 300)).toEqual([
      { observed_at: cutoff, successful_attacks: 3 },
      { observed_at: cutoff + hour, successful_attacks: 5 },
    ]);
  });

  it("uses successful outgoing faction attacks, including outside-war hits and missing chain metadata", async () => {
    ["Hospitalized", "Mugged", "Attacked", "Arrested", "Lost", "Assist", "Stalemate", "Escape"]
      .forEach((result, i) => hit(i + 1, cutoff - 30, result));
    hit(9, cutoff - 30, "Attacked", 999);
    hit(10, cutoff - 30, "Attacked", HOME_FACTION_ID, HOME_FACTION_ID);
    hit(11, cutoff - 30, "Attacked", HOME_FACTION_ID, null);
    db.exec("UPDATE attacks SET chain = NULL WHERE id = 11");
    expect(await readEventSuccessfulAttackHistory(env, window, cutoff + hour)).toEqual([
      { observed_at: cutoff, successful_attacks: 5 },
      { observed_at: cutoff + hour, successful_attacks: 5 },
    ]);
  });

  it("updates old totals when delayed attacks arrive without accumulating duplicates", async () => {
    expect((await readEventSuccessfulAttackHistory(env, window, cutoff + hour)).map(p => p.successful_attacks)).toEqual([0, 0]);
    hit(1, cutoff - hour);
    hit(2, cutoff + 10);
    expect((await readEventSuccessfulAttackHistory(env, window, cutoff + hour)).map(p => p.successful_attacks)).toEqual([1, 2]);
    expect((await readEventSuccessfulAttackHistory(env, window, cutoff + hour)).map(p => p.successful_attacks)).toEqual([1, 2]);
  });

  it("bounds history by cutoff, event start, finish and now", async () => {
    expect(await readEventSuccessfulAttackHistory(env, window, cutoff - 1)).toEqual([]);
    expect(await readEventSuccessfulAttackHistory(env, { ...window, practical_finish_time: cutoff - 1 }, cutoff + hour)).toEqual([]);
    const later = { practical_start_time: cutoff + 1200, practical_finish_time: cutoff + 2 * hour + 300 };
    hit(1, cutoff + 1000);
    hit(2, cutoff + 1800);
    hit(3, cutoff + 2 * hour + 1);
    expect(await readEventSuccessfulAttackHistory(env, later, cutoff + 3 * hour)).toEqual([
      { observed_at: cutoff + hour, successful_attacks: 1 },
      { observed_at: cutoff + 2 * hour, successful_attacks: 1 },
    ]);
  });

  it("uses started time only when completion time is unavailable", async () => {
    hit(1, cutoff + 10); // Started before noon but completed after: count next hour.
    hit(2, cutoff - 10);
    db.exec("UPDATE attacks SET ended = NULL WHERE id = 2");
    expect((await readEventSuccessfulAttackHistory(env, window, cutoff + hour)).map(p => p.successful_attacks)).toEqual([1, 2]);
  });

  it("returns the new history on the Halloween API and omits it for elimination", async () => {
    war();
    db.prepare("UPDATE wars SET practical_start_time = ?").run(window.practical_start_time);
    hit(1, cutoff - 1);
    at(cutoff + hour);
    expect((await view()).successful_attack_history).toEqual([
      { observed_at: cutoff, successful_attacks: 1 },
      { observed_at: cutoff + hour, successful_attacks: 1 },
    ]);
    db.exec("UPDATE wars SET event_type = 'elimination'");
    expect((await view()).successful_attack_history).toEqual([]);
  });

  it("applies the index migration and uses a bounded time lookup", async () => {
    db.exec("DROP INDEX idx_attacks_successful_hit_at");
    db.exec(readFileSync(new URL("../migrations/0187_index_successful_attack_history.sql", import.meta.url), "utf8"));
    const prepare = vi.spyOn(env.DB, "prepare");
    await readEventSuccessfulAttackHistory(env, window, cutoff + hour);
    const sql = prepare.mock.calls[0][0];
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .all(cutoff, cutoff, HOME_FACTION_ID, HOME_FACTION_ID, window.practical_start_time, cutoff + hour);
    expect(plan.some(row => String(row.detail).includes("idx_attacks_successful_hit_at")
      && String(row.detail).includes("<expr>"))).toBe(true);
    prepare.mockRestore();
  });
});

describe("event competition collection", () => {
  it("reads the latest roster tenure without dropping members whose roster data is missing", async () => {
    war(); member(1); member(2); member(3);
    await ensureEventCompetitionStarted(env, 1);
    db.exec("UPDATE home_faction_members SET days_in_faction = 42 WHERE member_id = 1");
    db.exec("UPDATE home_faction_members SET days_in_faction = 0 WHERE member_id = 2");
    db.exec("DELETE FROM home_faction_members WHERE member_id = 3");
    expect((await view()).members.map(({ member_id, days_in_faction }) => ({ member_id, days_in_faction })))
      .toEqual([
        { member_id: 1, days_in_faction: 42 },
        { member_id: 2, days_in_faction: 0 },
        { member_id: 3, days_in_faction: null },
      ]);
    db.exec("UPDATE home_faction_members SET days_in_faction = 43 WHERE member_id = 1");
    expect((await view()).members[0].days_in_faction).toBe(43);
  });

  it.each([0, 123])("accepts %i treats with explicitly null basket metadata", (treats) => {
    expect(parseCompetitionReading({ competition: {
      name: "Halloween", treats_collected: treats, basket: { id: null, name: null },
    } }, "halloween")).toEqual({ type: "halloween", treats, basketId: null, basketName: null });
  });

  it.each([undefined, null, -1, 0.5, "0"])("rejects an invalid treat count %s even without a basket", (treats) => {
    expect(() => parseCompetitionReading({ competition: {
      name: "Halloween", treats_collected: treats, basket: { id: null, name: null },
    } }, "halloween")).toThrow("Halloween reading incomplete");
  });

  it.each([undefined, null, {}, { id: null, name: "Spooky basket" }, { id: 123, name: null }])(
    "does not mistake malformed basket metadata %j for an explicitly unowned basket", (basket) => {
      expect(() => parseCompetitionReading({ competition: {
        name: "Halloween", treats_collected: 0, basket,
      } }, "halloween")).toThrow("Halloween reading incomplete");
    },
  );

  it("recovers a rejected zero baseline and preserves it after the member gets a basket", async () => {
    war("halloween", "scheduled"); member(); at(START - 3600);
    await ensureEventCompetitionStarted(env, 1);
    db.exec("UPDATE event_competition_members SET last_error = 'Halloween reading incomplete', attempts = 2");
    vi.mocked(fetchTrackedTornJson).mockResolvedValue({ competition: {
      name: "Halloween", treats_collected: 0, basket: { id: null, name: null },
    } });
    await collectInitialHalloweenBaseline(env, 1);
    expect((await view()).members[0]).toMatchObject({
      baseline_treats: 0, treats_gained: 0, basket_name: null,
      baseline_at: START - 3600, status: "tracking", last_error: null,
    });
    expect((await view()).total_treats_gained).toBe(0);
    expect(db.prepare("SELECT basket_id, basket_name, treats_collected FROM event_competition_snapshots").get())
      .toMatchObject({ basket_id: null, basket_name: null, treats_collected: 0 });
    expect(db.prepare("SELECT attempts, poll_due_at FROM event_competition_members").get())
      .toMatchObject({ attempts: 0, poll_due_at: START });

    at(START); db.exec("UPDATE wars SET status = 'active'");
    vi.mocked(fetchTrackedTornJson).mockResolvedValue(halloween(15));
    await runEventCompetitionCron(env);
    expect((await view()).members[0]).toMatchObject({
      baseline_treats: 0, baseline_at: START - 3600, treats_gained: 15, basket_name: "Spooky basket",
    });
  });

  it("classifies Unknown as non-participating, without treating null team IDs as unknown", () => {
    expect(parseCompetitionReading(elimination("Unknown"), "elimination")).toEqual({ type: "elimination", participation: "not_participating", team: null });
    expect(parseCompetitionReading(elimination("Loose Cannons"), "elimination")).toEqual({ type: "elimination", participation: "participating", team: "Loose Cannons" });
    expect(() => parseCompetitionReading({ competition: null }, "elimination")).toThrow();
    expect(() => parseCompetitionReading(halloween(100), "elimination")).toThrow();
  });

  it("validates event types and the two allowed intervals", async () => {
    expect(parseEventCompetitionSettings({})).toEqual({ eventType: "general", hours: 6 });
    expect(() => parseEventCompetitionSettings({ competition_refresh_hours: 5 })).toThrow();
    expect(() => parseEventCompetitionSettings({ event_type: "ranked" })).toThrow();
    const response = await createManualEvent(new Request("https://test/api/wars", { method: "POST", body: JSON.stringify({
      name: "test", practical_start_time: START, event_type: "halloween", competition_refresh_hours: 5,
    }) }), env);
    expect(response.status).toBe(400);
    expect(db.prepare("SELECT COUNT(*) AS n FROM wars").get()?.n).toBe(0);
  });

  it("collects each Elimination participation once, including non-participants", async () => {
    war("elimination"); member(1); member(2);
    vi.mocked(fetchTrackedTornJson).mockResolvedValueOnce(elimination("Unknown")).mockResolvedValueOnce(elimination("Loose Cannons"));
    await runEventCompetitionCron(env);
    await runEventCompetitionCron(env);
    at(START + 12 * 3600); await runEventCompetitionCron(env);
    expect(fetchTrackedTornJson).toHaveBeenCalledTimes(2);
    const data = await view();
    expect(data.members.map(m => m.participation)).toEqual(["not_participating", "participating"]);
    await finish(START + 13 * 3600); await runEventCompetitionCron(env);
    expect(fetchTrackedTornJson).toHaveBeenCalledTimes(2);
    expect((await view()).members.every(m => m.status === "complete")).toBe(true);
  });

  it("captures the roster once, includes members with no attacks, and preserves departures", async () => {
    war(); member(1); member(2, 0);
    await ensureEventCompetitionStarted(env, 1);
    member(3);
    db.exec("UPDATE home_faction_members SET is_current = 0 WHERE member_id = 1");
    await ensureEventCompetitionStarted(env, 1);
    await runEventCompetitionCron(env);
    expect((await view()).members.map(m => m.member_id)).toEqual([1]);
  });

  it.each([6, 12])("subtracts the immutable baseline on the %i-hour interval", async (hours) => {
    war("halloween", "active", hours); member();
    await runEventCompetitionCron(env);
    expect((await view()).total_treats_gained).toBe(0);
    at(START + hours * 3600 - 1); await runEventCompetitionCron(env);
    expect(fetchTrackedTornJson).toHaveBeenCalledTimes(1);
    at(START + hours * 3600);
    vi.mocked(fetchTrackedTornJson).mockResolvedValue(halloween(1166));
    await runEventCompetitionCron(env);
    expect((await view()).total_treats_gained).toBe(166);
    expect((await view()).members[0].baseline_at).toBe(START);
    expect(db.prepare("SELECT baseline_treats FROM event_competition_members").get()?.baseline_treats).toBe(1000);
  });

  it("waits for scheduled Elimination events and never fetches current data for historical events", async () => {
    war("elimination", "scheduled"); member();
    vi.mocked(fetchTrackedTornJson).mockResolvedValue(elimination("Loose Cannons"));
    await runEventCompetitionCron(env);
    expect(fetchTrackedTornJson).not.toHaveBeenCalled();
    db.exec("UPDATE wars SET status = 'ended'");
    await runEventCompetitionCron(env);
    expect((await view()).initialized_at).toBeNull();
    expect(fetchTrackedTornJson).not.toHaveBeenCalled();
    db.exec("UPDATE wars SET status = 'active'");
    await runEventCompetitionCron(env);
    expect(fetchTrackedTornJson).toHaveBeenCalledTimes(1);
  });

  it("starts a baseline for every current member on creation, before the scheduled start", async () => {
    for (let id = 1; id <= 25; id++) member(id);
    member(26, 0);
    const background: Promise<unknown>[] = [];
    const response = await createManualEvent(new Request("https://test/api/wars", { method: "POST", body: JSON.stringify({
      name: "Test event", practical_start_time: START + 24 * 3600, event_type: "halloween", status: "scheduled",
    }) }), env, { waitUntil: task => background.push(task) });
    expect(response.status).toBe(201);
    expect(background).toHaveLength(1);
    await Promise.all(background);
    expect(fetchTrackedTornJson).toHaveBeenCalledTimes(25);
    const data = await view();
    expect(data.members).toHaveLength(25);
    expect(data.members.every(member => member.baseline_at === START && member.baseline_treats === 1000 && member.treats_gained === 0)).toBe(true);
    expect(data.initialized_at).toBe(START);
    expect(data.next_refresh_at).toBe(START + 24 * 3600);
    at(START + 6 * 3600);
    await runEventCompetitionCron(env);
    expect(fetchTrackedTornJson).toHaveBeenCalledTimes(25);
    expect(db.prepare("SELECT status FROM wars WHERE id = 1").get()?.status).toBe("scheduled");
  });

  it("keeps the creation baseline at the event start and then follows the chosen interval", async () => {
    war("halloween", "scheduled", 12); member(); at(START - 3600);
    await ensureEventCompetitionStarted(env, 1);
    await collectInitialHalloweenBaseline(env, 1);
    expect((await view()).history).toEqual([{ observed_at: START, treats_gained: 0 }]);
    expect(db.prepare("SELECT observed_at FROM event_competition_snapshots").get()?.observed_at).toBe(START - 3600);
    at(START - 60);
    await rescheduleEventCompetition(env, 1, 12);
    expect((await view()).next_refresh_at).toBe(START);
    at(START); db.exec("UPDATE wars SET status = 'active'");
    vi.mocked(fetchTrackedTornJson).mockResolvedValue(halloween(1050));
    await runEventCompetitionCron(env);
    expect((await view()).members[0]).toMatchObject({ baseline_at: START - 3600, baseline_treats: 1000, treats_gained: 50 });
    expect((await view()).next_refresh_at).toBe(START + 12 * 3600);
    at(START + 12 * 3600); vi.mocked(fetchTrackedTornJson).mockResolvedValue(halloween(1300));
    await runEventCompetitionCron(env);
    expect((await view()).total_treats_gained).toBe(300);
    expect((await view()).history).toEqual([
      { observed_at: START, treats_gained: 50 },
      { observed_at: START + 12 * 3600, treats_gained: 300 },
    ]);
  });

  it("shows unavailable instead of zero when a pre-event baseline fails, then recovers before start", async () => {
    war("halloween", "scheduled"); member(); at(START - 3600);
    await ensureEventCompetitionStarted(env, 1);
    vi.mocked(fetchTrackedTornJson).mockRejectedValueOnce(new Error("offline"));
    await collectInitialHalloweenBaseline(env, 1);
    expect((await view()).members[0]).toMatchObject({ baseline_treats: null, treats_gained: null });
    at(START - 3540);
    await runEventCompetitionCron(env);
    expect((await view()).members[0]).toMatchObject({ baseline_treats: 1000, baseline_at: START - 3540, treats_gained: 0 });
  });

  it("leaves unstarted baseline requests queued when background time expires and cron completes them", async () => {
    war("halloween", "scheduled"); for (let id = 1; id <= 25; id++) member(id);
    at(START - 3600); await ensureEventCompetitionStarted(env, 1);
    vi.mocked(fetchTrackedTornJson).mockImplementation(async () => {
      at(START - 3570);
      return halloween(1000);
    });
    await collectInitialHalloweenBaseline(env, 1);
    const captured = (await view()).members.filter(member => member.baseline_treats !== null).length;
    expect(captured).toBeGreaterThan(0);
    expect(captured).toBeLessThan(25);
    vi.mocked(fetchTrackedTornJson).mockResolvedValue(halloween(1000));
    await runEventCompetitionCron(env);
    await runEventCompetitionCron(env);
    expect((await view()).members.every(member => member.baseline_treats === 1000)).toBe(true);
    expect(fetchTrackedTornJson).toHaveBeenCalledTimes(25);
  });

  it("leases baseline requests so simultaneous creation and cron collection cannot collect a member twice", async () => {
    war("halloween", "scheduled"); member(); at(START - 3600);
    await ensureEventCompetitionStarted(env, 1);
    await Promise.all([collectInitialHalloweenBaseline(env, 1), runEventCompetitionCron(env)]);
    expect(fetchTrackedTornJson).toHaveBeenCalledTimes(1);
    expect((await view()).members[0].baseline_treats).toBe(1000);
  });

  it("uses the first observed baseline when enabled partway through an event", async () => {
    war(); member(); at(START + 3600);
    await runEventCompetitionCron(env);
    expect((await view()).members[0].baseline_at).toBe(START + 3600);
    expect((await view()).total_treats_gained).toBe(0);
  });

  it("reschedules interval changes without replacing a baseline or immediately polling", async () => {
    war(); member(); await runEventCompetitionCron(env); at(START + 60);
    db.exec("UPDATE wars SET competition_refresh_hours = 12");
    await rescheduleEventCompetition(env, 1, 12);
    await runEventCompetitionCron(env);
    expect(fetchTrackedTornJson).toHaveBeenCalledTimes(1);
    expect((await view()).members[0].baseline_at).toBe(START);
    expect((await view()).next_refresh_at).toBeGreaterThan(START + 6 * 3600);
  });

  it("preserves valid data on errors and counter decreases", async () => {
    war(); member(); await runEventCompetitionCron(env); at(START + 6 * 3600);
    vi.mocked(fetchTrackedTornJson).mockResolvedValue(halloween(900));
    await runEventCompetitionCron(env);
    const data = await view();
    expect(data.members[0]).toMatchObject({ treats_gained: 0, status: "stale", updated_at: START });
    expect(data.members[0].last_error).toContain("decreased");
    expect(db.prepare("SELECT COUNT(*) AS n FROM event_competition_snapshots").get()?.n).toBe(1);
  });

  it("keeps retrying on the new cadence when a baseline was unavailable", async () => {
    war(); member(); vi.mocked(fetchTrackedTornJson).mockRejectedValue(new Error("offline"));
    for (const seconds of [0, 60, 120]) { at(START + seconds); await runEventCompetitionCron(env); }
    db.exec("UPDATE wars SET competition_refresh_hours = 12");
    await rescheduleEventCompetition(env, 1, 12);
    expect((await view()).next_refresh_at).toBe(START + 120 + 12 * 3600);
    at(START + 120 + 12 * 3600); vi.mocked(fetchTrackedTornJson).mockResolvedValue(halloween(1500));
    await runEventCompetitionCron(env);
    expect((await view()).members[0]).toMatchObject({ treats_gained: 0, status: "tracking" });
  });

  it("resumes Halloween collection after reopening without resetting the baseline", async () => {
    war(); member(); await runEventCompetitionCron(env); await finish(START + 60);
    vi.mocked(fetchTrackedTornJson).mockResolvedValue(halloween(1100)); await runEventCompetitionCron(env);
    at(START + 120); db.exec("UPDATE wars SET status = 'active', practical_finish_time = NULL");
    await runEventCompetitionCron(env);
    expect(fetchTrackedTornJson).toHaveBeenCalledTimes(2);
    at(START + 120 + 6 * 3600); vi.mocked(fetchTrackedTornJson).mockResolvedValue(halloween(1300));
    await runEventCompetitionCron(env);
    expect((await view()).total_treats_gained).toBe(300);
    expect((await view()).members[0].baseline_at).toBe(START);
  });

  it("bounds failed Elimination lookups and does not classify errors as non-participation", async () => {
    war("elimination"); member();
    vi.mocked(fetchTrackedTornJson).mockRejectedValue(new Error("test error"));
    for (const seconds of [0, 60, 120, 180, 3600]) { at(START + seconds); await runEventCompetitionCron(env); }
    expect(fetchTrackedTornJson).toHaveBeenCalledTimes(3);
    expect((await view()).members[0]).toMatchObject({ participation: null, status: "unavailable" });
  });

  it("finishes immediately, records the final sample timestamp, and stops polling", async () => {
    war(); member(); await runEventCompetitionCron(env);
    await finish(START + 600);
    expect((await view()).members[0].status).toBe("finishing");
    at(START + 610); vi.mocked(fetchTrackedTornJson).mockResolvedValue(halloween(1123));
    await runEventCompetitionCron(env);
    expect((await view()).members[0]).toMatchObject({ treats_gained: 123, status: "complete", updated_at: START + 610 });
    await requestEventCompetitionFinish(env, 1, START + 600);
    at(START + 86400); await runEventCompetitionCron(env);
    expect(fetchTrackedTornJson).toHaveBeenCalledTimes(2);
  });

  it("marks a failed final reading incomplete and retains the previous total", async () => {
    war(); member(); await runEventCompetitionCron(env); await finish(START + 600);
    vi.mocked(fetchTrackedTornJson).mockRejectedValue(new Error("offline"));
    for (const seconds of [600, 660, 720, 780]) { at(START + seconds); await runEventCompetitionCron(env); }
    expect((await view()).members[0]).toMatchObject({ treats_gained: 0, status: "incomplete", updated_at: START });
    expect(fetchTrackedTornJson).toHaveBeenCalledTimes(4);
  });

  it("does not invent a baseline from a final reading", async () => {
    war(); member(); await ensureEventCompetitionStarted(env, 1); await finish(START + 60);
    await runEventCompetitionCron(env);
    expect(fetchTrackedTornJson).not.toHaveBeenCalled();
    expect((await view()).members[0]).toMatchObject({ treats_gained: null, status: "incomplete" });
  });

  it("recovers an interrupted finish but does not fetch a stale finish a day later", async () => {
    war(); member(); await runEventCompetitionCron(env);
    db.prepare("UPDATE wars SET status = 'ended', practical_finish_time = ?").run(START + 10);
    at(START + 86400); await runEventCompetitionCron(env);
    expect(fetchTrackedTornJson).toHaveBeenCalledTimes(1);
    expect((await view()).members[0].status).toBe("incomplete");
  });

  it("drops a response overtaken by a finish and then collects the final phase", async () => {
    war(); member(); await runEventCompetitionCron(env); at(START + 6 * 3600);
    vi.mocked(fetchTrackedTornJson).mockImplementationOnce(async () => {
      await finish(START + 6 * 3600);
      return halloween(1100);
    });
    await runEventCompetitionCron(env);
    expect((await view()).members[0].status).toBe("finishing");
    expect(db.prepare("SELECT COUNT(*) AS n FROM event_competition_snapshots").get()?.n).toBe(1);
    vi.mocked(fetchTrackedTornJson).mockResolvedValue(halloween(1200));
    await runEventCompetitionCron(env);
    expect((await view()).total_treats_gained).toBe(200);
  });

  it("uses only available samples when time boundaries change", async () => {
    war(); member(); await runEventCompetitionCron(env);
    at(START + 6 * 3600); vi.mocked(fetchTrackedTornJson).mockResolvedValue(halloween(1200)); await runEventCompetitionCron(env);
    at(START + 12 * 3600); vi.mocked(fetchTrackedTornJson).mockResolvedValue(halloween(1500)); await runEventCompetitionCron(env);
    db.prepare("UPDATE wars SET practical_start_time = ?").run(START + 1);
    expect((await view()).total_treats_gained).toBe(300);
    expect((await view()).members[0].baseline_at).toBe(START + 6 * 3600);
    db.prepare("UPDATE wars SET practical_finish_time = ?").run(START + 8 * 3600);
    expect((await view()).total_treats_gained).toBe(0);
    expect(db.prepare("SELECT baseline_treats FROM event_competition_members").get()?.baseline_treats).toBe(1000);
  });

  it("locks the subtype after collection and cascades event deletion", async () => {
    war(); member(); await runEventCompetitionCron(env);
    const response = await updateEvent(new Request("https://test/api/wars/update-event", {
      method: "POST", body: JSON.stringify({ id: 1, event_type: "elimination" }),
    }), env);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "EVENT_TYPE_LOCKED" });
    db.exec("DELETE FROM wars WHERE id = 1");
    for (const table of ["event_competition_state", "event_competition_members", "event_competition_snapshots", "event_chain_history"]) {
      expect(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n).toBe(0);
    }
  });

  it("applies the migration to existing events with General defaults", () => {
    const upgrade = new DatabaseSync(":memory:");
    try {
      upgrade.exec("CREATE TABLE wars(id INTEGER PRIMARY KEY, war_type TEXT); INSERT INTO wars VALUES (1, 'event');");
      upgrade.exec(readFileSync(new URL("../migrations/0144_add_event_competitions.sql", import.meta.url), "utf8"));
      expect(upgrade.prepare("SELECT event_type, competition_refresh_hours FROM wars").get()).toMatchObject({ event_type: "general", competition_refresh_hours: 6 });
    } finally { upgrade.close(); }
  });

  it("makes snapshot baskets nullable without losing history, uniqueness, indexing, or deletion cascades", () => {
    const upgrade = new DatabaseSync(":memory:");
    try {
      upgrade.exec("PRAGMA foreign_keys = ON; CREATE TABLE wars(id INTEGER PRIMARY KEY, war_type TEXT); INSERT INTO wars VALUES (1, 'event');");
      upgrade.exec(readFileSync(new URL("../migrations/0144_add_event_competitions.sql", import.meta.url), "utf8"));
      upgrade.exec(`INSERT INTO event_competition_members(war_id, member_id, member_name) VALUES (1, 1, 'Member 1');
        INSERT INTO event_competition_snapshots VALUES (1, 1, 'baseline', 1, 1, 10, 123, 'Spooky basket');`);
      const original = upgrade.prepare("SELECT * FROM event_competition_snapshots").all();
      upgrade.exec(readFileSync(new URL("../migrations/0183_allow_halloween_without_basket.sql", import.meta.url), "utf8"));
      expect(upgrade.prepare("SELECT * FROM event_competition_snapshots").all()).toEqual(original);
      upgrade.exec("INSERT INTO event_competition_snapshots VALUES (1, 1, 'refresh', 2, 2, 0, NULL, NULL)");
      expect(() => upgrade.exec("INSERT INTO event_competition_snapshots VALUES (1, 1, 'refresh', 2, 3, 0, NULL, NULL)"))
        .toThrow(/UNIQUE/);
      expect(upgrade.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(upgrade.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'event_competition_history'").get())
        .toMatchObject({ name: "event_competition_history" });
      upgrade.exec("DELETE FROM wars WHERE id = 1");
      expect(upgrade.prepare("SELECT * FROM event_competition_snapshots").all()).toEqual([]);
    } finally { upgrade.close(); }
  });

  it("stores visual team status per event without changing collected data or calling Torn", async () => {
    war("elimination"); member(1); member(2); member(3);
    vi.mocked(fetchTrackedTornJson).mockResolvedValueOnce(elimination("Loose Cannons"))
      .mockResolvedValueOnce(elimination("Unknown")).mockResolvedValueOnce(elimination("Other team"));
    await runEventCompetitionCron(env);
    const before = await view();
    const storedBefore = db.prepare("SELECT * FROM event_competition_members").all();
    vi.clearAllMocks();
    expect((await setTeamStatus({ team_name: "Loose Cannons", eliminated: true })).status).toBe(200);
    expect((await setTeamStatus({ team_name: "Other team", eliminated: true })).status).toBe(200);
    expect((await setTeamStatus({ team_name: "Loose Cannons", eliminated: true })).status).toBe(200);
    const after = await view();
    expect(after.eliminated_teams).toEqual(["Loose Cannons", "Other team"]);
    expect(after.members).toEqual(before.members);
    expect(db.prepare("SELECT * FROM event_competition_members").all()).toEqual(storedBefore);
    expect(fetchTrackedTornJson).not.toHaveBeenCalled();
    expect(bumpWarCacheVersionById).toHaveBeenCalledWith(env, 1);
    db.prepare(`INSERT INTO wars(id, name, status, practical_start_time, war_type, event_type)
      VALUES (2, 'Second event', 'ended', ?, 'event', 'elimination')`).run(START);
    const second = db.prepare("SELECT * FROM wars WHERE id = 2").get() as unknown as WarRow;
    expect((await readEventCompetition(env, second))?.eliminated_teams).toEqual([]);
    await setTeamStatus({ team_name: "Loose Cannons", eliminated: false });
    await setTeamStatus({ team_name: "Loose Cannons", eliminated: false });
    expect((await view()).eliminated_teams).toEqual(["Other team"]);
    db.exec("DELETE FROM wars WHERE id = 1");
    expect(db.prepare("SELECT COUNT(*) AS n FROM event_competition_eliminated_teams").get()?.n).toBe(0);
  });

  it.each([
    null, {}, { team_name: "", eliminated: true }, { team_name: "Loose Cannons", eliminated: "true" },
    { team_name: "Unknown", eliminated: true }, { team_name: "Not participating", eliminated: true },
    { team_name: "Other event's team", eliminated: true },
  ])("rejects invalid or uncaptured teams: %j", async body => {
    war("elimination"); member();
    vi.mocked(fetchTrackedTornJson).mockResolvedValue(elimination("Loose Cannons"));
    await runEventCompetitionCron(env);
    expect((await setTeamStatus(body)).status).toBe(400);
    expect((await view()).eliminated_teams).toEqual([]);
  });

  it.each(["halloween", "general"])("rejects manual team status for %s events", async type => {
    war(type);
    expect((await setTeamStatus({ team_name: "Loose Cannons", eliminated: true })).status).toBe(400);
  });

  it("rejects missing events and malformed JSON", async () => {
    expect((await setTeamStatus({ team_name: "Loose Cannons", eliminated: true })).status).toBe(404);
    war("elimination");
    const url = new URL("https://test/api/wars/Test%20event/competition/team-status");
    const response = await updateEliminationTeamStatus(new Request(url, { method: "POST", body: "{" }), url, env);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_JSON" });
  });

  it("adds the visual team table to an existing schema without modifying events", () => {
    const upgrade = new DatabaseSync(":memory:");
    try {
      upgrade.exec("PRAGMA foreign_keys = ON; CREATE TABLE wars(id INTEGER PRIMARY KEY); INSERT INTO wars VALUES (1);");
      upgrade.exec(readFileSync(new URL("../migrations/0145_add_eliminated_event_teams.sql", import.meta.url), "utf8"));
      upgrade.prepare("INSERT INTO event_competition_eliminated_teams VALUES (1, 'Loose Cannons', ?)").run(START);
      expect(upgrade.prepare("SELECT * FROM wars").all()).toEqual([{ id: 1 }]);
      upgrade.exec("DELETE FROM wars WHERE id = 1");
      expect(upgrade.prepare("SELECT * FROM event_competition_eliminated_teams").all()).toEqual([]);
    } finally { upgrade.close(); }
  });
});
