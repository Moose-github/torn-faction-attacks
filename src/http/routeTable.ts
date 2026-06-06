import { matchesExactRoute, type HttpMethod } from "../routes";
import type { RouteContext, RouteResult } from "./context";

export type ExactRoute = {
  path: string;
  method?: HttpMethod;
  handle: (routeContext: RouteContext) => Promise<Response> | Response;
};

export async function routeExact(routeContext: RouteContext, routes: ExactRoute[]): Promise<RouteResult> {
  const { request, url } = routeContext;
  const route = routes.find((candidate) =>
    matchesExactRoute(url, request, candidate.path, candidate.method),
  );

  return route ? route.handle(routeContext) : null;
}
