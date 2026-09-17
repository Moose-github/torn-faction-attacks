import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOME_FACTION_ID } from "./constants";
import { fetchTornFactionMembers } from "./enemyScouting";
import { getEnemyMemberActivityHeatmap, HeatmapSamplingError, sampleFactionActivityHeatmaps } from "./heatmap";
import type { Env, TornFactionMember } from "./types";

vi.mock("./syncState", () => ({
  readSyncTimestamp: vi.fn(async () => Math.floor(Date.now() / 1000)),
  upsertSyncTimestamp: vi.fn(),
}));

vi.mock("./enemyScouting", () => ({
  fetchTornFactionMembers: vi.fn(),
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
  homeAlreadySampled = true;
  private readonly samples = new Map<string, { sampled_at: unknown }>();

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
      return this.samples.get(`home:${args.join(":")}`)
        ?? (this.homeAlreadySampled && factionId === HOME_FACTION_ID ? { sampled_at: 1_767_354_300 } : null);
    }

    if (sql.includes("FROM enemy_faction_activity_samples")) {
      return this.samples.get(`enemy:${args.join(":")}`) ?? null;
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
      const home = sql.includes("INSERT INTO home_faction_activity_samples");
      const key = `${home ? "home" : "enemy"}:${args.slice(0, home ? 3 : 4).join(":")}`;
      this.samples.set(key, { sampled_at: args[args.length - 1] });
    }

    if (sql.includes("INSERT INTO enemy_member_activity_samples")) {
      this.enemyMemberInserts.push(args);
    }

    return result([], 1);
  }
}

describe("enemy member activity heatmap", () => {
  beforeEach(() => {
    vi.mocked(fetchTornFactionMembers).mockReset();
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

  it("preserves the home sample and retries only the missing enemy sample at midnight +1 minute", async () => {
    vi.setSystemTime(new Date("2026-09-16T00:00:28Z"));
    const firstSampledAt = Math.floor(Date.now() / 1000);
    const db = new TestD1Database();
    db.homeAlreadySampled = false;
    const env = { DB: db as unknown as D1Database } as Env;
    vi.mocked(fetchTornFactionMembers)
      .mockResolvedValueOnce([member(1, "Home", "Online", firstSampledAt - 60)])
      .mockRejectedValueOnce(new Error("HTTP 504"));

    await expect(sampleFactionActivityHeatmaps(env)).rejects.toMatchObject({
      message: expect.stringContaining("enemy faction 456: HTTP 504"),
      metrics: { homeSampled: true, enemySampled: false, writeStatements: 1, changedRows: 1 },
    });
    expect(db.aggregateInserts).toEqual([[HOME_FACTION_ID, "2026-09-16", 0, 1, 1, firstSampledAt]]);

    vi.setSystemTime(new Date("2026-09-16T00:01:28Z"));
    const retriedAt = Math.floor(Date.now() / 1000);
    vi.mocked(fetchTornFactionMembers).mockResolvedValueOnce([
      member(2, "At cutoff", "Idle", retriedAt - 15 * 60),
      member(3, "Outside cutoff", "Idle", retriedAt - 15 * 60 - 1),
      member(4, "Active since first attempt", "Online", retriedAt - 10),
    ]);

    const metrics = await sampleFactionActivityHeatmaps(env, { retrySlotAt: retriedAt });

    expect(metrics).toMatchObject({ homeSampled: false, enemySampled: true });
    expect(vi.mocked(fetchTornFactionMembers).mock.calls.map((args) => args[1])).toEqual([HOME_FACTION_ID, 456, 456]);
    expect(db.aggregateInserts).toEqual([
      [HOME_FACTION_ID, "2026-09-16", 0, 1, 1, firstSampledAt],
      [123, 456, "2026-09-16", 0, 2, 3, retriedAt],
    ]);
    expect(db.enemyMemberInserts.map((row) => [row[2], row[5], row[6], row[9]])).toEqual([
      [2, 0, 1, retriedAt],
      [3, 0, 0, retriedAt],
      [4, 0, 1, retriedAt],
    ]);

    await sampleFactionActivityHeatmaps(env, { retrySlotAt: retriedAt });
    expect(fetchTornFactionMembers).toHaveBeenCalledTimes(3);
    expect(db.aggregateInserts).toHaveLength(2);
  });

  it("still collects the enemy sample when the home request fails", async () => {
    const db = new TestD1Database();
    db.homeAlreadySampled = false;
    const env = { DB: db as unknown as D1Database } as Env;
    vi.mocked(fetchTornFactionMembers)
      .mockRejectedValueOnce(new Error("HTTP 504"))
      .mockResolvedValueOnce([member(2, "Enemy", "Online", Math.floor(Date.now() / 1000) - 30)]);

    await expect(sampleFactionActivityHeatmaps(env)).rejects.toMatchObject({
      message: expect.stringContaining(`home faction ${HOME_FACTION_ID}: HTTP 504`),
      metrics: { homeSampled: false, enemySampled: true, writeStatements: 2, changedRows: 2 },
    });
    expect(db.aggregateInserts).toHaveLength(1);
    expect(db.aggregateInserts[0].slice(0, 2)).toEqual([123, 456]);
  });

  it("attempts each faction once when both requests fail", async () => {
    const db = new TestD1Database();
    db.homeAlreadySampled = false;
    vi.mocked(fetchTornFactionMembers).mockRejectedValue(new Error("HTTP 504"));

    await expect(sampleFactionActivityHeatmaps({ DB: db as unknown as D1Database } as Env))
      .rejects.toBeInstanceOf(HeatmapSamplingError);

    expect(fetchTornFactionMembers).toHaveBeenCalledTimes(2);
    expect(db.aggregateInserts).toHaveLength(0);
  });

  it("does not fetch or write when a delayed retry arrives in the next slot", async () => {
    vi.setSystemTime(new Date("2026-09-16T00:15:01Z"));
    const db = new TestD1Database();
    db.homeAlreadySampled = false;

    const metrics = await sampleFactionActivityHeatmaps({ DB: db as unknown as D1Database } as Env, {
      retrySlotAt: Date.parse("2026-09-16T00:01:00Z") / 1000,
    });

    expect(fetchTornFactionMembers).not.toHaveBeenCalled();
    expect(db.aggregateInserts).toHaveLength(0);
    expect(metrics).toMatchObject({ homeSampled: false, enemySampled: false, writeStatements: 0 });
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
