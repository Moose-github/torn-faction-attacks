import { describe, expect, it } from "vitest";
import {
  enemyNetworthCandidateLimit,
  partitionEnemyNetworthCandidates,
} from "./enemyNetworth";

describe("enemy networth key pooling", () => {
  it("scales the candidate limit by active key count", () => {
    expect(enemyNetworthCandidateLimit(0)).toBe(0);
    expect(enemyNetworthCandidateLimit(1)).toBe(40);
    expect(enemyNetworthCandidateLimit(3)).toBe(120);
  });

  it("partitions candidates across keys while respecting the per-key limit", () => {
    const keys = [
      candidate("env:TORN_API_KEY", "admin-fallback"),
      candidate("key_pool:alpha", "alpha"),
      candidate("key_pool:bravo", "bravo"),
    ];
    const rows = Array.from({ length: 10 }, (_, index) => index + 1);

    const batches = partitionEnemyNetworthCandidates(rows, keys, 3);

    expect(batches).toEqual([
      { key: keys[0], rows: [1, 4, 7] },
      { key: keys[1], rows: [2, 5, 8] },
      { key: keys[2], rows: [3, 6, 9] },
    ]);
  });
});

function candidate(id: string, key: string) {
  return {
    id,
    key,
    keySource: id,
    sourceType: id.startsWith("key_pool:") ? "submitted" as const : "env" as const,
    maxRequestsPerMinute: null,
    currentMinuteUsage: 0,
    lastUsedAt: null,
    monitorLastUsedAt: null,
  };
}
