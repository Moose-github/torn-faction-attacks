import { describe, expect, it } from "vitest";
import { buildWarControlSnapshot } from "./warControl";
import type { Env, TornFactionMember } from "./types";

describe("war control detection", () => {
  it("uses the opening grace period before claiming control", async () => {
    const db = new TestD1Database();
    const sampledAt = 1_781_000_300;
    const snapshot = await buildWarControlSnapshot(
      { DB: db as unknown as D1Database } as Env,
      { id: 123, practical_start_time: sampledAt - 5 * 60, enemy_faction_id: 456 },
      members(10, "Okay"),
      members(10, "Hospital"),
      sampledAt,
    );

    expect(snapshot.control_state).toBe("opening");
    expect(snapshot.control_reason).toBe("Opening momentum");
  });

  it("claims home control when enemy hospital threshold and available edge are met", async () => {
    const db = new TestD1Database();
    const sampledAt = 1_781_000_300;
    const snapshot = await buildWarControlSnapshot(
      { DB: db as unknown as D1Database } as Env,
      { id: 123, practical_start_time: sampledAt - 30 * 60, enemy_faction_id: 456 },
      members(10, "Okay"),
      [...members(8, "Hospital"), ...members(2, "Okay", 100)],
      sampledAt,
    );

    expect(snapshot.control_state).toBe("home_control");
    expect(snapshot.enemy_hospital_ratio).toBe(0.8);
    expect(snapshot.control_confidence).toBeGreaterThan(0.4);
  });

  it("uses active big hitters as a transition confidence multiplier, not a blocker", async () => {
    const sampledAt = 1_781_000_300;
    const db = new TestD1Database({
      enemyAttacks: 3,
      bigHitterIds: [1],
      previous: {
        control_state: "home_control",
        enemy_hospital_ratio: 0.9,
        home_hospital_ratio: 0,
      },
    });
    const enemy = [
      member(1, "Okay", sampledAt - 60),
      ...members(5, "Hospital", 10),
      ...members(4, "Okay", 100),
    ];

    const snapshot = await buildWarControlSnapshot(
      { DB: db as unknown as D1Database } as Env,
      { id: 123, practical_start_time: sampledAt - 30 * 60, enemy_faction_id: 456 },
      members(10, "Okay", 500),
      enemy,
      sampledAt,
    );

    expect(snapshot.control_state).toBe("transitioning");
    expect(snapshot.enemy_big_hitter_recently_active_count).toBe(1);
    expect(snapshot.control_confidence).toBe(0.88);
  });
});

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
    return this.db.all(this.sql) as D1Result<T>;
  }

  async run<T = unknown>(): Promise<D1Result<T>> {
    return result([]);
  }
}

class TestD1Database {
  constructor(
    private readonly options: {
      enemyAttacks?: number;
      bigHitterIds?: number[];
      previous?: {
        control_state: string;
        enemy_hospital_ratio: number;
        home_hospital_ratio: number;
      };
    } = {},
  ) {}

  prepare(sql: string): D1PreparedStatement {
    return new TestD1PreparedStatement(this, compactSql(sql)) as unknown as D1PreparedStatement;
  }

  first(sql: string, args: unknown[]): unknown | null {
    if (sql.includes("FROM war_control_settings")) {
      return null;
    }

    if (sql.includes("FROM war_control_snapshots")) {
      return this.options.previous
        ? {
            war_id: args[0],
            bucket_start: Number(args[1]) - 60,
            home_hospital_ratio: this.options.previous.home_hospital_ratio,
            enemy_hospital_ratio: this.options.previous.enemy_hospital_ratio,
            control_state: this.options.previous.control_state,
          }
        : null;
    }

    if (sql.includes("FROM attacks")) {
      const attackerFactionId = Number(args[1]);
      return { attacks: attackerFactionId === 456 ? (this.options.enemyAttacks ?? 0) : 0 };
    }

    return null;
  }

  all<T = unknown>(sql: string): D1Result<T> {
    if (sql.includes("FROM enemy_big_hitters")) {
      return result((this.options.bigHitterIds ?? []).map((member_id) => ({ member_id })) as T[]);
    }
    return result([]);
  }
}

function members(count: number, state: string, idOffset = 0): TornFactionMember[] {
  return Array.from({ length: count }, (_, index) => member(idOffset + index + 1, state));
}

function member(id: number, state: string, lastActionTimestamp = 1_781_000_000): TornFactionMember {
  return {
    id,
    name: `Member ${id}`,
    level: 100,
    status: { state },
    last_action: { status: state === "Okay" ? "Online" : "Offline", timestamp: lastActionTimestamp },
  };
}

function compactSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

function result<T>(results: T[]): D1Result<T> {
  return {
    results,
    success: true,
    meta: { changes: 0 },
  } as unknown as D1Result<T>;
}
