import { beforeEach, describe, expect, it, vi } from "vitest";
import { readAuthenticatedUserId, requireMember } from "../auth";
import { getDataHealthSummary } from "../dataHealth";
import {
  getDiscordMemberAlertSubscriptions,
  updateDiscordMemberAlertSubscriptionFromRequest,
} from "../discordMemberAlertSubscriptions";
import { getRetaliationCheck } from "../retaliations";
import { jsonResponse, routeContext } from "../testUtils/http";
import {
  createMyTornApiKey,
  deleteMyTornApiKey,
  listMyTornApiKeys,
  previewMyTornApiKey,
  updateMyTornApiKey,
} from "../tornKeyPool";
import { routeMemberUtilityApi } from "./memberRoutes";

vi.mock("../auth", () => ({
  readAuthenticatedUserId: vi.fn(),
  requireMember: vi.fn(),
}));

vi.mock("../dataHealth", () => ({
  getDataHealthSummary: vi.fn(),
}));

vi.mock("../discordMemberAlertSubscriptions", () => ({
  getDiscordMemberAlertSubscriptions: vi.fn(),
  updateDiscordMemberAlertSubscriptionFromRequest: vi.fn(),
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
vi.mock("../tornKeyPool", () => ({
  createMyTornApiKey: vi.fn(),
  deleteMyTornApiKey: vi.fn(),
  listMyTornApiKeys: vi.fn(),
  previewMyTornApiKey: vi.fn(),
  updateMyTornApiKey: vi.fn(),
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
    vi.mocked(readAuthenticatedUserId).mockResolvedValue(12345);
    vi.mocked(getDataHealthSummary).mockResolvedValue(jsonResponse({ ok: true, route: "data-health" }));
    vi.mocked(getDiscordMemberAlertSubscriptions).mockResolvedValue(jsonResponse({ ok: true, route: "discord-alerts" }));
    vi.mocked(updateDiscordMemberAlertSubscriptionFromRequest)
      .mockResolvedValue(jsonResponse({ ok: true, route: "discord-alerts-update" }));
    vi.mocked(getRetaliationCheck).mockResolvedValue(jsonResponse({ ok: true, route: "retaliations" }));
    vi.mocked(listMyTornApiKeys).mockResolvedValue(jsonResponse({ ok: true, route: "key-pool-list" }));
    vi.mocked(createMyTornApiKey).mockResolvedValue(jsonResponse({ ok: true, route: "key-pool-create" }));
    vi.mocked(previewMyTornApiKey).mockResolvedValue(jsonResponse({ ok: true, route: "key-pool-preview" }));
    vi.mocked(updateMyTornApiKey).mockResolvedValue(jsonResponse({ ok: true, route: "key-pool-update" }));
    vi.mocked(deleteMyTornApiKey).mockResolvedValue(jsonResponse({ ok: true, route: "key-pool-delete" }));
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

  it("routes member Discord alert subscription reads through member auth", async () => {
    const context = routeContext("https://worker.test/api/me/discord-alert-subscriptions");
    const response = await routeMemberUtilityApi(context);

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ ok: true, route: "discord-alerts" });
    expect(requireMember).toHaveBeenCalledOnce();
    expect(readAuthenticatedUserId).toHaveBeenCalledWith(context.request, context.env);
    expect(getDiscordMemberAlertSubscriptions).toHaveBeenCalledWith(context.env, 12345);
  });

  it("routes member Discord alert subscription updates through member auth", async () => {
    const context = routeContext("https://worker.test/api/me/discord-alert-subscriptions", {
      method: "POST",
      body: JSON.stringify({ alert_key: "enemy_push", enabled: true }),
    });
    const response = await routeMemberUtilityApi(context);

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ ok: true, route: "discord-alerts-update" });
    expect(requireMember).toHaveBeenCalledOnce();
    expect(readAuthenticatedUserId).toHaveBeenCalledWith(context.request, context.env);
    expect(updateDiscordMemberAlertSubscriptionFromRequest)
      .toHaveBeenCalledWith(context.request, context.env, 12345);
  });

  it("routes member Torn key pool reads through member auth", async () => {
    const context = routeContext("https://worker.test/api/me/torn-key-pool/keys");
    const response = await routeMemberUtilityApi(context);

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ ok: true, route: "key-pool-list" });
    expect(requireMember).toHaveBeenCalledOnce();
    expect(listMyTornApiKeys).toHaveBeenCalledWith(context.env, 12345);
  });

  it("routes member Torn key pool creates through member auth", async () => {
    const context = routeContext("https://worker.test/api/me/torn-key-pool/keys", {
      method: "POST",
      body: JSON.stringify({ key: "abc" }),
    });
    const response = await routeMemberUtilityApi(context);

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ ok: true, route: "key-pool-create" });
    expect(createMyTornApiKey).toHaveBeenCalledWith(context.request, context.env, 12345);
  });

  it("routes member Torn key previews through member auth", async () => {
    const context = routeContext("https://worker.test/api/me/torn-key-pool/keys/preview", {
      method: "POST",
      body: JSON.stringify({ key: "abc" }),
    });
    const response = await routeMemberUtilityApi(context);

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ ok: true, route: "key-pool-preview" });
    expect(previewMyTornApiKey).toHaveBeenCalledWith(context.request, context.env, 12345);
  });

  it("routes member Torn key pool updates and deletes by key id", async () => {
    const updateContext = routeContext("https://worker.test/api/me/torn-key-pool/keys/key-123", {
      method: "PUT",
      body: JSON.stringify({ label: "Main" }),
    });
    const updateResponse = await routeMemberUtilityApi(updateContext);

    expect(updateResponse?.status).toBe(200);
    expect(updateMyTornApiKey).toHaveBeenCalledWith(updateContext.request, updateContext.env, 12345, "key-123");

    vi.clearAllMocks();
    vi.mocked(requireMember).mockResolvedValue(null);
    vi.mocked(readAuthenticatedUserId).mockResolvedValue(12345);
    vi.mocked(deleteMyTornApiKey).mockResolvedValue(jsonResponse({ ok: true, route: "key-pool-delete" }));

    const deleteContext = routeContext("https://worker.test/api/me/torn-key-pool/keys/key-123", {
      method: "DELETE",
    });
    const deleteResponse = await routeMemberUtilityApi(deleteContext);

    expect(deleteResponse?.status).toBe(200);
    expect(deleteMyTornApiKey).toHaveBeenCalledWith(deleteContext.env, 12345, "key-123");
  });
});
