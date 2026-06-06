import { authenticateWithTornKey, getCurrentAuthSession } from "../auth";
import { json } from "../utils";
import { RouteContext, RouteResult } from "./context";
import { routeExact, type ExactRoute } from "./routeTable";

const PUBLIC_ROUTES: ExactRoute[] = [
  {
    path: "/api/auth/torn",
    method: "POST",
    handle: ({ request, env }) => authenticateWithTornKey(request, env),
  },
  {
    path: "/api/auth/me",
    method: "GET",
    handle: ({ request, env }) => getCurrentAuthSession(request, env),
  },
  {
    path: "/api/health",
    handle: () => json({ ok: true }),
  },
];

export async function routePublicApi(routeContext: RouteContext): Promise<RouteResult> {
  return routeExact(routeContext, PUBLIC_ROUTES);
}
