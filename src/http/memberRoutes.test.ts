import { beforeEach, describe, expect, it, vi } from "vitest";
import { readAuthenticatedUserId, requireMember } from "../auth";
import { getDataHealthSummary } from "../dataHealth";
import {
  getDiscordMemberAlertSubscriptions,
  updateDiscordMemberAlertSubscriptionFromRequest,
} from "../discordMemberAlertSubscriptions";
import {
  createRetaliationClaimFromRequest,
  getAvailableRetaliations,
  getRetaliationCheck,
} from "../retaliations";
import { jsonResponse, routeContext } from "../testUtils/http";
import {
  autoRefreshStockBenefitItemPrices,
  getStockBenefitValues,
  getStockInvestmentRoi,
  updateStockBenefitValueFromRequest,
} from "../stockMarket";
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
  createRetaliationClaimFromRequest: vi.fn(),
  getAvailableRetaliations: vi.fn(),
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
  autoRefreshStockBenefitItemPrices: vi.fn(),
  getStockBenefitValues: vi.fn(),
  getStockHistory: vi.fn(),
  getStockInvestmentRoi: vi.fn(),
  getStocks: vi.fn(),
  updateStockBenefitValueFromRequest: vi.fn(),
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
    vi.mocked(getAvailableRetaliations).mockResolvedValue(jsonResponse({ ok: true, route: "retaliations-list" }));
    vi.mocked(createRetaliationClaimFromRequest)
      .mockResolvedValue(jsonResponse({ ok: true, route: "retaliations-claim" }));
    vi.mocked(autoRefreshStockBenefitItemPrices).mockResolvedValue({
      ok: true,
      refreshed: 0,
      skipped: 0,
      failed: 0,
      prices: [],
    });
    vi.mocked(listMyTornApiKeys).mockResolvedValue(jsonResponse({ ok: true, route: "key-pool-list" }));
    vi.mocked(createMyTornApiKey).mockResolvedValue(jsonResponse({ ok: true, route: "key-pool-create" }));
    vi.mocked(previewMyTornApiKey).mockResolvedValue(jsonResponse({ ok: true, route: "key-pool-preview" }));
    vi.mocked(updateMyTornApiKey).mockResolvedValue(jsonResponse({ ok: true, route: "key-pool-update" }));
    vi.mocked(deleteMyTornApiKey).mockResolvedValue(jsonResponse({ ok: true, route: "key-pool-delete" }));
    vi.mocked(getStockInvestmentRoi).mockResolvedValue(jsonResponse({ ok: true, route: "stock-roi" }));
    vi.mocked(getStockBenefitValues).mockResolvedValue(jsonResponse({ ok: true, route: "stock-benefits" }));
    vi.mocked(updateStockBenefitValueFromRequest).mockResolvedValue(jsonResponse({ ok: true, route: "stock-benefits-update" }));
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

  it("routes retaliation lists through member auth", async () => {
    const response = await routeMemberUtilityApi(routeContext(
      "https://worker.test/api/retaliations/available",
    ));

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ ok: true, route: "retaliations-list" });
    expect(requireMember).toHaveBeenCalledOnce();
    expect(getAvailableRetaliations).toHaveBeenCalledOnce();
  });

  it("routes retaliation claims through member auth with the current user id", async () => {
    const context = routeContext("https://worker.test/api/retaliations/claims", {
      method: "POST",
      body: JSON.stringify({ target_id: 123, opening_attack_id: 456, source: "dashboard" }),
    });
    const response = await routeMemberUtilityApi(context);

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ ok: true, route: "retaliations-claim" });
    expect(requireMember).toHaveBeenCalledOnce();
    expect(readAuthenticatedUserId).toHaveBeenCalledWith(context.request, context.env);
    expect(createRetaliationClaimFromRequest).toHaveBeenCalledWith(context.request, context.env, 12345);
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

  it("routes stock ROI reads through member auth with the current user id", async () => {
    const context = routeContext("https://worker.test/api/stocks/investment-roi");
    const response = await routeMemberUtilityApi(context);

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ ok: true, route: "stock-roi" });
    expect(requireMember).toHaveBeenCalledOnce();
    expect(readAuthenticatedUserId).toHaveBeenCalledWith(context.request, context.env);
    expect(getStockInvestmentRoi).toHaveBeenCalledWith(context.env, 12345);
  });

  it("routes stock benefit value reads and updates through member auth", async () => {
    const readContext = routeContext("https://worker.test/api/stocks/benefit-values");
    const readResponse = await routeMemberUtilityApi(readContext);

    expect(readResponse?.status).toBe(200);
    expect(getStockBenefitValues).toHaveBeenCalledWith(readContext.env, 12345);

    vi.clearAllMocks();
    vi.mocked(requireMember).mockResolvedValue(null);
    vi.mocked(readAuthenticatedUserId).mockResolvedValue(12345);
    vi.mocked(updateStockBenefitValueFromRequest).mockResolvedValue(jsonResponse({ ok: true, route: "stock-benefits-update" }));

    const updateContext = routeContext("https://worker.test/api/stocks/benefit-values/item%3Abox_of_medical_supplies", {
      method: "PUT",
      body: JSON.stringify({ override_value: 900000 }),
    });
    const updateResponse = await routeMemberUtilityApi(updateContext);

    expect(updateResponse?.status).toBe(200);
    expect(updateStockBenefitValueFromRequest)
      .toHaveBeenCalledWith(updateContext.request, updateContext.env, 12345, "item:box_of_medical_supplies");
  });

  it("routes stock benefit item price auto refresh through member auth", async () => {
    const context = routeContext("https://worker.test/api/stocks/benefit-item-prices/auto-refresh", {
      method: "POST",
    });
    const response = await routeMemberUtilityApi(context);

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({
      ok: true,
      refreshed: 0,
      skipped: 0,
      failed: 0,
      prices: [],
    });
    expect(requireMember).toHaveBeenCalledOnce();
    expect(autoRefreshStockBenefitItemPrices).toHaveBeenCalledWith(context.env);
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
