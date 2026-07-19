import { readJsonObject } from "./backend/request";
import { DISCORD_ALERT_KEYS, type DiscordAlertKey } from "./discordAlerts";
import {
  discordNotificationChannelTargetId,
  listDiscordNotificationChannels,
  readDiscordNotificationGuildId,
  type DiscordNotificationChannel,
} from "./discordNotificationChannels";
import {
  clearSyncLatch,
  clearSyncLatchesByPrefix,
} from "./syncLatches";
import { Env } from "./types";
import { json } from "./utils";

export const ENEMY_PUSH_ALERT_STATE_PREFIX = "enemy_push_alert";

export const SHOPLIFTING_SECURITY_ALERTS = [
  { shopKey: "big_als", shopName: "Big Als", defaultEnabled: true, configurable: true },
  { shopKey: "jewelry_store", shopName: "Jewelry Store", defaultEnabled: false, configurable: true },
] as const;

export type ShopliftingSecurityAlertConfig = typeof SHOPLIFTING_SECURITY_ALERTS[number];

export type DiscordAlertSetting = {
  key: DiscordAlertKey;
  name: string;
  enabled: boolean;
  configurable: boolean;
};

export type DiscordAlertRouteSummary = {
  alert_key: DiscordAlertKey;
  channel_id: string;
  thread_id: string | null;
  target_id: string;
  updated_by_discord_id: string | null;
  updated_at: number;
};

export type ShopliftingSecurityAlertSetting = {
  shop_key: ShopliftingSecurityAlertConfig["shopKey"];
  shop_name: ShopliftingSecurityAlertConfig["shopName"];
  enabled: boolean;
  configurable: boolean;
};

export type ChainWatchAlertSetting = DiscordAlertSetting & {
  key: typeof DISCORD_ALERT_KEYS.chainWatch;
};

export type EnemyPushAlertSetting = DiscordAlertSetting & {
  key: typeof DISCORD_ALERT_KEYS.enemyPush;
};

export type RetaliationBoardAlertSetting = DiscordAlertSetting & {
  key: typeof DISCORD_ALERT_KEYS.retaliationBoard;
};

export type EnemyScoutingReportAlertSetting = DiscordAlertSetting & {
  key: typeof DISCORD_ALERT_KEYS.enemyScoutingReport;
};

export type XanaxCompetitionAlertSetting = DiscordAlertSetting & {
  key: typeof DISCORD_ALERT_KEYS.xanaxCompetition;
};

export type TermedWarAutoEndAlertSetting = DiscordAlertSetting & {
  key: typeof DISCORD_ALERT_KEYS.termedWarAutoEnd;
};

type AlertSettingConfig = {
  key: DiscordAlertKey;
  name: string;
  defaultEnabled: boolean;
  configurable: boolean;
};

type AlertSettingRow = {
  alert_key: string;
  enabled: number;
  configurable: number;
};

const ALERT_SETTING_CONFIGS = [
  {
    key: DISCORD_ALERT_KEYS.chainWatch,
    name: "Chain watch alerts",
    defaultEnabled: true,
    configurable: true,
  },
  {
    key: DISCORD_ALERT_KEYS.enemyPush,
    name: "Enemy push alerts",
    defaultEnabled: false,
    configurable: true,
  },
  {
    key: DISCORD_ALERT_KEYS.retaliationBoard,
    name: "Retaliation board",
    defaultEnabled: true,
    configurable: true,
  },
  {
    key: DISCORD_ALERT_KEYS.enemyScoutingReport,
    name: "Enemy scouting report",
    defaultEnabled: true,
    configurable: true,
  },
  {
    key: DISCORD_ALERT_KEYS.xanaxCompetition,
    name: "Xanax competition Discord reminder",
    defaultEnabled: true,
    configurable: true,
  },
  {
    key: DISCORD_ALERT_KEYS.termedWarAutoEnd,
    name: "Termed war auto-end notice",
    defaultEnabled: true,
    configurable: true,
  },
  {
    key: DISCORD_ALERT_KEYS.shopliftingSecurity("big_als"),
    name: "Big Als shoplifting",
    defaultEnabled: true,
    configurable: true,
  },
  {
    key: DISCORD_ALERT_KEYS.shopliftingSecurity("jewelry_store"),
    name: "Jewelry Store shoplifting",
    defaultEnabled: false,
    configurable: true,
  },
] as const satisfies readonly AlertSettingConfig[];

export async function getAdminDiscordAlertSettings(env: Env): Promise<Response> {
  const routes = await readDiscordAlertRouteSummaries(env);
  return json({
    ok: true,
    chain_watch_alert: await readChainWatchAlertSetting(env),
    retaliation_board_alert: await readRetaliationBoardAlertSetting(env),
    enemy_push_alert: await readEnemyPushAlertSetting(env),
    enemy_scouting_report_alert: await readEnemyScoutingReportAlertSetting(env),
    xanax_competition_alert: await readXanaxCompetitionAlertSetting(env),
    termed_war_auto_end_alert: await readTermedWarAutoEndAlertSetting(env),
    alerts: await readShopliftingSecurityAlertSettings(env),
    routes,
  });
}

export async function updateAdminDiscordAlertSettingsFromRequest(request: Request, env: Env): Promise<Response> {
  const body = await readJsonObject(request);
  if (body.alert_key === DISCORD_ALERT_KEYS.chainWatch) {
    const error = await updateAlertSettingFromBody(env, DISCORD_ALERT_KEYS.chainWatch, body.enabled);
    if (error) return error;
    return getAdminDiscordAlertSettings(env);
  }

  if (body.alert_key === DISCORD_ALERT_KEYS.enemyPush) {
    const error = await updateAlertSettingFromBody(env, DISCORD_ALERT_KEYS.enemyPush, body.enabled);
    if (error) return error;
    return getAdminDiscordAlertSettings(env);
  }

  if (body.alert_key === DISCORD_ALERT_KEYS.retaliationBoard) {
    const error = await updateAlertSettingFromBody(env, DISCORD_ALERT_KEYS.retaliationBoard, body.enabled);
    if (error) return error;
    return getAdminDiscordAlertSettings(env);
  }

  if (body.alert_key === DISCORD_ALERT_KEYS.enemyScoutingReport) {
    const error = await updateAlertSettingFromBody(env, DISCORD_ALERT_KEYS.enemyScoutingReport, body.enabled);
    if (error) return error;
    return getAdminDiscordAlertSettings(env);
  }

  if (body.alert_key === DISCORD_ALERT_KEYS.xanaxCompetition) {
    const error = await updateAlertSettingFromBody(env, DISCORD_ALERT_KEYS.xanaxCompetition, body.enabled);
    if (error) return error;
    return getAdminDiscordAlertSettings(env);
  }

  if (body.alert_key === DISCORD_ALERT_KEYS.termedWarAutoEnd) {
    const error = await updateAlertSettingFromBody(env, DISCORD_ALERT_KEYS.termedWarAutoEnd, body.enabled);
    if (error) return error;
    return getAdminDiscordAlertSettings(env);
  }

  const alertKey = typeof body.alert_key === "string" ? body.alert_key : "";
  const shopliftingAlert = SHOPLIFTING_SECURITY_ALERTS.find(
    (alert) => alertKey === shopliftingAlertKey(alert) || body.shop_key === alert.shopKey,
  );
  if (!shopliftingAlert || !shopliftingAlert.configurable) {
    return json({ ok: false, error: "Unknown alert", code: "UNKNOWN_ALERT" }, 400);
  }

  const error = await updateAlertSettingFromBody(env, shopliftingAlertKey(shopliftingAlert), body.enabled);
  if (error) return error;
  return getAdminDiscordAlertSettings(env);
}

export async function readChainWatchAlertSetting(env: Env): Promise<ChainWatchAlertSetting> {
  return readConfiguredAlertSetting(env, alertConfig(DISCORD_ALERT_KEYS.chainWatch)) as Promise<ChainWatchAlertSetting>;
}

export async function readEnemyPushAlertSetting(env: Env): Promise<EnemyPushAlertSetting> {
  return readConfiguredAlertSetting(env, alertConfig(DISCORD_ALERT_KEYS.enemyPush)) as Promise<EnemyPushAlertSetting>;
}

export async function readRetaliationBoardAlertSetting(env: Env): Promise<RetaliationBoardAlertSetting> {
  return readConfiguredAlertSetting(
    env,
    alertConfig(DISCORD_ALERT_KEYS.retaliationBoard),
  ) as Promise<RetaliationBoardAlertSetting>;
}

export async function readEnemyScoutingReportAlertSetting(env: Env): Promise<EnemyScoutingReportAlertSetting> {
  return readConfiguredAlertSetting(
    env,
    alertConfig(DISCORD_ALERT_KEYS.enemyScoutingReport),
  ) as Promise<EnemyScoutingReportAlertSetting>;
}

export async function readXanaxCompetitionAlertSetting(env: Env): Promise<XanaxCompetitionAlertSetting> {
  return readConfiguredAlertSetting(
    env,
    alertConfig(DISCORD_ALERT_KEYS.xanaxCompetition),
  ) as Promise<XanaxCompetitionAlertSetting>;
}

export async function readTermedWarAutoEndAlertSetting(env: Env): Promise<TermedWarAutoEndAlertSetting> {
  return readConfiguredAlertSetting(
    env,
    alertConfig(DISCORD_ALERT_KEYS.termedWarAutoEnd),
  ) as Promise<TermedWarAutoEndAlertSetting>;
}

export async function isDiscordAlertEnabled(env: Env, alertKey: DiscordAlertKey): Promise<boolean> {
  return (await readConfiguredAlertSetting(env, alertConfig(alertKey))).enabled;
}

export async function isEnemyPushAlertEnabled(env: Env): Promise<boolean> {
  return isDiscordAlertEnabled(env, DISCORD_ALERT_KEYS.enemyPush);
}

export async function readShopliftingSecurityAlertSettings(
  env: Env,
): Promise<ShopliftingSecurityAlertSetting[]> {
  const settings = await readAlertSettingMap(env);
  return SHOPLIFTING_SECURITY_ALERTS.map((alert) => {
    const key = shopliftingAlertKey(alert);
    const config = alertConfig(key);
    const row = settings.get(key);
    return {
      shop_key: alert.shopKey,
      shop_name: alert.shopName,
      enabled: row ? row.enabled === 1 : config.defaultEnabled,
      configurable: row ? row.configurable === 1 : config.configurable,
    };
  });
}

export async function updateEnemyPushAlertSetting(env: Env, enabled: boolean): Promise<void> {
  await updateAlertSetting(env, DISCORD_ALERT_KEYS.enemyPush, enabled);
}

export function shopliftingAlertKey(alert: Pick<ShopliftingSecurityAlertConfig, "shopKey">): DiscordAlertKey {
  return DISCORD_ALERT_KEYS.shopliftingSecurity(alert.shopKey);
}

async function updateAlertSettingFromBody(
  env: Env,
  alertKey: DiscordAlertKey,
  enabled: unknown,
): Promise<Response | null> {
  if (typeof enabled !== "boolean") {
    return json({ ok: false, error: "enabled must be a boolean", code: "INVALID_ENABLED" }, 400);
  }

  await updateAlertSetting(env, alertKey, enabled);
  return null;
}

async function updateAlertSetting(env: Env, alertKey: DiscordAlertKey, enabled: boolean): Promise<void> {
  const config = alertConfig(alertKey);
  await env.DB.prepare(
    `
    INSERT INTO alert_settings (alert_key, enabled, configurable, scope, updated_at)
    VALUES (?, ?, ?, 'global', unixepoch())
    ON CONFLICT(alert_key) DO UPDATE SET
      enabled = excluded.enabled,
      configurable = excluded.configurable,
      updated_at = excluded.updated_at
    `,
  )
    .bind(alertKey, enabled ? 1 : 0, config.configurable ? 1 : 0)
    .run();

  if (!enabled && alertKey === DISCORD_ALERT_KEYS.enemyPush) {
    await clearSyncLatchesByPrefix(env, `${ENEMY_PUSH_ALERT_STATE_PREFIX}:`);
  }
  if (!enabled && alertKey.startsWith("shoplifting_security_alert:")) {
    await clearSyncLatch(env, alertKey);
  }
}

async function readConfiguredAlertSetting(
  env: Env,
  config: AlertSettingConfig,
): Promise<DiscordAlertSetting> {
  const row = (await env.DB.prepare(
    `
    SELECT alert_key, enabled, configurable
    FROM alert_settings
    WHERE alert_key = ?
    LIMIT 1
    `,
  )
    .bind(config.key)
    .first()) as AlertSettingRow | null;

  return {
    key: config.key,
    name: config.name,
    enabled: row ? row.enabled === 1 : config.defaultEnabled,
    configurable: row ? row.configurable === 1 : config.configurable,
  };
}

async function readAlertSettingMap(env: Env): Promise<Map<string, AlertSettingRow>> {
  const result = await env.DB.prepare(
    `
    SELECT alert_key, enabled, configurable
    FROM alert_settings
    `,
  ).all<AlertSettingRow>();

  return new Map((result.results ?? []).map((row) => [row.alert_key, row]));
}

async function readDiscordAlertRouteSummaries(
  env: Env,
): Promise<Record<DiscordAlertKey, DiscordAlertRouteSummary | null>> {
  const guildId = readDiscordNotificationGuildId(env);
  const routesByAlertKey = new Map<DiscordAlertKey, DiscordNotificationChannel>();
  if (guildId) {
    const routes = await listDiscordNotificationChannels(env, guildId);
    routes.forEach((route) => routesByAlertKey.set(route.alertKey, route));
  }

  return Object.fromEntries(
    ALERT_SETTING_CONFIGS.map((config) => {
      const route = routesByAlertKey.get(config.key);
      return [
        config.key,
        route
          ? {
              alert_key: route.alertKey,
              channel_id: route.channelId,
              thread_id: route.threadId,
              target_id: discordNotificationChannelTargetId(route),
              updated_by_discord_id: route.updatedByDiscordId,
              updated_at: route.updatedAt,
            }
          : null,
      ];
    }),
  ) as Record<DiscordAlertKey, DiscordAlertRouteSummary | null>;
}

function alertConfig(alertKey: DiscordAlertKey): AlertSettingConfig {
  const config = ALERT_SETTING_CONFIGS.find((candidate) => candidate.key === alertKey);
  if (!config) {
    throw new Error(`Unknown Discord alert setting: ${alertKey}`);
  }
  return config;
}
