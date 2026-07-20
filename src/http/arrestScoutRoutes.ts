import { readAuthenticatedUserId } from "../auth";
import {
  getArrestScoutSnapshot,
  listArrestScoutFeedback,
  listArrestScoutFactionHof,
  listArrestScoutFutureTargets,
  listArrestScoutSnapshots,
  recordArrestScoutFeedback,
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

  if (matchesExactRoute(url, request, "/api/arrest-scout/feedback", "GET")) {
    return withMember(routeContext, () => listArrestScoutFeedback(env));
  }

  const feedbackResultId = feedbackResultIdFromPath(url.pathname);
  if (feedbackResultId !== null && request.method === "POST") {
    return withMember(routeContext, async () =>
      recordArrestScoutFeedback(
        request,
        env,
        feedbackResultId,
        await readAuthenticatedUserId(request, env),
      ),
    );
  }

  const snapshotId = snapshotIdFromPath(url.pathname);
  if (snapshotId !== null && request.method === "GET") {
    return withMember(routeContext, () => getArrestScoutSnapshot(env, snapshotId));
  }

  if (matchesExactRoute(url, request, "/api/arrest-scout/future-targets", "GET")) {
    return withMember(routeContext, () => listArrestScoutFutureTargets(env));
  }

  if (matchesExactRoute(url, request, "/api/arrest-scout/faction-hof", "GET")) {
    return withMember(routeContext, () => listArrestScoutFactionHof(request, env));
  }

  return null;
}

function snapshotIdFromPath(pathname: string): string | null {
  const match = /^\/api\/arrest-scout\/snapshots\/([^/]+)$/.exec(pathname);
  return match ? decodeURIComponent(match[1]).trim() || null : null;
}

function feedbackResultIdFromPath(pathname: string): string | null {
  const match = /^\/api\/arrest-scout\/results\/([^/]+)\/feedback$/.exec(pathname);
  return match ? decodeURIComponent(match[1]).trim() || null : null;
}
