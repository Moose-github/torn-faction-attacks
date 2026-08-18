import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendDiscordAlertMessageWithAttachments } from "./discordAlertDelivery";
import { isDiscordAlertEnabled } from "./discordAlertSettings";
import { DISCORD_ALERT_KEYS } from "./discordAlerts";
import {
  renderEnemyMemberStatsTablePng,
  renderStatsComparisonPng,
} from "./discordImageRenderer";
import { sendPendingEnemyStatsComparisonImage } from "./enemyScoutingCron";
import {
  readCurrentScoutingWar,
  readEnemyScouting,
  readHomeScouting,
} from "./enemyScouting";
import {
  clearSyncLatch,
  readSetSyncLatches,
  setSyncLatch,
} from "./syncLatches";
import type { Env } from "./types";

vi.mock("./discordAlertDelivery", () => ({
  sendDiscordAlertMessageWithAttachments: vi.fn(),
}));

vi.mock("./discordAlertSettings", () => ({
  isDiscordAlertEnabled: vi.fn(),
}));

vi.mock("./discordImageRenderer", () => ({
  renderEnemyMemberStatsTablePng: vi.fn(),
  renderStatsComparisonPng: vi.fn(),
}));

vi.mock("./enemyScouting", () => ({
  clearLiveEnemyTrackingData: vi.fn(),
  fetchBspBattlestatPrediction: vi.fn(),
  readCurrentScoutingWar: vi.fn(),
  readEnemyScouting: vi.fn(),
  readHomeScouting: vi.fn(),
  refreshEnemyFactionMemberStatuses: vi.fn(),
  refreshMissingFfBattlestats: vi.fn(),
}));

vi.mock("./syncLatches", () => ({
  clearSyncLatch: vi.fn(),
  isSyncLatchSet: vi.fn(),
  readSetSyncLatches: vi.fn(),
  setSyncLatch: vi.fn(),
}));

describe("enemy scouting stats image Discord report", () => {
  const env = {} as Env;
  const war = {
    id: 123,
    name: "Test War",
    status: "active",
    enemy_faction_id: 456,
    war_type: "real",
    practical_start_time: 1_781_000_000,
    practical_finish_time: null,
    official_start_time: null,
    enemy_scouting_status_checked_at: 1_780_999_000,
  };
  const pendingLatch = "enemy_target_stats_image_pending:123:456";
  const sentLatch = "enemy_target_stats_image_sent:123:456";
  const readyLatches = new Set([
    "enemy_target_ff_fill_complete:123:456",
    "enemy_target_bsp_fill_complete:123:456",
    "enemy_target_networth_fill_complete:123:456",
    pendingLatch,
  ]);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readCurrentScoutingWar).mockResolvedValue(war as any);
    vi.mocked(readSetSyncLatches).mockResolvedValue(new Set(readyLatches));
    vi.mocked(isDiscordAlertEnabled).mockResolvedValue(true);
    vi.mocked(readHomeScouting).mockResolvedValue([]);
    vi.mocked(readEnemyScouting).mockResolvedValue([]);
    vi.mocked(renderStatsComparisonPng).mockResolvedValue(new Uint8Array([1]));
    vi.mocked(renderEnemyMemberStatsTablePng).mockResolvedValue(new Uint8Array([2]));
    vi.mocked(sendDiscordAlertMessageWithAttachments).mockResolvedValue("message-1");
  });

  it("keeps the report pending when Discord delivery is skipped", async () => {
    vi.mocked(sendDiscordAlertMessageWithAttachments).mockResolvedValue(null);

    const result = await sendPendingEnemyStatsComparisonImage(env);

    expect(result).toEqual({
      sent: false,
      skipped: true,
      reason: "Discord delivery returned no message id",
    });
    expect(setSyncLatch).not.toHaveBeenCalled();
    expect(clearSyncLatch).not.toHaveBeenCalled();
  });

  it("marks the report sent only after Discord returns a message id", async () => {
    const result = await sendPendingEnemyStatsComparisonImage(env);

    expect(result).toEqual({ sent: true, skipped: false });
    expect(sendDiscordAlertMessageWithAttachments).toHaveBeenCalledWith(
      env,
      DISCORD_ALERT_KEYS.enemyScoutingReport,
      expect.objectContaining({
        content: "War matchup announced: Buttgrass vs Test War. Starts <t:1781000000:R>",
        attachments: expect.arrayContaining([
          expect.objectContaining({ filename: "enemy-stats-comparison-123.png" }),
          expect.objectContaining({ filename: "enemy-member-stats-123.png" }),
        ]),
      }),
    );
    expect(setSyncLatch).toHaveBeenCalledWith(env, sentLatch, expect.any(Number));
    expect(clearSyncLatch).toHaveBeenCalledWith(env, pendingLatch);
  });
});
