import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addEnemyBigHitterForWar,
  BIG_HITTER_BATTLESTAT_THRESHOLD,
  getEnemyBigHittersForWar,
  removeEnemyBigHitterForWar,
  seedEnemyBigHittersForWar,
} from "./enemyBigHitters";
import type { Env } from "./types";

vi.mock("./cacheVersions", () => ({
  bumpWarCacheVersion: vi.fn(),
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
  existingBigHitterCount = 0;
  bigHitterRows: unknown[] = [];
  memberRow: unknown | null = { member_id: 111, faction_id: 456, name: "Large Enemy" };
  seedArgs: unknown[] | null = null;
  addArgs: unknown[] | null = null;
  removeArgs: unknown[] | null = null;
  removeChanges = 1;

  prepare(sql: string): D1PreparedStatement {
    return new TestD1PreparedStatement(this, compactSql(sql)) as unknown as D1PreparedStatement;
  }

  first(sql: string, _args: unknown[]): unknown | null {
    if (sql.includes("FROM wars")) {
      return {
        id: 123,
        name: "Current War",
        status: "active",
        practical_start_time: 1,
        practical_finish_time: null,
        official_start_time: null,
        official_end_time: null,
        enemy_faction_id: 456,
        war_type: "real",
      };
    }

    if (sql.includes("COUNT(*) AS count") && sql.includes("FROM enemy_big_hitters")) {
      return { count: this.existingBigHitterCount };
    }

    if (sql.includes("FROM enemy_faction_members")) {
      return this.memberRow;
    }

    return null;
  }

  all<T = unknown>(sql: string, _args: unknown[]): D1Result<T> {
    if (sql.includes("FROM enemy_big_hitters")) {
      return result(this.bigHitterRows as T[]);
    }

    return result([]);
  }

  run<T = unknown>(sql: string, args: unknown[]): D1Result<T> {
    if (sql.includes("INSERT INTO enemy_big_hitters") && sql.includes("SELECT")) {
      this.seedArgs = args;
      return result([], 2);
    }

    if (sql.includes("INSERT INTO enemy_big_hitters") && sql.includes("VALUES")) {
      this.addArgs = args;
      return result([], 1);
    }

    if (sql.includes("DELETE FROM enemy_big_hitters")) {
      this.removeArgs = args;
      return result([], this.removeChanges);
    }

    return result([], 0);
  }
}

describe("enemy big hitters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("seeds one-time big hitter rows from the enemy scouting roster", async () => {
    const db = new TestD1Database();
    const env = { DB: db as unknown as D1Database } as Env;

    const metrics = await seedEnemyBigHittersForWar(env, 123, 456);

    expect(metrics).toEqual({ writeStatements: 2, changedRows: 2, seededRows: 2, skipped: false });
    expect(db.seedArgs).toEqual([123, 456, BIG_HITTER_BATTLESTAT_THRESHOLD]);
  });

  it("skips seeding when the war already has a big hitter roster", async () => {
    const db = new TestD1Database();
    db.existingBigHitterCount = 1;
    const env = { DB: db as unknown as D1Database } as Env;

    const metrics = await seedEnemyBigHittersForWar(env, 123, 456);

    expect(metrics).toEqual({ writeStatements: 1, changedRows: 0, seededRows: 0, skipped: true });
    expect(db.seedArgs).toBeNull();
  });

  it("lists, adds, and removes manual big hitters for a war", async () => {
    const db = new TestD1Database();
    db.bigHitterRows = [
      {
        war_id: 123,
        faction_id: 456,
        member_id: 111,
        member_name: "Large Enemy",
        created_at: 1_767_000_000,
      },
    ];
    const env = { DB: db as unknown as D1Database } as Env;
    const url = new URL("https://worker.test/api/wars/current/enemy-big-hitters");

    const listResponse = await getEnemyBigHittersForWar(url, env);
    await expect(listResponse.json()).resolves.toMatchObject({
      ok: true,
      big_hitters: [{ member_id: 111, member_name: "Large Enemy" }],
    });

    const addResponse = await addEnemyBigHitterForWar(jsonRequest({ member_id: 111 }), url, env);
    expect(addResponse.status).toBe(200);
    expect(db.addArgs).toEqual([123, 456, 111, "Large Enemy"]);

    const removeResponse = await removeEnemyBigHitterForWar(jsonRequest({ member_id: 111 }), url, env);
    expect(removeResponse.status).toBe(200);
    expect(db.removeArgs).toEqual([123, 111]);
    await expect(removeResponse.json()).resolves.toMatchObject({ ok: true, deleted: 1 });
  });
});

function jsonRequest(body: unknown): Request {
  return new Request("https://worker.test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
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
