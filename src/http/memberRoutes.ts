import { readAuthenticatedUserId } from "../auth";
import { MEMBER_LIFESTYLE_CACHE_VERSION_NAME } from "../cacheVersions";
import { getDiceGameState, rollDiceGame, sendXanaxToDiceGame } from "../diceGame";
import { getRecentFactionAttacks } from "../factionAttacks";
import { getCurrentHomeFactionMemberSummary } from "../homeFactionMembers";
import {
  getMemberLifestyleDailyChart,
  getMemberLifestyleStats,
} from "../lifestyleStats";
import { listMemberAchievementSummaries } from "../memberAchievements";
import { getMiscellaneousData } from "../miscellaneous";
import { createMonitorTicket } from "../monitorTickets";
import { OFFICIAL_END_CACHE_TTL_SECONDS } from "../responseCache";
import { matchesExactRoute, stockIdFromHistoryRoute } from "../routes";
import { getStockHistory, getStocks } from "../stockMarket";
import { createMemberSuggestion } from "../suggestions";
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

  if (matchesExactRoute(url, request, "/api/xanax-competition", "GET")) {
    return withMember(routeContext, async () =>
      getXanaxCompetition(env, await readAuthenticatedUserId(request, env)),
    );
  }

  if (matchesExactRoute(url, request, "/api/stocks", "GET")) {
    return cachedMemberGet(routeContext, 55, () => getStocks(env));
  }

  const stockHistoryId = stockIdFromHistoryRoute(url, request);
  if (stockHistoryId !== null) {
    return cachedMemberGet(routeContext, 55, () => getStockHistory(url, env, stockHistoryId));
  }

  if (matchesExactRoute(url, request, "/api/faction-attacks/recent", "GET")) {
    return cachedMemberGet(routeContext, 15, () => getRecentFactionAttacks(url, env));
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
