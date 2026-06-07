import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireAdmin, requireMember } from "../auth";
import { warCacheVersionNames } from "../cacheVersions";
import { getChainWatchForWar } from "../chainWatch";
import { getWarReportDiscrepancies } from "../reports";
import {
  cachedGetJson,
  cachedVersionedGetJson,
} from "../responseCache";
import type { Env } from "../types";
import {
  exportWarAttacksCsv,
  getWar,
  getWarAttacks,
  getWarMemberAttacks,
  listWars,
} from "../wars";
import { routeWarReads } from "./warRoutes";

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
  getWarMemberActivityHeatmap: vi.fn(),
  getWarMemberAttacks: vi.fn(),
  importHistoricalWar: vi.fn(),
  listWars: vi.fn(),
  previewHistoricalWarImport: vi.fn(),
  relinkWarAttacks: vi.fn(),
  updateOfficialWar: vi.fn(),
}));

describe("war read routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue(null);
    vi.mocked(requireMember).mockResolvedValue(null);
    vi.mocked(exportWarAttacksCsv).mockResolvedValue(jsonResponse({ ok: true, route: "attacks-csv" }));
    vi.mocked(getChainWatchForWar).mockResolvedValue(jsonResponse({ ok: true, route: "chain-watch" }));
    vi.mocked(getWar).mockResolvedValue(jsonResponse({ ok: true, route: "detail" }));
    vi.mocked(getWarAttacks).mockResolvedValue(jsonResponse({ ok: true, route: "attacks-json" }));
    vi.mocked(getWarMemberAttacks).mockResolvedValue(jsonResponse({ ok: true, route: "member-attacks" }));
    vi.mocked(getWarReportDiscrepancies).mockResolvedValue(jsonResponse({ ok: true, route: "report-discrepancies" }));
    vi.mocked(listWars).mockResolvedValue(jsonResponse({ ok: true, route: "list" }));
  });

  it("routes the war list through member auth and the simple cache", async () => {
    const context = routeContext("https://worker.test/api/wars?war_type=real");

    const response = await routeWarReads(context);

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ ok: true, route: "list" });
    expect(requireMember).toHaveBeenCalledWith(context.request, context.env);
    expect(cachedGetJson).toHaveBeenCalledWith(context.request, context.ctx, 55, expect.any(Function));
    expect(listWars).toHaveBeenCalledWith(context.url, context.env);
  });

  it("uses versioned caching for war details with the decoded war name", async () => {
    const context = routeContext("https://worker.test/api/wars/Buttgrass%20Classic");

    const response = await routeWarReads(context);

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ ok: true, route: "detail" });
    expect(warCacheVersionNames).toHaveBeenCalledWith("Buttgrass Classic");
    expect(cachedVersionedGetJson).toHaveBeenCalledWith(
      context.env,
      context.request,
      context.ctx,
      55,
      ["cache_version:war:Buttgrass Classic"],
      expect.any(Function),
    );
    expect(getWar).toHaveBeenCalledWith(context.url, context.env);
  });

  it("prefers member attack detail routes before generic admin attacks", async () => {
    const context = routeContext("https://worker.test/api/wars/current/members/123/attacks");

    const response = await routeWarReads(context);

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ ok: true, route: "member-attacks" });
    expect(requireMember).toHaveBeenCalledWith(context.request, context.env);
    expect(getWarMemberAttacks).toHaveBeenCalledWith(context.url, context.env);
    expect(requireAdmin).not.toHaveBeenCalled();
    expect(getWarAttacks).not.toHaveBeenCalled();
  });

  it("keeps generic war attacks behind admin auth", async () => {
    const context = routeContext("https://worker.test/api/wars/current/attacks");

    const response = await routeWarReads(context);

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ ok: true, route: "attacks-json" });
    expect(requireAdmin).toHaveBeenCalledWith(context.request, context.env);
    expect(getWarAttacks).toHaveBeenCalledWith(context.url, context.env);
  });

  it("routes CSV war attack exports through the same admin gate", async () => {
    const context = routeContext("https://worker.test/api/wars/current/attacks?format=csv");

    const response = await routeWarReads(context);

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ ok: true, route: "attacks-csv" });
    expect(requireAdmin).toHaveBeenCalledWith(context.request, context.env);
    expect(exportWarAttacksCsv).toHaveBeenCalledWith(context.url, context.env);
    expect(getWarAttacks).not.toHaveBeenCalled();
  });

  it("does not read generic war attacks when admin auth fails", async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce(jsonResponse({ ok: false, code: "FORBIDDEN" }, 403));

    const response = await routeWarReads(routeContext("https://worker.test/api/wars/current/attacks"));

    expect(response?.status).toBe(403);
    expect(getWarAttacks).not.toHaveBeenCalled();
    expect(exportWarAttacksCsv).not.toHaveBeenCalled();
  });

  it("routes cached report discrepancy and chain-watch reads to their handlers", async () => {
    const reportContext = routeContext("https://worker.test/api/wars/current/report-discrepancies");
    const chainWatchContext = routeContext("https://worker.test/api/wars/current/chain-watch");

    const reportResponse = await routeWarReads(reportContext);
    const chainWatchResponse = await routeWarReads(chainWatchContext);

    expect(await reportResponse?.json()).toEqual({ ok: true, route: "report-discrepancies" });
    expect(await chainWatchResponse?.json()).toEqual({ ok: true, route: "chain-watch" });
    expect(getWarReportDiscrepancies).toHaveBeenCalledWith(reportContext.url, reportContext.env);
    expect(getChainWatchForWar).toHaveBeenCalledWith(chainWatchContext.url, chainWatchContext.env);
  });

  it("ignores non-GET war read routes", async () => {
    const response = await routeWarReads(routeContext("https://worker.test/api/wars/current/attacks", {
      method: "POST",
    }));

    expect(response).toBeNull();
    expect(requireAdmin).not.toHaveBeenCalled();
    expect(requireMember).not.toHaveBeenCalled();
  });
});

function routeContext(rawUrl: string, init?: RequestInit) {
  const request = new Request(rawUrl, init);
  const url = new URL(rawUrl);
  return {
    request,
    env: {} as Env,
    ctx: {} as ExecutionContext,
    url,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
