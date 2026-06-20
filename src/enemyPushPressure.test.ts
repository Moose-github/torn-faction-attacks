import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendDiscordMessage } from "./discord";
import { sendEnemyPushAlerts, type EnemyPushSnapshotInput } from "./enemyPushPressure";
import {
  clearSyncLatch,
  clearSyncLatchesByPrefix,
  isSyncLatchSet,
  readSetSyncLatches,
  setSyncLatch,
} from "./syncLatches";
import type { Env } from "./types";

vi.mock("./discord", () => ({
  sendDiscordMessage: vi.fn(),
}));

vi.mock("./syncLatches", () => ({
  clearSyncLatch: vi.fn(),
  clearSyncLatchesByPrefix: vi.fn(),
  isSyncLatchSet: vi.fn(),
  readSetSyncLatches: vi.fn(),
  setSyncLatch: vi.fn(),
}));

describe("enemy push alerts", () => {
  const env = {} as Env;
  const snapshot: EnemyPushSnapshotInput = {
    war_id: 123,
    faction_id: 456,
    bucket_start: 1_781_000_000,
    total_members: 50,
    online_count: 12,
    idle_count: 10,
    offline_count: 28,
    recently_active_count: 14,
    offline_idle_to_online_count: 4,
    enemy_attacks_last_5m: 6,
    hospital_count: 3,
    revivable_count: 2,
    baseline_active_count: 8,
    activity_above_baseline: 6,
    online_delta_10m: 5,
    recently_active_delta_10m: 7,
    pressure_score: 25,
    pressure_level: "underway",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readSetSyncLatches).mockResolvedValue(new Set());
  });

  it("does not send Discord messages by default", async () => {
    vi.mocked(isSyncLatchSet).mockResolvedValue(false);

    await sendEnemyPushAlerts(env, 123, "Test War", snapshot, [], { warType: "real" });

    expect(sendDiscordMessage).not.toHaveBeenCalled();
    expect(readSetSyncLatches).not.toHaveBeenCalled();
    expect(setSyncLatch).not.toHaveBeenCalled();
    expect(clearSyncLatchesByPrefix).not.toHaveBeenCalled();
  });

  it("sends and latches Discord messages when enabled", async () => {
    vi.mocked(isSyncLatchSet).mockResolvedValue(true);
    vi.mocked(readSetSyncLatches).mockResolvedValue(new Set(["enemy_push_alert:123:likely"]));

    await sendEnemyPushAlerts(env, 123, "Test War", snapshot, [], { warType: "real" });

    expect(sendDiscordMessage).toHaveBeenCalledOnce();
    expect(setSyncLatch).toHaveBeenCalledWith(env, "enemy_push_alert:123:underway", snapshot.bucket_start);
    expect(clearSyncLatch).toHaveBeenCalledWith(env, "enemy_push_alert:123:likely");
  });
});
