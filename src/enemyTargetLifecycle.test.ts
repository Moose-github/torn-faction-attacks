import { describe, expect, it } from "vitest";
import { handleEnemyTargetMatched } from "./enemyTargetLifecycle";
import type { Env } from "./types";

describe("enemy target lifecycle", () => {
  it("clears all enemy activity sample rows during replaceable heatmap cleanup", async () => {
    const db = fakeDb([
      {
        match: "DELETE FROM enemy_faction_activity_samples",
        result: result(3),
      },
      {
        match: "DELETE FROM enemy_member_activity_samples",
        result: result(5),
      },
    ]);

    const metrics = await handleEnemyTargetMatched(envWithDb(db), 123, {
      clearReplaceableHeatmaps: true,
    });

    expect(metrics.writeStatements).toBe(2);
    expect(metrics.changedRows).toBe(8);
    expect(metrics.enemyActivitySampleRowsDeleted).toBe(8);

    expect(db.calls.map((call) => call.sql)).toEqual([
      "DELETE FROM enemy_faction_activity_samples",
      "DELETE FROM enemy_member_activity_samples",
    ]);
    expect(db.calls.every((call) => call.params.length === 0)).toBe(true);
    expect(db.calls.some((call) => call.sql.includes("FROM wars"))).toBe(false);
    expect(db.calls.some((call) => call.sql.includes("WHERE faction_id"))).toBe(false);
  });

  it("clears the manual Discord travel target when cached enemy roster is replaced", async () => {
    const db = fakeDb([
      {
        match: "DELETE FROM enemy_faction_members",
        result: result(10),
      },
      {
        match: "DELETE FROM discord_travel_tracker_target",
        result: result(1),
      },
      {
        match: "DELETE FROM enemy_hit_stat_snapshots",
        result: result(4),
      },
    ]);

    const metrics = await handleEnemyTargetMatched(envWithDb(db), 123, {
      clearCachedEnemyRoster: true,
    });

    expect(metrics.writeStatements).toBe(3);
    expect(metrics.changedRows).toBe(15);
    expect(metrics.enemyRosterRowsDeleted).toBe(10);
    expect(metrics.enemyHitStatRowsDeleted).toBe(4);
    expect(db.calls.some((call) =>
      call.sql === "DELETE FROM discord_travel_tracker_target WHERE id = 1"
    )).toBe(true);
  });
});

function envWithDb(db: ReturnType<typeof fakeDb>): Env {
  return { DB: db } as unknown as Env;
}

function fakeDb(runResults: Array<{ match: string; result: unknown }> = []) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];

  return {
    calls,
    prepare(sql: string) {
      const call = { sql: compactSql(sql), params: [] as unknown[] };
      calls.push(call);

      return {
        bind(...params: unknown[]) {
          call.params = params;
          return this;
        },
        async run() {
          const index = runResults.findIndex((entry) => call.sql.includes(entry.match));
          if (index >= 0) {
            const [entry] = runResults.splice(index, 1);
            return entry.result;
          }

          return result(0);
        },
        async first() {
          return null;
        },
        async all() {
          return { results: [], success: true };
        },
      };
    },
  };
}

function compactSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

function result(changes: number): D1Result<unknown> {
  return {
    results: [],
    success: true,
    meta: { changes },
  } as unknown as D1Result<unknown>;
}
