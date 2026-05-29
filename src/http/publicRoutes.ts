import { authenticateWithTornKey, getCurrentAuthSession } from "../auth";
import { matchesExactRoute } from "../routes";
import { json } from "../utils";
import { RouteContext, RouteResult } from "./context";

export async function routePublicApi({ request, env, url }: RouteContext): Promise<RouteResult> {
  if (matchesExactRoute(url, request, "/api/auth/torn", "POST")) {
    return authenticateWithTornKey(request, env);
  }

  if (matchesExactRoute(url, request, "/api/auth/me", "GET")) {
    return getCurrentAuthSession(request, env);
  }

  if (matchesExactRoute(url, request, "/api/health")) {
    return json({ ok: true });
  }

  return null;
}
