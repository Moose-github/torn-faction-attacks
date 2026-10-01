import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { importOwnedStockPortfolio, OWNED_STOCK_REQUEST_TIMEOUT_MS, type OwnedStockImportProgress } from "./ownedStockImport";

const stockData = { stocks: [{ id: 1, shares: 500_000, bonus: { available: false, increment: 1, progress: 3, frequency: 7 } }] };
const bankData = { money: { city_bank: { amount: 2_387_200_000, profit: 387_200_000, duration: 90,
  interest_rate: 19.36, until: 1_800_000_000, invested_at: 1_792_224_000 } } };
const meritsData = { merits: { upgrades: [{ id: 7, level: 10 }] } };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const flush = () => vi.advanceTimersByTimeAsync(0);

describe("portfolio imports", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-01T12:00:00Z")); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  function setup() {
    const requests = { stocks: deferred<Response>(), money: deferred<Response>(), merits: deferred<Response>() };
    const signals: AbortSignal[] = [];
    const fetchMock = vi.fn((url: string, options: RequestInit) => {
      const selection = new URL(url).pathname.split("/").pop() as keyof typeof requests;
      const signal = options.signal!;
      signals.push(signal);
      return new Promise<Response>((resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
        requests[selection].promise.then(resolve, reject);
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const updates: OwnedStockImportProgress[] = [];
    const finished = importOwnedStockPortfolio("test-key", controller.signal, progress => updates.push(progress));
    return { requests, signals, fetchMock, controller, updates, finished, latest: () => updates[updates.length - 1] };
  }

  it("publishes stocks immediately while bank details and merits are still pending", async () => {
    const load = setup();
    load.requests.stocks.resolve(json(stockData));
    await flush();
    expect(load.latest()).toMatchObject({ stocks: { status: "success", value: { stocks: [{ stock_id: 1, shares: 500_000 }] } },
      bank: { status: "loading" }, merits: { status: "loading" } });
    load.requests.money.resolve(json(bankData));
    await flush();
    expect(load.latest().bank).toEqual({ status: "success", value: bankData.money.city_bank });
    expect(load.latest().merits.status).toBe("loading");
    load.requests.merits.resolve(json(meritsData));
    await load.finished;
    expect(load.latest().merits).toEqual({ status: "success", value: 10 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retains optional results if they arrive before stocks, including no bank and zero merits", async () => {
    const load = setup();
    load.requests.money.resolve(json({ money: { city_bank: null } }));
    load.requests.merits.resolve(json({ merits: { bank_interest: 0 } }));
    await flush();
    expect(load.latest().stocks.status).toBe("loading");
    load.requests.stocks.resolve(json({ stocks: [] }));
    await load.finished;
    expect(load.latest()).toMatchObject({ stocks: { status: "success", value: { stocks: [] } },
      bank: { status: "success", value: null }, merits: { status: "success", value: 0 } });
  });

  it("times out optional requests without losing successful stock holdings", async () => {
    const load = setup();
    load.requests.stocks.resolve(json(stockData));
    await vi.advanceTimersByTimeAsync(OWNED_STOCK_REQUEST_TIMEOUT_MS);
    await load.finished;
    expect(load.latest().stocks.status).toBe("success");
    expect(load.latest().bank).toMatchObject({ status: "error", error: expect.stringContaining("City Bank details from Torn timed out after 15 seconds") });
    expect(load.latest().merits).toMatchObject({ status: "error", error: expect.stringContaining("bank merits from Torn timed out") });
    expect(load.signals.every(signal => signal.aborted)).toBe(false); // The completed stock request is untouched.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("times out stock requests and permits a subsequent import to succeed", async () => {
    const load = setup();
    load.requests.money.resolve(json(bankData));
    load.requests.merits.resolve(json(meritsData));
    await vi.advanceTimersByTimeAsync(OWNED_STOCK_REQUEST_TIMEOUT_MS);
    await load.finished;
    expect(load.latest().stocks).toMatchObject({ status: "error", error: expect.stringContaining("stock holdings from Torn timed out") });
    const retry = setup();
    retry.requests.stocks.resolve(json(stockData));
    retry.requests.money.resolve(json(bankData));
    retry.requests.merits.resolve(json(meritsData));
    await retry.finished;
    expect(retry.latest().stocks.status).toBe("success");
  });

  it("keeps the timeout active while a response body is still downloading", async () => {
    const load = setup();
    load.requests.stocks.resolve({ ok: true, json: () => new Promise((_, reject) => {
      load.signals[0].addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }) } as Response);
    await vi.advanceTimersByTimeAsync(OWNED_STOCK_REQUEST_TIMEOUT_MS);
    await load.finished;
    expect(load.latest().stocks).toMatchObject({ status: "error", error: expect.stringContaining("timed out") });
  });

  it("does not publish late responses or errors after cancellation", async () => {
    const load = setup();
    load.requests.stocks.resolve(json(stockData));
    await flush();
    const updateCount = load.updates.length;
    load.controller.abort();
    load.requests.money.resolve(json(bankData));
    load.requests.merits.resolve(json(meritsData));
    await load.finished;
    expect(load.updates).toHaveLength(updateCount);
    expect(load.signals.slice(1).every(signal => signal.aborted)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not start an already-cancelled import", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    controller.abort();
    const update = vi.fn();
    await importOwnedStockPortfolio("test-key", controller.signal, update);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("explains permission failures for every selection, including HTTP errors", async () => {
    const load = setup();
    for (const request of Object.values(load.requests)) request.resolve(json({ error: { code: 16, error: "Access level too low" } }, 403));
    await load.finished;
    for (const result of Object.values(load.latest())) expect(result).toMatchObject({ status: "error", error: expect.stringContaining("Use a Limited or Full access Torn key") });
    expect(load.latest().stocks).toMatchObject({ error: expect.stringContaining("user → stocks") });
    expect(load.latest().bank).toMatchObject({ error: expect.stringContaining("user → money") });
  });

  it.each([[2, "Incorrect key"], [5, "Too many requests"]])("preserves Torn error %s", async (code, error) => {
    const load = setup();
    load.requests.stocks.resolve(json({ error: { code, error } }));
    load.requests.money.resolve(json(bankData));
    load.requests.merits.resolve(json(meritsData));
    await load.finished;
    expect(load.latest().stocks).toEqual({ status: "error", error });
  });

  it("reports missing or unreadable optional data without rejecting the holdings", async () => {
    const load = setup();
    load.requests.stocks.resolve(json(stockData));
    load.requests.money.resolve(new Response("unavailable", { status: 502 }));
    load.requests.merits.resolve(json({ merits: {} }));
    await load.finished;
    expect(load.latest().stocks.status).toBe("success");
    expect(load.latest().bank).toMatchObject({ status: "error", error: expect.stringContaining("unreadable response") });
    expect(load.latest().merits).toMatchObject({ status: "error", error: expect.stringContaining("Enter them manually") });
  });

  it("explains network errors without exposing the submitted key", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch secret-key")));
    const updates: OwnedStockImportProgress[] = [];
    await importOwnedStockPortfolio("secret-key", new AbortController().signal, progress => updates.push(progress));
    const result = updates[updates.length - 1];
    expect(result.stocks).toMatchObject({ status: "error", error: expect.stringContaining("Could not connect directly to Torn") });
    expect(JSON.stringify(result)).not.toContain("secret-key");
  });
});
