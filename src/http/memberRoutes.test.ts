import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireMember } from "../auth";
import { getDataHealthSummary } from "../dataHealth";
import { getRetaliationCheck } from "../retaliations";
import { jsonResponse, routeContext } from "../testUtils/http";
import { routeMemberUtilityApi } from "./memberRoutes";

vi.mock("../auth", () => ({
  readAuthenticatedUserId: vi.fn(),
  requireMember: vi.fn(),
}));

vi.mock("../dataHealth", () => ({
  getDataHealthSummary: vi.fn(),
}));

vi.mock("../retaliations", () => ({
  getRetaliationCheck: vi.fn(),
}));

vi.mock("../diceGame", () => ({
  getDiceGameState: vi.fn(),
  rollDiceGame: vi.fn(),
  sendXanaxToDiceGame: vi.fn(),
}));
vi.mock("../factionAttacks", () => ({
  getRecentFactionAttacks: vi.fn(),
}));
vi.mock("../homeFactionMembers", () => ({
  getCurrentHomeFactionMemberSummary: vi.fn(),
}));
vi.mock("../lifestyleStats", () => ({
  getMemberLifestyleDailyChart: vi.fn(),
  getMemberLifestyleStats: vi.fn(),
}));
vi.mock("../memberAchievements", () => ({
  listMemberAchievementSummaries: vi.fn(),
}));
vi.mock("../miscellaneous", () => ({
  getMiscellaneousData: vi.fn(),
}));
vi.mock("../monitorTickets", () => ({
  createMonitorTicket: vi.fn(),
}));
vi.mock("../responseCache", () => ({
  cachedGetJson: vi.fn((_request, _ctx, _ttl, load) => load()),
  cachedVersionedGetJson: vi.fn((_env, _request, _ctx, _ttl, _versions, load) => load()),
  OFFICIAL_END_CACHE_TTL_SECONDS: 55,
}));
vi.mock("../stockMarket", () => ({
  getStockHistory: vi.fn(),
  getStocks: vi.fn(),
}));
vi.mock("../suggestions", () => ({
  createMemberSuggestion: vi.fn(),
}));
vi.mock("../wars", () => ({
  getOverallStats: vi.fn(),
}));
vi.mock("../xanaxCompetition", () => ({
  getXanaxCompetition: vi.fn(),
}));

describe("member utility routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireMember).mockResolvedValue(null);
    vi.mocked(getDataHealthSummary).mockResolvedValue(jsonResponse({ ok: true, route: "data-health" }));
    vi.mocked(getRetaliationCheck).mockResolvedValue(jsonResponse({ ok: true, route: "retaliations" }));
  });

  it("routes retaliation checks through member auth", async () => {
    const response = await routeMemberUtilityApi(routeContext(
      "https://worker.test/api/retaliations/check?target_id=123",
    ));

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ ok: true, route: "retaliations" });
    expect(requireMember).toHaveBeenCalledOnce();
    expect(getRetaliationCheck).toHaveBeenCalledOnce();
  });

  it("rejects retaliation checks when member auth fails", async () => {
    vi.mocked(requireMember).mockResolvedValueOnce(jsonResponse({
      ok: false,
      code: "UNAUTHORIZED",
    }, 401));

    const response = await routeMemberUtilityApi(routeContext(
      "https://worker.test/api/retaliations/check?target_id=123",
    ));

    expect(response?.status).toBe(401);
    expect(getRetaliationCheck).not.toHaveBeenCalled();
  });

  it("routes data health summary through member auth", async () => {
    const response = await routeMemberUtilityApi(routeContext(
      "https://worker.test/api/data-health/summary",
    ));

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ ok: true, route: "data-health" });
    expect(requireMember).toHaveBeenCalledOnce();
    expect(getDataHealthSummary).toHaveBeenCalledOnce();
  });
});
