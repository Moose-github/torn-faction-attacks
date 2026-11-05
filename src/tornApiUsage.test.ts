import { describe, expect, it } from "vitest";
import { refreshTornApiUsageRollups } from "./tornApiUsage";
import type { Env } from "./types";

describe("Torn API usage rollups", () => {
  it("refreshes a bounded window for all admin groupings in one batch", async () => {
    const statements: Array<{ sql: string; binds: unknown[] }> = [];
    const env = rollupEnv(statements);

    const result = await refreshTornApiUsageRollups(env, 1_800_000);

    const deleteStatement = statements.find((statement) => statement.sql.includes("DELETE FROM torn_api_usage_rollup_15m"));
    const insertStatements = statements.filter((statement) => statement.sql.includes("INSERT INTO torn_api_usage_rollup_15m"));
    const syncStatement = statements.find((statement) => statement.sql.includes("INSERT INTO sync_state"));

    expect(deleteStatement).toBeUndefined();
    expect(insertStatements).toHaveLength(1);
    expect(insertStatements[0].binds).toEqual([900, 1_710_000, 1_800_000]);
    expect(syncStatement?.binds).toEqual(["torn_api_usage_rollup_15m", 1_800_000]);
    expect(result).toMatchObject({
      writeStatements: 2,
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
      async batch(prepared: Array<{ run(): Promise<unknown> }>) {
        const results = [];
        for (const statement of prepared) results.push(await statement.run());
        return results;
      },
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
