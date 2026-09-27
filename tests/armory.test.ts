import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOME_FACTION_ID } from "../src/constants";
import { parseArmoryDetails, parseArmoryInventory, parseMedicalInventory, readMedicalArmory, readArmory, refreshArmoryDetails, syncArmory } from "../src/armory";
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
  constructor() {
    for (const file of ["0164_create_faction_armory.sql", "0165_track_armory_loan_observations.sql", "0166_add_armory_categories.sql", "0167_add_armory_medical.sql"]) {
      this.sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
    }
  }
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

const armorDetail = (uid = 18059712452) => ({ id: 668, name: "Assault Boots", uid, type: "Armor", sub_type: null,
  stats: { damage: null, accuracy: null, armor: 47.15, quality: 23.08 },
  bonuses: [{ id: 17, title: "Impenetrable", description: "22% decreased incoming bullet damage", value: 22 }], rarity: "yellow" });
const armorStock = (loaned: { id: number; name: string } | null = { id: 4002200, name: "Minitamark" }) => ({ inventory_timestamp: clock,
  inventory: [{ id: 668, name: "Assault Boots", type: "Defensive", amount: 1, uids: [18059712452], loaned }] });

describe("armor inventory and category isolation", () => {
  it("parses armor stats, null subtype and bonuses from the supplied detail format", () => {
    const parsed = parseArmoryDetails({ itemdetails: armorDetail() });
    expect(parsed.get("18059712452")).toEqual({ ...armorDetail(), uid: "18059712452" });
    expect(parseArmoryDetails({ itemdetails: { ...armorDetail(), stats: { ...armorDetail().stats, armor: null } } }).size).toBe(0);
  });
  it("follows all armor pages without switching categories and reuses enriched UIDs", async () => {
    const first = JSON.parse(readFileSync(new URL("./fixtures/armory-armor-inventory.json", import.meta.url), "utf8"));
    const second = { inventory_timestamp: first.inventory_timestamp,
      inventory: Array.from({ length: 19 }, (_, index) => ({ ...armorStock().inventory[0], uids: [91000000000 + index] })),
      _metadata: { total: 119, links: { prev: null, next: "https://api.torn.com/v2/faction/inventory?cat=armor&offset=200&limit=100" } } };
    const modelByUid = new Map([...first.inventory, ...second.inventory].flatMap(row => row.uids.map((uid: number) => [String(uid), row.id])));
    fetcher.mockImplementation(async (_env, input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/inventory")) {
        expect(url.searchParams.get("cat")).toBe("armor");
        return Response.json(url.searchParams.get("offset") === "0" ? first : second);
      }
      const uids = url.pathname.split("/").at(-2)!.split(",");
      return Response.json({ itemdetails: uids.map(uid => ({ ...armorDetail(Number(uid)), id: modelByUid.get(uid) })) });
    });
    await syncArmory(env, "armor");
    for (let attempt = 0; attempt < 4 && (await readArmory(env, "armor")).pending; attempt++) await syncArmory(env, "armor");
    const result = await readArmory(env, "armor");
    expect(result.items).toHaveLength(parseArmoryInventory(first).items.length + 19);
    expect(result.items.find(item => item.uid === "18059712452")).toMatchObject({ details: { stats: { armor: 47.15, damage: null } }, loan_first_seen_at: clock });
    expect(result.error).toBeNull();
    expect(result.pending).toBe(0);
    expect(fetcher.mock.calls.filter(call => String(call[1]).includes("/inventory"))).toHaveLength(2);
    const calls = fetcher.mock.calls.length;
    await syncArmory(env, "armor");
    expect(fetcher.mock.calls).toHaveLength(calls);
    expect((await readArmory(env)).items).toEqual([]);
  });
  it("isolates snapshots, leases, detail refreshes and current loans between categories", async () => {
    await syncArmory(env);
    const weapons = await readArmory(env);
    fetcher.mockResolvedValueOnce(Response.json(armorStock())).mockResolvedValueOnce(Response.json({ itemdetails: armorDetail() }));
    await syncArmory(env, "armor");
    expect(await readArmory(env)).toEqual(weapons);
    const armor = await readArmory(env, "armor");
    expect(armor.items).toHaveLength(1);
    expect(armor.items[0].loan_first_seen_at).toBe(clock);
    await refreshArmoryDetails(env, "armor");
    expect((await readArmory(env, "armor")).refreshing).toBe(1);
    expect((await readArmory(env)).refreshing).toBe(0);
    advance();
    // An active weapons lease must not prevent an armor refresh.
    db.sqlite.exec(`UPDATE faction_armory_state SET lease_until = ${clock + 10000} WHERE category = 'weapons'`);
    fetcher.mockResolvedValueOnce(Response.json(armorStock())).mockResolvedValueOnce(Response.json({ itemdetails: armorDetail() }));
    await syncArmory(env, "armor");
    expect((await readArmory(env, "armor")).items[0].loan_first_seen_at).toBe(clock);
    vi.setSystemTime((clock + 7202) * 1000);
    fetcher.mockResolvedValueOnce(Response.json({ ...armorStock(), inventory: [] }));
    await syncArmory(env, "armor");
    expect((await readArmory(env, "armor")).items).toEqual([]);
    expect((await readArmory(env)).items).toEqual(weapons.items);
  });
  it("retains saved armor on failure and rejects links to a different category", async () => {
    fetcher.mockResolvedValueOnce(Response.json(armorStock())).mockResolvedValueOnce(Response.json({ itemdetails: armorDetail() }));
    await syncArmory(env, "armor");
    advance();
    fetcher.mockResolvedValueOnce(Response.json({ ...armorStock(null), _metadata: { total: 2, links: { next: nextPage(1), prev: null } } }));
    await syncArmory(env, "armor");
    const result = await readArmory(env, "armor");
    expect(result.error).not.toBeNull();
    expect(result.items[0]).toMatchObject({ loaned: { id: 4002200 }, loan_first_seen_at: clock });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("rejects weapon details returned for armor and overlapping inventory UIDs", async () => {
    fetcher.mockResolvedValueOnce(Response.json(armorStock())).mockResolvedValueOnce(Response.json({ itemdetails: { ...detail(18059712452), id: 668 } }));
    await syncArmory(env, "armor");
    expect((await readArmory(env, "armor")).pending).toBe(1);
    const armor = (await readArmory(env, "armor")).items;
    fetcher.mockResolvedValueOnce(Response.json(armorStock()));
    await syncArmory(env);
    expect((await readArmory(env)).items).toEqual([]);
    expect((await readArmory(env)).error).not.toBeNull();
    expect((await readArmory(env, "armor")).items).toEqual(armor);
  });
  it("migrates existing weapon state and loan observations without resetting them", () => {
    const legacy = new DatabaseSync(":memory:");
    try {
      for (const file of ["0164_create_faction_armory.sql", "0165_track_armory_loan_observations.sql"]) {
        legacy.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
      }
      legacy.exec(`INSERT INTO faction_armory_state (faction_id, inventory_timestamp, checked_at, source_json) VALUES (8803, 123, 456, '{}');
        INSERT INTO faction_armory_inventory (faction_id, uid, model_id, name, slot_type, borrower_id, borrower_name, loan_first_seen_at)
        VALUES (8803, '123', 399, 'ArmaLite', 'Primary', 42, 'Borrower', 100);`);
      legacy.exec(readFileSync(new URL("../migrations/0166_add_armory_categories.sql", import.meta.url), "utf8"));
      expect(legacy.prepare("SELECT * FROM faction_armory_state").get()).toMatchObject({ category: "weapons", inventory_timestamp: 123, checked_at: 456, source_json: "{}" });
      expect(legacy.prepare("SELECT * FROM faction_armory_inventory").get()).toMatchObject({ category: "weapons", borrower_id: 42, loan_first_seen_at: 100 });
      legacy.exec("INSERT INTO faction_armory_state (faction_id, category) VALUES (8803, 'armor')");
      expect(legacy.prepare("SELECT COUNT(*) AS count FROM faction_armory_state").get()).toEqual({ count: 2 });
      const existingState = legacy.prepare("SELECT * FROM faction_armory_state ORDER BY category").all();
      legacy.exec(readFileSync(new URL("../migrations/0167_add_armory_medical.sql", import.meta.url), "utf8"));
      expect(legacy.prepare("SELECT * FROM faction_armory_state ORDER BY category").all()).toEqual(existingState);
      expect(legacy.prepare("SELECT * FROM faction_armory_inventory").get()).toMatchObject({ category: "weapons", borrower_id: 42, loan_first_seen_at: 100 });
      legacy.exec("INSERT INTO faction_armory_state (faction_id, category) VALUES (8803, 'medical')");
    } finally { legacy.close(); }
  });
});

describe("medical stacks", () => {
  const sample = () => JSON.parse(readFileSync(new URL("./fixtures/armory-medical-inventory.json", import.meta.url), "utf8"));
  it("preserves quantities and separate available/borrowed stock without UIDs or loan dates", async () => {
    fetcher.mockResolvedValueOnce(Response.json(sample()));
    await syncArmory(env, "medical");
    const result = await readMedicalArmory(env);
    expect(result.items).toHaveLength(16);
    expect(result.items.reduce((sum, item) => sum + item.amount, 0)).toBe(48527);
    expect(result.items.filter(item => item.id === 1012)).toEqual([
      { id: 1012, name: "Blood Bag : Irradiated", type: "Medical", amount: 35, loaned: null },
      { id: 1012, name: "Blood Bag : Irradiated", type: "Medical", amount: 1, loaned: { id: 2625483, name: "Sunjuggler" } },
    ]);
    expect(result).toMatchObject({ pending: 0, refreshing: 0, error: null, syncing: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0][1])).toContain("cat=medical");
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM faction_armory_inventory").get()).toEqual({ count: 0 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM armory_weapon_details").get()).toEqual({ count: 0 });
    await syncArmory(env, "medical");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("follows all pages and combines only stacks with the same model and borrower", async () => {
    const row = sample().inventory[6];
    const loan = sample().inventory[7];
    fetcher.mockResolvedValueOnce(Response.json({ inventory_timestamp: clock, inventory: [row],
      _metadata: { total: 3, links: { next: "https://api.torn.com/v2/faction/inventory?cat=medical&limit=1&offset=1", prev: null } } }))
      .mockResolvedValueOnce(Response.json({ inventory_timestamp: clock, inventory: [{ ...row, amount: 5 }, loan],
        _metadata: { total: 3, links: { next: "https://api.torn.com/v2/faction/inventory?cat=medical&limit=2&offset=3", prev: null } } }));
    await syncArmory(env, "medical");
    expect((await readMedicalArmory(env)).items.map(item => item.amount)).toEqual([40, 1]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("replaces quantities and current loans without touching equipment snapshots", async () => {
    await syncArmory(env);
    const weapons = await readArmory(env);
    fetcher.mockResolvedValueOnce(Response.json(armorStock())).mockResolvedValueOnce(Response.json({ itemdetails: armorDetail() }));
    await syncArmory(env, "armor");
    const armor = await readArmory(env, "armor");
    fetcher.mockResolvedValueOnce(Response.json(sample()));
    await syncArmory(env, "medical");
    advance();
    fetcher.mockResolvedValueOnce(Response.json({ ...sample(), inventory: [{ ...sample().inventory[6], amount: 36 }],
      _metadata: { total: 1, links: { next: null, prev: null } } }));
    await syncArmory(env, "medical");
    expect((await readMedicalArmory(env)).items).toEqual([{ id: 1012, name: "Blood Bag : Irradiated", type: "Medical", amount: 36, loaned: null }]);
    expect(await readArmory(env)).toEqual(weapons);
    expect(await readArmory(env, "armor")).toEqual(armor);
    expect(fetcher.mock.calls.filter(call => String(call[1]).includes("itemdetails"))).toHaveLength(2);
  });
  it("retains medical stock after malformed, older, incomplete and failed refreshes", async () => {
    fetcher.mockResolvedValueOnce(Response.json(sample()));
    await syncArmory(env, "medical");
    const original = (await readMedicalArmory(env)).items;
    for (const payload of [
      { ...sample(), inventory: [{ ...sample().inventory[0], amount: -1 }] },
      { ...sample(), inventory_timestamp: clock - 1 },
      { ...sample(), _metadata: { total: 17, links: { next: null, prev: null } } },
      { error: { code: 17 } },
    ]) {
      db.sqlite.exec("UPDATE faction_armory_state SET next_inventory_at = 0 WHERE category = 'medical'");
      fetcher.mockResolvedValueOnce(Response.json(payload));
      await syncArmory(env, "medical");
      const result = await readMedicalArmory(env);
      expect(result.items).toEqual(original);
      expect(result.error).not.toBeNull();
    }
  });
  it("handles an empty stock snapshot and respects API rate limit backoff", async () => {
    fetcher.mockResolvedValueOnce(new Response("{}", { status: 429, headers: { "Retry-After": "900" } }));
    await syncArmory(env, "medical");
    await syncArmory(env, "medical");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await readMedicalArmory(env)).next_sync_at).toBe(clock + 900);
    vi.setSystemTime((clock + 901) * 1000);
    fetcher.mockResolvedValueOnce(Response.json({ ...sample(), inventory: [], _metadata: { total: 0, links: { next: null, prev: null } } }));
    await syncArmory(env, "medical");
    expect(await readMedicalArmory(env)).toMatchObject({ items: [], error: null, pending: 0 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("validates stack counts and borrowers independently of equipment UIDs", () => {
    for (const amount of [-1, 1.5, "12", Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => parseMedicalInventory({ ...sample(), inventory: [{ ...sample().inventory[0], amount }] })).toThrow();
    }
    expect(() => parseMedicalInventory({ ...sample(), inventory: [{ ...sample().inventory[0], loaned: { id: 0, name: "Invalid" } }] })).toThrow();
    expect(() => parseArmoryInventory(sample())).toThrow();
  });
});

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
  it("fetches all 162 rows and stops at the total even when Torn returns an extra next link", async () => {
    const first = JSON.parse(readFileSync(new URL("./fixtures/armory-inventory.json", import.meta.url), "utf8"));
    first._metadata.total = 162;
    const second = { inventory_timestamp: first.inventory_timestamp,
      inventory: Array.from({ length: 62 }, (_, index) => stock([90000000000 + index]).inventory[0]),
      _metadata: { total: 162, links: { prev: null, next: nextPage(200) } } };
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
  it("accepts an empty inventory even if Torn supplies a next link", async () => {
    fetcher.mockResolvedValueOnce(Response.json({ inventory_timestamp: clock, inventory: [],
      _metadata: { total: 0, links: { prev: null, next: nextPage(100) } } }));
    await syncArmory(env);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const result = await readArmory(env);
    expect(result.items).toEqual([]);
    expect(result.error).toBeNull();
  });
  it("rejects an empty page before reaching the reported total", async () => {
    fetcher.mockResolvedValueOnce(Response.json(paged([1], 2, nextPage(1))))
      .mockResolvedValueOnce(Response.json({ inventory_timestamp: clock, inventory: [],
        _metadata: { total: 2, links: { prev: null, next: nextPage(101) } } }));
    await syncArmory(env);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect((await readArmory(env)).inventory_timestamp).toBeNull();
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

describe("current loan observations", () => {
  const loan = (id = 2332935, name = "Daz69") => ({ ...stock(),
    inventory: stock().inventory.map(row => ({ ...row, loaned: { id, name } })) });
  async function observe(payload: unknown, seconds: number) {
    vi.setSystemTime((clock + seconds) * 1000);
    db.sqlite.exec("UPDATE faction_armory_state SET next_inventory_at = 0");
    fetcher.mockResolvedValueOnce(Response.json(payload));
    await syncArmory(env);
    return (await readArmory(env)).items;
  }
  it("starts when fetched, persists across refreshes and renames, and resets for a different holder", async () => {
    const first = await observe(loan(), 30);
    expect(first.every(item => item.loan_first_seen_at === clock + 30)).toBe(true);
    expect((await observe(loan(2332935, "Renamed"), 3631))[0]).toMatchObject({
      loaned: { id: 2332935, name: "Renamed" }, loan_first_seen_at: clock + 30 });
    expect((await observe(loan(2, "Other"), 7232))[0].loan_first_seen_at).toBe(clock + 7232);
  });
  it("clears returned loans and restarts for the same borrower after return or removal", async () => {
    await observe(loan(), 0);
    expect((await observe(stock(), 3601)).every(item => item.loan_first_seen_at === null)).toBe(true);
    expect((await observe(loan(), 7202))[0].loan_first_seen_at).toBe(clock + 7202);
    expect(await observe(stock([]), 10803)).toEqual([]);
    expect((await observe(loan(), 14404))[0].loan_first_seen_at).toBe(clock + 14404);
  });
  it("retains holder and time through malformed, older and failed inventory responses", async () => {
    await observe(loan(), 0);
    for (const payload of [stock([1, 1]), stock([], clock - 1), { error: { code: 17 } }]) {
      const items = await observe(payload, 3601);
      expect(items).toHaveLength(2);
      expect(items.every(item => item.loaned?.id === 2332935 && item.loan_first_seen_at === clock)).toBe(true);
    }
  });
  it("initializes legacy loans only on a successful inventory observation", async () => {
    await observe(loan(), 0);
    db.sqlite.exec("UPDATE faction_armory_inventory SET loan_first_seen_at = NULL");
    expect((await readArmory(env)).items[0].loan_first_seen_at).toBeNull();
    expect((await observe({ error: { code: 17 } }, 3601))[0].loan_first_seen_at).toBeNull();
    expect((await observe(loan(), 7202))[0].loan_first_seen_at).toBe(clock + 7202);
  });
  it("tracks different copies independently before their details are known", async () => {
    fetcher.mockImplementation(async () => Response.json({ itemdetails: [] }));
    const payload = { ...stock(), inventory: [
      { ...stock([7443497174]).inventory[0], loaned: { id: 1, name: "First" } },
      stock([10727704270]).inventory[0],
    ] };
    const first = await observe(payload, 0);
    expect(first.find(item => item.uid === "7443497174")).toMatchObject({ details: null, loan_first_seen_at: clock });
    expect(first.find(item => item.uid === "10727704270")?.loan_first_seen_at).toBeNull();
    const next = await observe(loan(1, "First"), 3601);
    expect(next.find(item => item.uid === "7443497174")?.loan_first_seen_at).toBe(clock);
    expect(next.find(item => item.uid === "10727704270")?.loan_first_seen_at).toBe(clock + 3601);
  });
});

describe("armory admin endpoints", () => {
  it.each(["/api/admin/armory", "/api/admin/armory/sync", "/api/admin/armory/details/refresh"].flatMap(path => [path, `${path}?cat=armor`, `${path}?cat=medical`]))("rejects missing and member sessions for %s", async path => {
    db.sqlite.exec(`CREATE TABLE auth_sessions (token TEXT, torn_user_id INTEGER, access_level TEXT, expires_at INTEGER);
      CREATE TABLE home_faction_members (member_id INTEGER, name TEXT);`);
    const token = crypto.randomUUID();
    db.sqlite.prepare("INSERT INTO auth_sessions VALUES (?, 1, 'member', ?)").run(token, clock + 7200);
    for (const member of [false, true]) {
      const request = new Request(`https://example.test${path}`, { method: path.split("?")[0].endsWith("/armory") ? "GET" : "POST",
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
