import { readAuthenticatedUserId } from "../auth";
import {
  matchesExactRoute,
  tradeWatchlistIdFromDetailPath,
  tradeWatchlistIdFromScanPath,
} from "../routes";
import {
  createTradeWatchlist,
  deleteTradeWatchlist,
  getTradeOpportunities,
  getTradeSearchOpportunities,
  listTradeWatchlists,
  scanTradeSearch,
  scanTradeWatchlist,
  updateTradeWatchlist,
} from "../tradeScout";
import { RouteContext, RouteResult, withAdmin, withMember } from "./context";

export async function routeTradeApi(routeContext: RouteContext): Promise<RouteResult> {
  const { request, env, url } = routeContext;

  if (matchesExactRoute(url, request, "/api/trade/watchlists", "GET")) {
    return withMember(routeContext, () => listTradeWatchlists(env));
  }

  if (matchesExactRoute(url, request, "/api/trade/watchlists", "POST")) {
    return withMember(routeContext, async () =>
      createTradeWatchlist(
        request,
        env,
        await readAuthenticatedUserId(request, env),
      ),
    );
  }

  const detailWatchlistId = tradeWatchlistIdFromDetailPath(url.pathname);
  if (detailWatchlistId !== null && request.method === "PUT") {
    return withAdmin(routeContext, () => updateTradeWatchlist(request, env, detailWatchlistId));
  }

  if (detailWatchlistId !== null && request.method === "DELETE") {
    return withAdmin(routeContext, () => deleteTradeWatchlist(env, detailWatchlistId));
  }

  const watchlistIdToScan = tradeWatchlistIdFromScanPath(url.pathname);
  if (watchlistIdToScan !== null && request.method === "POST") {
    return withMember(routeContext, async () =>
      scanTradeWatchlist(
        request,
        env,
        watchlistIdToScan,
        await readAuthenticatedUserId(request, env),
      ),
    );
  }

  if (matchesExactRoute(url, request, "/api/trade/search/opportunities", "POST")) {
    return withMember(routeContext, () => getTradeSearchOpportunities(request, env));
  }

  if (matchesExactRoute(url, request, "/api/trade/search/scan", "POST")) {
    return withMember(routeContext, async () =>
      scanTradeSearch(
        request,
        env,
        await readAuthenticatedUserId(request, env),
      ),
    );
  }

  if (matchesExactRoute(url, request, "/api/trade/opportunities", "GET")) {
    return withMember(routeContext, () => getTradeOpportunities(url, env));
  }

  return null;
}
