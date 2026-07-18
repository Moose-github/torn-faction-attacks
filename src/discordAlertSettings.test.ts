import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAdminDiscordAlertSettings,
  isDiscordAlertEnabled,
  readShopliftingSecurityAlertSettings,
  updateAdminDiscordAlertSettingsFromRequest,
  updateEnemyPushAlertSetting,
} from "./discordAlertSettings";
import { DISCORD_ALERT_KEYS } from "./discordAlerts";
import {
  clearSyncLatch,
  clearSyncLatchesByPrefix,
} from "./syncLatches";
import type { Env } from "./types";

vi.mock("./syncLatches", () => ({
  clearSyncLatch: vi.fn(),
  clearSyncLatchesByPrefix: vi.fn(),
}));

describe("Discord alert settings", () => {
  let db: TestD1Database;
  let env: Env;

  beforeEach(() => {
    vi.clearAllMocks();
    db = new TestD1Database([
      ["chain_watch", { enabled: 0, configurable: 1 }],
      ["enemy_push", { enabled: 1, configurable: 1 }],
      ["shoplifting_security_alert:big_als", { enabled: 0, configurable: 1 }],
      ["shoplifting_security_alert:jewelry_store", { enabled: 1, configurable: 1 }],
    ]);
    env = { DB: db as unknown as D1Database } as Env;
  });

  it("reads global Discord alert settings from alert_settings", async () => {
    const response = await getAdminDiscordAlertSettings(env);

    expect(await response.json()).toEqual({
      ok: true,
      chain_watch_alert: {
        key: "chain_watch",
        name: "Chain watch alerts",
        enabled: false,
        configurable: true,
      },
      retaliation_board_alert: {
        key: "retaliation_board",
        name: "Retaliation board",
        enabled: true,
        configurable: true,
      },
      enemy_push_alert: {
        key: "enemy_push",
        name: "Enemy push alerts",
        enabled: true,
        configurable: true,
      },
      enemy_scouting_report_alert: {
        key: "enemy_scouting_report",
        name: "Enemy scouting report",
        enabled: true,
        configurable: true,
      },
      xanax_competition_alert: {
        key: "xanax_competition",
        name: "Xanax competition Discord reminder",
        enabled: true,
        configurable: true,
      },
      termed_war_auto_end_alert: {
        key: "termed_war_auto_end",
        name: "Termed war auto-end notice",
        enabled: true,
        configurable: true,
      },
      alerts: [
        {
          shop_key: "big_als",
          shop_name: "Big Als",
          enabled: false,
          configurable: true,
        },
        {
          shop_key: "jewelry_store",
          shop_name: "Jewelry Store",
          enabled: true,
          configurable: true,
        },
      ],
    });
  });

  it("falls back to configured defaults when rows are missing", async () => {
    db.settings.clear();

    await expect(isDiscordAlertEnabled(env, DISCORD_ALERT_KEYS.chainWatch)).resolves.toBe(true);
    await expect(isDiscordAlertEnabled(env, DISCORD_ALERT_KEYS.retaliationBoard)).resolves.toBe(true);
    await expect(isDiscordAlertEnabled(env, DISCORD_ALERT_KEYS.enemyPush)).resolves.toBe(false);
    await expect(isDiscordAlertEnabled(env, DISCORD_ALERT_KEYS.enemyScoutingReport)).resolves.toBe(true);
    await expect(isDiscordAlertEnabled(env, DISCORD_ALERT_KEYS.xanaxCompetition)).resolves.toBe(true);
    await expect(isDiscordAlertEnabled(env, DISCORD_ALERT_KEYS.termedWarAutoEnd)).resolves.toBe(true);
    await expect(readShopliftingSecurityAlertSettings(env)).resolves.toEqual([
      {
        shop_key: "big_als",
        shop_name: "Big Als",
        enabled: true,
        configurable: true,
      },
      {
        shop_key: "jewelry_store",
        shop_name: "Jewelry Store",
        enabled: false,
        configurable: true,
      },
    ]);
  });

  it("updates chain watch alert settings", async () => {
    await updateAdminDiscordAlertSettingsFromRequest(jsonRequest({ alert_key: "chain_watch", enabled: true }), env);

    expect(db.settings.get("chain_watch")).toMatchObject({ enabled: 1, configurable: 1 });
    expect(clearSyncLatchesByPrefix).not.toHaveBeenCalled();
  });

  it("updates Discord-only report and reminder alert settings", async () => {
    await updateAdminDiscordAlertSettingsFromRequest(
      jsonRequest({ alert_key: DISCORD_ALERT_KEYS.enemyScoutingReport, enabled: false }),
      env,
    );
    await updateAdminDiscordAlertSettingsFromRequest(
      jsonRequest({ alert_key: DISCORD_ALERT_KEYS.xanaxCompetition, enabled: false }),
      env,
    );
    await updateAdminDiscordAlertSettingsFromRequest(
      jsonRequest({ alert_key: DISCORD_ALERT_KEYS.termedWarAutoEnd, enabled: false }),
      env,
    );

    expect(db.settings.get(DISCORD_ALERT_KEYS.enemyScoutingReport)).toMatchObject({ enabled: 0, configurable: 1 });
    expect(db.settings.get(DISCORD_ALERT_KEYS.xanaxCompetition)).toMatchObject({ enabled: 0, configurable: 1 });
    expect(db.settings.get(DISCORD_ALERT_KEYS.termedWarAutoEnd)).toMatchObject({ enabled: 0, configurable: 1 });
  });

  it("disables enemy push alerts and clears pending push alert latches", async () => {
    await updateEnemyPushAlertSetting(env, false);

    expect(db.settings.get("enemy_push")).toMatchObject({ enabled: 0, configurable: 1 });
    expect(clearSyncLatchesByPrefix).toHaveBeenCalledWith(env, "enemy_push_alert:");
  });

  it("updates shoplifting alert settings and clears sent latch when disabled", async () => {
    await updateAdminDiscordAlertSettingsFromRequest(jsonRequest({ shop_key: "big_als", enabled: false }), env);

    expect(db.settings.get("shoplifting_security_alert:big_als")).toMatchObject({ enabled: 0, configurable: 1 });
    expect(clearSyncLatch).toHaveBeenCalledWith(env, "shoplifting_security_alert:big_als");
  });

  it("rejects unknown alert setting updates", async () => {
    const response = await updateAdminDiscordAlertSettingsFromRequest(
      jsonRequest({ shop_key: "unknown", enabled: true }),
      env,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      ok: false,
      code: "UNKNOWN_ALERT",
    });
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
    return this.db.run(this.args) as D1Result<T>;
  }
}

class TestD1Database {
  readonly settings: Map<string, { enabled: number; configurable: number }>;

  constructor(entries: Array<[string, { enabled: number; configurable: number }]>) {
    this.settings = new Map(entries);
  }

  prepare(sql: string): D1PreparedStatement {
    return new TestD1PreparedStatement(this, compactSql(sql)) as unknown as D1PreparedStatement;
  }

  first(sql: string, args: unknown[]): unknown | null {
    if (sql.includes("FROM alert_settings")) {
      const key = String(args[0] ?? "");
      const row = this.settings.get(key);
      return row ? { alert_key: key, ...row } : null;
    }
    return null;
  }

  all<T = unknown>(sql: string): D1Result<T> {
    if (sql.includes("FROM alert_settings")) {
      return result(Array.from(this.settings, ([alert_key, row]) => ({ alert_key, ...row })) as T[]);
    }
    return result([]);
  }

  run<T = unknown>(args: unknown[]): D1Result<T> {
    const key = String(args[0] ?? "");
    this.settings.set(key, {
      enabled: Number(args[1] ?? 0),
      configurable: Number(args[2] ?? 1),
    });
    return result([]);
  }
}

function jsonRequest(body: unknown): Request {
  return new Request("https://worker.test/api/admin/discord-alerts/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
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
