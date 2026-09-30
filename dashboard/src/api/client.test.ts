import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authenticateTornKey, refreshAuthSession } from "./auth";
import { ApiError, deleteJson, getApiResponse, getJson, postJson, putJson } from "./client";
import { subscribeAuthFailures } from "../auth/events";

describe("API errors and credential ownership", () => {
  let token: string | null;
  let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
  const cleanups: Array<() => void> = [];
  beforeEach(() => {
    token = "original-token";
    vi.stubGlobal("window", { localStorage: { getItem: () => token } });
    fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetcher);
  });
  afterEach(() => { cleanups.splice(0).forEach(stop => stop()); vi.unstubAllGlobals(); });

  it.each([
    ["GET", () => getJson("/api/test")],
    ["POST", () => postJson("/api/test", { value: 3 })],
    ["PUT", () => putJson("/api/test", { value: 3 })],
    ["DELETE", () => deleteJson("/api/test")],
  ] as const)("preserves structured errors for %s without retrying mutations", async (method, request) => {
    fetcher.mockResolvedValueOnce(Response.json({ ok: false, error: "Wait", code: "COOLDOWN_ACTIVE" }, { status: 429 }));
    await expect(request()).rejects.toMatchObject({ name: "ApiError", message: "Wait", status: 429, code: "COOLDOWN_ACTIVE" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method, headers: { Authorization: "Bearer original-token" } });
  });

  it.each([401, 403, 502, 503])("preserves status %s for non-JSON error responses", async status => {
    fetcher.mockResolvedValueOnce(new Response("<html>Error</html>", { status }));
    await expect(getJson("/api/test")).rejects.toMatchObject({ status, code: null });
  });

  it("rejects malformed success responses without labelling them an auth failure", async () => {
    const failure = vi.fn(); cleanups.push(subscribeAuthFailures(failure));
    fetcher.mockResolvedValueOnce(new Response("broken", { status: 200 }));
    await expect(getJson("/api/test")).rejects.toMatchObject({ status: 200, code: "INVALID_RESPONSE" });
    expect(failure).not.toHaveBeenCalled();
  });

  it("attributes late failures to the token sent, not the current token", async () => {
    const failure = vi.fn(); cleanups.push(subscribeAuthFailures(failure));
    fetcher.mockImplementationOnce(async () => {
      token = "replacement-token";
      return Response.json({ ok: false }, { status: 401 });
    });
    await expect(getJson("/api/test")).rejects.toBeInstanceOf(ApiError);
    expect(failure).toHaveBeenCalledWith({ token: "original-token", kind: "unauthorized" });
  });

  it("keeps auth-operation results and storage writes with the session owner", async () => {
    const failure = vi.fn(); cleanups.push(subscribeAuthFailures(failure));
    fetcher.mockResolvedValueOnce(Response.json({ token: "new-token" }));
    await expect(authenticateTornKey("input-key")).resolves.toEqual({ token: "new-token" });
    expect(fetcher.mock.calls[0][1]).toMatchObject({ headers: { "Content-Type": "application/json" } });
    expect(fetcher.mock.calls[0][1]?.headers).not.toHaveProperty("Authorization");
    fetcher.mockResolvedValueOnce(Response.json({ ok: false }, { status: 401 }));
    await expect(refreshAuthSession()).rejects.toMatchObject({ status: 401 });
    expect(failure).not.toHaveBeenCalled();
    expect(token).toBe("original-token");
  });

  it("does not report unauthenticated requests or aborted requests as session failures", async () => {
    const failure = vi.fn(); cleanups.push(subscribeAuthFailures(failure));
    fetcher.mockResolvedValueOnce(Response.json({ ok: false }, { status: 401 }));
    await expect(getJson("/api/test", false)).rejects.toMatchObject({ status: 401 });
    const controller = new AbortController(); controller.abort();
    fetcher.mockRejectedValueOnce(new DOMException("Aborted", "AbortError"));
    await expect(getJson("/api/test", true, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(fetcher.mock.calls[1][1]?.signal).toBe(controller.signal);
    expect(failure).not.toHaveBeenCalled();
  });

  it("handles download permissions consistently while preserving successful binary responses", async () => {
    const failure = vi.fn(); cleanups.push(subscribeAuthFailures(failure));
    fetcher.mockResolvedValueOnce(Response.json({ code: "ADMIN_REQUIRED" }, { status: 403 }));
    await expect(getApiResponse("/api/preview")).rejects.toMatchObject({ status: 403, code: "ADMIN_REQUIRED" });
    expect(failure).toHaveBeenCalledWith({ token, kind: "permissions" });
    fetcher.mockResolvedValueOnce(new Response("binary", { headers: { "Content-Type": "image/png" } }));
    expect(await (await getApiResponse("/api/preview")).text()).toBe("binary");
  });
});
