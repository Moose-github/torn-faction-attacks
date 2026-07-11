import { readAuthenticatedUserId } from "../auth";
import { MEMBER_LIFESTYLE_CACHE_VERSION_NAME } from "../cacheVersions";
import { getDataHealthSummary } from "../dataHealth";
import { getDiceGameState, rollDiceGame, sendXanaxToDiceGame } from "../diceGame";
import {
  getDiscordMemberAlertSubscriptions,
  updateDiscordMemberAlertSubscriptionFromRequest,
} from "../discordMemberAlertSubscriptions";
import { getRecentFactionAttacks } from "../factionAttacks";
import { getCurrentHomeFactionMemberSummary } from "../homeFactionMembers";
import {
  getMemberLifestyleDailyChart,
  getMemberLifestyleStats,
} from "../lifestyleStats/reports";
import { listMemberAchievementSummaries } from "../memberAchievements";
import { getMiscellaneousData } from "../miscellaneous";
import { createMonitorTicket } from "../monitorTickets";
import { OFFICIAL_END_CACHE_TTL_SECONDS } from "../responseCache";
import { getRetaliationCheck } from "../retaliations";
import { matchesExactRoute, stockBenefitValueKeyFromRoute, stockIdFromHistoryRoute } from "../routes";
import {
  autoRefreshStockBenefitItemPrices,
  getStockBenefitValues,
  getStockHistory,
  getStockInvestmentRoi,
  getStocks,
  updateStockBenefitValueFromRequest,
} from "../stockMarket";
import { createMemberSuggestion } from "../suggestions";
import {
  createMyTornApiKey,
  deleteMyTornApiKey,
  listMyTornApiKeys,
  previewMyTornApiKey,
  updateMyTornApiKey,
} from "../tornKeyPool";
import { json } from "../utils";
import { getOverallStats } from "../wars";
import { getXanaxCompetition } from "../xanaxCompetition";
import {
  cachedMemberGet,
  requireActionCooldown,
  RouteContext,
  RouteResult,
  withMember,
} from "./context";

export async function routeMemberUtilityApi(routeContext: RouteContext): Promise<RouteResult> {
  const { request, env, url } = routeContext;

  if (matchesExactRoute(url, request, "/api/member-lifestyle-stats/daily", "GET")) {
    return cachedMemberGet(
      routeContext,
      OFFICIAL_END_CACHE_TTL_SECONDS,
      () => getMemberLifestyleDailyChart(url, env),
      [MEMBER_LIFESTYLE_CACHE_VERSION_NAME],
    );
  }

  if (matchesExactRoute(url, request, "/api/member-lifestyle-stats", "GET")) {
    return cachedMemberGet(
      routeContext,
      OFFICIAL_END_CACHE_TTL_SECONDS,
      () => getMemberLifestyleStats(url, env),
      [MEMBER_LIFESTYLE_CACHE_VERSION_NAME],
    );
  }

  if (matchesExactRoute(url, request, "/api/member-achievements", "GET")) {
    return cachedMemberGet(routeContext, 55, () => listMemberAchievementSummaries(env));
  }

  if (matchesExactRoute(url, request, "/api/miscellaneous", "GET")) {
    return cachedMemberGet(routeContext, 55, () => getMiscellaneousData(env));
  }

  if (matchesExactRoute(url, request, "/api/home-faction-members/summary", "GET")) {
    return cachedMemberGet(routeContext, 55, () => getCurrentHomeFactionMemberSummary(env));
  }

  if (matchesExactRoute(url, request, "/api/data-health/summary", "GET")) {
    return cachedMemberGet(routeContext, 30, () => getDataHealthSummary(env));
  }

  if (matchesExactRoute(url, request, "/api/xanax-competition", "GET")) {
    return withMember(routeContext, async () =>
      getXanaxCompetition(env, await readAuthenticatedUserId(request, env)),
    );
  }

  if (matchesExactRoute(url, request, "/api/stocks", "GET")) {
    return cachedMemberGet(routeContext, 55, () => getStocks(env));
  }

  if (matchesExactRoute(url, request, "/api/stocks/investment-roi", "GET")) {
    return withMember(routeContext, async () =>
      getStockInvestmentRoi(env, await readAuthenticatedUserId(request, env)),
    );
  }

  if (matchesExactRoute(url, request, "/api/stocks/benefit-values", "GET")) {
    return withMember(routeContext, async () =>
      getStockBenefitValues(env, await readAuthenticatedUserId(request, env)),
    );
  }

  if (matchesExactRoute(url, request, "/api/stocks/benefit-item-prices/auto-refresh", "POST")) {
    return withMember(routeContext, async () =>
      json(await autoRefreshStockBenefitItemPrices(env)),
    );
  }

  const stockBenefitValueKey = stockBenefitValueKeyFromRoute(url, request);
  if (stockBenefitValueKey !== null) {
    return withMember(routeContext, async () =>
      updateStockBenefitValueFromRequest(
        request,
        env,
        await readAuthenticatedUserId(request, env),
        stockBenefitValueKey,
      ),
    );
  }

  const stockHistoryId = stockIdFromHistoryRoute(url, request);
  if (stockHistoryId !== null) {
    return cachedMemberGet(routeContext, 55, () => getStockHistory(url, env, stockHistoryId));
  }

  if (matchesExactRoute(url, request, "/api/faction-attacks/recent", "GET")) {
    return cachedMemberGet(routeContext, 15, () => getRecentFactionAttacks(url, env));
  }

  if (matchesExactRoute(url, request, "/api/retaliations/check", "GET")) {
    return withMember(routeContext, () => getRetaliationCheck(url, env));
  }

  if (matchesExactRoute(url, request, "/api/me/discord-alert-subscriptions", "GET")) {
    return withMember(routeContext, async () =>
      getDiscordMemberAlertSubscriptions(env, await readAuthenticatedUserId(request, env)),
    );
  }

  if (matchesExactRoute(url, request, "/api/me/discord-alert-subscriptions", "POST")) {
    return withMember(routeContext, async () =>
      updateDiscordMemberAlertSubscriptionFromRequest(
        request,
        env,
        await readAuthenticatedUserId(request, env),
      ),
    );
  }

  if (matchesExactRoute(url, request, "/api/me/torn-key-pool/keys", "GET")) {
    return withMember(routeContext, async () =>
      listMyTornApiKeys(env, await readAuthenticatedUserId(request, env)),
    );
  }

  if (matchesExactRoute(url, request, "/api/me/torn-key-pool/keys", "POST")) {
    return withMember(routeContext, async () =>
      createMyTornApiKey(request, env, await readAuthenticatedUserId(request, env)),
    );
  }

  if (matchesExactRoute(url, request, "/api/me/torn-key-pool/keys/preview", "POST")) {
    return withMember(routeContext, async () =>
      previewMyTornApiKey(request, env, await readAuthenticatedUserId(request, env)),
    );
  }

  const tornKeyPoolKeyId = tornKeyPoolKeyIdFromRoute(url);
  if (tornKeyPoolKeyId && request.method === "PUT") {
    return withMember(routeContext, async () =>
      updateMyTornApiKey(request, env, await readAuthenticatedUserId(request, env), tornKeyPoolKeyId),
    );
  }

  if (tornKeyPoolKeyId && request.method === "DELETE") {
    return withMember(routeContext, async () =>
      deleteMyTornApiKey(env, await readAuthenticatedUserId(request, env), tornKeyPoolKeyId),
    );
  }

  if (matchesExactRoute(url, request, "/api/suggestions", "POST")) {
    return withMember(routeContext, async () => {
      const userId = await readAuthenticatedUserId(request, env);
      if (!userId) {
        return json({ ok: false, error: "Unauthorized", code: "UNAUTHORIZED" }, 401);
      }
      const cooldownError = await requireActionCooldown(env, `member_suggestion:${userId}`, 60);
      if (cooldownError) return cooldownError;
      return createMemberSuggestion(request, env, userId);
    });
  }

  if (matchesExactRoute(url, request, "/api/monitor-ticket", "POST")) {
    return withMember(routeContext, () => createMonitorTicket(request, env));
  }

  if (matchesExactRoute(url, request, "/api/dice-game", "GET")) {
    return withMember(routeContext, () => getDiceGameState(request, env, url));
  }

  if (matchesExactRoute(url, request, "/api/dice-game/roll", "POST")) {
    return withMember(routeContext, () => rollDiceGame(request, env));
  }

  if (matchesExactRoute(url, request, "/api/dice-game/send-xanax", "POST")) {
    return withMember(routeContext, () => sendXanaxToDiceGame(request, env));
  }

  if (matchesExactRoute(url, request, "/api/stats", "GET")) {
    return cachedMemberGet(routeContext, 55, () => getOverallStats(url, env));
  }

  return null;
}

function tornKeyPoolKeyIdFromRoute(url: URL): string | null {
  const match = /^\/api\/me\/torn-key-pool\/keys\/([^/]+)$/.exec(url.pathname);
  return match ? decodeURIComponent(match[1]).trim() || null : null;
}
