import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getJson } from "../api/client";
import type { AuthSession } from "../api/types";
import { createAuthController } from "./controller";
import { AUTH_SESSION_STORAGE_KEY, AUTH_TOKEN_STORAGE_KEY, clearStoredAuth, getAuthToken, readStoredAuth, writeStoredAuth } from "./storage";

function session(id = 1, access_level: "admin" | "member" = "admin"): AuthSession {
  return { ok: true, token: `token-${id}`, access_level, expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id, name: `Member ${id}`, key_access_level: null, key_access_type: null, key_faction_access: false } };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
const flush = () => vi.advanceTimersByTimeAsync(0);
const saved = (value: AuthSession) => writeStoredAuth({ token: value.token!, session: value });
const response = (value: AuthSession) => { const { token: _token, ...body } = value; return Response.json(body); };

describe("shared authentication lifecycle", () => {
  let storage: Map<string, string>;
  let page: EventTarget & { hidden: boolean };
  let serverSession: AuthSession;
  let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
  const cleanups: Array<() => void> = [];
  function start() {
    const controller = createAuthController();
    cleanups.push(controller.start());
    return controller;
  }
  function storageEvent(key: string | null = AUTH_SESSION_STORAGE_KEY) {
    window.dispatchEvent(Object.assign(new Event("storage"), { key, newValue: window.localStorage.getItem(key ?? ""), storageArea: window.localStorage }));
  }
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-30T12:00:00Z"));
    storage = new Map();
    vi.stubGlobal("window", Object.assign(new EventTarget(), { localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
      removeItem: (key: string) => { storage.delete(key); },
    } }));
    page = Object.assign(new EventTarget(), { hidden: false });
    vi.stubGlobal("document", page);
    serverSession = session();
    fetcher = vi.fn<typeof fetch>(async () => response(serverSession));
    vi.stubGlobal("fetch", fetcher);
  });
  afterEach(() => {
    cleanups.splice(0).forEach(stop => stop());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("restores legacy sessions whose metadata omitted the token", async () => {
    const { token, ...legacy } = serverSession;
    storage.set(AUTH_TOKEN_STORAGE_KEY, token!);
    storage.set(AUTH_SESSION_STORAGE_KEY, JSON.stringify(legacy));
    const auth = start();
    await flush();
    expect(auth.getSnapshot().session?.user.id).toBe(1);
    expect(getAuthToken()).toBe(token);
    expect(readStoredAuth()?.session.token).toBe(token);
  });

  it("coalesces refresh requests and wake events while a request is in flight", async () => {
    saved(serverSession);
    const pending = deferred<Response>();
    fetcher.mockReturnValueOnce(pending.promise);
    const auth = start();
    auth.refresh(); auth.refresh(); window.dispatchEvent(new Event("focus"));
    page.dispatchEvent(new Event("visibilitychange"));
    expect(fetcher).toHaveBeenCalledTimes(1);
    pending.resolve(response(serverSession));
    await flush();
    expect(auth.getSnapshot().refreshing).toBe(false);
  });

  it.each(["network", "server", "malformed"])("retains a valid session during a %s failure, then recovers", async kind => {
    saved(serverSession);
    if (kind === "network") fetcher.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    else fetcher.mockResolvedValueOnce(new Response("unavailable", { status: kind === "server" ? 503 : 200 }));
    const auth = start();
    await flush();
    expect(auth.getSnapshot().session?.user.id).toBe(1);
    expect(auth.getSnapshot().refreshError).toBeTruthy();
    expect(getAuthToken()).toBe("token-1");
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(auth.getSnapshot().refreshError).toBeNull();
  });

  it("backs off repeated failures and prevents wake events from bypassing the retry delay", async () => {
    saved(serverSession);
    fetcher.mockRejectedValue(new TypeError("offline"));
    const auth = start();
    await flush();
    for (const delay of [5000, 15000, 30000, 60000, 60000]) {
      const calls = fetcher.mock.calls.length;
      auth.refresh(); window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(fetcher).toHaveBeenCalledTimes(calls);
      await vi.advanceTimersByTimeAsync(1);
      expect(fetcher).toHaveBeenCalledTimes(calls + 1);
    }
  });

  it("clears a rejected session and stops further polling", async () => {
    saved(serverSession);
    fetcher.mockResolvedValueOnce(Response.json({ ok: false, code: "UNAUTHORIZED" }, { status: 401 }));
    const auth = start();
    await flush();
    expect(auth.getSnapshot().session).toBeNull();
    expect(getAuthToken()).toBeNull();
    await vi.advanceTimersByTimeAsync(3600_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("expires a session during an outage even while the page is hidden", async () => {
    serverSession.expires_at = Math.floor(Date.now() / 1000) + 10;
    saved(serverSession);
    fetcher.mockRejectedValue(new TypeError("offline"));
    const auth = start();
    await flush();
    page.hidden = true;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(auth.getSnapshot().session).toBeNull();
    expect(getAuthToken()).toBeNull();
  });

  it("does not allow a late refresh to restore a signed-out session", async () => {
    saved(serverSession);
    const pending = deferred<Response>();
    fetcher.mockReturnValueOnce(pending.promise);
    const auth = start();
    auth.signOut();
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    pending.resolve(response(serverSession));
    await flush();
    expect(auth.getSnapshot().session).toBeNull();
    expect(readStoredAuth()).toBeNull();
  });

  it("rejects a late sign-in after sign-out", async () => {
    const pending = deferred<Response>();
    fetcher.mockReturnValueOnce(pending.promise);
    const auth = start();
    const result = auth.signIn("key").catch(error => error);
    auth.signOut();
    pending.resolve(Response.json(serverSession));
    expect(await result).toMatchObject({ name: "AbortError" });
    expect(readStoredAuth()).toBeNull();
  });

  it("switches account scope and ignores the previous account's pending refresh", async () => {
    saved(serverSession);
    const pending = deferred<Response>();
    fetcher.mockReturnValueOnce(pending.promise);
    const auth = start();
    const originalScope = auth.getSnapshot().scope;
    const next = session(2, "member");
    fetcher.mockResolvedValueOnce(Response.json(next));
    await auth.signIn("new-key");
    pending.resolve(response(serverSession));
    await flush();
    expect(auth.getSnapshot().session?.user.id).toBe(2);
    expect(auth.getSnapshot().scope).toBeGreaterThan(originalScope);
    expect(getAuthToken()).toBe("token-2");
  });

  it("does not sign out a new account when an old protected request returns 401", async () => {
    saved(serverSession);
    const auth = start();
    await flush();
    const pending = deferred<Response>();
    fetcher.mockReturnValueOnce(pending.promise);
    const oldRequest = getJson("/api/members").catch(error => error);
    fetcher.mockResolvedValueOnce(Response.json(session(2)));
    await auth.signIn("new-key");
    pending.resolve(Response.json({ ok: false }, { status: 401 }));
    await oldRequest;
    expect(auth.getSnapshot().session?.user.id).toBe(2);
  });

  it("refreshes permissions on ADMIN_REQUIRED and keeps the member signed in", async () => {
    saved(serverSession);
    const auth = start();
    await flush();
    const scope = auth.getSnapshot().scope;
    serverSession = session(1, "member");
    fetcher.mockResolvedValueOnce(Response.json({ ok: false, code: "ADMIN_REQUIRED" }, { status: 403 }));
    await expect(getJson("/api/admin/example")).rejects.toMatchObject({ status: 403 });
    await flush();
    expect(auth.getSnapshot().session?.access_level).toBe("member");
    expect(auth.getSnapshot().scope).toBeGreaterThan(scope);
    expect(getAuthToken()).toBe("token-1");
  });

  it("does not treat an ordinary permission failure as invalid authentication", async () => {
    saved(serverSession);
    const auth = start();
    await flush();
    fetcher.mockResolvedValueOnce(Response.json({ ok: false, code: "FORBIDDEN" }, { status: 403 }));
    await expect(getJson("/api/example")).rejects.toMatchObject({ status: 403 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(auth.getSnapshot().session).not.toBeNull();
  });

  it("synchronizes account changes and sign-out across tabs", async () => {
    saved(serverSession);
    const auth = start();
    await flush();
    serverSession = session(2, "member");
    saved(serverSession); storageEvent();
    expect(auth.getSnapshot().session?.user.id).toBe(2);
    await flush();
    clearStoredAuth(); storageEvent();
    expect(auth.getSnapshot().session).toBeNull();
  });

  it("notices a cross-tab token change before its storage event arrives", async () => {
    saved(serverSession);
    const oldSession = serverSession;
    const pending = deferred<Response>();
    fetcher.mockReturnValueOnce(pending.promise);
    const auth = start();
    serverSession = session(2); saved(serverSession);
    pending.resolve(response(oldSession));
    await flush();
    expect(auth.getSnapshot().session?.user.id).toBe(2);
    expect(getAuthToken()).toBe("token-2");
  });

  it("keeps unchanged session data and scope stable after validation", async () => {
    saved(serverSession);
    const auth = start();
    await flush();
    const before = auth.getSnapshot();
    auth.refresh(); await flush();
    expect(auth.getSnapshot().session).toBe(before.session);
    expect(auth.getSnapshot().scope).toBe(before.scope);
  });

  it("cleans up and restarts safely under Strict Mode's effect lifecycle", async () => {
    saved(serverSession);
    const pending = deferred<Response>();
    fetcher.mockReturnValueOnce(pending.promise);
    const auth = createAuthController();
    auth.start()();
    const stop = auth.start(); cleanups.push(stop);
    pending.resolve(response(session(2)));
    await flush();
    expect(auth.getSnapshot().session?.user.id).toBe(1);
    stop();
    await vi.advanceTimersByTimeAsync(7200_000);
    window.dispatchEvent(new Event("focus"));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each(["expired", "malformed", "mismatched"])("discards %s saved credentials without requesting /auth/me", kind => {
    saved(serverSession);
    if (kind === "expired") saved({ ...serverSession, expires_at: 1 });
    if (kind === "malformed") storage.set(AUTH_SESSION_STORAGE_KEY, JSON.stringify({ ok: true }));
    if (kind === "mismatched") storage.set(AUTH_TOKEN_STORAGE_KEY, "other-token");
    expect(start().getSnapshot().session).toBeNull();
    expect(getAuthToken()).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
