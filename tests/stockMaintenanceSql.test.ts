import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { runStockStorageMaintenance } from "../src/stockMarket";
import type { Env } from "../src/types";

const day = 86400;
const hour = 3600;
const today = Date.UTC(2026, 10, 2) / 1000;
const yesterday = today - day;
let clock: number;
let db: DatabaseSync;
let env: Env;
let writes: Array<{ sql: string; args: SQLInputValue[] }>;
let failOn: string | undefined;

beforeEach(() => {
  clock = today + 7 * hour + 420;
  writes = [];
  failOn = undefined;
  db = new DatabaseSync(":memory:");
  db.function("unixepoch", () => clock);
  db.exec(readFileSync(new URL("../schema/current.sql", import.meta.url), "utf8"));
  db.exec("INSERT INTO stock_profiles(stock_id,updated_at) VALUES(1,0),(2,0)");
  env = { DB: { prepare(sql: string) {
    let args: SQLInputValue[] = [];
    const statement = {
      bind(...values: SQLInputValue[]) { args = values; return statement; },
      async first() { return db.prepare(sql).get(...args) ?? null; },
      async run() {
        writes.push({ sql, args });
        if (failOn && sql.includes(failOn)) throw new Error("Injected write failure");
        return { success: true, meta: { changes: Number(db.prepare(sql).run(...args).changes) } };
      },
    };
    return statement;
  } } } as unknown as Env;
  env.STOCK_DB = env.DB;
});
afterEach(() => db.close());

function point(stock: number, time: number, price: number) {
  db.prepare("INSERT INTO stock_price_snapshots(stock_id,observed_at,price,fetched_at) VALUES(?,?,?,?)")
    .run(stock, time, price, clock);
}
function seed() {
  for (const stock of [1, 2]) {
    point(stock, yesterday + 60, 10);
    point(stock, yesterday + 120, 20);
    point(stock, yesterday + hour, 30);
  }
  db.prepare("INSERT INTO stock_ingestion_runs(id,batch_group,started_at,status,points_written) VALUES('run','minute',?,'running',6)").run(yesterday);
}
const run = () => runStockStorageMaintenance(env, clock * 1000);
const rows = (table: string) => db.prepare(`SELECT * FROM ${table} ORDER BY 1,2`).all();

it("writes no unchanged stock or ingestion aggregates and preserves their update times", async () => {
  seed();
  const first = await run();
  expect(first.hourly_rollups.changed_rows).toBe(4);
  expect(first.daily_rollups.changed_rows).toBe(2);
  expect(first.ingestion_run_daily_stats.changed_rows).toBe(1);
  const tables = ["stock_price_rollups_hourly", "stock_price_rollups_daily", "stock_ingestion_run_daily_stats"];
  const before = tables.map(rows);
  clock += 60;
  const second = await run();
  expect(second.hourly_rollups.changed_rows).toBe(0);
  expect(second.daily_rollups.changed_rows).toBe(0);
  expect(second.ingestion_run_daily_stats.changed_rows).toBe(0);
  expect(tables.map(rows)).toEqual(before);
});

it("propagates late samples, corrected prices and ingestion outcomes only to affected aggregates", async () => {
  seed(); await run(); clock += 60;
  db.prepare("UPDATE stock_price_snapshots SET price=40 WHERE stock_id=1 AND observed_at=?").run(yesterday + 120);
  point(1, yesterday + 180, 25);
  db.exec("UPDATE stock_ingestion_runs SET status='ok',points_written=7");
  const result = await run();
  expect(result.hourly_rollups.changed_rows).toBe(1);
  expect(result.daily_rollups.changed_rows).toBe(1);
  expect(result.ingestion_run_daily_stats.changed_rows).toBe(1);
  expect(db.prepare("SELECT * FROM stock_price_rollups_hourly WHERE stock_id=1 AND bucket_start=?").get(yesterday))
    .toMatchObject({ open_price: 10, close_price: 25, low_price: 10, high_price: 40, avg_price: 25, sample_count: 3 });
  expect(db.prepare("SELECT * FROM stock_price_rollups_daily WHERE stock_id=1").get())
    .toMatchObject({ open_price: 10, close_price: 30, avg_price: 26.25, sample_count: 4 });
  expect(rows("stock_ingestion_run_daily_stats")[0]).toMatchObject({ ok_runs: 1, running_runs: 0, points_written: 7 });
});

it("covers backfill and refresh ranges without overlap while advancing all checkpoints", async () => {
  for (const age of [5, 2]) {
    point(1, today - age * day, 10);
    db.prepare("INSERT INTO stock_ingestion_runs(id,batch_group,started_at,status) VALUES(?,'minute',?,'ok')")
      .run(String(age), today - (age + 5) * day);
  }
  const result = await run();
  for (const table of ["stock_price_rollups_hourly", "stock_price_rollups_daily", "stock_ingestion_run_daily_stats"]) {
    const ranges = writes.filter(write => write.sql.includes(`INSERT INTO ${table}`))
      .map(write => [Number(write.args[2]), Number(write.args[3])]).sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < ranges.length; i++) expect(ranges[i - 1][1]).toBeLessThanOrEqual(ranges[i][0]);
  }
  expect(result.hourly_rollups.progress_after).toBe(today + 7 * hour);
  expect(result.daily_rollups.progress_after).toBe(today);
  expect(result.ingestion_run_daily_stats.progress_after).toBe(today);
  expect(rows("stock_price_rollups_hourly")).toHaveLength(2);
  expect(rows("stock_price_rollups_daily")).toHaveLength(2);
});

it("does not advance a failed backfill checkpoint or prune its source data", async () => {
  point(1, today - 70 * day, 10);
  failOn = "INSERT INTO stock_price_rollups_hourly";
  await expect(run()).rejects.toThrow("Injected write failure");
  expect(db.prepare("SELECT * FROM sync_state WHERE name='stock_price_rollup_hourly'").get()).toBeUndefined();
  expect(rows("stock_price_snapshots")).toHaveLength(1);
  failOn = undefined;
  const result = await run();
  expect(result.hourly_rollups.progress_after).toBe(today - 63 * day);
  expect(result.retention.minute_snapshots_deleted).toBe(1);
  expect(rows("stock_price_rollups_daily")).toHaveLength(1);
});

it("skips an entire unchanged 35-stock, 72-hour refresh", async () => {
  const end = today + 7 * hour;
  for (let stock = 1; stock <= 35; stock++) {
    db.prepare("INSERT OR IGNORE INTO stock_profiles(stock_id,updated_at) VALUES(?,0)").run(stock);
    for (let time = end - 72 * hour; time < end; time += hour) point(stock, time, stock * 10);
  }
  expect((await run()).hourly_rollups.changed_rows).toBe(2520);
  clock += 60;
  const result = await run();
  expect(result.hourly_rollups.changed_rows).toBe(0);
  expect(result.daily_rollups.changed_rows).toBe(0);
});
