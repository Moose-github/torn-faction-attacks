import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { refreshTornApiUsageRollups } from "../src/tornApiUsage";
import type { Env } from "../src/types";

const now = 1800000;
let db: DatabaseSync;
let env: Env;
let clock: number;
let failAt: number | undefined;
beforeEach(() => {
  clock = now;
  failAt = undefined;
  db = new DatabaseSync(":memory:");
  db.function("unixepoch", () => clock);
  db.exec(readFileSync(new URL("../schema/current.sql", import.meta.url), "utf8"));
  const adapter = {
    prepare(sql: string) {
      let args: SQLInputValue[] = [];
      const statement = {
        bind(...values: SQLInputValue[]) { args = values; return statement; },
        async first() { return db.prepare(sql).get(...args) ?? null; },
        async run() { return { success: true, meta: { changes: Number(db.prepare(sql).run(...args).changes) } }; },
      };
      return statement;
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      db.exec("BEGIN");
      try {
        const results = [];
        for (let index = 0; index < statements.length; index++) {
          if (failAt === index) throw new Error("Injected batch failure");
          results.push(await statements[index].run());
        }
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
  env = { DB: adapter } as unknown as Env;
});
afterEach(() => db.close());

function call(at: number, feature = "stocks", endpoint = "torn/stocks", key = "key_pool:a", status: number | null = 200, duration = 100) {
  return db.prepare(`INSERT INTO torn_api_call_log(requested_at,feature,endpoint,key_source,method,status,ok,duration_ms)
    VALUES(?,?,?,?,'GET',?,?,?)`).run(at, feature, endpoint, key, status, Number(status === 200), duration).lastInsertRowid;
}
const rows = () => db.prepare("SELECT * FROM torn_api_usage_rollup_15m ORDER BY bucket_start,group_type,group_value").all();
const refresh = (at = now) => refreshTornApiUsageRollups(env, at);

it("matches the previous aggregation for all groups, errors, bucket boundaries and empty values", async () => {
  call(now - 90000); // inclusive initial lookback
  call(now - 90001); // outside lookback
  call(now - 901);
  call(now - 900, "armory", "faction", "key_pool:b", 429, 250);
  call(now - 899, "armory", "faction", "key_pool:b", null, 0);
  call(now - 1, "", "", "", 500, 20);
  call(now);
  call(now + 1); // future log must not leak into the current bucket
  await refresh();
  const expected = ["feature", "endpoint", "key_source"].flatMap(column => db.prepare(`
    SELECT requested_at-requested_at%900 AS bucket_start, '${column}' AS group_type, ${column} AS group_value,
      count(*) AS requests, sum(CASE WHEN ok=0 THEN 1 ELSE 0 END) AS errors,
      sum(CASE WHEN status=429 THEN 1 ELSE 0 END) AS rate_limited,
      sum(duration_ms) AS total_duration_ms, max(duration_ms) AS max_duration_ms,
      max(requested_at) AS last_requested_at
    FROM torn_api_call_log WHERE requested_at>=? AND requested_at<=? AND ${column}<>''
    GROUP BY bucket_start,group_value`).all(now - 90000, now));
  const actual = rows().map(({ updated_at: _, ...row }) => row);
  expect(actual).toHaveLength(expected.length);
  expect(actual).toEqual(expect.arrayContaining(expected));
});

it("does not rewrite unchanged summaries; only the checkpoint changes on the next refresh", async () => {
  for (let bucket = 1; bucket <= 8; bucket++) call(now - bucket * 900);
  const first = await refresh();
  expect(first.details.upserted_rows).toBe(24);
  const before = rows();
  clock += 900;
  const next = await refresh(now + 900);
  expect(next).toMatchObject({ changedRows: 1, details: { upserted_rows: 0 } });
  expect(rows()).toEqual(before);
  expect((await refresh(now + 900)).changedRows).toBe(0);
});

it("incorporates late logs and changes only their bucket's three summaries", async () => {
  call(now - 900); call(now - 1800);
  await refresh();
  clock += 900;
  call(now - 850, "stocks", "torn/stocks", "key_pool:a", 429, 200);
  const result = await refresh(now + 900);
  expect(result.details).toMatchObject({ upserted_rows: 3 });
  expect(rows().filter(row => row.bucket_start === now - 900)).toEqual(expect.arrayContaining([
    expect.objectContaining({ group_type: "feature", requests: 2, errors: 1, rate_limited: 1, total_duration_ms: 300, max_duration_ms: 200 }),
  ]));
  expect(rows().filter(row => row.bucket_start === now - 1800).every(row => row.updated_at === now)).toBe(true);
});

it("corrects smaller aggregates and keeps groups whose logs were removed by hand", async () => {
  call(now - 20000, "old");
  const removed = call(now - 900, "removed", "old/endpoint", "key_pool:old");
  call(now - 900); const other = call(now - 899);
  await refresh();
  db.prepare("DELETE FROM torn_api_call_log WHERE id IN (?,?)").run(removed, other);
  clock += 900;
  const result = await refresh(now + 900);
  expect(result.details).toMatchObject({ upserted_rows: 3 });
  const bucket = rows().filter(row => row.bucket_start === now - 900);
  expect(bucket.filter(row => row.group_value === "stocks")).toEqual([expect.objectContaining({ requests: 1 })]);
  expect(bucket.filter(row => row.group_value === "removed")).toEqual([expect.objectContaining({ requests: 1 })]);
  expect(rows().filter(row => row.group_value === "old")).toHaveLength(1);
});

it("only re-reads the recent overlap on a normal run", async () => {
  await refresh();
  clock += 900;
  const result = await refresh(now + 900);
  expect(result.details.start_at).toBe(now - 1800);
  call(now - 1801); // Older than the overlap, which no real call can be.
  clock += 900;
  expect((await refresh(now + 1800)).details.upserted_rows).toBe(0);
});

it.each([0, 1])("rolls back aggregate changes and retains the checkpoint when batch step %i fails", async step => {
  call(now - 900); await refresh();
  const before = rows();
  call(now - 800);
  clock += 900;
  failAt = step;
  await expect(refresh(now + 900)).rejects.toThrow("Injected batch failure");
  expect(rows()).toEqual(before);
  expect(db.prepare("SELECT last_started FROM sync_state WHERE name='torn_api_usage_rollup_15m'").get()?.last_started).toBe(now);
  failAt = undefined;
  expect((await refresh(now + 900)).details.upserted_rows).toBe(3);
});

it("catches up after a missed run using the existing bounded overlap", async () => {
  call(now - 900); await refresh();
  call(now + 1800);
  const caughtUp = await refresh(now + 10800);
  expect(caughtUp.details.start_at).toBe(now - 1800);
  expect(rows().some(row => row.bucket_start === now + 1800)).toBe(true);
});
