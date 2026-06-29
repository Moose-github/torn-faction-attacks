import { describe, expect, it } from "vitest";
import type { Env } from "../types";
import { applyRankedWarReportStats } from "./rankedReport";

describe("ranked war report stats", () => {
  it("adds report-only rows for home members missing from calculated war stats", async () => {
    const db = fakeDb({
      allResults: [
        { match: "FROM war_member_stats", result: [{ member_id: 10 }] },
      ],
    });

    const result = await applyRankedWarReportStats(envWithDb(db), {
      warId: 7,
      homeMembers: [
        { id: 10, name: "Existing", level: 99, attacks: 1, score: 100 },
        { id: 11, name: "Missing", level: 88, attacks: 0, score: 0 },
      ],
    });

    expect(result).toEqual({
      home_report_members: 2,
      added_from_report_members: 1,
    });
    expect(db.batchCalls).toHaveLength(1);
    expect(db.batchCalls[0]).toHaveLength(1);
    expect(db.batchCalls[0][0].sql).toContain("INSERT INTO war_member_stats");
    expect(db.batchCalls[0][0].sql).toContain("added_from_report");
    expect(db.batchCalls[0][0].params).toEqual([7, 11, "Missing"]);
  });

  it("does not write when every report member already has a stat row", async () => {
    const db = fakeDb({
      allResults: [
        { match: "FROM war_member_stats", result: [{ member_id: 10 }] },
      ],
    });

    const result = await applyRankedWarReportStats(envWithDb(db), {
      warId: 7,
      homeMembers: [
        { id: 10, name: "Existing", level: 99, attacks: 1, score: 100 },
      ],
    });

    expect(result).toEqual({
      home_report_members: 1,
      added_from_report_members: 0,
    });
    expect(db.batchCalls).toHaveLength(0);
  });
});

function envWithDb(db: ReturnType<typeof fakeDb>): Env {
  return { DB: db } as unknown as Env;
}

function fakeDb(options?: {
  allResults?: Array<{ match: string; result: unknown[] }>;
}) {
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
