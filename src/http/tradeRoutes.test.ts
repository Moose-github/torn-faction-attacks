import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  readAuthenticatedUserId,
  requireAdmin,
  requireMember,
} from "../auth";
import {
  createTradeWatchlist,
  deleteTradeWatchlist,
  getTradeOpportunities,
  getTradeSearchOpportunities,
  listTradeWatchlists,
  scanTradeSearch,
  scanTradeWatchlist,
  updateTradeWatchlist,
} from "../tradeScout";
import { jsonResponse, routeContext } from "../testUtils/http";
import { routeTradeApi } from "./tradeRoutes";

vi.mock("../auth", () => ({
  readAuthenticatedUserId: vi.fn(),
  requireAdmin: vi.fn(),
  requireMember: vi.fn(),
}));

vi.mock("../tradeScout", () => ({
  createTradeWatchlist: vi.fn(),
  deleteTradeWatchlist: vi.fn(),
  getTradeOpportunities: vi.fn(),
  getTradeSearchOpportunities: vi.fn(),
  listTradeWatchlists: vi.fn(),
  scanTradeSearch: vi.fn(),
  scanTradeWatchlist: vi.fn(),
  updateTradeWatchlist: vi.fn(),
}));

describe("trade routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue(null);
    vi.mocked(requireMember).mockResolvedValue(null);
    vi.mocked(readAuthenticatedUserId).mockResolvedValue(12345);
    vi.mocked(createTradeWatchlist).mockResolvedValue(jsonResponse({ ok: true, route: "create" }));
    vi.mocked(deleteTradeWatchlist).mockResolvedValue(jsonResponse({ ok: true, route: "delete" }));
    vi.mocked(getTradeOpportunities).mockResolvedValue(jsonResponse({ ok: true, route: "opportunities" }));
    vi.mocked(getTradeSearchOpportunities).mockResolvedValue(jsonResponse({ ok: true, route: "search-opportunities" }));
    vi.mocked(listTradeWatchlists).mockResolvedValue(jsonResponse({ ok: true, route: "list" }));
    vi.mocked(scanTradeSearch).mockResolvedValue(jsonResponse({ ok: true, route: "search-scan" }));
    vi.mocked(scanTradeWatchlist).mockResolvedValue(jsonResponse({ ok: true, route: "watchlist-scan" }));
    vi.mocked(updateTradeWatchlist).mockResolvedValue(jsonResponse({ ok: true, route: "update" }));
  });

  it("routes watchlist reads through member auth", async () => {
    const context = routeContext("https://worker.test/api/trade/watchlists");

    const response = await routeTradeApi(context);

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ ok: true, route: "list" });
    expect(requireMember).toHaveBeenCalledWith(context.request, context.env);
    expect(listTradeWatchlists).toHaveBeenCalledWith(context.env);
  });

  it("creates watchlists with the authenticated member id", async () => {
    const context = routeContext("https://worker.test/api/trade/watchlists", {
      method: "POST",
      body: JSON.stringify({ name: "Plushies" }),
    });

    const response = await routeTradeApi(context);

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ ok: true, route: "create" });
    expect(readAuthenticatedUserId).toHaveBeenCalledWith(context.request, context.env);
    expect(createTradeWatchlist).toHaveBeenCalledWith(context.request, context.env, 12345);
  });

  it.each([
    ["PUT", updateTradeWatchlist, "update"],
    ["DELETE", deleteTradeWatchlist, "delete"],
  ])("routes %s watchlist detail commands through admin auth", async (method, handler, routeName) => {
    const context = routeContext("https://worker.test/api/trade/watchlists/42", { method });

    const response = await routeTradeApi(context);

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ ok: true, route: routeName });
    expect(requireAdmin).toHaveBeenCalledWith(context.request, context.env);
    expect(handler).toHaveBeenCalledWith(...(
      method === "PUT"
        ? [context.request, context.env, 42]
        : [context.env, 42]
    ));
  });

  it("scans watchlists with the authenticated member id", async () => {
    const context = routeContext("https://worker.test/api/trade/watchlists/42/scan", {
      method: "POST",
    });

    const response = await routeTradeApi(context);

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ ok: true, route: "watchlist-scan" });
    expect(requireMember).toHaveBeenCalledWith(context.request, context.env);
    expect(scanTradeWatchlist).toHaveBeenCalledWith(context.request, context.env, 42, 12345);
  });

  it.each([
    ["/api/trade/search/opportunities", getTradeSearchOpportunities, "search-opportunities"],
    ["/api/trade/opportunities", getTradeOpportunities, "opportunities"],
  ])("routes %s through member auth", async (path, handler, routeName) => {
    const method = path.includes("search") ? "POST" : "GET";
    const context = routeContext(`https://worker.test${path}`, { method });

    const response = await routeTradeApi(context);

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ ok: true, route: routeName });
    expect(requireMember).toHaveBeenCalledWith(context.request, context.env);
    expect(handler).toHaveBeenCalled();
  });

  it("routes trade search scans with the authenticated member id", async () => {
    const context = routeContext("https://worker.test/api/trade/search/scan", {
      method: "POST",
      body: JSON.stringify({ query: "flower" }),
    });

    const response = await routeTradeApi(context);

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ ok: true, route: "search-scan" });
    expect(scanTradeSearch).toHaveBeenCalledWith(context.request, context.env, 12345);
  });

  it("does not resolve member ids when member auth fails", async () => {
    vi.mocked(requireMember).mockResolvedValueOnce(jsonResponse({ ok: false, code: "UNAUTHORIZED" }, 401));

    const response = await routeTradeApi(routeContext("https://worker.test/api/trade/watchlists", {
      method: "POST",
    }));

    expect(response?.status).toBe(401);
    expect(readAuthenticatedUserId).not.toHaveBeenCalled();
    expect(createTradeWatchlist).not.toHaveBeenCalled();
  });

  it("rejects admin watchlist commands before handlers run", async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce(jsonResponse({ ok: false, code: "FORBIDDEN" }, 403));

    const response = await routeTradeApi(routeContext("https://worker.test/api/trade/watchlists/42", {
      method: "DELETE",
    }));

    expect(response?.status).toBe(403);
    expect(deleteTradeWatchlist).not.toHaveBeenCalled();
  });

  it("ignores unmatched trade routes", async () => {
    const response = await routeTradeApi(routeContext("https://worker.test/api/trade/watchlists/not-a-number", {
      method: "DELETE",
    }));

    expect(response).toBeNull();
    expect(requireAdmin).not.toHaveBeenCalled();
    expect(requireMember).not.toHaveBeenCalled();
  });
});
