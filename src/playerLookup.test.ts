import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchTornPersonalStatsWithTimestamps: vi.fn(),
  fetchTrackedTornJson: vi.fn(),
  runWithTornKeyPool: vi.fn(),
}));

vi.mock("./external/torn", () => ({
  fetchTrackedTornJson: mocks.fetchTrackedTornJson,
}));

vi.mock("./personalStats", () => ({
  fetchTornPersonalStatsWithTimestamps: mocks.fetchTornPersonalStatsWithTimestamps,
}));

vi.mock("./tornKeyPool", () => ({
  runWithTornKeyPool: mocks.runWithTornKeyPool,
}));

import {
  PLAYER_LOOKUP_HISTORICAL_STAT_KEYS,
  PLAYER_LOOKUP_PERSONAL_STAT_KEYS,
  lookupTornPlayer,
  normalizeTornPlayerProfile,
} from "./playerLookup";

describe("player lookup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runWithTornKeyPool.mockImplementation(async (_env, options) => ({
      result: await options.run({
        key: "api-key-1",
        keySource: "key_pool:key-1",
        candidate: {
          id: "key-1",
          key: "api-key-1",
          keySource: "key_pool:key-1",
          sourceType: "submitted",
          maxRequestsPerMinute: 35,
          currentMinuteUsage: 0,
          lastUsedAt: null,
          monitorLastUsedAt: null,
        },
      }),
      candidate: { id: "key-1" },
    }));
  });

  it("fetches player info and current plus 30-day personal stats", async () => {
    mocks.fetchTrackedTornJson.mockResolvedValue({
      profile: {
        id: 123,
        name: "Alice",
        level: 75,
        rank: "Absolute beginner",
        title: "Pilot",
        age: 3000,
        faction: { id: 8803, name: "Buttgrass" },
        property: { name: "Private Island" },
        spouse: { id: 456, name: "Bob", days_married: 789 },
        awards: 250,
        status: { state: "Okay", description: "Okay" },
        last_action: { status: "Online", timestamp: 1_800_000_000 },
      },
    });
    mocks.fetchTornPersonalStatsWithTimestamps
      .mockResolvedValueOnce({
        xantaken: { value: 130, timestamp: 1_800_000_000 },
        timeplayed: { value: 3_600_000, timestamp: 1_800_000_000 },
        criminaloffenses: { value: 12_300, timestamp: 1_800_000_000 },
        refills: { value: 90, timestamp: 1_800_000_000 },
        traveltimes: { value: 400, timestamp: 1_800_000_000 },
        activestreak: { value: 45, timestamp: 1_800_000_000 },
        bestactivestreak: { value: 120, timestamp: 1_800_000_000 },
        attackswon: { value: 500, timestamp: 1_800_000_000 },
        networth: { value: 2_000_000, timestamp: 1_800_000_000 },
      })
      .mockResolvedValueOnce({
        xantaken: { value: 100, timestamp: 1_798_272_000 },
        timeplayed: { value: 3_340_800, timestamp: 1_798_272_000 },
        criminaloffenses: { value: 12_000, timestamp: 1_798_272_000 },
        refills: { value: 60, timestamp: 1_798_272_000 },
        traveltimes: { value: 370, timestamp: 1_798_272_000 },
        attackswon: { value: 410, timestamp: 1_798_272_000 },
      });

    const result = await lookupTornPlayer({} as any, 123, 1_800_000_000);

    expect(mocks.runWithTornKeyPool).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      feature: "misc_utilities",
      usageCount: 3,
    }));
    expect(mocks.fetchTrackedTornJson).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ href: "https://api.torn.com/v2/user/123/profile" }),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "ApiKey api-key-1",
        }),
      }),
      expect.objectContaining({
        feature: "player-lookup:profile",
        keySource: "key_pool:key-1",
      }),
      expect.objectContaining({ service: "Torn player lookup" }),
    );
    expect(mocks.fetchTornPersonalStatsWithTimestamps).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      123,
      PLAYER_LOOKUP_PERSONAL_STAT_KEYS,
      {
        apiKey: "api-key-1",
        keySource: "key_pool:key-1",
      },
    );
    expect(mocks.fetchTornPersonalStatsWithTimestamps).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      123,
      PLAYER_LOOKUP_HISTORICAL_STAT_KEYS,
      {
        timestamp: 1_797_408_000,
        apiKey: "api-key-1",
        keySource: "key_pool:key-1",
      },
    );
    expect(result.profile.name).toBe("Alice");
    expect(result.averages.find((average) => average.key === "xantaken")?.periodDays).toBe(20);
    expect(result.averages.find((average) => average.key === "xantaken")?.averagePerDay).toBe(1.5);
    expect(result.averages.find((average) => average.key === "timeplayed")?.averagePerDay).toBe(12960);
    expect(result.averages.find((average) => average.key === "attackswon")?.delta).toBe(90);
    expect(result.averages.find((average) => average.key === "networth")?.delta).toBeNull();
    expect(result.averages.find((average) => average.key === "activestreak")?.previous).toBeNull();
  });

  it("normalizes common Torn profile response shapes", () => {
    expect(normalizeTornPlayerProfile({
      profile: {
        player_id: 456,
        player_name: "Bob",
        rank: "Highly distinguished",
        title: "Soldier",
        age: 2000,
        faction_id: 1234,
        faction_name: "Example Faction",
        property_name: "Castle",
        spouse_id: 789,
        spouse_name: "Alice",
        days_married: 100,
        awards_count: 42,
        last_action_status: "Idle",
      },
    }, 456)).toMatchObject({
      id: 456,
      name: "Bob",
      rank: "Highly distinguished",
      title: "Soldier",
      age: 2000,
      factionId: 1234,
      factionName: "Example Faction",
      propertyName: "Castle",
      spouseId: 789,
      spouseName: "Alice",
      daysMarried: 100,
      awards: 42,
      lastActionStatus: "Idle",
    });
  });
});
