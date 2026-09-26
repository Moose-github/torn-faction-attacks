import { getArmory, refreshArmoryDetails, syncArmory } from "../armory";
import { matchesExactRoute } from "../routes";
import { withAdmin, type RouteContext, type RouteResult } from "./context";

export async function routeArmoryApi(context: RouteContext): Promise<RouteResult> {
  const { request, env, url } = context;
  if (matchesExactRoute(url, request, "/api/admin/armory", "GET")) {
    return withAdmin(context, () => getArmory(env));
  }
  if (matchesExactRoute(url, request, "/api/admin/armory/sync", "POST")) {
    return withAdmin(context, () => syncArmory(env));
  }
  if (matchesExactRoute(url, request, "/api/admin/armory/details/refresh", "POST")) {
    return withAdmin(context, () => refreshArmoryDetails(env));
  }
  return null;
}
