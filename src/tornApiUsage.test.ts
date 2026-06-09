import { describe, expect, it } from "vitest";
import { refreshTornApiUsageRollups } from "./tornApiUsage";
import type { Env } from "./types";

describe("Torn API usage rollups", () => {
  it("rebuilds a bounded 15-minute rollup window for each admin grouping", async () => {
    const statements: Array<{ sql: string; binds: unknown[] }> = [];
    const env = rollupEnv(statements);

    const result = await refreshTornApiUsageRollups(env, 1_800_000);

    const deleteStatement = statements.find((statement) => statement.sql.includes("DELETE FROM torn_api_usage_rollup_15m"));
    const insertStatements = statements.filter((statement) => statement.sql.includes("INSERT INTO torn_api_usage_rollup_15m"));
    const syncStatement = statements.find((statement) => statement.sql.includes("INSERT INTO sync_state"));

    expect(deleteStatement?.binds).toEqual([1_710_000, 1_800_000]);
    expect(insertStatements).toHaveLength(3);
    expect(insertStatements.map((statement) => statement.binds[1])).toEqual([
      "feature",
      "endpoint",
      "key_source",
    ]);
    expect(insertStatements.every((statement) => statement.binds[2] === 1_710_000)).toBe(true);
    expect(insertStatements.every((statement) => statement.binds[3] === 1_800_000)).toBe(true);
    expect(syncStatement?.binds).toEqual(["torn_api_usage_rollup_15m", 1_800_000]);
    expect(result).toMatchObject({
      writeStatements: 5,
      details: {
        start_at: 1_710_000,
        end_at: 1_800_000,
        bucket_seconds: 900,
      },
    });
  });
});

function rollupEnv(statements: Array<{ sql: string; binds: unknown[] }>): Env {
  return {
    DB: {
      prepare(sql: string) {
        const compactSql = sql.replace(/\s+/g, " ").trim();
        const statement = {
          binds: [] as unknown[],
          bind(...binds: unknown[]) {
            statement.binds = binds;
            statements.push({ sql: compactSql, binds });
            return statement;
          },
          first: async () => null,
          run: async () => ({ success: true, meta: { changes: 1 } }),
        };
        return statement;
      },
    },
  } as unknown as Env;
}
