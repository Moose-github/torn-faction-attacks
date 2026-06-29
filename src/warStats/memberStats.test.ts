import { describe, expect, it } from "vitest";
import type { Env } from "../types";
import { clearWarStats, rebuildWarStatsFromRaw } from "./memberStats";

describe("war stats rebuilds", () => {
  it("returns an empty result when a single-war rebuild targets a missing war", async () => {
    const db = fakeDb({
      firstResults: [
        { match: "FROM wars", result: null },
      ],
    });

    const result = await rebuildWarStatsFromRaw(envWithDb(db), {
      scope: "single-war",
      warId: 404,
      reason: "admin",
    });

    expect(result).toEqual({ wars_rebuilt: 0, combat_bucket_rows: 0 });
    expect(db.calls.some((call) => call.sql.includes("DELETE FROM war_member_stats"))).toBe(false);
  });

  it("runs the canonical single-war rebuild sequence", async () => {
    const db = fakeDb({
      firstResults: [
        { match: "FROM wars", result: { id: 7 } },
        { match: "COUNT(*) AS count", result: { count: 3 } },
      ],
    });

    const result = await rebuildWarStatsFromRaw(envWithDb(db), {
      scope: "single-war",
      warId: 7,
      reason: "lifecycle",
    });

    expect(result).toEqual({ wars_rebuilt: 1, combat_bucket_rows: 3 });
    expect(db.calls.some((call) => call.sql.includes("UPDATE war_member_stats"))).toBe(true);
    expect(db.calls.some((call) => call.sql.includes("DELETE FROM war_member_stats"))).toBe(true);
    expect(db.calls.some((call) => call.sql.includes("DELETE FROM war_member_combat_buckets"))).toBe(true);
    expect(db.calls.some((call) => call.sql.includes("INSERT INTO war_member_stats"))).toBe(true);
    expect(db.calls.some((call) => call.sql.includes("INSERT INTO war_member_combat_buckets"))).toBe(true);
    expect(db.calls.some((call) => call.sql.includes("INSERT INTO war_summary"))).toBe(true);
  });

  it("clears every calculated war stats table for a war", async () => {
    const db = fakeDb();

    await clearWarStats(envWithDb(db), 7);

    expect(db.batchCalls).toHaveLength(1);
    expect(db.batchCalls[0].map((call) => call.sql)).toEqual([
      "DELETE FROM war_member_combat_buckets WHERE war_id = ?",
      "DELETE FROM war_member_stats WHERE war_id = ?",
      "DELETE FROM war_summary WHERE war_id = ?",
    ]);
    expect(db.batchCalls[0].map((call) => call.params)).toEqual([[7], [7], [7]]);
  });
});

function envWithDb(db: ReturnType<typeof fakeDb>): Env {
  return { DB: db } as unknown as Env;
}

function fakeDb(options?: {
  firstResults?: Array<{ match: string; result: unknown }>;
  allResults?: Array<{ match: string; result: unknown[] }>;
}) {
  const firstResults = [...(options?.firstResults ?? [])];
  const allResults = [...(options?.allResults ?? [])];
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const batchCalls: Array<Array<{ sql: string; params: unknown[] }>> = [];

  return {
    calls,
    batchCalls,
    prepare(sql: string) {
      const call = { sql: sql.trim(), params: [] as unknown[] };
      calls.push(call);

      return {
        sql: call.sql,
        params: call.params,
        bind(...params: unknown[]) {
          call.params = params;
          this.params = params;
          return this;
        },
        async run() {
          return { success: true, meta: { changes: 1 } };
        },
        async first() {
          const index = firstResults.findIndex((entry) => call.sql.includes(entry.match));
          if (index < 0) {
            return null;
          }

          const [entry] = firstResults.splice(index, 1);
          return entry.result;
        },
        async all() {
          const index = allResults.findIndex((entry) => call.sql.includes(entry.match));
          if (index < 0) {
            return { results: [] };
          }

          const [entry] = allResults.splice(index, 1);
          return { results: entry.result };
        },
      };
    },
    async batch(statements: Array<{ sql: string; params: unknown[] }>) {
      batchCalls.push(statements.map((statement) => ({
        sql: statement.sql,
        params: statement.params,
      })));
      return statements.map(() => ({ success: true, meta: { changes: 1 } }));
    },
  };
}
