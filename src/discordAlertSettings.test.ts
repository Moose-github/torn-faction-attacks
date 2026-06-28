import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAdminDiscordAlertSettings,
  readShopliftingSecurityAlertSettings,
  updateAdminDiscordAlertSettingsFromRequest,
  updateEnemyPushAlertSetting,
} from "./discordAlertSettings";
import {
  clearSyncLatch,
  clearSyncLatchesByPrefix,
  isSyncLatchSet,
  readSetSyncLatches,
  setSyncLatch,
} from "./syncLatches";
import type { Env } from "./types";

vi.mock("./syncLatches", () => ({
  clearSyncLatch: vi.fn(),
  clearSyncLatchesByPrefix: vi.fn(),
  isSyncLatchSet: vi.fn(),
  readSetSyncLatches: vi.fn(),
  setSyncLatch: vi.fn(),
}));

describe("Discord alert settings", () => {
  const env = {} as Env;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isSyncLatchSet).mockResolvedValue(false);
    vi.mocked(readSetSyncLatches).mockResolvedValue(new Set());
  });

  it("reads global Discord alert settings from existing latches", async () => {
    vi.mocked(isSyncLatchSet).mockResolvedValue(true);
    vi.mocked(readSetSyncLatches)
      .mockResolvedValueOnce(new Set(["shoplifting_security_alert_enabled:jewelry_store"]))
      .mockResolvedValueOnce(new Set(["shoplifting_security_alert_disabled:big_als"]));

    const response = await getAdminDiscordAlertSettings(env);

    expect(await response.json()).toEqual({
      ok: true,
      alerts: [
        {
          shop_key: "big_als",
          shop_name: "Big Als",
          enabled: false,
          configurable: true,
        },
        {
          shop_key: "jewelry_store",
          shop_name: "Jewelry Store",
          enabled: true,
          configurable: true,
        },
      ],
      enemy_push_alert: {
        key: "enemy_push",
        name: "Enemy push alerts",
        enabled: true,
        configurable: true,
      },
    });
  });

  it("disables enemy push alerts and clears pending push alert latches", async () => {
    await updateEnemyPushAlertSetting(env, false);

    expect(clearSyncLatch).toHaveBeenCalledWith(env, "enemy_push_alert_discord_enabled");
    expect(clearSyncLatchesByPrefix).toHaveBeenCalledWith(env, "enemy_push_alert:");
  });

  it("uses default-enabled shoplifting override latches", async () => {
    await updateAdminDiscordAlertSettingsFromRequest(jsonRequest({ shop_key: "big_als", enabled: false }), env);

    expect(clearSyncLatch).toHaveBeenCalledWith(env, "shoplifting_security_alert_enabled:big_als");
    expect(setSyncLatch).toHaveBeenCalledWith(
      env,
      "shoplifting_security_alert_disabled:big_als",
      expect.any(Number),
    );
    expect(clearSyncLatch).toHaveBeenCalledWith(env, "shoplifting_security_alert:big_als");
  });

  it("uses default-disabled shoplifting override latches", async () => {
    await updateAdminDiscordAlertSettingsFromRequest(jsonRequest({ shop_key: "jewelry_store", enabled: true }), env);

    expect(clearSyncLatch).toHaveBeenCalledWith(env, "shoplifting_security_alert_disabled:jewelry_store");
    expect(setSyncLatch).toHaveBeenCalledWith(
      env,
      "shoplifting_security_alert_enabled:jewelry_store",
      expect.any(Number),
    );
  });

  it("rejects unknown shoplifting alert setting updates", async () => {
    const response = await updateAdminDiscordAlertSettingsFromRequest(
      jsonRequest({ shop_key: "unknown", enabled: true }),
      env,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      ok: false,
      code: "UNKNOWN_SHOPLIFTING_ALERT",
    });
  });

  it("returns shoplifting alert settings directly for senders", async () => {
    vi.mocked(readSetSyncLatches)
      .mockResolvedValueOnce(new Set())
      .mockResolvedValueOnce(new Set());

    await expect(readShopliftingSecurityAlertSettings(env)).resolves.toEqual([
      {
        shop_key: "big_als",
        shop_name: "Big Als",
        enabled: true,
        configurable: true,
      },
      {
        shop_key: "jewelry_store",
        shop_name: "Jewelry Store",
        enabled: false,
        configurable: true,
      },
    ]);
  });
});

function jsonRequest(body: unknown): Request {
  return new Request("https://worker.test/api/admin/discord-alerts/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
