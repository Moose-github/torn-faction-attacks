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
vi.mock("../responseCache", () => ({ cachedGetJson: vi.fn() }));
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
});
