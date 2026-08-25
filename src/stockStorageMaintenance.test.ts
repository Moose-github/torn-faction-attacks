import { describe, expect, it } from "vitest";
import { runStockStorageMaintenance } from "./stockMarket";
import type { Env } from "./types";

type RecordedQuery = {
  operation: "first" | "run";
  sql: string;
  args: unknown[];
};

class TestD1PreparedStatement {
  private args: unknown[] = [];

  constructor(
    private readonly db: TestD1Database,
    private readonly sql: string,
  ) {}

  bind(...args: unknown[]): D1PreparedStatement {
    this.args = args;
    return this as unknown as D1PreparedStatement;
  }

  async first<T = unknown>(): Promise<T | null> {
    return this.db.first(this.sql, this.args) as T | null;
  }

  async run<T = unknown>(): Promise<D1Result<T>> {
    return this.db.run(this.sql, this.args) as D1Result<T>;
  }
}

class TestD1Database {
  readonly queries: RecordedQuery[] = [];
  readonly syncState = new Map<string, number>();
  oldestSnapshotAt: number | null = 1_700_000_000;
  oldestHourlyRollupAt: number | null = 1_700_000_000;
  oldestIngestionRunAt: number | null = 1_700_000_000;
  rollupChanges = 35;
  ingestionStatsChanges = 1;
  rawDeleteChanges = 25_000;
  runDeleteChanges = 1_440;

  prepare(sql: string): D1PreparedStatement {
    return new TestD1PreparedStatement(this, compactSql(sql)) as unknown as D1PreparedStatement;
  }

  first(sql: string, args: unknown[]): unknown | null {
    this.queries.push({ operation: "first", sql, args });

    if (sql.includes("FROM sync_state")) {
      const name = String(args[0]);
      const lastStarted = this.syncState.get(name);
      return lastStarted === undefined
        ? null
        : { name, last_started: lastStarted, active_war_id: null, war_state: "none" };
    }

    if (sql.includes("MIN(observed_at)") && sql.includes("FROM stock_price_snapshots")) {
      return { observed_at: this.oldestSnapshotAt };
    }

    if (sql.includes("MIN(bucket_start)") && sql.includes("FROM stock_price_rollups_hourly")) {
      return { bucket_start: this.oldestHourlyRollupAt };
    }

    if (sql.includes("MIN(started_at)") && sql.includes("FROM stock_ingestion_runs")) {
      return { started_at: this.oldestIngestionRunAt };
    }

    return null;
  }

  run<T = unknown>(sql: string, args: unknown[]): D1Result<T> {
    this.queries.push({ operation: "run", sql, args });

    if (sql.includes("INSERT INTO sync_state")) {
      this.syncState.set(String(args[0]), Number(args[1]));
      return d1Result([], 1);
    }

    if (sql.includes("INSERT INTO stock_ingestion_run_daily_stats")) {
      return d1Result([], this.ingestionStatsChanges);
    }

    if (sql.includes("INSERT INTO stock_price_rollups_hourly") || sql.includes("INSERT INTO stock_price_rollups_daily")) {
      return d1Result([], this.rollupChanges);
    }

    if (sql.includes("DELETE FROM stock_price_snapshots")) {
      return d1Result([], this.rawDeleteChanges);
    }

    if (sql.includes("DELETE FROM stock_ingestion_runs")) {
      return d1Result([], this.runDeleteChanges);
    }

    return d1Result([], 0);
  }
}

describe("stock storage maintenance", () => {
  it("rolls up stock history before pruning raw minute data", async () => {
    const db = new TestD1Database();
    const scheduledTime = Date.UTC(2026, 7, 25, 12, 7, 0);
    const env = { DB: db as unknown as D1Database } as Env;

    const result = await runStockStorageMaintenance(env, scheduledTime);

    const scheduledSecond = Math.floor(scheduledTime / 1000 / 60) * 60;
    const oldestSnapshotHour = Math.floor((db.oldestSnapshotAt ?? 0) / 3600) * 3600;
    const expectedHourlyProgress = oldestSnapshotHour + 7 * 24 * 60 * 60;
    expect(result.hourly_rollups.progress_after).toBe(expectedHourlyProgress);
    expect(result.retention.minute_snapshot_delete_before).toBe(
      Math.min(scheduledSecond - 60 * 24 * 60 * 60, expectedHourlyProgress),
    );
    expect(result.retention.minute_snapshots_deleted).toBe(db.rawDeleteChanges);
    expect(result.retention.ingestion_runs_deleted).toBe(db.runDeleteChanges);

    const runSql = db.queries.filter((query) => query.operation === "run").map((query) => query.sql);
    const hourlyRollupIndex = runSql.findIndex((sql) => sql.includes("INSERT INTO stock_price_rollups_hourly"));
    const dailyRollupIndex = runSql.findIndex((sql) => sql.includes("INSERT INTO stock_price_rollups_daily"));
    const ingestionStatsIndex = runSql.findIndex((sql) => sql.includes("INSERT INTO stock_ingestion_run_daily_stats"));
    const rawDeleteIndex = runSql.findIndex((sql) => sql.includes("DELETE FROM stock_price_snapshots"));
    const ingestionRunDeleteIndex = runSql.findIndex((sql) => sql.includes("DELETE FROM stock_ingestion_runs"));

    expect(hourlyRollupIndex).toBeGreaterThanOrEqual(0);
    expect(dailyRollupIndex).toBeGreaterThan(hourlyRollupIndex);
    expect(ingestionStatsIndex).toBeGreaterThan(dailyRollupIndex);
    expect(rawDeleteIndex).toBeGreaterThan(ingestionStatsIndex);
    expect(ingestionRunDeleteIndex).toBeGreaterThan(rawDeleteIndex);
    expect(runSql[rawDeleteIndex]).toContain("LIMIT ?");
    expect(runSql[ingestionRunDeleteIndex]).toContain("status = 'ok'");
  });

  it("skips pruning when rollup watermarks have not advanced", async () => {
    const db = new TestD1Database();
    db.oldestSnapshotAt = null;
    db.oldestHourlyRollupAt = null;
    db.oldestIngestionRunAt = null;
    db.rollupChanges = 0;
    db.ingestionStatsChanges = 0;
    const env = { DB: db as unknown as D1Database } as Env;

    const result = await runStockStorageMaintenance(env, Date.UTC(2026, 7, 25, 12, 7, 0));

    expect(result.hourly_rollups.progress_after).toBeNull();
    expect(result.retention.minute_snapshot_delete_before).toBeNull();
    expect(result.retention.minute_snapshots_deleted).toBe(0);
    expect(result.retention.ingestion_runs_deleted).toBe(0);
    expect(db.queries.some((query) => query.sql.includes("DELETE FROM stock_price_snapshots"))).toBe(false);
    expect(db.queries.some((query) => query.sql.includes("DELETE FROM stock_ingestion_runs"))).toBe(false);
  });
});

function compactSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

function d1Result<T>(results: T[], changes: number): D1Result<T> {
  return {
    results,
    success: true,
    meta: { changes },
  } as unknown as D1Result<T>;
}
