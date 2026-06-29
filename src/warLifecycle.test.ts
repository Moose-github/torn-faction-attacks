import { describe, expect, it, vi } from "vitest";
import { applyTornOfficialWarEnd, endWarPractically, startWarTracking } from "./warLifecycle";
import { runWarLiveStartedHooks } from "./warLifecycleHooks";
import type { Env } from "./types";

vi.mock("./cacheVersions", () => ({
  bumpWarCacheVersionById: vi.fn(),
}));

vi.mock("./chainWatch", () => ({
  ensureChainWatchEnabledForWar: vi.fn(),
}));

vi.mock("./enemyScouting", () => ({
  clearLiveEnemyTrackingData: vi.fn(),
  fetchEnemyScoutingOnceForWar: vi.fn(),
}));

vi.mock("./warStats", () => ({
  rebuildWarMemberStatsFromRaw: vi.fn(),
  rebuildWarSummaryFromMemberStats: vi.fn(),
}));

describe("war lifecycle global state", () => {
  it("starts a scheduled war through the war-start lifecycle hooks", async () => {
    const db = fakeDb([], [
      {
        match: "SET status = 'active'",
        result: { success: true, meta: { changes: 1 } },
      },
    ]);

    await startWarTracking(envWithDb(db), {
      warId: 7,
      startedAt: 100,
    });

    expect(db.calls).toContainEqual(expect.objectContaining({
      params: ["attacks", 100, 7, "current"],
    }));
    expect(db.calls.some((call) => call.params[0] === "war_lifecycle:war_started:7"))
      .toBe(true);
  });

  it("recovers war-start hooks when activation already marked the war active", async () => {
    const db = fakeDb([
      {
        match: "SELECT status",
        result: { status: "active" },
      },
    ], [
      {
        match: "SET status = 'active'",
        result: { success: true, meta: { changes: 0 } },
      },
    ]);

    await startWarTracking(envWithDb(db), {
      warId: 7,
      startedAt: 100,
    });

    expect(db.calls).toContainEqual(expect.objectContaining({
      params: ["attacks", 100, 7, "current"],
    }));
    expect(db.calls.some((call) => call.params[0] === "war_lifecycle:war_started:7"))
      .toBe(true);
  });

  it("does not run war-start hooks when activation finds a non-active war", async () => {
    const db = fakeDb([
      {
        match: "SELECT status",
        result: { status: "ended" },
      },
    ], [
      {
        match: "SET status = 'active'",
        result: { success: true, meta: { changes: 0 } },
      },
    ]);

    await startWarTracking(envWithDb(db), {
      warId: 7,
      startedAt: 100,
    });

    expect(db.calls.some((call) => call.params[0] === "war_lifecycle:war_started:7"))
      .toBe(false);
    expect(db.calls.some((call) => call.params.includes("current"))).toBe(false);
  });

  it("does not rewrite an already-complete empty lifecycle phase", async () => {
    const db = fakeDb([
      {
        match: "FROM sync_state",
        result: { 1: 1 },
      },
    ]);

    await runWarLiveStartedHooks(envWithDb(db), 7);

    expect(db.calls.some((call) => call.sql.includes("INSERT INTO sync_state")))
      .toBe(false);
  });

  it("manual practical finish keeps the war active and marks the global state practically finished", async () => {
    const db = fakeDb([
      {
        match: "SELECT practical_finish_time",
        result: { practical_finish_time: 200 },
      },
    ]);

    await endWarPractically(envWithDb(db), {
      warId: 7,
      finishAt: 200,
      enemyFactionId: 123,
    });

    const warUpdate = db.calls.find((call) =>
      call.sql.includes("UPDATE wars") && call.sql.includes("practical_finish_time"),
    );
    expect(warUpdate?.sql).not.toContain("status = 'ended'");
    expect(db.calls.some((call) => call.sql.includes("active_war_id = NULL"))).toBe(false);
    expect(db.calls).toContainEqual(expect.objectContaining({
      params: ["attacks", 7, "practically_finished"],
    }));
  });

  it("official Torn end marks the war ended and clears global state when no scheduled war exists", async () => {
    const db = fakeDb([
      {
        match: "WHERE status = 'scheduled'",
        result: null,
      },
    ]);

    await applyTornOfficialWarEnd(envWithDb(db), officialEndOptions());

    expect(db.calls.find((call) => call.sql.includes("UPDATE wars"))?.sql).toContain("status = 'ended'");
    expect(db.calls.some((call) =>
      call.sql.includes("active_war_id = NULL") && call.sql.includes("war_state = 'none'")
    )).toBe(true);
  });

  it("official Torn end moves global state to the next scheduled war when one exists", async () => {
    const db = fakeDb([
      {
        match: "WHERE status = 'scheduled'",
        result: { id: 12 },
      },
    ]);

    await applyTornOfficialWarEnd(envWithDb(db), officialEndOptions());

    expect(db.calls).toContainEqual(expect.objectContaining({
      params: ["attacks", 12, "upcoming"],
    }));
    expect(db.calls.some((call) => call.params[0] === "war_lifecycle:war_scheduled:12"))
      .toBe(true);
  });
});

function officialEndOptions() {
  return {
    warId: 7,
    officialEndTime: 250,
    tornWarId: 99,
    currentEnemyFactionId: 123,
    enemyFactionId: 123,
    homeScore: 1000,
    enemyScore: 950,
    winnerFactionId: 1,
  };
}

function envWithDb(db: ReturnType<typeof fakeDb>): Env {
  return { DB: db } as unknown as Env;
}

function fakeDb(
  firstResults: Array<{ match: string; result: unknown }>,
  runResults: Array<{ match: string; result: unknown }> = [],
) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];

  return {
    calls,
    prepare(sql: string) {
      const call = { sql, params: [] as unknown[] };
      calls.push(call);

      return {
        bind(...params: unknown[]) {
          call.params = params;
          return this;
        },
        async run() {
          const index = runResults.findIndex((entry) => sql.includes(entry.match));
          if (index >= 0) {
            const [entry] = runResults.splice(index, 1);
            return entry.result;
          }

          return { success: true };
        },
        async first() {
          const index = firstResults.findIndex((entry) => sql.includes(entry.match));
          if (index < 0) {
            return null;
          }

          const [entry] = firstResults.splice(index, 1);
          return entry.result;
        },
      };
    },
  };
}
