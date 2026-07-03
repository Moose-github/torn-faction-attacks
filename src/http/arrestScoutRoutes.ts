import { readAuthenticatedUserId } from "../auth";
import {
  getArrestScoutSnapshot,
  listArrestScoutFutureTargets,
  listArrestScoutSnapshots,
  scanArrestScout,
} from "../arrestScout";
import { matchesExactRoute } from "../routes";
import { RouteContext, RouteResult, withMember } from "./context";

export async function routeArrestScoutApi(routeContext: RouteContext): Promise<RouteResult> {
  const { request, env, url } = routeContext;

  if (matchesExactRoute(url, request, "/api/arrest-scout/scan", "POST")) {
    return withMember(routeContext, async () =>
      scanArrestScout(
        request,
        env,
        await readAuthenticatedUserId(request, env),
      ),
    );
  }

  if (matchesExactRoute(url, request, "/api/arrest-scout/snapshots", "GET")) {
    return withMember(routeContext, () => listArrestScoutSnapshots(env));
  }

  const snapshotId = snapshotIdFromPath(url.pathname);
  if (snapshotId !== null && request.method === "GET") {
    return withMember(routeContext, () => getArrestScoutSnapshot(env, snapshotId));
  }

  if (matchesExactRoute(url, request, "/api/arrest-scout/future-targets", "GET")) {
    return withMember(routeContext, () => listArrestScoutFutureTargets(env));
  }

  return null;
}

function snapshotIdFromPath(pathname: string): string | null {
  const match = /^\/api\/arrest-scout\/snapshots\/([^/]+)$/.exec(pathname);
  return match ? decodeURIComponent(match[1]).trim() || null : null;
}
