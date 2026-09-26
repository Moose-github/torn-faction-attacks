import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOME_FACTION_ID } from "../src/constants";
import { parseArmoryDetails, parseArmoryInventory, readArmory, refreshArmoryDetails, syncArmory } from "../src/armory";
import { fetchTrackedTornResponse } from "../src/external/torn";
import type { Env } from "../src/types";
import { routeArmoryApi } from "../src/http/armoryRoutes";

vi.mock("../src/external/torn", () => ({ fetchTrackedTornResponse: vi.fn() }));
const fetcher = vi.mocked(fetchTrackedTornResponse);
const clock = 1_790_467_200;
const detail = (uid: number, special = false) => ({ id: 399, uid, name: "ArmaLite M-15A4", type: "Weapon", sub_type: "Rifle",
  stats: { damage: special ? 74.81 : 68.97, accuracy: 61.03, quality: special ? 108.35 : 16.3 },
  bonuses: special ? [{ id: 50, title: "Achilles", description: "52% increased Foot damage", value: 52 }] : [], rarity: special ? "yellow" : null });
const stock = (uids = [7443497174, 10727704270], timestamp = clock) => ({ inventory_timestamp: timestamp,
  inventory: [{ id: 399, name: "ArmaLite M-15A4", type: "Primary", amount: uids.length, uids, loaned: null }] });

// Real SQLite executes the production SQL, including transactions and conditional leases.
class TestDB {
  sqlite = new DatabaseSync(":memory:");
  constructor() { this.sqlite.exec(readFileSync(new URL("../migrations/0164_create_faction_armory.sql", import.meta.url), "utf8")); }
  prepare(sql: string) {
    const statement = this.sqlite.prepare(sql);
    let bindings: Array<string | number | null> = [];
    const prepared = {
      bind: (...args: Array<string | number | null>) => { bindings = args; return prepared; },
      run: async () => statement.columns().length
        ? { results: statement.all(...bindings), meta: { changes: 0 }, success: true }
        : { results: [], meta: { changes: Number(statement.run(...bindings).changes) }, success: true },
      first: async () => statement.get(...bindings) ?? null,
      all: async () => ({ results: statement.all(...bindings), success: true }),
    };
    return prepared;
  }
  async batch(statements: Array<ReturnType<TestDB["prepare"]>>) {
    this.sqlite.exec("BEGIN");
    try { const results = []; for (const statement of statements) results.push(await statement.run()); this.sqlite.exec("COMMIT"); return results; }
    catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }
}
let db: TestDB, env: Env;
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(clock * 1000); fetcher.mockReset();
  db = new TestDB(); env = { DB: db as unknown as D1Database, TORN_API_KEY: "test-placeholder" } as Env;
  fetcher.mockImplementation(async (_env, input) => {
    const url = String(input);
    return Response.json(url.includes("inventory") ? stock() : { itemdetails: [detail(10727704270, true), detail(7443497174)] });
  });
});
afterEach(() => { db.sqlite.close(); vi.useRealTimers(); });
const advance = () => vi.setSystemTime((clock + 3601) * 1000);

describe("armory validation", () => {
  it("reconciles the supplied first-page fixture without losing borrowers or copies", () => {
    const fixture = JSON.parse(readFileSync(new URL("./fixtures/armory-inventory.json", import.meta.url), "utf8"));
    const { items } = parseArmoryInventory(fixture);
    expect(items).toHaveLength(231);
    expect(items.filter(item => !item.loaned)).toHaveLength(191);
    expect(items.filter(item => item.loaned)).toHaveLength(40);
    expect(new Set(items.flatMap(item => item.loaned ? [item.loaned.id] : [])).size).toBe(20);
    expect(items.find(item => item.uid === "10727704270")?.loaned?.name).toBe("Daz69");
  });
  it("rejects duplicate UIDs and amounts without inventing copies", () => {
    expect(() => parseArmoryInventory(stock([1, 1]))).toThrow("Duplicate");
    const invalid = stock(); invalid.inventory[0].amount = 3;
    expect(() => parseArmoryInventory(invalid)).toThrow("counts");
    expect(() => parseArmoryInventory(stock([Number.MAX_SAFE_INTEGER + 1]))).toThrow();
    expect(() => parseArmoryInventory({})).toThrow();
  });
  it("normalizes singleton and unordered array details, keeping invalid siblings pending", () => {
    expect(parseArmoryDetails({ itemdetails: detail(1) }).get("1")?.bonuses).toEqual([]);
    const parsed = parseArmoryDetails({ itemdetails: [detail(2, true), { ...detail(3), bonuses: undefined }, detail(1)] });
    expect(parsed.get("2")?.bonuses[0].title).toBe("Achilles");
    expect(parsed.has("3")).toBe(false);
    expect(parsed.get("1")?.rarity).toBeNull();
    expect(parseArmoryDetails({ itemdetails: [detail(1), detail(1, true)] }).size).toBe(0);
  });
});

const nextPage = (offset: number) => `https://api.torn.com/v2/faction/inventory?&limit=100&cat=weapons&offset=${offset}`;
const paged = (uids: number[], total: number, next: string | null, timestamp = clock) => ({ ...stock(uids, timestamp),
  _metadata: { total, links: { prev: null, next } } });

describe("complete inventory pagination", () => {
  it("fetches all 162 inventory rows, counting rows separately from their weapon amounts", async () => {
    const first = JSON.parse(readFileSync(new URL("./fixtures/armory-inventory.json", import.meta.url), "utf8"));
    first._metadata.total = 162;
    const second = { inventory_timestamp: first.inventory_timestamp,
      inventory: Array.from({ length: 62 }, (_, index) => stock([90000000000 + index]).inventory[0]),
      _metadata: { total: 162, links: { prev: null, next: null } } };
    fetcher.mockResolvedValueOnce(Response.json(first)).mockResolvedValueOnce(Response.json(second));
    await syncArmory(env);
    const result = await readArmory(env);
    expect(result.items).toHaveLength(293);
    expect(result.items.some(item => item.uid === "90000000061")).toBe(true);
    expect(String(fetcher.mock.calls[1][1])).toContain("offset=100");
    const saved = JSON.parse(String(db.sqlite.prepare("SELECT source_json FROM faction_armory_state").get()!.source_json));
    expect(saved.inventory).toHaveLength(162);
    expect(saved._metadata.links.next).toBeNull();
    const inventoryCalls = () => fetcher.mock.calls.filter(call => String(call[1]).includes("/faction/inventory"));
    expect(inventoryCalls()).toHaveLength(2);
    await syncArmory(env);
    expect(inventoryCalls()).toHaveLength(2);
  });
  it("continues beyond the second page and enriches later-page UIDs", async () => {
    fetcher.mockImplementation(async (_env, input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/inventory")) {
        const offset = Number(url.searchParams.get("offset"));
        return Response.json(paged([offset + 1], 3, offset < 2 ? nextPage(offset + 1) : null));
      }
      return Response.json({ itemdetails: [detail(3, true), detail(2), detail(1)] });
    });
    await syncArmory(env);
    const result = await readArmory(env);
    expect(result.items).toHaveLength(3);
    expect(result.pending).toBe(0);
    expect(result.items.find(item => item.uid === "3")?.details?.bonuses[0].title).toBe("Achilles");
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it.each([
    ["failed last page", () => new Response("{}", { status: 503 })],
    ["missing rows", () => Response.json(paged([], 3, null))],
    ["duplicate UID", () => Response.json(paged([1], 2, null))],
    ["changed timestamp", () => Response.json(paged([2], 2, null, clock + 1))],
    ["changed total", () => Response.json(paged([2], 3, null))],
    ["missing metadata", () => Response.json(stock([2]))],
  ])("retains the previous snapshot after %s", async (_label, response) => {
    await syncArmory(env); advance();
    fetcher.mockResolvedValueOnce(Response.json(paged([1], 2, nextPage(1)))).mockResolvedValueOnce(response());
    await syncArmory(env);
    const result = await readArmory(env);
    expect(result.items.map(item => item.uid).sort()).toEqual(["10727704270", "7443497174"]);
    expect(result.checked_at).toBe(clock);
    expect(result.error).not.toBeNull();
  });
  it.each([nextPage(0), nextPage(2), "https://example.test/v2/faction/inventory?cat=weapons&limit=100&offset=1",
    "https://api.torn.com/v2/faction/inventory?cat=armor&limit=100&offset=1"])("rejects unsafe or non-progressing links: %s", async link => {
    fetcher.mockResolvedValueOnce(Response.json(paged([1], 2, link)));
    await syncArmory(env);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await readArmory(env)).inventory_timestamp).toBeNull();
  });
  it("repairs a previously cached first page immediately but respects failure backoff", async () => {
    await syncArmory(env);
    db.sqlite.prepare("UPDATE faction_armory_state SET source_json = ?").run(JSON.stringify(paged([7443497174, 10727704270], 2, nextPage(1))));
    expect((await readArmory(env)).next_inventory_at).toBe(0);
    fetcher.mockResolvedValueOnce(Response.json(paged([7443497174, 10727704270], 2, nextPage(1))))
      .mockResolvedValueOnce(new Response("{}", { status: 503 }));
    await syncArmory(env);
    const failed = await readArmory(env);
    expect(failed.next_inventory_at).toBe(clock + 60);
    await syncArmory(env); expect(fetcher).toHaveBeenCalledTimes(4);
    vi.setSystemTime((clock + 61) * 1000);
    fetcher.mockResolvedValueOnce(Response.json(paged([7443497174, 10727704270], 2, nextPage(1))))
      .mockResolvedValueOnce(Response.json(paged([8077945671], 2, null)))
      .mockResolvedValueOnce(Response.json({ itemdetails: detail(8077945671) }));
    await syncArmory(env);
    const repaired = await readArmory(env);
    expect(repaired.items).toHaveLength(3);
    expect(repaired.pending).toBe(0);
    expect(repaired.error).toBeNull();
    expect(repaired.next_inventory_at).toBe(clock + 61 + 3600);
  });
  it("renews the lease while fetching a long inventory", async () => {
    fetcher.mockImplementation(async (_env, input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/inventory")) {
        const offset = Number(url.searchParams.get("offset"));
        const lease = db.sqlite.prepare("SELECT lease_until FROM faction_armory_state").get()!;
        expect(Number(lease.lease_until)).toBe(Math.floor(Date.now() / 1000) + 120);
        vi.setSystemTime(Date.now() + 10_000);
        return Response.json(paged([offset + 1], 14, offset < 13 ? nextPage(offset + 1) : null));
      }
      return Response.json({ itemdetails: Array.from({ length: 14 }, (_, index) => detail(index + 1)) });
    });
    await syncArmory(env);
    expect((await readArmory(env)).pending).toBe(0);
    expect((await readArmory(env)).items).toHaveLength(14);
  });
});

describe("armory admin endpoints", () => {
  it.each(["/api/admin/armory", "/api/admin/armory/sync", "/api/admin/armory/details/refresh"])("rejects missing and member sessions for %s", async path => {
    db.sqlite.exec(`CREATE TABLE auth_sessions (token TEXT, torn_user_id INTEGER, access_level TEXT, expires_at INTEGER);
      CREATE TABLE home_faction_members (member_id INTEGER, name TEXT);`);
    const token = crypto.randomUUID();
    db.sqlite.prepare("INSERT INTO auth_sessions VALUES (?, 1, 'member', ?)").run(token, clock + 7200);
    for (const member of [false, true]) {
      const request = new Request(`https://example.test${path}`, { method: path.endsWith("/armory") ? "GET" : "POST",
        headers: member ? { Authorization: `Bearer ${token}` } : {} });
      const response = await routeArmoryApi({ request, url: new URL(request.url), env, ctx: {} as ExecutionContext });
      expect(response?.status).toBe(member ? 403 : 401);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("armory persistent sync", () => {
  it("resolves Secrets Store keys without sending a binding object", async () => {
    env.TORN_API_KEY = { get: async () => "test-secret-value" } as SecretsStoreSecret;
    await syncArmory(env);
    expect(fetcher.mock.calls[0][2].headers).toMatchObject({ Authorization: "ApiKey test-secret-value" });
  });
  it("rejects a cached UID that changes weapon model", async () => {
    await syncArmory(env); advance();
    const changed = stock(); changed.inventory[0].id = 26;
    fetcher.mockResolvedValueOnce(Response.json(changed));
    await syncArmory(env);
    expect((await readArmory(env)).items.every(item => item.id === 399)).toBe(true);
    expect((await readArmory(env)).error).not.toBeNull();
  });
  it("joins out-of-order details by UID and reuses them on warm loads and borrower changes", async () => {
    await syncArmory(env);
    const first = await readArmory(env);
    expect(first.items.find(item => item.uid === "10727704270")?.details?.bonuses[0].title).toBe("Achilles");
    expect(first.pending).toBe(0); expect(first.syncing).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await syncArmory(env); expect(fetcher).toHaveBeenCalledTimes(2);
    advance();
    fetcher.mockResolvedValueOnce(Response.json({ ...stock(), inventory: stock().inventory.map(row => ({ ...row, loaned: { id: 2332935, name: "Daz69" } })) }));
    await syncArmory(env);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect((await readArmory(env)).items[0].loaned?.name).toBe("Daz69");
  });
  it("fetches only a new UID and retains details across departure and return", async () => {
    await syncArmory(env); advance();
    fetcher.mockResolvedValueOnce(Response.json(stock([7443497174, 10727704270, 8077945671], clock + 3600)))
      .mockResolvedValueOnce(Response.json({ itemdetails: detail(8077945671) }));
    await syncArmory(env);
    expect(String(fetcher.mock.calls[3][1])).toContain("/8077945671/itemdetails");
    vi.setSystemTime((clock + 7202) * 1000);
    fetcher.mockResolvedValueOnce(Response.json(stock([], clock + 7200)));
    await syncArmory(env); expect((await readArmory(env)).items).toHaveLength(0);
    vi.setSystemTime((clock + 10803) * 1000);
    fetcher.mockResolvedValueOnce(Response.json(stock([8077945671], clock + 10800)));
    await syncArmory(env); expect(fetcher).toHaveBeenCalledTimes(6);
    expect((await readArmory(env)).pending).toBe(0);
  });
  it("preserves valid inventory on malformed, older and failed responses", async () => {
    await syncArmory(env); advance();
    for (const response of [stock([1, 1]), stock([], clock - 1), { error: { code: 17, error: "upstream failed" } }]) {
      db.sqlite.exec("UPDATE faction_armory_state SET next_inventory_at = 0");
      fetcher.mockResolvedValueOnce(Response.json(response));
      await syncArmory(env);
      const saved = await readArmory(env);
      expect(saved.items).toHaveLength(2); expect(saved.inventory_timestamp).toBe(clock); expect(saved.error).not.toBeNull();
    }
  });
  it("persists valid siblings and retries only missing or mismatched details after backoff", async () => {
    fetcher.mockResolvedValueOnce(Response.json(stock()))
      .mockResolvedValueOnce(Response.json({ itemdetails: [detail(7443497174), { ...detail(10727704270), id: 26 }] }));
    await syncArmory(env); expect((await readArmory(env)).pending).toBe(1);
    await syncArmory(env); expect(fetcher).toHaveBeenCalledTimes(2);
    vi.setSystemTime((clock + 61) * 1000);
    fetcher.mockResolvedValueOnce(Response.json({ itemdetails: detail(10727704270, true) }));
    await syncArmory(env); expect(String(fetcher.mock.calls[2][1])).toContain("/10727704270/itemdetails");
    expect((await readArmory(env)).pending).toBe(0);
  });
  it("deduplicates concurrent requests with the database lease", async () => {
    let resolve!: (value: Response) => void;
    fetcher.mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }));
    const first = syncArmory(env);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const concurrent = await syncArmory(env);
    expect((await concurrent.json() as { syncing: boolean }).syncing).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    resolve(Response.json(stock())); await first;
    expect((await readArmory(env)).pending).toBe(0);
  });
  it("prevents an expired lease holder replacing data after a new owner takes over", async () => {
    let resolve!: (value: Response) => void;
    fetcher.mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }));
    const old = syncArmory(env);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    vi.setSystemTime((clock + 121) * 1000);
    fetcher.mockResolvedValueOnce(Response.json(stock([], clock + 120)));
    await syncArmory(env);
    resolve(Response.json(stock())); await old;
    expect((await readArmory(env)).items).toHaveLength(0);
    expect((await readArmory(env)).inventory_timestamp).toBe(clock + 120);
  });
  it("schedules explicit detail refresh once while retaining cached stats", async () => {
    await syncArmory(env); await refreshArmoryDetails(env); await refreshArmoryDetails(env);
    const refreshing = await readArmory(env);
    expect(refreshing.refreshing).toBe(2); expect(refreshing.pending).toBe(0);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await syncArmory(env); expect(fetcher).toHaveBeenCalledTimes(3);
    expect((await readArmory(env)).refreshing).toBe(0);
    await refreshArmoryDetails(env); expect((await readArmory(env)).refreshing).toBe(0);
  });
  it("bounds initial enrichment to four batches and resumes remaining work", async () => {
    const ids = Array.from({ length: 231 }, (_, index) => index + 100);
    fetcher.mockImplementation(async (_env, input) => {
      const url = String(input);
      if (url.includes("inventory")) return Response.json(stock(ids));
      const uids = url.split("/").at(-2)!.split(",");
      expect(uids.length).toBeLessThanOrEqual(25);
      return Response.json({ itemdetails: uids.reverse().map(uid => detail(Number(uid))) });
    });
    await syncArmory(env); expect(fetcher).toHaveBeenCalledTimes(5); expect((await readArmory(env)).pending).toBe(131);
    await syncArmory(env); await syncArmory(env);
    expect(fetcher).toHaveBeenCalledTimes(11); expect((await readArmory(env)).pending).toBe(0);
  });
  it("respects rate-limit retry headers and stops key-error retries", async () => {
    fetcher.mockResolvedValueOnce(new Response("{}", { status: 429, headers: { "Retry-After": "900" } }));
    await syncArmory(env); await syncArmory(env);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await readArmory(env)).next_sync_at).toBe(clock + 900);
    vi.setSystemTime((clock + 901) * 1000);
    fetcher.mockResolvedValueOnce(Response.json({ error: { code: 16 } }));
    await syncArmory(env);
    expect((await readArmory(env)).error).toContain("permissions");
    expect((await readArmory(env)).next_inventory_at).toBe(clock + 901 + 3600);
  });
  it("also defers inventory when a detail response rate-limits the shared key", async () => {
    fetcher.mockResolvedValueOnce(Response.json(stock()))
      .mockResolvedValueOnce(new Response("{}", { status: 429, headers: { "Retry-After": "7200" } }));
    await syncArmory(env); advance(); await syncArmory(env);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect((await readArmory(env)).next_sync_at).toBe(clock + 7200);
  });
  it("keeps inventory isolated to the home faction", async () => {
    await syncArmory(env);
    expect(db.sqlite.prepare("SELECT DISTINCT faction_id FROM faction_armory_inventory").all()).toEqual([{ faction_id: HOME_FACTION_ID }]);
  });
});
