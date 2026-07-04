import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runWithTornKeyPool: vi.fn(),
}));

vi.mock("../tornKeyPool", () => ({
  runWithTornKeyPool: mocks.runWithTornKeyPool,
}));

import { fetchMemberPersonalStats } from "./dailyPersonal";

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
});
