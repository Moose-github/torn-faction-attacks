import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireAdmin } from "../auth";
import { acceptDailyStatsIssueFromRequest } from "../lifestyleStats/dailyAttention";
vi.mock("../lifestyleStats/dailyAttention", () => ({
  acceptDailyStatsIssueFromRequest: vi.fn(),
  getDailyStatsAttention: vi.fn(),
}));
import { sendAdminDiscordMessageFromRequest } from "../discordMessageSend";
import { getAdminDiscordSubscriptionSettings, updateAdminDiscordSubscriptionSettingFromRequest } from "../discordSubscriptionSettings";
vi.mock("../discordSubscriptionSettings", () => ({ getAdminDiscordSubscriptionSettings: vi.fn(), updateAdminDiscordSubscriptionSettingFromRequest: vi.fn() }));
vi.mock("../discordMessageSend", () => ({ sendAdminDiscordMessageFromRequest: vi.fn() }));
import {
  getAdminDataHealth,
  updateDataHealthSettingsFromRequest,
} from "../dataHealth";
import { jsonResponse, routeContext } from "../testUtils/http";
import {
  getWarControlSettings,
  updateWarControlSettingsFromRequest,
} from "../warControl";
import { syncMemberDiscordLinksFromRequest } from "../memberDiscordLinks";
import {
  clearDiscordTravelTrackerTargetFromRequest,
  getDiscordTravelTrackerTargetFromRequest,
  setDiscordTravelTrackerTargetFromRequest,
  syncDiscordTravelTrackerFromRequest,
  updateDiscordTravelTrackerSettingsFromRequest,
} from "../discordTravelTracker";
import {
  getAdminDiscordAlertSettings,
  testAdminDiscordAlertRouteFromRequest,
  updateAdminDiscordAlertSettingsFromRequest,
} from "../discordAlertSettings";
import {
  readSyncTimestamp,
  upsertSyncTimestamp,
} from "../syncState";
import { refreshStockBenefitItemPrices } from "../stockMarket";
import { refreshMemberAchievementSummaries } from "../memberAchievements";
import { listAdminTornApiKeys } from "../tornKeyPool";
import { routeAdminApi } from "./adminRoutes";
import { deleteDiscordBotMessageFromRequest, previewDiscordBotMessageFromRequest } from "../discordMessageAdmin";
import { getAdminDiscordAlertMentions, updateAdminDiscordAlertMentionsFromRequest } from "../discordMentionSettings";
import { getAdminDiscordRouteDestinations, updateAdminDiscordRouteFromRequest } from "../discordRouteAdmin";
vi.mock("../discordRouteAdmin", () => ({ getAdminDiscordRouteDestinations: vi.fn(), updateAdminDiscordRouteFromRequest: vi.fn() }));
vi.mock("../discordMentionSettings", () => ({ getAdminDiscordAlertMentions: vi.fn(), updateAdminDiscordAlertMentionsFromRequest: vi.fn() }));

vi.mock("../discordMessageAdmin", () => ({ deleteDiscordBotMessageFromRequest: vi.fn(), previewDiscordBotMessageFromRequest: vi.fn() }));

vi.mock("../auth", () => ({
  grantAdminAccess: vi.fn(),
  listAdminUsers: vi.fn(),
  readAuthenticatedUserId: vi.fn(),
  requireAdmin: vi.fn(),
}));

vi.mock("../dataHealth", () => ({
  getAdminDataHealth: vi.fn(),
  updateDataHealthSettingsFromRequest: vi.fn(),
}));

vi.mock("../cacheVersions", () => ({
  bumpGlobalWarCacheVersion: vi.fn(),
  bumpWarCacheVersionById: vi.fn(),
}));
vi.mock("../discordTravelTracker", () => ({
  clearDiscordTravelTrackerTargetFromRequest: vi.fn(),
  getDiscordTravelTrackerTargetFromRequest: vi.fn(),
  setDiscordTravelTrackerTargetFromRequest: vi.fn(),
  syncDiscordTravelTrackerFromRequest: vi.fn(),
  updateDiscordTravelTrackerSettingsFromRequest: vi.fn(),
}));
vi.mock("../discordAlertSettings", () => ({
  getAdminDiscordAlertSettings: vi.fn(),
  testAdminDiscordAlertRouteFromRequest: vi.fn(),
  updateAdminDiscordAlertSettingsFromRequest: vi.fn(),
}));
vi.mock("../enemyScoutingCron", () => ({
  previewEnemyStatsImageFromRequest: vi.fn(),
  resetEnemyStatsImageFromRequest: vi.fn(),
}));
vi.mock("../enemyScouting", () => ({ restartLiveEnemyTrackingFromRequest: vi.fn() }));
vi.mock("../homeFactionMembers", () => ({
  listHomeFactionReportExemptions: vi.fn(),
  updateHomeFactionReportExemption: vi.fn(),
}));
vi.mock("../ingestion", () => ({
  getLatestIngestionRun: vi.fn(),
  runIngestion: vi.fn(),
}));
vi.mock("../lifestyleStats", () => ({
  cancelMemberLifestyleRepairJob: vi.fn(),
  createMemberLifestyleRepairJob: vi.fn(),
  getMemberLifestyleRepairJob: vi.fn(),
  listMemberLifestyleRepairJobs: vi.fn(),
  refreshDailyGymStats: vi.fn(),
  refreshDailyMemberLifestyleStats: vi.fn(),
}));
vi.mock("../maintenance", () => ({ getLatestMaintenanceRun: vi.fn() }));
vi.mock("../memberDiscordLinks", () => ({ syncMemberDiscordLinksFromRequest: vi.fn() }));
vi.mock("../memberAchievements", () => ({ refreshMemberAchievementSummaries: vi.fn() }));
vi.mock("../responseCache", () => ({ cachedGetJson: vi.fn() }));
vi.mock("../syncState", () => ({
  readSyncTimestamp: vi.fn(),
  upsertSyncTimestamp: vi.fn(),
}));
vi.mock("../stockMarket", () => ({
  getStockIngestionStatus: vi.fn(),
  refreshStockBenefitItemPrices: vi.fn(),
  refreshTornStockHistoryBatch: vi.fn(),
}));
vi.mock("../stockPaperTrading", () => ({
  exportStockSnapshots: vi.fn(),
  getStockPaperSimulations: vi.fn(),
  getStockPaperStatus: vi.fn(),
  getStockPaperTrades: vi.fn(),
  resetStockPaperAccount: vi.fn(),
  simulateStockPaperBotFromRequest: vi.fn(),
}));
vi.mock("../warStats", () => ({ rebuildWarStatsFromRaw: vi.fn() }));
vi.mock("../suggestions", () => ({ listMemberSuggestionsForAdmin: vi.fn() }));
vi.mock("../tornApiUsage", () => ({ getTornApiUsage: vi.fn() }));
vi.mock("../tornKeyPool", () => ({ listAdminTornApiKeys: vi.fn() }));
vi.mock("../warControl", () => ({
  getWarControlSettings: vi.fn(),
  updateWarControlSettingsFromRequest: vi.fn(),
}));
vi.mock("../wars", () => ({ getAttackWindow: vi.fn() }));
vi.mock("../xanaxCompetition", () => ({
  getAdminXanaxCompetition: vi.fn(),
  previewXanaxCompetitionImage: vi.fn(),
  updateAdminXanaxCompetition: vi.fn(),
}));

describe("admin routes", () => {
  it("does not register the retired packs endpoint", async () => {
    const response = await routeAdminApi(routeContext("https://worker.test/api/admin/packs"));
    expect(response).toBeNull();
    expect(requireAdmin).not.toHaveBeenCalled();
  });

  it.each(["GET", "POST"])("requires admin access for %s subscription availability", async method => {
    vi.mocked(requireAdmin).mockResolvedValueOnce(jsonResponse({ ok: false }, 403));
    const response = await routeAdminApi(routeContext("https://worker.test/api/admin/discord-alerts/subscriptions", { method }));
    expect(response?.status).toBe(403);
    expect(getAdminDiscordSubscriptionSettings).not.toHaveBeenCalled();
    expect(updateAdminDiscordSubscriptionSettingFromRequest).not.toHaveBeenCalled();
  });
  it("routes admin subscription reads and updates", async () => {
    vi.mocked(getAdminDiscordSubscriptionSettings).mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.mocked(updateAdminDiscordSubscriptionSettingFromRequest).mockResolvedValueOnce(jsonResponse({ ok: true }));
    for (const method of ["GET", "POST"]) {
      const context = routeContext("https://worker.test/api/admin/discord-alerts/subscriptions", { method });
      expect((await routeAdminApi(context))?.status).toBe(200);
      if (method === "GET") expect(getAdminDiscordSubscriptionSettings).toHaveBeenCalledWith(context.env);
      else expect(updateAdminDiscordSubscriptionSettingFromRequest).toHaveBeenCalledWith(context.request, context.env);
    }
  });
  it.each([401, 403])("requires admin access before sending Discord messages (%i)", async status => {
    vi.mocked(requireAdmin).mockResolvedValueOnce(jsonResponse({ ok: false }, status));
    const result = await routeAdminApi(routeContext("https://worker.test/api/admin/discord-messages/send", { method: "POST" }));
    expect(result?.status).toBe(status);
    expect(sendAdminDiscordMessageFromRequest).not.toHaveBeenCalled();
    expect(upsertSyncTimestamp).not.toHaveBeenCalled();
  });
  it("routes custom messages through the admin cooldown", async () => {
    vi.mocked(sendAdminDiscordMessageFromRequest).mockResolvedValueOnce(jsonResponse({ ok: true }));
    const context = routeContext("https://worker.test/api/admin/discord-messages/send", { method: "POST" });
    expect((await routeAdminApi(context))?.status).toBe(200);
    expect(sendAdminDiscordMessageFromRequest).toHaveBeenCalledWith(context.request, context.env);
    expect(readSyncTimestamp).toHaveBeenCalledWith(context.env, "discord_custom_message_send");
  });
  it("does not send a custom message while the cooldown is active", async () => {
    vi.mocked(readSyncTimestamp).mockResolvedValueOnce(Math.floor(Date.now() / 1000));
    const result = await routeAdminApi(routeContext("https://worker.test/api/admin/discord-messages/send", { method: "POST" }));
    expect(result?.status).toBe(429);
    expect(sendAdminDiscordMessageFromRequest).not.toHaveBeenCalled();
  });
  it.each(["GET", "POST"])("requires admin access for %s Discord route editing", async method => {
    vi.mocked(requireAdmin).mockResolvedValueOnce(jsonResponse({ ok: false }, 403));
    const result = await routeAdminApi(routeContext("https://worker.test/api/admin/discord-alerts/routes", { method }));
    expect(result?.status).toBe(403);
    expect(getAdminDiscordRouteDestinations).not.toHaveBeenCalled();
    expect(updateAdminDiscordRouteFromRequest).not.toHaveBeenCalled();
  });
  it.each(["GET", "POST"])("routes authenticated %s Discord route editing", async method => {
    const handler = method === "GET" ? getAdminDiscordRouteDestinations : updateAdminDiscordRouteFromRequest;
    vi.mocked(handler).mockResolvedValueOnce(jsonResponse({ ok: true }));
    const context = routeContext("https://worker.test/api/admin/discord-alerts/routes", { method });
    expect((await routeAdminApi(context))?.status).toBe(200);
    expect(requireAdmin).toHaveBeenCalledOnce(); expect(handler).toHaveBeenCalledOnce();
  });
  it.each(["GET", "POST"])("requires admin access for %s alert mention settings", async method => {
    vi.mocked(requireAdmin).mockResolvedValueOnce(jsonResponse({ ok: false }, 403));
    const result = await routeAdminApi(routeContext("https://worker.test/api/admin/discord-alerts/mentions", { method }));
    expect(result?.status).toBe(403);
    expect(getAdminDiscordAlertMentions).not.toHaveBeenCalled();
    expect(updateAdminDiscordAlertMentionsFromRequest).not.toHaveBeenCalled();
  });
  it.each(["GET", "POST"])("routes authenticated %s alert mention settings", async method => {
    const handler = method === "GET" ? getAdminDiscordAlertMentions : updateAdminDiscordAlertMentionsFromRequest;
    vi.mocked(handler).mockResolvedValueOnce(jsonResponse({ ok: true }));
    const context = routeContext("https://worker.test/api/admin/discord-alerts/mentions", { method });
    expect((await routeAdminApi(context))?.status).toBe(200);
    expect(requireAdmin).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledOnce();
  });
  it.each(["preview", "delete"])("requires admin authentication for Discord message %s", async (action) => {
    vi.mocked(requireAdmin).mockResolvedValueOnce(jsonResponse({ ok: false }, 403));
    const result = await routeAdminApi(routeContext(`https://worker.test/api/admin/discord-messages/${action}`, { method: "POST" }));
    expect(result?.status).toBe(403);
    expect(previewDiscordBotMessageFromRequest).not.toHaveBeenCalled();
    expect(deleteDiscordBotMessageFromRequest).not.toHaveBeenCalled();
  });
  it.each(["preview", "delete"])("routes authenticated Discord message %s requests", async (action) => {
    const handler = action === "preview" ? previewDiscordBotMessageFromRequest : deleteDiscordBotMessageFromRequest;
    vi.mocked(handler).mockResolvedValueOnce(jsonResponse({ ok: true }));
    const context = routeContext(`https://worker.test/api/admin/discord-messages/${action}`, { method: "POST" });
    expect((await routeAdminApi(context))?.status).toBe(200);
    expect(requireAdmin).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(context.request, context.env);
  });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue(null);
    vi.mocked(getAdminDataHealth).mockResolvedValue(jsonResponse({ ok: true, route: "admin-data-health" }));
    vi.mocked(updateDataHealthSettingsFromRequest).mockResolvedValue(jsonResponse({ ok: true, route: "settings" }));
    vi.mocked(getWarControlSettings).mockResolvedValue(jsonResponse({ ok: true, route: "war-control-settings" }));
    vi.mocked(updateWarControlSettingsFromRequest).mockResolvedValue(jsonResponse({ ok: true, route: "war-control-settings-update" }));
    vi.mocked(readSyncTimestamp).mockResolvedValue(0);
    vi.mocked(upsertSyncTimestamp).mockResolvedValue(undefined);
    vi.mocked(syncMemberDiscordLinksFromRequest).mockResolvedValue(jsonResponse({ ok: true, route: "discord-links" }));
    vi.mocked(getDiscordTravelTrackerTargetFromRequest).mockResolvedValue(jsonResponse({ ok: true, route: "discord-travel-target" }));
    vi.mocked(setDiscordTravelTrackerTargetFromRequest).mockResolvedValue(jsonResponse({ ok: true, route: "discord-travel-target-set" }));
    vi.mocked(clearDiscordTravelTrackerTargetFromRequest).mockResolvedValue(jsonResponse({ ok: true, route: "discord-travel-target-clear" }));
    vi.mocked(syncDiscordTravelTrackerFromRequest).mockResolvedValue(jsonResponse({ ok: true, route: "discord-travel" }));
    vi.mocked(updateDiscordTravelTrackerSettingsFromRequest).mockResolvedValue(jsonResponse({ ok: true, route: "discord-travel-settings" }));
    vi.mocked(getAdminDiscordAlertSettings).mockResolvedValue(jsonResponse({ ok: true, route: "discord-alert-settings" }));
    vi.mocked(testAdminDiscordAlertRouteFromRequest).mockResolvedValue(jsonResponse({ ok: true, route: "discord-alert-test" }));
    vi.mocked(updateAdminDiscordAlertSettingsFromRequest).mockResolvedValue(jsonResponse({ ok: true, route: "discord-alert-settings-update" }));
    vi.mocked(listAdminTornApiKeys).mockResolvedValue(jsonResponse({ ok: true, route: "admin-key-pool" }));
    vi.mocked(refreshMemberAchievementSummaries).mockResolvedValue({
      writeStatements: 3,
      changedRows: 3,
      skipped: false,
    });
    vi.mocked(refreshStockBenefitItemPrices).mockResolvedValue({
      ok: true,
      refreshed: 1,
      skipped: 0,
      failed: 0,
      prices: [],
    });
  });

  it("routes admin data health through admin auth", async () => {
    const response = await routeAdminApi(routeContext("https://worker.test/api/admin/data-health"));

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ ok: true, route: "admin-data-health" });
    expect(requireAdmin).toHaveBeenCalledOnce();
    expect(getAdminDataHealth).toHaveBeenCalledOnce();
  });

  it("routes data health settings updates through admin auth", async () => {
    const response = await routeAdminApi(routeContext(
      "https://worker.test/api/admin/data-health/settings",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ingestion_warn_seconds: 60 }),
      },
    ));

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ ok: true, route: "settings" });
    expect(requireAdmin).toHaveBeenCalledOnce();
    expect(updateDataHealthSettingsFromRequest).toHaveBeenCalledOnce();
  });

  it("allows admins to accept a daily stats issue", async () => {
    vi.mocked(acceptDailyStatsIssueFromRequest).mockResolvedValueOnce(jsonResponse({ ok: true }));
    const context = routeContext("https://worker.test/api/admin/data-health/daily-stats/accept", { method: "POST" });
    expect((await routeAdminApi(context))?.status).toBe(200);
    expect(requireAdmin).toHaveBeenCalledWith(context.request, context.env);
    expect(acceptDailyStatsIssueFromRequest).toHaveBeenCalledWith(context.request, context.env);
  });

  it("rejects accepting daily stats issues without admin access", async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce(jsonResponse({ ok: false }, 403));
    const context = routeContext("https://worker.test/api/admin/data-health/daily-stats/accept", { method: "POST" });
    expect((await routeAdminApi(context))?.status).toBe(403);
    expect(acceptDailyStatsIssueFromRequest).not.toHaveBeenCalled();
  });

  it("routes war control settings reads through admin auth", async () => {
    const response = await routeAdminApi(routeContext("https://worker.test/api/admin/war-control-settings"));

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ ok: true, route: "war-control-settings" });
    expect(requireAdmin).toHaveBeenCalledOnce();
    expect(getWarControlSettings).toHaveBeenCalledOnce();
  });

  it("routes admin Torn key pool overview through admin auth", async () => {
    const context = routeContext("https://worker.test/api/admin/torn-key-pool/keys");
    const response = await routeAdminApi(context);

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ ok: true, route: "admin-key-pool" });
    expect(requireAdmin).toHaveBeenCalledOnce();
    expect(listAdminTornApiKeys).toHaveBeenCalledWith(context.env);
  });

  it("routes stock benefit item price refresh through admin auth and cooldown", async () => {
    const context = routeContext("https://worker.test/api/admin/stocks/benefit-item-prices/refresh", {
      method: "POST",
    });

    const response = await routeAdminApi(context);

    expect(response?.status).toBe(200);
    expect(await response?.json()).toMatchObject({ ok: true, refreshed: 1 });
    expect(requireAdmin).toHaveBeenCalledWith(context.request, context.env);
    expect(readSyncTimestamp).toHaveBeenCalledWith(context.env, "manual_stock_benefit_item_prices");
    expect(refreshStockBenefitItemPrices).toHaveBeenCalledWith(context.env, { force: true });
  });

  it("routes member achievement refresh through admin auth and cooldown", async () => {
    const context = routeContext("https://worker.test/api/admin/member-achievements/refresh", {
      method: "POST",
    });

    const response = await routeAdminApi(context);

    expect(response?.status).toBe(200);
    expect(await response?.json()).toMatchObject({ ok: true, changedRows: 3 });
    expect(requireAdmin).toHaveBeenCalledWith(context.request, context.env);
    expect(readSyncTimestamp).toHaveBeenCalledWith(context.env, "manual_member_achievements_refresh");
    expect(refreshMemberAchievementSummaries).toHaveBeenCalledWith(context.env);
  });

  it("routes war control settings updates through admin auth", async () => {
    const response = await routeAdminApi(routeContext(
      "https://worker.test/api/admin/war-control-settings",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ control_hospital_threshold: 0.8 }),
      },
    ));

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ ok: true, route: "war-control-settings-update" });
    expect(requireAdmin).toHaveBeenCalledOnce();
    expect(updateWarControlSettingsFromRequest).toHaveBeenCalledOnce();
  });

  it("rejects admin data health when admin auth fails", async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce(jsonResponse({ ok: false }, 403));

    const response = await routeAdminApi(routeContext("https://worker.test/api/admin/data-health"));

    expect(response?.status).toBe(403);
    expect(getAdminDataHealth).not.toHaveBeenCalled();
  });

  it("routes Discord link sync through admin auth and cooldown", async () => {
    const context = routeContext("https://worker.test/api/admin/discord-links/sync", {
      method: "POST",
    });

    const response = await routeAdminApi(context);

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ ok: true, route: "discord-links" });
    expect(requireAdmin).toHaveBeenCalledWith(context.request, context.env);
    expect(readSyncTimestamp).toHaveBeenCalledWith(context.env, "discord_links_sync");
    expect(upsertSyncTimestamp).toHaveBeenCalledWith(
      context.env,
      "discord_links_sync",
      expect.any(Number),
      null,
    );
    expect(syncMemberDiscordLinksFromRequest).toHaveBeenCalledWith(context.env);
  });

  it("returns cooldown responses before syncing Discord links", async () => {
    vi.mocked(readSyncTimestamp).mockResolvedValueOnce(Math.floor(Date.now() / 1000));
    const response = await routeAdminApi(routeContext("https://worker.test/api/admin/discord-links/sync", {
      method: "POST",
    }));

    expect(response?.status).toBe(429);
    expect(await response?.json()).toMatchObject({ ok: false, code: "COOLDOWN_ACTIVE" });
    expect(syncMemberDiscordLinksFromRequest).not.toHaveBeenCalled();
  });

  it("does not route the removed arbitrary Discord message endpoint", async () => {
    const response = await routeAdminApi(routeContext("https://worker.test/api/admin/discord/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "test" }),
    }));

    expect(response).toBeNull();
    expect(requireAdmin).not.toHaveBeenCalled();
  });

  it("routes Discord travel tracker sync through admin auth", async () => {
    const context = routeContext("https://worker.test/api/admin/discord-travel-tracker/sync", {
      method: "POST",
    });

    const response = await routeAdminApi(context);

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ ok: true, route: "discord-travel" });
    expect(requireAdmin).toHaveBeenCalledWith(context.request, context.env);
    expect(readSyncTimestamp).toHaveBeenCalledWith(context.env, "discord_travel_tracker_sync");
    expect(upsertSyncTimestamp).toHaveBeenCalledWith(
      context.env,
      "discord_travel_tracker_sync",
      expect.any(Number),
      null,
    );
    expect(syncDiscordTravelTrackerFromRequest).toHaveBeenCalledWith(context.env);
  });

  it("returns cooldown responses before syncing Discord travel tracker", async () => {
    vi.mocked(readSyncTimestamp).mockResolvedValueOnce(Math.floor(Date.now() / 1000));
    const response = await routeAdminApi(routeContext("https://worker.test/api/admin/discord-travel-tracker/sync", {
      method: "POST",
    }));

    expect(response?.status).toBe(429);
    expect(await response?.json()).toMatchObject({ ok: false, code: "COOLDOWN_ACTIVE" });
    expect(syncDiscordTravelTrackerFromRequest).not.toHaveBeenCalled();
  });

  it("routes Discord travel tracker target reads through admin auth", async () => {
    const context = routeContext("https://worker.test/api/admin/discord-travel-tracker/target");

    const response = await routeAdminApi(context);

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ ok: true, route: "discord-travel-target" });
    expect(requireAdmin).toHaveBeenCalledWith(context.request, context.env);
    expect(getDiscordTravelTrackerTargetFromRequest).toHaveBeenCalledWith(context.env);
  });

  it("routes Discord travel tracker target updates through admin auth", async () => {
    const context = routeContext("https://worker.test/api/admin/discord-travel-tracker/target", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ faction_id: 123, faction_name: "Test Faction" }),
    });

    const response = await routeAdminApi(context);

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ ok: true, route: "discord-travel-target-set" });
    expect(requireAdmin).toHaveBeenCalledWith(context.request, context.env);
    expect(setDiscordTravelTrackerTargetFromRequest).toHaveBeenCalledWith(context.request, context.env);
  });

  it("routes Discord travel tracker target clears through admin auth", async () => {
    const context = routeContext("https://worker.test/api/admin/discord-travel-tracker/target", {
      method: "DELETE",
    });

    const response = await routeAdminApi(context);

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ ok: true, route: "discord-travel-target-clear" });
    expect(requireAdmin).toHaveBeenCalledWith(context.request, context.env);
    expect(clearDiscordTravelTrackerTargetFromRequest).toHaveBeenCalledWith(context.env);
  });

  it("routes Discord travel tracker settings through admin auth", async () => {
    const context = routeContext("https://worker.test/api/admin/discord-travel-tracker/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ home_enabled: true, target_enabled: false }),
    });

    const response = await routeAdminApi(context);

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ ok: true, route: "discord-travel-settings" });
    expect(requireAdmin).toHaveBeenCalledWith(context.request, context.env);
    expect(updateDiscordTravelTrackerSettingsFromRequest).toHaveBeenCalledWith(context.request, context.env);
  });

  it("routes Discord alert settings through admin auth", async () => {
    const context = routeContext("https://worker.test/api/admin/discord-alerts/settings");

    const response = await routeAdminApi(context);

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ ok: true, route: "discord-alert-settings" });
    expect(requireAdmin).toHaveBeenCalledWith(context.request, context.env);
    expect(getAdminDiscordAlertSettings).toHaveBeenCalledWith(context.env);
  });

  it("routes Discord alert settings updates through admin auth", async () => {
    const context = routeContext("https://worker.test/api/admin/discord-alerts/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alert_key: "enemy_push", enabled: true }),
    });

    const response = await routeAdminApi(context);

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ ok: true, route: "discord-alert-settings-update" });
    expect(requireAdmin).toHaveBeenCalledWith(context.request, context.env);
    expect(updateAdminDiscordAlertSettingsFromRequest).toHaveBeenCalledWith(context.request, context.env);
  });

  it("routes Discord alert tests through admin auth", async () => {
    const context = routeContext("https://worker.test/api/admin/discord-alerts/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alert_key: "enemy_scouting_report" }),
    });

    const response = await routeAdminApi(context);

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ ok: true, route: "discord-alert-test" });
    expect(requireAdmin).toHaveBeenCalledWith(context.request, context.env);
    expect(testAdminDiscordAlertRouteFromRequest).toHaveBeenCalledWith(context.request, context.env);
  });

  it("keeps the old shoplifting alerts route as a Discord alert settings alias", async () => {
    const context = routeContext("https://worker.test/api/admin/shoplifting-alerts");

    const response = await routeAdminApi(context);

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ ok: true, route: "discord-alert-settings" });
    expect(getAdminDiscordAlertSettings).toHaveBeenCalledWith(context.env);
  });
});
