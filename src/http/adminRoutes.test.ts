import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireAdmin } from "../auth";
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
} from "../discordTravelTracker";
import {
  readSyncTimestamp,
  upsertSyncTimestamp,
} from "../syncState";
import { routeAdminApi } from "./adminRoutes";

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
vi.mock("../discord", () => ({ sendDiscordMessageFromRequest: vi.fn() }));
vi.mock("../discordTravelTracker", () => ({
  clearDiscordTravelTrackerTargetFromRequest: vi.fn(),
  getDiscordTravelTrackerTargetFromRequest: vi.fn(),
  setDiscordTravelTrackerTargetFromRequest: vi.fn(),
  syncDiscordTravelTrackerFromRequest: vi.fn(),
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
vi.mock("../responseCache", () => ({ cachedGetJson: vi.fn() }));
vi.mock("../syncState", () => ({
  readSyncTimestamp: vi.fn(),
  upsertSyncTimestamp: vi.fn(),
}));
vi.mock("../stockMarket", () => ({
  getStockIngestionStatus: vi.fn(),
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
vi.mock("../summaries", () => ({ rebuildDerivedStatsFromRaw: vi.fn() }));
vi.mock("../suggestions", () => ({ listMemberSuggestionsForAdmin: vi.fn() }));
vi.mock("../tornApiUsage", () => ({ getTornApiUsage: vi.fn() }));
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

  it("routes war control settings reads through admin auth", async () => {
    const response = await routeAdminApi(routeContext("https://worker.test/api/admin/war-control-settings"));

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ ok: true, route: "war-control-settings" });
    expect(requireAdmin).toHaveBeenCalledOnce();
    expect(getWarControlSettings).toHaveBeenCalledOnce();
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
});
