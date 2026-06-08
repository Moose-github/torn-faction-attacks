import { describe, expect, it, vi } from "vitest";
import { applyTornOfficialWarEnd, endWarPractically } from "./warLifecycle";
import type { Env } from "./types";

vi.mock("./cacheVersions", () => ({
  bumpWarCacheVersionById: vi.fn(),
}));

vi.mock("./chainWatch", () => ({
  ensureChainWatchEnabledForWar: vi.fn(),
}));

vi.mock("./enemyScouting", () => ({
  clearLiveEnemyTrackingData: vi.fn(),
}));

vi.mock("./summaries", () => ({
  rebuildWarMemberStatsFromRaw: vi.fn(),
  rebuildWarSummaryFromMemberStats: vi.fn(),
}));

describe("war lifecycle global state", () => {
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

function fakeDb(firstResults: Array<{ match: string; result: unknown }>) {
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
