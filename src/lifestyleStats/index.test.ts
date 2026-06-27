import { afterEach, describe, expect, it, vi } from "vitest";
import { getDailyStatsAttention } from ".";
import type { Env } from "../types";

afterEach(() => {
  vi.useRealTimers();
});

describe("daily lifestyle stats attention", () => {
  it("reports lagging personal stats buckets and affected members", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-06T12:00:00Z"));

    const attention = await getDailyStatsAttention(lifestyleAttentionEnv({
      latestBucketDate: "2026-06-03",
      affectedMembers: [
        {
          member_id: 1001,
          member_name: "Lagging Member",
          error: "RETRY_EXPIRED_PERSONALSTATS",
          updated_at: 1_780_000_000,
        },
      ],
      counts: {
        stale_personalstats: 2,
        missing_donator_days: 1,
      },
    }));

    expect(attention).toEqual({
      stale_personalstats: 2,
      missing_donator_days: 1,
      personalstats_target_date: "2026-06-05",
      latest_personalstats_bucket_date: "2026-06-03",
      personalstats_lag_days: 2,
      affected_members: [
        {
          member_id: 1001,
          member_name: "Lagging Member",
          error: "RETRY_EXPIRED_PERSONALSTATS",
          updated_at: 1_780_000_000,
        },
      ],
    });
  });

  it("ignores daily attention rows from before the member joined the faction", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-06T12:00:00Z"));
    const calls: DbCall[] = [];

    await getDailyStatsAttention(lifestyleAttentionEnv({
      latestBucketDate: "2026-06-05",
      affectedMembers: [],
      counts: {
        stale_personalstats: 0,
        missing_donator_days: 0,
      },
      calls,
    }));

    const affectedMembersCall = calls.find((call) =>
      call.method === "all" && call.sql.includes("LIMIT 12")
    );
    const countsCall = calls.find((call) =>
      call.method === "first" && call.sql.includes("AS stale_personalstats")
    );

    expect(affectedMembersCall?.sql).toContain("members.days_in_faction IS NULL");
    expect(affectedMembersCall?.sql).toContain("stats.snapshot_date > date(members.updated_at");
    expect(countsCall?.sql).toContain("members.days_in_faction IS NULL");
    expect(countsCall?.sql).toContain("stats.snapshot_date > date(members.updated_at");
  });
});

type DbCall = {
  sql: string;
  method: "first" | "all";
  params: unknown[];
};

function lifestyleAttentionEnv(options: {
  latestBucketDate: string | null;
  affectedMembers: Array<{
    member_id: number;
    member_name: string | null;
    error: string | null;
    updated_at: number | null;
  }>;
  counts: {
    stale_personalstats: number | null;
    missing_donator_days: number | null;
  } | null;
  calls?: DbCall[];
}): Env {
  return {
    DB: {
      prepare(sql: string) {
        const compactSql = sql.replace(/\s+/g, " ").trim();
        const statement = {
          params: [] as unknown[],
          bind(...params: unknown[]) {
            statement.params = params;
            return statement;
          },
          first: async () => {
            options.calls?.push({ sql: compactSql, method: "first", params: statement.params });
            return firstRowForQuery(compactSql, options);
          },
          all: async () => {
            options.calls?.push({ sql: compactSql, method: "all", params: statement.params });
            return { results: rowsForQuery(compactSql, options) };
          },
        };
        return statement;
      },
    },
  } as unknown as Env;
}

function firstRowForQuery(
  sql: string,
  options: Parameters<typeof lifestyleAttentionEnv>[0],
): Record<string, unknown> | null {
  if (sql.includes("ORDER BY snapshots.snapshot_date DESC")) {
    return options.latestBucketDate === null
      ? null
      : { snapshot_date: options.latestBucketDate };
  }

  if (sql.includes("AS stale_personalstats")) {
    return options.counts;
  }

  return null;
}

function rowsForQuery(
  sql: string,
  options: Parameters<typeof lifestyleAttentionEnv>[0],
): Array<Record<string, unknown>> {
  if (sql.includes("LIMIT 12")) {
    return options.affectedMembers;
  }

  return [];
}
