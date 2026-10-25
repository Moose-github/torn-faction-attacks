import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runWithTornKeyPool: vi.fn(),
}));

vi.mock("../tornKeyPool", () => ({
  runWithTornKeyPool: mocks.runWithTornKeyPool,
}));

import { fetchMemberPersonalStats, refreshMemberLifestyleStats } from "./dailyPersonal";

describe("daily personal stats key pool routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses faction lifestyle stats when no raw api key is supplied", async () => {
    const result = {
      xantaken: 1,
      personalstats_key_source: "key_pool:test",
    };
    mocks.runWithTornKeyPool.mockResolvedValue({ result });

    await expect(fetchMemberPersonalStats({} as any, 123, {})).resolves.toBe(result);

    expect(mocks.runWithTornKeyPool).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ feature: "faction_lifestyle_stats" }),
    );
  });

  it("requires keySource when a raw api key is supplied", async () => {
    await expect(fetchMemberPersonalStats({} as any, 123, {
      apiKey: "raw-key",
    })).rejects.toThrow("keySource is required when apiKey is supplied");
  });

  it.each(["2026-09-18", "2026-09-17"])("counts an older returned bucket (%s) as pending, not a failed fetch", async returnedDate => {
    const writes: unknown[][] = [];
    const env = collectionEnv(writes);
    mocks.runWithTornKeyPool.mockResolvedValue({ result: { daysbeendonator: 100, personalstats_bucket_date: returnedDate } });
    const result = await refreshMemberLifestyleStats(env, { homeMembersSynced: true, activeDates: ["2026-09-18", "2026-09-19"] });
    expect(result).toEqual({ considered: 1, refreshed: 0, pending: 1, failed: 0 });
    expect(writes).toContainEqual(["pending", `PERSONALSTATS_BUCKET_MISMATCH: requested 2026-09-19, received ${returnedDate}`, 0, 101, "2026-09-19"]);
  });

  it("continues to count real API errors as failed fetches", async () => {
    const writes: unknown[][] = [];
    mocks.runWithTornKeyPool.mockRejectedValue(new Error("Invalid API key"));
    const result = await refreshMemberLifestyleStats(collectionEnv(writes), { homeMembersSynced: true, activeDates: ["2026-09-18", "2026-09-19"] });
    expect(result).toEqual({ considered: 1, refreshed: 0, pending: 0, failed: 1 });
    expect(writes).toContainEqual(["failed", "Invalid API key", 0, 101, "2026-09-19"]);
  });

  it("counts expired-day attempts and only retries days under the cap", async () => {
    const writes: unknown[][] = [];
    const reads: Array<{ sql: string; params: unknown[] }> = [];
    mocks.runWithTornKeyPool.mockResolvedValue({ result: { daysbeendonator: 100, personalstats_bucket_date: "2026-09-09" } });

    await refreshMemberLifestyleStats(collectionEnv(writes, reads, { expired: true }), {
      homeMembersSynced: true,
      activeDates: ["2026-09-18", "2026-09-19"],
      expiredOnly: true,
    });

    const expiredRead = reads.find((read) => read.sql.includes("recent.status = 'retry_expired'"));
    expect(expiredRead?.sql).toContain("recent.expired_attempts < ?");
    expect(expiredRead?.params).toEqual([8803, 5, 5]);
    expect(writes).toContainEqual(["retry_expired", "PERSONALSTATS_BUCKET_MISMATCH: requested 2026-09-10, received 2026-09-09", 1, 101, "2026-09-10"]);
  });

  it.each([
    { daysbeendonator: null, personalstats_bucket_date: "2026-09-18", code: "MISSING_DONATOR_DAYS" },
    { daysbeendonator: 100, personalstats_bucket_date: null, code: "MISSING_PERSONALSTATS_BUCKET" },
  ])("leaves an incomplete snapshot pending: $code", async ({ code, ...stats }) => {
    const writes: unknown[][] = [];
    mocks.runWithTornKeyPool.mockResolvedValue({ result: stats });
    const result = await refreshMemberLifestyleStats(collectionEnv(writes), { homeMembersSynced: true, activeDates: ["2026-09-18", "2026-09-19"] });
    expect(result).toEqual({ considered: 1, refreshed: 0, pending: 1, failed: 0 });
    expect(writes).toContainEqual(["pending", expect.stringContaining(code), 0, 101, "2026-09-19"]);
  });
});

function collectionEnv(writes: unknown[][], reads: Array<{ sql: string; params: unknown[] }> = [], options: { expired?: boolean } = {}) {
  return { DB: {
    async batch() { return []; },
    prepare(sql: string) {
      let params: unknown[] = [];
      return {
        bind(...values: unknown[]) { params = values; return this; },
        async run() { writes.push(params); return { meta: { changes: 1 } }; },
        async first() { return { complete: 1 }; },
        async all() {
          reads.push({ sql, params });
          if (options.expired) {
            return { results: sql.includes("recent.status = 'retry_expired'") ? [{ member_id: 101, snapshot_date: "2026-09-10", status: "retry_expired", target_timestamp: 1 }] : [] };
          }
          return { results: sql.includes("recent.snapshot_date IN") ? [{ member_id: 101, snapshot_date: "2026-09-19", status: "pending", target_timestamp: 1 }] : [] };
        },
      };
    },
  } } as any;
}
