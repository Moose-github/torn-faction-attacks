import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireMember } from "../auth";
import { getRetaliationCheck } from "../retaliations";
import type { Env } from "../types";
import { routeMemberUtilityApi } from "./memberRoutes";

vi.mock("../auth", () => ({
  readAuthenticatedUserId: vi.fn(),
  requireMember: vi.fn(),
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
});

function routeContext(rawUrl: string) {
  const request = new Request(rawUrl);
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
