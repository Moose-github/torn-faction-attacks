import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prices: Record<number, number> = { 367: 14080000, 985: 415000, 986: 850000, 987: 1320000,
  530: 1840000, 553: 1830000, 532: 2410000, 554: 2400000, 533: 4080000, 555: 4120000 };
const payload = (id: number) => ({ item_id: id, item_name: `Item ${id}`, market_price: prices[id],
  bazaar_average: 99, listings: [{ price: 1 }], generated_at: Math.floor(Date.now() / 1000) - 60 });
const success = (input: string) => Promise.resolve(Response.json(payload(Number(input.split("/").at(-1)))));

describe("Halloween Weav3r prices", () => {
  beforeEach(() => { vi.resetModules(); vi.stubGlobal("fetch", vi.fn(success)); });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it("loads market values, picks the cheaper same-energy can and sends no credentials", async () => {
    const { getHalloweenPrices } = await import("./halloweenPrices");
    const result = await getHalloweenPrices(new AbortController().signal);
    expect(result.fhc.price).toBe(14080000);
    expect(result.cans.map(can => [can.energy, can.itemId, can.price])).toEqual([
      [5, 985, 415000], [10, 986, 850000], [15, 987, 1320000],
      [20, 553, 1830000], [25, 554, 2400000], [30, 533, 4080000],
    ]);
    expect(fetch).toHaveBeenCalledTimes(10);
    for (const [url, options] of vi.mocked(fetch).mock.calls) {
      expect(url).toMatch(/^https:\/\/weav3r\.dev\/api\/marketplace\/\d+$/);
      expect(options).toMatchObject({ credentials: "omit", headers: { Accept: "application/json" } });
      expect(options?.headers).not.toHaveProperty("Authorization");
    }
    expect(result.generatedAt).toBeLessThanOrEqual(Date.now() / 1000 - 59);
  });

  it("reuses a successful snapshot for five minutes, then refreshes", async () => {
    vi.useFakeTimers();
    const { getHalloweenPrices } = await import("./halloweenPrices");
    const first = await getHalloweenPrices(new AbortController().signal);
    expect(await getHalloweenPrices(new AbortController().signal)).toBe(first);
    expect(fetch).toHaveBeenCalledTimes(10);
    vi.setSystemTime(Date.now() + 300001);
    await getHalloweenPrices(new AbortController().signal);
    expect(fetch).toHaveBeenCalledTimes(20);
  });

  it.each([
    { market_price: 0 }, { market_price: null }, { market_price: "123" }, { item_id: 9999 },
    { generated_at: 1 }, { generated_at: null }, { item_name: "" },
  ])("rejects malformed or stale data without caching partial prices: %j", async override => {
    const { getHalloweenPrices } = await import("./halloweenPrices");
    vi.mocked(fetch).mockImplementation(async input => {
      const id = Number(String(input).split("/").at(-1));
      return Response.json({ ...payload(id), ...(id === 985 ? override : {}) });
    });
    await expect(getHalloweenPrices(new AbortController().signal)).rejects.toThrow("invalid or outdated");
    vi.mocked(fetch).mockImplementation(input => success(String(input)));
    expect((await getHalloweenPrices(new AbortController().signal)).cans).toHaveLength(6);
  });

  it("surfaces rate limits without applying an incomplete price set", async () => {
    const { getHalloweenPrices } = await import("./halloweenPrices");
    vi.mocked(fetch).mockResolvedValue(new Response("", { status: 429 }));
    await expect(getHalloweenPrices(new AbortController().signal)).rejects.toThrow("limiting requests");
  });

  it("honours cancellation even when prices are cached", async () => {
    const { getHalloweenPrices } = await import("./halloweenPrices");
    await getHalloweenPrices(new AbortController().signal);
    const controller = new AbortController(); controller.abort();
    await expect(getHalloweenPrices(controller.signal)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(10);
  });

  it("bounds slow requests with a timeout", async () => {
    vi.useFakeTimers();
    const { getHalloweenPrices } = await import("./halloweenPrices");
    vi.mocked(fetch).mockImplementation((_input, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new Error("Aborted")), { once: true });
    }));
    const assertion = expect(getHalloweenPrices(new AbortController().signal)).rejects.toThrow("Unable to load");
    await vi.advanceTimersByTimeAsync(20000);
    await assertion;
  });
});
