import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOME_FACTION_ID } from "./constants";
import { getEnemyMemberActivityHeatmap, sampleFactionActivityHeatmaps } from "./heatmap";
import type { Env, TornFactionMember } from "./types";

vi.mock("./syncState", () => ({
  readSyncTimestamp: vi.fn(async () => Date.parse("2026-01-02T10:05:00Z") / 1000),
  upsertSyncTimestamp: vi.fn(),
}));

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

  async all<T = unknown>(): Promise<D1Result<T>> {
    return this.db.all(this.sql, this.args) as D1Result<T>;
  }

  async run<T = unknown>(): Promise<D1Result<T>> {
    return this.db.run(this.sql, this.args) as D1Result<T>;
  }

  execute(): Promise<D1Result<unknown>> {
    return this.run();
  }

  raw(): Promise<unknown[]> {
    throw new Error("raw is not implemented in this test");
  }
}

class TestD1Database {
  readonly enemyMemberInserts: unknown[][] = [];
  readonly aggregateInserts: unknown[][] = [];
  enemyMemberRows: unknown[] = [];
  enemyMemberSelectArgs: unknown[] = [];

  prepare(sql: string): D1PreparedStatement {
    return new TestD1PreparedStatement(this, compactSql(sql)) as unknown as D1PreparedStatement;
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    return Promise.all(statements.map((statement) => statement.run<T>()));
  }

  first(sql: string, args: unknown[]): unknown | null {
    if (sql.includes("FROM wars")) {
      return {
        id: 123,
        name: "Current War",
        practical_start_time: 1_767_353_400,
        practical_finish_time: null,
        official_start_time: null,
        official_end_time: null,
        enemy_faction_id: 456,
      };
    }

    if (sql.includes("FROM home_faction_activity_samples")) {
      const factionId = Number(args[0]);
      return factionId === HOME_FACTION_ID ? { sampled_at: 1_767_354_300 } : null;
    }

    if (sql.includes("FROM enemy_faction_activity_samples")) {
      return null;
    }

    return null;
  }

  all<T = unknown>(sql: string, args: unknown[]): D1Result<T> {
    if (sql.includes("FROM enemy_member_activity_samples")) {
      this.enemyMemberSelectArgs = args;
      return result(this.enemyMemberRows as T[]);
    }

    return result([]);
  }

  run<T = unknown>(sql: string, args: unknown[]): D1Result<T> {
    if (
      sql.includes("INSERT INTO home_faction_activity_samples") ||
      sql.includes("INSERT INTO enemy_faction_activity_samples")
    ) {
      this.aggregateInserts.push(args);
    }

    if (sql.includes("INSERT INTO enemy_member_activity_samples")) {
      this.enemyMemberInserts.push(args);
    }

    return result([], 1);
  }
}

describe("enemy member activity heatmap", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-02T10:05:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes one enemy member row per sampled date interval", async () => {
    const db = new TestD1Database();
    const env = { DB: db as unknown as D1Database } as Env;
    const sampledAt = Date.parse("2026-01-02T10:05:00Z") / 1000;
    const members: TornFactionMember[] = [
      member(1, "Online Enemy", "Online", sampledAt - 60),
      member(2, "Quiet Enemy", "Idle", sampledAt - 60 * 60),
    ];

    const metrics = await sampleFactionActivityHeatmaps(env, {
      membersByFaction: new Map([[456, members]]),
    });

    expect(metrics.enemySampled).toBe(true);
    expect(db.aggregateInserts).toHaveLength(1);
    expect(db.enemyMemberInserts).toEqual([
      [123, 456, 1, "Online Enemy", "2026-01-02", 40, 1, "online", sampledAt - 60, sampledAt],
      [123, 456, 2, "Quiet Enemy", "2026-01-02", 40, 0, "idle", sampledAt - 60 * 60, sampledAt],
    ]);
  });

  it("returns filtered enemy member activity rows", async () => {
    const db = new TestD1Database();
    db.enemyMemberRows = [
      {
        war_id: 123,
        faction_id: 456,
        member_id: 1,
        member_name: "Online Enemy",
        date: "2026-01-02",
        interval_index: 40,
        is_recently_active: 1,
        last_action_status: "online",
        last_action_timestamp: 1_767_354_240,
        sampled_at: 1_767_354_300,
      },
    ];
    const env = { DB: db as unknown as D1Database } as Env;

    const response = await getEnemyMemberActivityHeatmap(
      new URL("https://worker.test/api/wars/current/enemy-member-activity-heatmap?member_id=1&member_ids=2,3"),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      interval_minutes: 15,
      rows: [{ member_id: 1, is_recently_active: 1 }],
    });
    expect(db.enemyMemberSelectArgs).toEqual([123, 456, 1, 2, 3]);
  });
});

function member(id: number, name: string, status: string, timestamp: number): TornFactionMember {
  return {
    id,
    name,
    level: 100,
    last_action: {
      status,
      timestamp,
    },
  };
}

function compactSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

function result<T>(results: T[], changes = 0): D1Result<T> {
  return {
    results,
    success: true,
    meta: { changes },
  } as unknown as D1Result<T>;
}
