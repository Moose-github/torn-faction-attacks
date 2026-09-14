import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env, WarRow } from "../src/types";
import {
  ensureEventCompetitionStarted, parseCompetitionReading, parseEventCompetitionSettings,
  readEventCompetition, requestEventCompetitionFinish, rescheduleEventCompetition, runEventCompetitionCron,
} from "../src/eventCompetition";
import { fetchTrackedTornJson } from "../src/external/torn";
import { createManualEvent, updateEvent } from "../src/wars";

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
  env = { DB: {
    prepare: statement,
    batch: async (statements: ReturnType<typeof statement>[]) => {
      db.exec("BEGIN");
      try {
        const results = [];
        for (const item of statements) results.push(await item.run());
        db.exec("COMMIT");
        return results;
      } catch (error) { db.exec("ROLLBACK"); throw error; }
    },
  } } as unknown as Env;
  vi.mocked(fetchTrackedTornJson).mockResolvedValue(halloween(1000));
});
afterEach(() => { db.close(); vi.useRealTimers(); });

describe("event competition collection", () => {
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

  it("waits for scheduled events and never fetches current data for historical events", async () => {
    war("halloween", "scheduled"); member();
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
    for (const table of ["event_competition_state", "event_competition_members", "event_competition_snapshots"]) {
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
});
