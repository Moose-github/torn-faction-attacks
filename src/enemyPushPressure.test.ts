import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendDiscordAlertMessage } from "./discordAlertDelivery";
import { isEnemyPushAlertEnabled } from "./discordAlertSettings";
import { DISCORD_ALERT_KEYS } from "./discordAlerts";
import { readDiscordAlertMentions } from "./discordMentions";
import {
  bigHitterPressureMultiplierForCount,
  buildEnemyPushSnapshot,
  calculatePushPressureScore,
  interpretEnemyPushPressure,
  sendEnemyPushAlerts,
  type EnemyPushSnapshotInput,
} from "./enemyPushPressure";
import {
  clearSyncLatch,
  clearSyncLatchesByPrefix,
  readSetSyncLatches,
  setSyncLatch,
} from "./syncLatches";
import type { Env } from "./types";
import type { TornFactionMember } from "./types";

vi.mock("./discordAlertDelivery", () => ({
  sendDiscordAlertMessage: vi.fn(),
}));

vi.mock("./discordMentions", () => ({
  formatDiscordAlertMessage: (alertText: string, messageSuffix: string) =>
    messageSuffix ? `${alertText}\n${messageSuffix}` : alertText,
  readDiscordAlertMentions: vi.fn(),
}));

vi.mock("./discordAlertSettings", () => ({
  ENEMY_PUSH_ALERT_STATE_PREFIX: "enemy_push_alert",
  isEnemyPushAlertEnabled: vi.fn(),
}));

vi.mock("./syncLatches", () => ({
  clearSyncLatch: vi.fn(),
  clearSyncLatchesByPrefix: vi.fn(),
  readSetSyncLatches: vi.fn(),
  setSyncLatch: vi.fn(),
}));

describe("enemy push alerts", () => {
  const env = {} as Env;
  const snapshot: EnemyPushSnapshotInput = {
    war_id: 123,
    faction_id: 456,
    bucket_start: 1_781_000_000,
    total_members: 50,
    online_count: 12,
    idle_count: 10,
    offline_count: 28,
    recently_active_count: 14,
    offline_idle_to_online_count: 4,
    enemy_attacks_last_5m: 6,
    hospital_count: 3,
    revivable_count: 2,
    baseline_active_count: 8,
    activity_above_baseline: 6,
    online_delta_10m: 5,
    recently_active_delta_10m: 7,
    big_hitter_total_count: 4,
    big_hitter_online_count: 2,
    big_hitter_recently_active_count: 2,
    big_hitter_pressure_multiplier: 1.5,
    base_pressure_score: 13,
    pressure_score: 25,
    pressure_level: "underway",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readSetSyncLatches).mockResolvedValue(new Set());
    vi.mocked(isEnemyPushAlertEnabled).mockResolvedValue(true);
    vi.mocked(readDiscordAlertMentions).mockResolvedValue({
      messageSuffix: "",
      allowedMentions: undefined,
    });
  });

  it("does not send Discord messages by default", async () => {
    vi.mocked(isEnemyPushAlertEnabled).mockResolvedValue(false);

    await sendEnemyPushAlerts(env, 123, "Test War", snapshot, [], { warType: "real", controlState: null });

    expect(sendDiscordAlertMessage).not.toHaveBeenCalled();
    expect(readSetSyncLatches).not.toHaveBeenCalled();
    expect(setSyncLatch).not.toHaveBeenCalled();
    expect(clearSyncLatchesByPrefix).not.toHaveBeenCalled();
  });

  it("sends and latches Discord messages when enabled", async () => {
    vi.mocked(readSetSyncLatches).mockResolvedValue(new Set(["enemy_push_alert:123:likely"]));

    await sendEnemyPushAlerts(env, 123, "Test War", snapshot, [], { warType: "real", controlState: null });

    expect(sendDiscordAlertMessage).toHaveBeenCalledOnce();
    expect(readDiscordAlertMentions).toHaveBeenCalledWith(env, DISCORD_ALERT_KEYS.enemyPush);
    expect(sendDiscordAlertMessage).toHaveBeenCalledWith(
      env,
      DISCORD_ALERT_KEYS.enemyPush,
      expect.not.stringContaining("<@327916221330620436>"),
      undefined,
    );
    expect(setSyncLatch).toHaveBeenCalledWith(env, "enemy_push_alert:123:underway", snapshot.bucket_start);
    expect(clearSyncLatch).toHaveBeenCalledWith(env, "enemy_push_alert:123:likely");
  });

  it("sends configured Discord alert mentions for enemy push alerts", async () => {
    vi.mocked(readDiscordAlertMentions).mockResolvedValue({
      messageSuffix: "<@111111111111111111> <@&222222222222222222>",
      allowedMentions: {
        users: ["111111111111111111"],
        roles: ["222222222222222222"],
      },
    });

    await sendEnemyPushAlerts(env, 123, "Test War", snapshot, [], { warType: "real", controlState: null });

    expect(sendDiscordAlertMessage).toHaveBeenCalledWith(
      env,
      DISCORD_ALERT_KEYS.enemyPush,
      expect.stringContaining("\n<@111111111111111111> <@&222222222222222222>"),
      {
        users: ["111111111111111111"],
        roles: ["222222222222222222"],
      },
    );
  });

  it("suppresses likely and underway alerts while the enemy already has control", async () => {
    vi.mocked(readSetSyncLatches).mockResolvedValue(new Set([
      "enemy_push_alert:123:likely",
      "enemy_push_alert:123:underway",
    ]));

    await sendEnemyPushAlerts(env, 123, "Test War", snapshot, [], { warType: "real", controlState: "enemy_control" });

    expect(sendDiscordAlertMessage).not.toHaveBeenCalled();
    expect(setSyncLatch).not.toHaveBeenCalled();
    expect(clearSyncLatch).toHaveBeenCalledWith(env, "enemy_push_alert:123:likely");
    expect(clearSyncLatch).toHaveBeenCalledWith(env, "enemy_push_alert:123:underway");
  });
});

describe("enemy push pressure interpretation", () => {
  it.each([
    ["home_control", "Enemy push pressure", false],
    ["enemy_control", "Enemy control pressure", true],
    ["contested", "Enemy momentum", false],
    ["transitioning", "Control swing pressure", false],
    ["opening", "Opening momentum", false],
    ["unknown", "Enemy activity pressure", false],
    [null, "Enemy activity pressure", false],
  ] as const)("interprets %s as %s", (controlState, label, suppressed) => {
    expect(interpretEnemyPushPressure(controlState)).toMatchObject({
      control_state: controlState,
      push_interpretation_label: label,
      push_alerts_suppressed: suppressed,
    });
  });
});

describe("enemy push pressure scoring", () => {
  it.each([
    [0, 0.5],
    [1, 1],
    [2, 1.5],
    [8, 1.5],
  ])("returns the expected multiplier for %s active big hitters", (count, expected) => {
    expect(bigHitterPressureMultiplierForCount(count)).toBe(expected);
  });

  it("multiplies only pre-attack pressure and preserves attack score", () => {
    const noBigHitters = calculatePushPressureScore({
      totalMembers: 50,
      onlineDelta10m: 4,
      recentlyActiveCount: 14,
      recentlyActiveDelta10m: 7,
      offlineIdleToOnlineCount: 3,
      activityAboveBaseline: 6,
      enemyAttacksLast5m: 4,
      bigHitterRecentlyActiveCount: 0,
    });
    const multipleBigHitters = calculatePushPressureScore({
      totalMembers: 50,
      onlineDelta10m: 4,
      recentlyActiveCount: 14,
      recentlyActiveDelta10m: 7,
      offlineIdleToOnlineCount: 3,
      activityAboveBaseline: 6,
      enemyAttacksLast5m: 4,
      bigHitterRecentlyActiveCount: 2,
    });

    expect(noBigHitters.basePressureScore).toBe(15);
    expect(noBigHitters.attackScore).toBe(12);
    expect(noBigHitters.pressureScore).toBe(20);
    expect(multipleBigHitters.basePressureScore).toBe(15);
    expect(multipleBigHitters.attackScore).toBe(12);
    expect(multipleBigHitters.pressureScore).toBe(35);
  });

  it("counts rostered big hitters in push snapshots", async () => {
    const db = new TestD1Database();
    const env = { DB: db as unknown as D1Database } as Env;
    const fetchedAt = 1_781_000_300;
    const members: TornFactionMember[] = [
      member(1, "Online Big", "Online", fetchedAt - 60),
      member(2, "Offline Regular", "Offline", fetchedAt - 60 * 20),
      member(3, "Idle Big", "Idle", fetchedAt - 60 * 20),
    ];

    const snapshot = await buildEnemyPushSnapshot(
      env,
      123,
      456,
      members,
      new Map([[1, { last_action_status: "offline" } as any]]),
      fetchedAt,
    );

    expect(snapshot.big_hitter_total_count).toBe(2);
    expect(snapshot.big_hitter_online_count).toBe(1);
    expect(snapshot.big_hitter_recently_active_count).toBe(1);
    expect(snapshot.big_hitter_pressure_multiplier).toBe(1);
    expect(snapshot.base_pressure_score).toBe(2);
    expect(snapshot.pressure_score).toBe(5);
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
  prepare(sql: string): D1PreparedStatement {
    return new TestD1PreparedStatement(this, compactSql(sql)) as unknown as D1PreparedStatement;
  }

  first(sql: string, _args: unknown[]): unknown | null {
    if (sql.includes("FROM enemy_push_activity_snapshots")) {
      return null;
    }

    if (sql.includes("FROM enemy_faction_activity_samples")) {
      return { active_count: 8 };
    }

    if (sql.includes("FROM attacks")) {
      return { attacks: 1 };
    }

    return null;
  }

  all<T = unknown>(sql: string, _args: unknown[]): D1Result<T> {
    if (sql.includes("FROM enemy_big_hitters")) {
      return result([
        { member_id: 1 },
        { member_id: 3 },
      ] as T[]);
    }

    return result([]);
  }

  run<T = unknown>(_sql: string, _args: unknown[]): D1Result<T> {
    return result([]);
  }
}

function member(
  id: number,
  name: string,
  status: string,
  timestamp: number,
): TornFactionMember {
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
