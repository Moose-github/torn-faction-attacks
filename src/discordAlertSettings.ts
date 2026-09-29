import { readJsonObject } from "./backend/request";
import { DISCORD_ALERTS, discordAlertByKey } from "../shared/discordAlertCatalog";
import { legacyDiscordAlertSettings, legacyShopAlertKey } from "../shared/discordAlertSettingsCompatibility";
import type { AdminDiscordAlertSettingsResponse, DiscordAlertSetting, DiscordAlertRouteSummary } from "../shared/discordAlertSettings";
export type { DiscordAlertSetting, DiscordAlertRouteSummary } from "../shared/discordAlertSettings";
import { createDiscordBotMessage } from "./discord";
import { readDiscordChannelNames } from "./discordChannelNames";
import {
  DISCORD_ALERT_CHANNEL_ROUTES,
  DISCORD_ALERT_KEYS,
  DISCORD_DEFAULT_ALERT_ROUTE_KEY,
  discordAlertRouteByKey,
  type DiscordAlertKey,
  type DiscordAlertRouteKey,
} from "./discordAlerts";
import {
  discordNotificationChannelTargetId,
  listDiscordNotificationChannels,
  readConfiguredDiscordNotificationChannel,
  readDiscordNotificationChannel,
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

type AlertSettingConfig = typeof DISCORD_ALERTS[number];

type AlertSettingRow = {
  alert_key: string;
  enabled: number;
  configurable: number;
};

export async function readDiscordAlertSettings(env: Env): Promise<Record<DiscordAlertKey, DiscordAlertSetting>> {
  const rows = await readAlertSettingMap(env);
  return Object.fromEntries(DISCORD_ALERTS.map(alert => [alert.key, resolveAlertSetting(alert, rows.get(alert.key))])) as Record<DiscordAlertKey, DiscordAlertSetting>;
}

export async function getAdminDiscordAlertSettings(env: Env): Promise<Response> {
  const [settings, routes] = await Promise.all([readDiscordAlertSettings(env), readDiscordAlertRouteSummaries(env)]);
  return json({
    ok: true,
    settings_by_key: settings,
    ...legacyDiscordAlertSettings(settings),
    routes,
  } satisfies AdminDiscordAlertSettingsResponse);
}

export async function testAdminDiscordAlertRouteFromRequest(request: Request, env: Env): Promise<Response> {
  const body = await readJsonObject(request);
  const alertKey = typeof body.alert_key === "string" ? body.alert_key : "";
  const alert = discordAlertRouteByKey(alertKey);
  if (!alert) {
    return json({ ok: false, error: "Unknown alert route", code: "UNKNOWN_ALERT_ROUTE" }, 400);
  }

  const guildId = readDiscordNotificationGuildId(env);
  if (!guildId) {
    return json(
      { ok: false, error: "DISCORD_GUILD_ID is not configured", code: "MISSING_DISCORD_GUILD_ID" },
      500,
    );
  }

  const route = alert.key === DISCORD_DEFAULT_ALERT_ROUTE_KEY
    ? await readDiscordNotificationChannel(env, guildId, DISCORD_DEFAULT_ALERT_ROUTE_KEY)
    : await readConfiguredDiscordNotificationChannel(env, alert.key);
  if (!route) {
    return json(
      {
        ok: false,
        error: alert.key === DISCORD_DEFAULT_ALERT_ROUTE_KEY
          ? "No default Discord alert route is configured"
          : "No Discord alert route or default route is configured",
        code: "NO_DISCORD_ALERT_ROUTE",
      },
      409,
    );
  }

  let messageId: string | null;
  try {
    messageId = await createDiscordBotMessage(
      env,
      discordNotificationChannelTargetId(route),
      `Discord alert route test: ${alert.name}`,
      { users: [], roles: [] },
      {
        embeds: [
          {
            title: "Discord alert route test",
            description: `This message was sent from Admin controls for **${alert.name}**.`,
            color: 0x2f80ed,
          },
        ],
      },
    );
  } catch (err: any) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`Discord alert route test failed for ${alert.key}:`, message);
    return json(
      {
        ok: false,
        error: message || "Discord alert route test failed",
        code: "DISCORD_ALERT_TEST_FAILED",
        alert_key: alert.key,
        route: discordAlertRouteSummary(route),
      },
      502,
    );
  }

  return json({
    ok: true,
    alert_key: alert.key,
    message_id: messageId,
    route: discordAlertRouteSummary(route),
  });
}

export async function updateAdminDiscordAlertSettingsFromRequest(request: Request, env: Env): Promise<Response> {
  const body = await readJsonObject(request);
  const key = typeof body.alert_key === "string" ? body.alert_key : legacyShopAlertKey(body.shop_key);
  const alert = key ? discordAlertByKey(key) : null;
  if (!alert || !alert.configurable) {
    return json({ ok: false, error: "Unknown alert", code: "UNKNOWN_ALERT" }, 400);
  }
  const error = await updateAlertSettingFromBody(env, alert.key, body.enabled);
  if (error) return error;
  return getAdminDiscordAlertSettings(env);
}

export async function isDiscordAlertEnabled(env: Env, alertKey: DiscordAlertKey): Promise<boolean> {
  return (await readConfiguredAlertSetting(env, alertConfig(alertKey))).enabled;
}

export async function isEnemyPushAlertEnabled(env: Env): Promise<boolean> {
  return isDiscordAlertEnabled(env, DISCORD_ALERT_KEYS.enemyPush);
}

export async function updateEnemyPushAlertSetting(env: Env, enabled: boolean): Promise<void> {
  await updateAlertSetting(env, DISCORD_ALERT_KEYS.enemyPush, enabled);
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

// Operational cleanup stays on the server, outside the shared configuration catalog.
const ALERT_DISABLE_HANDLERS: Partial<Record<DiscordAlertKey, (env: Env) => Promise<unknown>>> = {
  [DISCORD_ALERT_KEYS.enemyPush]: env => clearSyncLatchesByPrefix(env, `${ENEMY_PUSH_ALERT_STATE_PREFIX}:`),
  [DISCORD_ALERT_KEYS.bigAlsShoplifting]: env => clearSyncLatch(env, DISCORD_ALERT_KEYS.bigAlsShoplifting),
  [DISCORD_ALERT_KEYS.jewelryStoreShoplifting]: env => clearSyncLatch(env, DISCORD_ALERT_KEYS.jewelryStoreShoplifting),
};

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

  if (!enabled) await ALERT_DISABLE_HANDLERS[alertKey]?.(env);
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

  return resolveAlertSetting(config, row);
}

function resolveAlertSetting(config: AlertSettingConfig, row?: AlertSettingRow | null): DiscordAlertSetting {
  return {
    key: config.key,
    name: config.admin.label,
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
): Promise<Record<DiscordAlertRouteKey, DiscordAlertRouteSummary | null>> {
  const guildId = readDiscordNotificationGuildId(env);
  const routesByAlertKey = new Map<DiscordAlertRouteKey, DiscordNotificationChannel>();
  if (guildId) {
    const routes = await listDiscordNotificationChannels(env, guildId);
    routes.forEach((route) => routesByAlertKey.set(route.alertKey, route));
  }
  const names = guildId
    ? await readDiscordChannelNames(env, guildId, Array.from(routesByAlertKey.values()).flatMap((route) =>
      route.threadId ? [route.channelId, route.threadId] : [route.channelId]
    ))
    : new Map<string, string>();

  return Object.fromEntries(
    DISCORD_ALERT_CHANNEL_ROUTES.map((alert) => {
      const route = routesByAlertKey.get(alert.key);
      return [
        alert.key,
        route ? discordAlertRouteSummary(route, names) : null,
      ];
    }),
  ) as Record<DiscordAlertRouteKey, DiscordAlertRouteSummary | null>;
}

function discordAlertRouteSummary(
  route: DiscordNotificationChannel,
  names: ReadonlyMap<string, string> = new Map(),
): DiscordAlertRouteSummary {
  return {
    alert_key: route.alertKey,
    channel_id: route.channelId,
    channel_name: names.get(route.channelId) ?? null,
    thread_id: route.threadId,
    thread_name: route.threadId ? names.get(route.threadId) ?? null : null,
    target_id: discordNotificationChannelTargetId(route),
    updated_by_discord_id: route.updatedByDiscordId,
    updated_at: route.updatedAt,
  };
}

function alertConfig(alertKey: DiscordAlertKey): AlertSettingConfig {
  const config = discordAlertByKey(alertKey);
  if (!config) {
    throw new Error(`Unknown Discord alert setting: ${alertKey}`);
  }
  return config;
}
