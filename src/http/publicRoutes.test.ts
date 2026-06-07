import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  authenticateWithTornKey,
  getCurrentAuthSession,
} from "../auth";
import type { Env } from "../types";
import { routePublicApi } from "./publicRoutes";

vi.mock("../auth", () => ({
  authenticateWithTornKey: vi.fn(),
  getCurrentAuthSession: vi.fn(),
}));

describe("public routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateWithTornKey).mockResolvedValue(jsonResponse({ ok: true, route: "auth-torn" }));
    vi.mocked(getCurrentAuthSession).mockResolvedValue(jsonResponse({ ok: true, route: "auth-me" }));
  });

  it("routes Torn key authentication without an auth gate", async () => {
    const context = routeContext("https://worker.test/api/auth/torn", {
      method: "POST",
      body: JSON.stringify({ key: "abc" }),
    });

    const response = await routePublicApi(context);

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ ok: true, route: "auth-torn" });
    expect(authenticateWithTornKey).toHaveBeenCalledWith(context.request, context.env);
  });

  it("routes current session refresh without an auth gate", async () => {
    const context = routeContext("https://worker.test/api/auth/me");

    const response = await routePublicApi(context);

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ ok: true, route: "auth-me" });
    expect(getCurrentAuthSession).toHaveBeenCalledWith(context.request, context.env);
  });

  it("returns a lightweight health response for any method", async () => {
    const response = await routePublicApi(routeContext("https://worker.test/api/health", {
      method: "HEAD",
    }));

    expect(response?.status).toBe(200);
    expect(response?.headers.get("Content-Type")).toContain("application/json");
    expect(await response?.json()).toEqual({ ok: true });
    expect(authenticateWithTornKey).not.toHaveBeenCalled();
    expect(getCurrentAuthSession).not.toHaveBeenCalled();
  });

  it.each([
    ["/api/auth/torn", "GET"],
    ["/api/auth/me", "POST"],
    ["/api/unknown", "GET"],
  ])("ignores unmatched public route %s %s", async (path, method) => {
    const response = await routePublicApi(routeContext(`https://worker.test${path}`, { method }));

    expect(response).toBeNull();
    expect(authenticateWithTornKey).not.toHaveBeenCalled();
    expect(getCurrentAuthSession).not.toHaveBeenCalled();
  });
});

function routeContext(rawUrl: string, init?: RequestInit) {
  const request = new Request(rawUrl, init);
  const url = new URL(rawUrl);
  return {
    request,
    env: {} as Env,
    ctx: {} as ExecutionContext,
    url,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
