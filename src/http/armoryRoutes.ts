import { getArmory, refreshArmoryDetails, syncArmory, updateMedicalStockSetting } from "../armory";
import { matchesExactRoute } from "../routes";
import { withAdmin, type RouteContext, type RouteResult } from "./context";
import { json } from "../utils";

export async function routeArmoryApi(context: RouteContext): Promise<RouteResult> {
  const { request, env, url } = context;
  if (matchesExactRoute(url, request, "/api/admin/armory/medical/stock", "POST")) {
    return withAdmin(context, () => updateMedicalStockSetting(request, env));
  }
  const action = matchesExactRoute(url, request, "/api/admin/armory", "GET") ? getArmory
    : matchesExactRoute(url, request, "/api/admin/armory/sync", "POST") ? syncArmory
    : matchesExactRoute(url, request, "/api/admin/armory/details/refresh", "POST") ? refreshArmoryDetails : null;
  if (!action) return null;
  return withAdmin(context, () => {
    const category = url.searchParams.get("cat") ?? "weapons";
    if (category === "medical") {
      if (action === refreshArmoryDetails) return json({ ok: false, error: "Medical items do not have UID details to refresh." }, 400);
      return request.method === "GET" ? getArmory(env, "medical") : syncArmory(env, "medical");
    }
    if (category !== "weapons" && category !== "armor") return json({ ok: false, error: "Unsupported armory category." }, 400);
    return action(env, category);
  });
}
