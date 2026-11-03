import type { Env } from "./types";
import { json } from "./utils";

// Used during database cutovers. Core routes and scheduled faction work remain available.
export function stockMaintenanceResponse(url: URL, env: Env): Response | null {
  if (env.STOCK_STORAGE_PAUSED !== "true") return null;
  const stockRoute = ["/api/stocks", "/api/admin/stocks"].some(
    (prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`),
  );
  if (!stockRoute) return null;
  const response = json({ ok: false, code: "STOCK_STORAGE_MAINTENANCE", error: "Stocks are temporarily paused for database maintenance." }, 503);
  response.headers.set("Retry-After", "60");
  response.headers.set("Cache-Control", "no-store");
  return response;
}
