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
});

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
}): Env {
  return {
    DB: {
      prepare(sql: string) {
        const compactSql = sql.replace(/\s+/g, " ").trim();
        const statement = {
          bind() {
            return statement;
          },
          first: async () => firstRowForQuery(compactSql, options),
          all: async () => ({ results: rowsForQuery(compactSql, options) }),
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
