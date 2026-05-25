type HttpMethod = "DELETE" | "GET" | "POST" | "PUT";

export function matchesExactRoute(url: URL, request: Request, pathname: string, method?: HttpMethod): boolean {
  return url.pathname === pathname && (!method || request.method === method);
}

export function tradeWatchlistIdFromDetailPath(pathname: string): number | null {
  const match = /^\/api\/trade\/watchlists\/(\d+)$/.exec(pathname);
  return match ? Number(match[1]) : null;
}

export function tradeWatchlistIdFromScanPath(pathname: string): number | null {
  const match = /^\/api\/trade\/watchlists\/(\d+)\/scan$/.exec(pathname);
  return match ? Number(match[1]) : null;
}

export function isTornWarReportFetchRoute(url: URL, request: Request): boolean {
  return request.method === "POST" && url.pathname.startsWith("/api/torn-wars/") && url.pathname.endsWith("/report/fetch");
}

export function isWarSubroute(url: URL, request: Request, suffix: string, method: HttpMethod): boolean {
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

export function warNameFromWarRoute(url: URL): string {
  return decodeURIComponent(url.pathname.split("/")[3] ?? "").trim();
}
