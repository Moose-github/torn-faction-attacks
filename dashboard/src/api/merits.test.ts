import { afterEach, describe, expect, it, vi } from "vitest";
import { importMerits, MERIT_IMPORT_TIMEOUT_MS } from "./merits";

const user = { merits: { upgrades: [{ id: 7, level: 10 }], used: 55, available: 10 } };
const catalog = { merits: [{ id: 7, name: "Bank Interest", description: "Bank interest" }] };
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("one-time merit fetch", () => {
  it("only requests merit data from Torn and keeps the key out of URLs", async () => {
    const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(url.includes("/user/") ? user : catalog)));
    vi.stubGlobal("fetch", fetchMock);
    const result = await importMerits("test-key", new AbortController().signal);
    expect(result.budget).toBe(65);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual(["https://api.torn.com/v2/user/merits", "https://api.torn.com/v2/torn/merits"]);
    expect(fetchMock).toHaveBeenCalledWith("https://api.torn.com/v2/user/merits", expect.objectContaining({
      headers: { Accept: "application/json", Authorization: "ApiKey test-key" }, credentials: "omit", cache: "no-store",
    }));
  });
  it.each([[2, "not valid"], [16, "Minimal"], [5, "rate-limiting"]])("handles Torn error %s without exposing the key", async (code, message) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code, error: "untrusted secret-key" } }))));
    await expect(importMerits("secret-key", new AbortController().signal)).rejects.toThrow(String(message));
  });
  it("does not start a cancelled import", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const request = new AbortController(); request.abort();
    await expect(importMerits("test", request.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("times out and cancels both outstanding requests", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      const signal = init.signal as AbortSignal; signals.push(signal);
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    })));
    const pending = expect(importMerits("test", new AbortController().signal)).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(MERIT_IMPORT_TIMEOUT_MS);
    await pending;
    expect(signals).toHaveLength(2);
    expect(signals.every(signal => signal.aborted)).toBe(true);
  });
});
