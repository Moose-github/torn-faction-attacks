import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  withTornKeyPool: vi.fn(),
}));

vi.mock("./tornKeyPool", () => ({
  withTornKeyPool: mocks.withTornKeyPool,
}));

import { fetchTornPersonalStatsWithTimestamps } from "./personalStats";

describe("personal stats key pool routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the faction lifestyle feature by default", async () => {
    mocks.withTornKeyPool.mockResolvedValue({ networth: { value: 123, timestamp: null } });

    const result = await fetchTornPersonalStatsWithTimestamps({} as any, 123, ["networth"]);

    expect(result.networth.value).toBe(123);
    expect(mocks.withTornKeyPool).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ feature: "faction_lifestyle_stats" }),
    );
  });

  it("allows callers to route personalstats through another feature", async () => {
    mocks.withTornKeyPool.mockResolvedValue({ networth: { value: 456, timestamp: null } });

    await fetchTornPersonalStatsWithTimestamps({} as any, 123, ["networth"], {
      feature: "enemy_scouting",
    });

    expect(mocks.withTornKeyPool).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ feature: "enemy_scouting" }),
    );
  });

  it("requires keySource when a raw apiKey is supplied", async () => {
    await expect(fetchTornPersonalStatsWithTimestamps({} as any, 123, ["networth"], {
      apiKey: "raw-key",
    })).rejects.toThrow("keySource is required when apiKey is supplied");
  });
});
