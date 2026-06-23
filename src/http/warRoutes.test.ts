import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireAdmin } from "../auth";
import {
  refreshEnemyScoutingForWar,
} from "../enemyScouting";
import {
  fetchRankedWarReport,
} from "../reports";
import {
  readSyncTimestamp,
  upsertSyncTimestamp,
} from "../syncState";
import { jsonResponse, routeContext } from "../testUtils/http";
import {
  deleteWar,
  endActiveWar,
  importHistoricalWar,
  previewHistoricalWarImport,
  relinkWarAttacks,
  updateOfficialWar,
} from "../wars";
import { routeWarCommands } from "./warRoutes";

vi.mock("../auth", () => ({
  requireAdmin: vi.fn(),
  requireMember: vi.fn(),
}));

vi.mock("../cacheVersions", () => ({
  warCacheVersionNames: vi.fn((warName: string) => [`cache_version:war:${warName}`]),
}));

vi.mock("../chainWatch", () => ({
  getChainWatchForWar: vi.fn(),
  updateChainWatchForWar: vi.fn(),
}));

vi.mock("../enemyPushPressure", () => ({
  getEnemyPushPressureForWar: vi.fn(),
}));

vi.mock("../enemyScouting", () => ({
  getEnemyScoutingForWar: vi.fn(),
  getScoutingComparisonForWar: vi.fn(),
  refreshEnemyHitStatsForWar: vi.fn(),
  refreshEnemyScoutingForWar: vi.fn(),
}));

vi.mock("../heatmap", () => ({
  getWarActivityHeatmap: vi.fn(),
}));

vi.mock("../reports", () => ({
  fetchRankedWarReport: vi.fn(),
  getWarReportDiscrepancies: vi.fn(),
}));

vi.mock("../responseCache", () => ({
  cachedGetJson: vi.fn((_request, _ctx, _ttl, load) => load()),
  cachedVersionedGetJson: vi.fn((_env, _request, _ctx, _ttl, _versions, load) => load()),
  OFFICIAL_END_CACHE_TTL_SECONDS: 24 * 60 * 60,
  scoutingComparisonTtlSeconds: vi.fn(() => 55),
  warDataTtlSeconds: vi.fn((ttl: number) => ttl),
}));

vi.mock("../syncState", () => ({
  readSyncTimestamp: vi.fn(),
  upsertSyncTimestamp: vi.fn(),
}));

vi.mock("../wars", () => ({
  deleteWar: vi.fn(),
  endActiveWar: vi.fn(),
  exportWarAttacksCsv: vi.fn(),
  getWar: vi.fn(),
  getWarActivity: vi.fn(),
  getWarAttacks: vi.fn(),
  getWarChainBonusesForWar: vi.fn(),
  getWarMemberCombatHeatmap: vi.fn(),
  getWarMemberAttacks: vi.fn(),
  importHistoricalWar: vi.fn(),
  listWars: vi.fn(),
  previewHistoricalWarImport: vi.fn(),
  relinkWarAttacks: vi.fn(),
  updateOfficialWar: vi.fn(),
}));

describe("war command routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue(null);
    vi.mocked(readSyncTimestamp).mockResolvedValue(0);
    vi.mocked(upsertSyncTimestamp).mockResolvedValue(undefined);
    vi.mocked(importHistoricalWar).mockResolvedValue(jsonResponse({ ok: true, route: "import" }));
    vi.mocked(previewHistoricalWarImport).mockResolvedValue(jsonResponse({ ok: true, route: "preview" }));
    vi.mocked(updateOfficialWar).mockResolvedValue(jsonResponse({ ok: true, route: "update-official" }));
    vi.mocked(deleteWar).mockResolvedValue(jsonResponse({ ok: true, route: "delete" }));
    vi.mocked(relinkWarAttacks).mockResolvedValue(jsonResponse({ ok: true, route: "relink" }));
    vi.mocked(endActiveWar).mockResolvedValue(jsonResponse({ ok: true, route: "end" }));
    vi.mocked(fetchRankedWarReport).mockResolvedValue(jsonResponse({ ok: true, route: "fetch-report" }));
    vi.mocked(refreshEnemyScoutingForWar).mockResolvedValue(jsonResponse({ ok: true, route: "enemy-scouting" }));
  });

  it("routes historical war imports through admin auth", async () => {
    const context = routeContext("https://worker.test/api/wars/import", {
      method: "POST",
      body: JSON.stringify({ name: "old-war" }),
    });

    const response = await routeWarCommands(context);

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ ok: true, route: "import" });
    expect(requireAdmin).toHaveBeenCalledWith(context.request, context.env);
    expect(importHistoricalWar).toHaveBeenCalledWith(context.request, context.env);
  });

  it("rejects command handlers when admin auth fails", async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce(jsonResponse({ ok: false, code: "UNAUTHORIZED" }, 401));

    const response = await routeWarCommands(routeContext("https://worker.test/api/wars/delete", {
      method: "POST",
    }));

    expect(response?.status).toBe(401);
    expect(deleteWar).not.toHaveBeenCalled();
  });

  it("keeps disabled manual war creation behind admin auth", async () => {
    const response = await routeWarCommands(routeContext("https://worker.test/api/wars", {
      method: "POST",
    }));

    expect(response?.status).toBe(410);
    expect(await response?.json()).toMatchObject({
      ok: false,
      code: "MANUAL_WAR_CREATION_DISABLED",
    });
    expect(requireAdmin).toHaveBeenCalledOnce();
  });

  it.each([
    ["/api/wars/import/preview", previewHistoricalWarImport, "preview"],
    ["/api/wars/update-official", updateOfficialWar, "update-official"],
    ["/api/wars/delete", deleteWar, "delete"],
    ["/api/wars/relink-attacks", relinkWarAttacks, "relink"],
    ["/api/wars/end", endActiveWar, "end"],
  ])("routes %s to the matching admin handler", async (path, handler, routeName) => {
    const context = routeContext(`https://worker.test${path}`, { method: "POST" });

    const response = await routeWarCommands(context);

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ ok: true, route: routeName });
    expect(requireAdmin).toHaveBeenCalledWith(context.request, context.env);
    expect(handler).toHaveBeenCalledWith(context.request, context.env);
  });

  it("applies cooldown before fetching ranked war reports", async () => {
    const context = routeContext("https://worker.test/api/torn-wars/123/report/fetch", {
      method: "POST",
    });

    const response = await routeWarCommands(context);

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ ok: true, route: "fetch-report" });
    expect(readSyncTimestamp).toHaveBeenCalledWith(
      context.env,
      "ranked_war_report_fetch:/api/torn-wars/123/report/fetch",
    );
    expect(upsertSyncTimestamp).toHaveBeenCalledWith(
      context.env,
      "ranked_war_report_fetch:/api/torn-wars/123/report/fetch",
      expect.any(Number),
      null,
    );
    expect(fetchRankedWarReport).toHaveBeenCalledWith(context.url, context.env);
  });

  it("returns cooldown responses before refreshing enemy scouting", async () => {
    vi.mocked(readSyncTimestamp).mockResolvedValueOnce(Math.floor(Date.now() / 1000));
    const context = routeContext("https://worker.test/api/wars/current/enemy-scouting", {
      method: "POST",
    });

    const response = await routeWarCommands(context);

    expect(response?.status).toBe(429);
    expect(await response?.json()).toMatchObject({
      ok: false,
      code: "COOLDOWN_ACTIVE",
    });
    expect(refreshEnemyScoutingForWar).not.toHaveBeenCalled();
  });

  it("ignores unmatched command routes", async () => {
    const response = await routeWarCommands(routeContext("https://worker.test/api/wars/current", {
      method: "POST",
    }));

    expect(response).toBeNull();
    expect(requireAdmin).not.toHaveBeenCalled();
  });
});
