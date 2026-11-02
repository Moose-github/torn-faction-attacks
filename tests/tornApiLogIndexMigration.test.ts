import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";

// Representative usage summary, grouped report, recent call/error and retention access paths.
const queries = [
  "SELECT count(*),sum(ok=0),sum(status=429),avg(duration_ms) FROM torn_api_call_log WHERE requested_at>=1900",
  "SELECT feature,count(*),sum(ok=0),sum(status=429),avg(duration_ms) FROM torn_api_call_log WHERE requested_at>=1900 GROUP BY feature ORDER BY count(*) DESC,feature",
  "SELECT * FROM torn_api_call_log ORDER BY requested_at DESC,id DESC LIMIT 25",
  "SELECT * FROM torn_api_call_log WHERE ok=0 OR status>=400 ORDER BY requested_at DESC,id DESC LIMIT 12",
  "SELECT id FROM torn_api_call_log WHERE requested_at<100 ORDER BY id",
];
const migration = (name: string) => readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8");

function logDatabase(...migrations: string[]) {
  const db = new DatabaseSync(":memory:");
  db.exec(migration("0069_create_torn_api_call_log.sql"));
  for (const name of migrations) db.exec(migration(name));
  const insert = db.prepare(`INSERT INTO torn_api_call_log
    (requested_at,feature,key_source,method,endpoint,status,ok,duration_ms)
    VALUES(?,?,'key_pool:test','GET','user',?,?,100)`);
  for (let i = 0; i < 2000; i++) insert.run(i, `feature${i % 8}`, i % 97 === 0 ? 429 : 200, Number(i % 97 !== 0));
  return { db, insert };
}
const snapshot = (db: DatabaseSync) => queries.map(sql => ({
  rows: db.prepare(sql).all(),
  plan: db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map(row => row.detail),
}));
const indexes = (db: DatabaseSync) => db.prepare("PRAGMA index_list(torn_api_call_log)").all().map(row => row.name).sort();

it("drops only the unused status index and preserves log query results and access paths", () => {
  const { db, insert } = logDatabase();
  try {
    db.exec("ANALYZE");
    const before = snapshot(db);
    db.exec(migration("0200_drop_api_call_log_status_index.sql"));
    db.exec(migration("0200_drop_api_call_log_status_index.sql"));
    expect(snapshot(db)).toEqual(before);
    expect(indexes(db)).toEqual([
      "idx_torn_api_call_log_feature_requested_at",
      "idx_torn_api_call_log_requested_at",
    ]);
    expect(db.prepare("SELECT count(*) AS count FROM torn_api_call_log").get()?.count).toBe(2000);
    expect(insert.run(2001, "feature0", 200, 1).changes).toBe(1);
  } finally {
    db.close();
  }
});

it("drops the feature index so the unanalyzed grouped report reads only its time range", () => {
  // D1 keeps no sqlite_stat1, so plans here match production rather than an ANALYZEd database.
  const { db, insert } = logDatabase("0200_drop_api_call_log_status_index.sql");
  try {
    const before = snapshot(db);
    expect(before[1].plan[0]).toBe("SCAN torn_api_call_log USING INDEX idx_torn_api_call_log_feature_requested_at");
    db.exec(migration("0201_drop_api_call_log_feature_index.sql"));
    db.exec(migration("0201_drop_api_call_log_feature_index.sql"));
    const after = snapshot(db);
    expect(after.map(query => query.rows)).toEqual(before.map(query => query.rows));
    expect(after[1].plan[0]).toBe("SEARCH torn_api_call_log USING INDEX idx_torn_api_call_log_requested_at (requested_at>?)");
    // Every other access path is unchanged.
    expect(after.filter((_, index) => index !== 1)).toEqual(before.filter((_, index) => index !== 1));
    expect(indexes(db)).toEqual(["idx_torn_api_call_log_requested_at"]);
    expect(insert.run(2001, "feature0", 200, 1).changes).toBe(1);
  } finally {
    db.close();
  }
});
