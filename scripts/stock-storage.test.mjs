import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getStocks, getStockHistory, refreshTornStockMarketMinute, runStockStorageMaintenance, updateStockBenefitDisabledStockFromRequest } from "../src/stockMarket";
import { resetStockPaperAccount, runLiveStockPaperBotTick, getStockPaperStatus } from "../src/stockPaperTrading";
import { readLatestStockRun, readStockCoverage, readStockLastError } from "../src/dataHealth/queries";
import { DEFAULT_DATA_HEALTH_SETTINGS } from "../src/dataHealth/model";
import { stockMaintenanceResponse } from "../src/stockStorage";
import stockWorker from "../workers/stock-market/src/index";
import { withTornKeyPool } from "../src/tornKeyPool";
import { fetchTrackedTornJson } from "../src/external/torn";

vi.mock("../src/tornKeyPool", () => ({ withTornKeyPool: vi.fn((_env, options) => options.run({ key: "test", keySource: "test" })) }));
vi.mock("../src/external/torn", () => ({ fetchTrackedTornJson: vi.fn() }));

const databases = [];
afterEach(() => { databases.splice(0).forEach(db => db.close()); vi.clearAllMocks(); });

function database(schema) {
  const sqlite = new DatabaseSync(":memory:");
  databases.push(sqlite);
  sqlite.exec("PRAGMA foreign_keys=ON;");
  sqlite.exec(schema);
  class Statement {
    constructor(sql, values = []) { this.sql = sql; this.values = values; }
    bind(...values) { return new Statement(this.sql, values); }
    execute() {
      const before = sqlite.prepare("SELECT total_changes() AS n").get().n;
      const results = sqlite.prepare(this.sql).all(...this.values);
      return { success: true, results, meta: { changes: sqlite.prepare("SELECT total_changes() AS n").get().n - before } };
    }
    async all() { return this.execute(); }
    async run() { return this.execute(); }
    async first() { return this.execute().results[0] ?? null; }
  }
  return { sqlite, prepare: sql => new Statement(sql), async batch(statements) {
    sqlite.exec("BEGIN");
    try { const result = statements.map(s => s.execute()); sqlite.exec("COMMIT"); return result; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } };
}

function environment() {
  return {
    DB: database("CREATE TABLE sync_state(name TEXT PRIMARY KEY, last_started INTEGER NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP, active_war_id INTEGER, war_state TEXT DEFAULT 'none');"),
    STOCK_DB: database(readFileSync(new URL("../stock-migrations/0001_stock_schema.sql", import.meta.url), "utf8")),
  };
}

async function ingest(env) {
  vi.mocked(fetchTrackedTornJson).mockResolvedValue({ stocks: [{ id: 1, name: "Test stock", acronym: "TEST", current_price: 100, market_cap: 100000, total_shares: 1000, investors: 10 }] });
  return refreshTornStockMarketMinute(env, Date.now());
}

describe("separate stock database", () => {
  it("ingests into stock storage while keeping API coordination and sync state in core", async () => {
    const env = environment();
    expect((await ingest(env)).status).toBe("ok");
    expect(env.STOCK_DB.sqlite.prepare("SELECT COUNT(*) AS n FROM stock_price_snapshots").get().n).toBe(1);
    expect(env.DB.sqlite.prepare("SELECT name FROM sync_state").get().name).toBe("stock_market_profiles_refreshed");
    expect(withTornKeyPool.mock.calls[0][0].DB).toBe(env.DB);
    expect(fetchTrackedTornJson.mock.calls[0][0].DB).toBe(env.DB);
    expect(() => env.DB.sqlite.prepare("SELECT * FROM stock_profiles")).toThrow();
    expect(() => env.STOCK_DB.sqlite.prepare("SELECT * FROM sync_state")).toThrow();
  });

  it("serves history and health from stock storage and preserves paper account operations", async () => {
    const env = environment();
    await ingest(env);
    expect((await (await getStocks(env)).json()).stocks).toHaveLength(1);
    expect((await (await getStockHistory(new URL("https://example.test/api/stocks/1/history"), env, 1)).json()).history).toHaveLength(1);
    expect((await readLatestStockRun(env)).status).toBe("ok");
    expect((await readStockCoverage(env, Math.floor(Date.now()/1000), DEFAULT_DATA_HEALTH_SETTINGS)).total_stocks).toBe(1);
    expect(await readStockLastError(env)).toBeNull();
    const reset = await resetStockPaperAccount(new Request("https://example.test/api/admin/stocks/paper/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ starting_cash: 5000 }) }), env);
    expect(reset.status).toBe(200);
    expect(env.STOCK_DB.sqlite.prepare("SELECT cash_balance FROM stock_paper_accounts WHERE id='stock-paper-live'").get().cash_balance).toBe(5000);
    await runLiveStockPaperBotTick(env, Date.now());
    expect((await getStockPaperStatus(env)).status).toBe(200);
    await runStockStorageMaintenance(env, Date.now() + 2 * 24 * 60 * 60 * 1000);
    expect(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM sync_state").get().n).toBeGreaterThan(1);
  });

  it("keeps member preferences in stock storage", async () => {
    const env = environment();
    env.STOCK_DB.sqlite.prepare("INSERT INTO stock_profiles(stock_id,name,current_price,benefit_json,updated_at) VALUES(1,'Test',100,?,1)").run(JSON.stringify({ passive: false, frequency: 7, requirement: 100, description: "1x Mystery Box" }));
    const response = await updateStockBenefitDisabledStockFromRequest(new Request("https://example.test/api/stocks/benefit-disabled-stocks/1", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ disabled: true }) }), env, 123, 1);
    expect(response.status).toBe(200);
    expect(env.STOCK_DB.sqlite.prepare("SELECT torn_user_id FROM stock_benefit_disabled_stocks").get().torn_user_id).toBe(123);
  });

  it("reapplies the baseline without changing data and matches the canonical stock schema", () => {
    const env = environment();
    env.STOCK_DB.sqlite.exec("INSERT INTO stock_profiles(stock_id,updated_at) VALUES(1,1)");
    env.STOCK_DB.sqlite.exec(readFileSync(new URL("../stock-migrations/0001_stock_schema.sql", import.meta.url), "utf8"));
    const canonical = database(readFileSync(new URL("../schema/stocks.sql", import.meta.url), "utf8"));
    const objects = db => db.sqlite.prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type,name").all().map(o => ({ ...o, sql: o.sql.replaceAll("IF NOT EXISTS ", "") }));
    expect(objects(env.STOCK_DB)).toEqual(objects(canonical));
    expect(env.STOCK_DB.sqlite.prepare("SELECT COUNT(*) AS n FROM stock_profiles").get().n).toBe(1);
    expect(env.STOCK_DB.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});

describe("stock cutover pause", () => {
  it("blocks all stock routes without blocking core routes", () => {
    for (const path of ["/api/stocks", "/api/stocks/benefit-values/test", "/api/admin/stocks/paper/reset"]) {
      const response = stockMaintenanceResponse(new URL(`https://example.test${path}`), { STOCK_STORAGE_PAUSED: "true" });
      expect(response.status).toBe(503);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    }
    expect(stockMaintenanceResponse(new URL("https://example.test/api/wars"), { STOCK_STORAGE_PAUSED: "true" })).toBeNull();
    expect(stockMaintenanceResponse(new URL("https://example.test/api/stocks"), { STOCK_STORAGE_PAUSED: "false" })).toBeNull();
  });

  it("does not access either database or the Torn API when cron is paused", async () => {
    let pending;
    await stockWorker.scheduled({ scheduledTime: Date.now() }, { STOCK_STORAGE_PAUSED: "true" }, { waitUntil: work => { pending = work; } });
    await pending;
    expect(withTornKeyPool).not.toHaveBeenCalled();
  });
});
