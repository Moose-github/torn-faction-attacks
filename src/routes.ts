type RouteMethod = "DELETE" | "GET" | "POST" | "PUT";

export function matchesRoute(url: URL, request: Request, pathname: string, method?: RouteMethod): boolean {
  return url.pathname === pathname && (!method || request.method === method);
}

export function tradeWatchlistIdFromPath(pathname: string): number | null {
  const match = /^\/api\/trade\/watchlists\/(\d+)$/.exec(pathname);
  return match ? Number(match[1]) : null;
}

export function tradeWatchlistScanIdFromPath(pathname: string): number | null {
  const match = /^\/api\/trade\/watchlists\/(\d+)\/scan$/.exec(pathname);
  return match ? Number(match[1]) : null;
}

export function isTornWarReportFetchRoute(url: URL, request: Request): boolean {
  return request.method === "POST" && url.pathname.startsWith("/api/torn-wars/") && url.pathname.endsWith("/report/fetch");
}

export function isWarSubroute(url: URL, request: Request, suffix: string, method: RouteMethod): boolean {
  return request.method === method && url.pathname.startsWith("/api/wars/") && url.pathname.endsWith(suffix);
}

export function isWarMemberAttacksRoute(url: URL, request: Request): boolean {
  return (
    request.method === "GET" &&
    url.pathname.startsWith("/api/wars/") &&
    url.pathname.includes("/members/") &&
    url.pathname.endsWith("/attacks")
  );
}

export function isWarDetailRoute(url: URL, request: Request): boolean {
  return request.method === "GET" && url.pathname.startsWith("/api/wars/") && !url.pathname.endsWith("/attacks");
}

export function warNameFromSubroute(url: URL): string {
  return decodeURIComponent(url.pathname.split("/")[3] ?? "").trim();
}
