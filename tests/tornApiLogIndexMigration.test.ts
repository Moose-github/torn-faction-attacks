import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";

it("drops only the unused status index and preserves log query results and access paths", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(readFileSync(new URL("../migrations/0069_create_torn_api_call_log.sql", import.meta.url), "utf8"));
    const insert = db.prepare(`INSERT INTO torn_api_call_log
      (requested_at,feature,key_source,method,endpoint,status,ok,duration_ms)
      VALUES(?,?,'key_pool:test','GET','user',?,?,100)`);
    for (let i = 0; i < 2000; i++) insert.run(i, `feature${i % 8}`, i % 97 === 0 ? 429 : 200, Number(i % 97 !== 0));
    db.exec("ANALYZE");
    // Representative usage summary, grouped report, recent call/error and
    // retention access paths. The feature index still serves grouped reports.
    const queries = [
      "SELECT count(*),sum(ok=0),sum(status=429),avg(duration_ms) FROM torn_api_call_log WHERE requested_at>=1900",
      "SELECT feature,count(*),sum(ok=0),sum(status=429),avg(duration_ms) FROM torn_api_call_log WHERE requested_at>=1900 GROUP BY feature ORDER BY count(*) DESC,feature",
      "SELECT * FROM torn_api_call_log ORDER BY requested_at DESC,id DESC LIMIT 25",
      "SELECT * FROM torn_api_call_log WHERE ok=0 OR status>=400 ORDER BY requested_at DESC,id DESC LIMIT 12",
      "SELECT id FROM torn_api_call_log WHERE requested_at<100 ORDER BY id",
    ];
    const before = queries.map(sql => ({
      rows: db.prepare(sql).all(),
      plan: db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map(row => row.detail),
    }));
    const migration = readFileSync(new URL("../migrations/0200_drop_api_call_log_status_index.sql", import.meta.url), "utf8");
    db.exec(migration);
    db.exec(migration);
    queries.forEach((sql, index) => {
      expect(db.prepare(sql).all()).toEqual(before[index].rows);
      expect(db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map(row => row.detail)).toEqual(before[index].plan);
    });
    expect(db.prepare("PRAGMA index_list(torn_api_call_log)").all().map(row => row.name).sort()).toEqual([
      "idx_torn_api_call_log_feature_requested_at",
      "idx_torn_api_call_log_requested_at",
    ]);
    expect(db.prepare("SELECT count(*) AS count FROM torn_api_call_log").get()?.count).toBe(2000);
    expect(insert.run(2001, "feature0", 200, 1).changes).toBe(1);
  } finally {
    db.close();
  }
});
