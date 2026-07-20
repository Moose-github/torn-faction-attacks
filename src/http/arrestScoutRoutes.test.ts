import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  readAuthenticatedUserId,
  requireMember,
} from "../auth";
import {
  getArrestScoutSnapshot,
  listArrestScoutFactionHof,
  listArrestScoutFutureTargets,
  listArrestScoutSnapshots,
  scanArrestScout,
} from "../arrestScout";
import { jsonResponse, routeContext } from "../testUtils/http";
import { routeArrestScoutApi } from "./arrestScoutRoutes";

vi.mock("../auth", () => ({
  readAuthenticatedUserId: vi.fn(),
  requireMember: vi.fn(),
}));

vi.mock("../arrestScout", () => ({
  getArrestScoutSnapshot: vi.fn(),
  listArrestScoutFactionHof: vi.fn(),
  listArrestScoutFutureTargets: vi.fn(),
  listArrestScoutSnapshots: vi.fn(),
  scanArrestScout: vi.fn(),
}));

describe("arrest scout routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireMember).mockResolvedValue(null);
    vi.mocked(readAuthenticatedUserId).mockResolvedValue(12345);
    vi.mocked(scanArrestScout).mockResolvedValue(jsonResponse({ ok: true, route: "scan" }));
    vi.mocked(listArrestScoutSnapshots).mockResolvedValue(jsonResponse({ ok: true, route: "snapshots" }));
    vi.mocked(getArrestScoutSnapshot).mockResolvedValue(jsonResponse({ ok: true, route: "snapshot" }));
    vi.mocked(listArrestScoutFutureTargets).mockResolvedValue(jsonResponse({ ok: true, route: "future-targets" }));
    vi.mocked(listArrestScoutFactionHof).mockResolvedValue(jsonResponse({ ok: true, route: "faction-hof" }));
  });

  it("routes scans through member auth with the authenticated member id", async () => {
    const context = routeContext("https://worker.test/api/arrest-scout/scan", {
      method: "POST",
      body: JSON.stringify({ source: "manual" }),
    });

    const response = await routeArrestScoutApi(context);

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ ok: true, route: "scan" });
    expect(requireMember).toHaveBeenCalledWith(context.request, context.env);
    expect(scanArrestScout).toHaveBeenCalledWith(context.request, context.env, 12345);
  });

  it.each([
    ["/api/arrest-scout/snapshots", listArrestScoutSnapshots, "snapshots"],
    ["/api/arrest-scout/future-targets", listArrestScoutFutureTargets, "future-targets"],
  ])("routes %s through member auth", async (path, handler, routeName) => {
    const context = routeContext(`https://worker.test${path}`);

    const response = await routeArrestScoutApi(context);

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ ok: true, route: routeName });
    expect(requireMember).toHaveBeenCalledWith(context.request, context.env);
    expect(handler).toHaveBeenCalledWith(context.env);
  });

  it("routes faction HoF lookup through member auth with the request", async () => {
    const context = routeContext("https://worker.test/api/arrest-scout/faction-hof?cat=rank&limit=100");

    const response = await routeArrestScoutApi(context);

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ ok: true, route: "faction-hof" });
    expect(requireMember).toHaveBeenCalledWith(context.request, context.env);
    expect(listArrestScoutFactionHof).toHaveBeenCalledWith(context.request, context.env);
  });

  it("routes snapshot details through member auth", async () => {
    const context = routeContext("https://worker.test/api/arrest-scout/snapshots/abc-123");

    const response = await routeArrestScoutApi(context);

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ ok: true, route: "snapshot" });
    expect(getArrestScoutSnapshot).toHaveBeenCalledWith(context.env, "abc-123");
  });

  it("does not resolve member ids when member auth fails", async () => {
    vi.mocked(requireMember).mockResolvedValueOnce(jsonResponse({ ok: false, code: "UNAUTHORIZED" }, 401));

    const response = await routeArrestScoutApi(routeContext("https://worker.test/api/arrest-scout/scan", {
      method: "POST",
    }));

    expect(response?.status).toBe(401);
    expect(readAuthenticatedUserId).not.toHaveBeenCalled();
    expect(scanArrestScout).not.toHaveBeenCalled();
  });

  it("ignores unmatched arrest scout routes", async () => {
    const response = await routeArrestScoutApi(routeContext("https://worker.test/api/arrest-scout/nope"));

    expect(response).toBeNull();
    expect(requireMember).not.toHaveBeenCalled();
  });
});
