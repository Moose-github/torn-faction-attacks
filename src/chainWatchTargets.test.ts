import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHAIN_TARGET_SEARCH_CURSORS } from "./chainWatchTargetCursors";
import { fetchChainWatchTargets, isViableChainWatchTarget } from "./chainWatchTargets";
import { fetchTrackedTornResponse } from "./external/torn";
import { markTornKeyFailure, readAvailableTornApiKeys, recordTornKeyUse, type TornKeyPoolCandidate } from "./tornKeyPool";
import type { Env } from "./types";

vi.mock("./external/torn", () => ({ fetchTrackedTornResponse: vi.fn() }));
vi.mock("./tornKeyPool", () => ({ readAvailableTornApiKeys: vi.fn(), recordTornKeyUse: vi.fn(), markTornKeyFailure: vi.fn() }));
const env = {} as Env;
const player = (id: number, icons: unknown[] = []) => ({ id, icons, online: "Online", faction_id: 8803 });
const icon = (id: number, title: string, description: string | null = null) => ({ id, title, description });
const key = (id = "one", currentMinuteUsage = 0, maxRequestsPerMinute: number | null = 60): TornKeyPoolCandidate => ({
  id, key: `test-key-${id}`, keySource: `key_pool:${id}`, sourceType: "submitted", maxRequestsPerMinute,
  currentMinuteUsage, lastUsedAt: null, monitorLastUsedAt: null,
});
const respond = (players: unknown[]) => Response.json({ search: players });

beforeEach(() => {
  vi.mocked(readAvailableTornApiKeys).mockResolvedValue([key()]);
  vi.mocked(recordTornKeyUse).mockResolvedValue(undefined);
  vi.mocked(markTornKeyFailure).mockResolvedValue(undefined);
  vi.mocked(fetchTrackedTornResponse).mockImplementation(async () => respond([]));
});
afterEach(() => { vi.restoreAllMocks(); vi.resetAllMocks(); vi.useRealTimers(); });

describe("target availability", () => {
  it.each([15, 16, 70, 71])("rejects unavailable icon %s even if its title changes", id => {
    expect(isViableChainWatchTarget(player(1, [icon(id, "Status")]))).toBe(false);
  });
  it.each(["Hospital", "Jail", "Federal jail", "Traveling to Mexico", "Returning from Japan", "Abroad", "Hiding out in UAE", "Fallen", "Resting in peace"])("rejects %s", title => {
    const id = title.startsWith("Returning") ? 71 : 999;
    expect(isViableChainWatchTarget(player(1, [icon(id, title)]))).toBe(false);
  });
  it("does not filter online/idle players, our faction, or names embedded in other icon descriptions", () => {
    expect(isViableChainWatchTarget(player(1, [icon(8, "Married", "To Hospital_Traveling_Jail")]))).toBe(true);
    expect(isViableChainWatchTarget({ ...player(2), online: "Idle" })).toBe(true);
  });
  it.each([null, {}, { id: 1 }, { id: 1, icons: null }, player(0), player(-1), player(1.5), player(1, [null]), player(1, [{}])])("rejects malformed candidates %j", value => {
    expect(isViableChainWatchTarget(value)).toBe(false);
  });
});

describe("random cursor search", () => {
  it("bundles 100 distinct positions from each end, preserving each cursor's sort direction", () => {
    expect(CHAIN_TARGET_SEARCH_CURSORS).toHaveLength(200);
    expect(new Set(CHAIN_TARGET_SEARCH_CURSORS.map(position => JSON.stringify(position))).size).toBe(200);
    for (const sort of ["ASC", "DESC"]) {
      const positions = CHAIN_TARGET_SEARCH_CURSORS.filter(position => position.sort === sort);
      expect(positions).toHaveLength(100);
      expect(positions[0].cursor).toBeNull();
      expect(positions.filter(position => position.cursor === null)).toHaveLength(1);
      for (const position of positions.slice(1)) {
        expect(JSON.parse(atob(position.cursor!))).toMatchObject({ direction: "next", id: expect.any(Number), name: expect.any(String) });
      }
    }
  });
  it("starts two pages concurrently, uses the Enemy scouting pool, and merges viable IDs", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const releases: ((response: Response) => void)[] = [];
    vi.mocked(fetchTrackedTornResponse).mockImplementation(() => new Promise(resolve => releases.push(resolve)));
    const pending = fetchChainWatchTargets(env);
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases[0](respond([player(1), player(2, [icon(70, "Federal jail")])]));
    releases[1](respond([player(1), player(3)]));
    expect(await pending).toMatchObject({ target_ids: [1, 3], status: "ok", pages_fetched: 2, failed_pages: 0 });
    expect(readAvailableTornApiKeys).toHaveBeenCalledWith(env, "enemy_scouting", expect.any(Number), { includeFallback: false });
    expect(recordTornKeyUse).toHaveBeenCalledWith(env, expect.objectContaining({ id: "one" }), "enemy_scouting", expect.any(Number), 2);
    const calls = vi.mocked(fetchTrackedTornResponse).mock.calls;
    const urls = calls.map(call => new URL(String(call[1])));
    expect(urls[0].searchParams.has("cursor")).toBe(false);
    expect(urls[1].searchParams.get("cursor")).toBe(CHAIN_TARGET_SEARCH_CURSORS[1].cursor);
    for (const [index, url] of urls.entries()) {
      expect(url.origin + url.pathname).toBe("https://api.torn.com/v2/user/search");
      // Pin the equality filter literally so an old level threshold cannot regress unnoticed.
      expect(url.searchParams.get("filters")).toBe("lastActionYearAgo,level:=:1,offences:=:0,notInHospital");
      expect(url.searchParams.get("sort")).toBe(CHAIN_TARGET_SEARCH_CURSORS[index].sort);
      expect(url.searchParams.has("timestamp")).toBe(true);
      expect(url.searchParams.has("offset")).toBe(false);
      expect(url.searchParams.has("key")).toBe(false);
      expect(calls[index][2]).toMatchObject({ headers: { Authorization: "ApiKey test-key-one" } });
      expect(calls[index][3]).toMatchObject({ feature: "chain-watch:targets", keySource: "key_pool:one" });
    }
  });
  it("can select every position across the entire saved pool", async () => {
    const random = vi.spyOn(Math, "random");
    const fetch = vi.mocked(fetchTrackedTornResponse);
    vi.mocked(readAvailableTornApiKeys).mockImplementation(async () => [key()]);
    fetch.mockImplementation(async () => respond([player(5)]));
    for (const [index, position] of CHAIN_TARGET_SEARCH_CURSORS.entries()) {
      fetch.mockClear();
      // Use the middle of each equal-sized selection interval, including the last.
      random.mockReturnValue((index + 0.5) / CHAIN_TARGET_SEARCH_CURSORS.length);
      await fetchChainWatchTargets(env);
      expect(fetch).toHaveBeenCalledTimes(2);
      const selected = fetch.mock.calls.map(call => {
        const params = new URL(String(call[1])).searchParams;
        return { sort: params.get("sort"), cursor: params.get("cursor") };
      });
      expect(selected[0]).toEqual(position);
      expect(selected[1]).not.toEqual(position);
    }
  });
  it("fetches a saved descending cursor with DESC, not the old global ascending sort", async () => {
    const index = CHAIN_TARGET_SEARCH_CURSORS.findIndex(position => position.sort === "DESC" && position.cursor !== null);
    vi.spyOn(Math, "random").mockReturnValue(index / CHAIN_TARGET_SEARCH_CURSORS.length);
    vi.mocked(fetchTrackedTornResponse).mockImplementation(async () => respond([player(5)]));
    await fetchChainWatchTargets(env);
    const url = new URL(String(vi.mocked(fetchTrackedTornResponse).mock.calls[0][1]));
    expect(url.searchParams.get("sort")).toBe("DESC");
    expect(url.searchParams.get("cursor")).toBe(CHAIN_TARGET_SEARCH_CURSORS[index].cursor);
  });
  it("tries different positions after an empty/blocked batch, then stops on success", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.4);
    vi.mocked(fetchTrackedTornResponse)
      .mockResolvedValueOnce(respond([]))
      .mockResolvedValueOnce(respond([player(4, [icon(71, "Hiding out in UAE")])]))
      .mockResolvedValueOnce(respond([player(5)]));
    expect(await fetchChainWatchTargets(env)).toMatchObject({ target_ids: [5], status: "ok", pages_fetched: 4 });
    const cursors = vi.mocked(fetchTrackedTornResponse).mock.calls.map(call => {
      const params = new URL(String(call[1])).searchParams;
      return `${params.get("sort")}:${params.get("cursor")}`;
    });
    expect(new Set(cursors).size).toBe(4);
  });
  it("caps an empty search at six distinct pages", async () => {
    expect(await fetchChainWatchTargets(env)).toMatchObject({ target_ids: [], status: "no_targets", pages_fetched: 6 });
    expect(fetchTrackedTornResponse).toHaveBeenCalledTimes(6);
    const cursors = vi.mocked(fetchTrackedTornResponse).mock.calls.map(call => {
      const params = new URL(String(call[1])).searchParams;
      return `${params.get("sort")}:${params.get("cursor")}`;
    });
    expect(new Set(cursors).size).toBe(6);
  });
  it("keeps usable results when the other page fails", async () => {
    vi.mocked(fetchTrackedTornResponse).mockRejectedValueOnce(new Error("network failed")).mockResolvedValueOnce(respond([player(7)]));
    expect(await fetchChainWatchTargets(env)).toMatchObject({ target_ids: [7], status: "ok", failed_pages: 1, pages_fetched: 2 });
  });
  it("reports malformed upstream data as unavailable, not a successful empty search", async () => {
    vi.mocked(fetchTrackedTornResponse).mockImplementation(async () => Response.json({ search: {} }));
    expect(await fetchChainWatchTargets(env)).toMatchObject({ status: "unavailable", failed_pages: 6 });
  });
  it("does not use environment keys when no Enemy scouting keys are available", async () => {
    vi.mocked(readAvailableTornApiKeys).mockResolvedValue([]);
    expect(await fetchChainWatchTargets({ TORN_API_KEY: "unused" } as Env)).toMatchObject({ status: "unavailable", pages_fetched: 0 });
    expect(fetchTrackedTornResponse).not.toHaveBeenCalled();
  });
  it("respects remaining per-key capacity when allocating concurrent calls", async () => {
    vi.mocked(readAvailableTornApiKeys).mockResolvedValue([key("one", 59), key("two", 59)]);
    expect(await fetchChainWatchTargets(env)).toMatchObject({ status: "unavailable", pages_fetched: 2 });
    expect(recordTornKeyUse).toHaveBeenCalledWith(env, expect.objectContaining({ id: "one" }), "enemy_scouting", expect.any(Number), 1);
    expect(recordTornKeyUse).toHaveBeenCalledWith(env, expect.objectContaining({ id: "two" }), "enemy_scouting", expect.any(Number), 1);
  });
  it.each(["api", "http"])("pauses a rate-limited key (%s) and does not retry it", async kind => {
    vi.mocked(fetchTrackedTornResponse).mockImplementation(async () => kind === "api"
      ? Response.json({ error: { code: 5, error: "Too many requests" } })
      : new Response("Too many requests", { status: 429 }));
    expect(await fetchChainWatchTargets(env)).toMatchObject({ status: "unavailable", pages_fetched: 2 });
    expect(markTornKeyFailure).toHaveBeenCalledTimes(1);
  });
  it("can use another eligible key after a key failure", async () => {
    vi.mocked(readAvailableTornApiKeys).mockResolvedValue([key(), key("two")]);
    vi.mocked(fetchTrackedTornResponse)
      .mockResolvedValueOnce(Response.json({ error: { code: 2 } }))
      .mockResolvedValueOnce(Response.json({ error: { code: 2 } }))
      .mockResolvedValueOnce(respond([player(8)]));
    expect(await fetchChainWatchTargets(env)).toMatchObject({ status: "ok", target_ids: [8], pages_fetched: 4 });
    expect(vi.mocked(fetchTrackedTornResponse).mock.calls[2][3].keySource).toBe("key_pool:two");
  });
  it("accepts healthy search pages that take longer than the former two-second timeout", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    vi.mocked(fetchTrackedTornResponse).mockImplementation((_env, _url, init) => {
      signals.push(init.signal!);
      return new Promise(resolve => setTimeout(() => resolve(respond([player(9)])), 3_500));
    });
    const pending = fetchChainWatchTargets(env);
    await vi.advanceTimersByTimeAsync(3_500);
    expect(await pending).toMatchObject({ status: "ok", target_ids: [9], pages_fetched: 2, failed_pages: 0 });
    expect(signals.every(signal => !signal.aborted)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("bounds stalled response bodies and aborts requests at the overall search deadline", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    vi.mocked(fetchTrackedTornResponse).mockImplementation(async (_env, _url, init) => {
      signals.push(init.signal!);
      return { ok: true, status: 200, json: () => new Promise(() => {}) } as unknown as Response;
    });
    const pending = fetchChainWatchTargets(env);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(await pending).toMatchObject({ status: "timeout", target_ids: [], pages_fetched: 6 });
    expect(signals).toHaveLength(6);
    expect(signals.every(signal => signal.aborted)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
