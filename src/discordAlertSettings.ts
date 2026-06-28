import { readJsonObject } from "./backend/request";
import { DISCORD_ALERT_KEYS } from "./discordAlerts";
import {
  clearSyncLatch,
  clearSyncLatchesByPrefix,
  isSyncLatchSet,
  readSetSyncLatches,
  setSyncLatch,
} from "./syncLatches";
import { Env } from "./types";
import { json, nowSeconds } from "./utils";

export const ENEMY_PUSH_ALERT_STATE_PREFIX = "enemy_push_alert";

const ENEMY_PUSH_ALERT_ENABLED_STATE_NAME = "enemy_push_alert_discord_enabled";
const SHOPLIFTING_SECURITY_ALERT_ENABLED_STATE_PREFIX = "shoplifting_security_alert_enabled";
const SHOPLIFTING_SECURITY_ALERT_DISABLED_STATE_PREFIX = "shoplifting_security_alert_disabled";

export const SHOPLIFTING_SECURITY_ALERTS = [
  { shopKey: "big_als", shopName: "Big Als", defaultEnabled: true, configurable: true },
  { shopKey: "jewelry_store", shopName: "Jewelry Store", defaultEnabled: false, configurable: true },
] as const;

export type ShopliftingSecurityAlertConfig = typeof SHOPLIFTING_SECURITY_ALERTS[number];

export type ShopliftingSecurityAlertSetting = {
  shop_key: ShopliftingSecurityAlertConfig["shopKey"];
  shop_name: ShopliftingSecurityAlertConfig["shopName"];
  enabled: boolean;
  configurable: boolean;
};

export type EnemyPushAlertSetting = {
  key: typeof DISCORD_ALERT_KEYS.enemyPush;
  name: string;
  enabled: boolean;
  configurable: boolean;
};

export async function getAdminDiscordAlertSettings(env: Env): Promise<Response> {
  return json({
    ok: true,
    alerts: await readShopliftingSecurityAlertSettings(env),
    enemy_push_alert: await readEnemyPushAlertSetting(env),
  });
}

export async function updateAdminDiscordAlertSettingsFromRequest(request: Request, env: Env): Promise<Response> {
  const body = await readJsonObject(request);
  if (body.alert_key === DISCORD_ALERT_KEYS.enemyPush) {
    if (typeof body.enabled !== "boolean") {
      return json({ ok: false, error: "enabled must be a boolean", code: "INVALID_ENABLED" }, 400);
    }

    await updateEnemyPushAlertSetting(env, body.enabled);
    return getAdminDiscordAlertSettings(env);
  }

  const shopKey = typeof body.shop_key === "string" ? body.shop_key : "";
  const alert = SHOPLIFTING_SECURITY_ALERTS.find((candidate) => candidate.shopKey === shopKey);
  if (!alert || !alert.configurable) {
    return json({ ok: false, error: "Unknown shoplifting alert", code: "UNKNOWN_SHOPLIFTING_ALERT" }, 400);
  }
  if (typeof body.enabled !== "boolean") {
    return json({ ok: false, error: "enabled must be a boolean", code: "INVALID_ENABLED" }, 400);
  }

  await updateShopliftingSecurityAlertSetting(env, alert, body.enabled);
  return getAdminDiscordAlertSettings(env);
}

export async function readEnemyPushAlertSetting(env: Env): Promise<EnemyPushAlertSetting> {
  return {
    key: DISCORD_ALERT_KEYS.enemyPush,
    name: "Enemy push alerts",
    enabled: await isEnemyPushAlertEnabled(env),
    configurable: true,
  };
}

export async function updateEnemyPushAlertSetting(env: Env, enabled: boolean): Promise<void> {
  if (enabled) {
    await setSyncLatch(env, ENEMY_PUSH_ALERT_ENABLED_STATE_NAME, nowSeconds());
    return;
  }

  await clearSyncLatch(env, ENEMY_PUSH_ALERT_ENABLED_STATE_NAME);
  await clearSyncLatchesByPrefix(env, `${ENEMY_PUSH_ALERT_STATE_PREFIX}:`);
}

export async function isEnemyPushAlertEnabled(env: Env): Promise<boolean> {
  return isSyncLatchSet(env, ENEMY_PUSH_ALERT_ENABLED_STATE_NAME);
}

export async function readShopliftingSecurityAlertSettings(
  env: Env,
): Promise<ShopliftingSecurityAlertSetting[]> {
  const enabledStateNames = SHOPLIFTING_SECURITY_ALERTS
    .filter((alert) => !alert.defaultEnabled)
    .map((alert) => shopliftingAlertEnabledStateName(alert.shopKey));
  const disabledStateNames = SHOPLIFTING_SECURITY_ALERTS
    .filter((alert) => alert.defaultEnabled)
    .map((alert) => shopliftingAlertDisabledStateName(alert.shopKey));
  const enabledOverrides = await readSetSyncLatches(env, enabledStateNames);
  const disabledOverrides = await readSetSyncLatches(env, disabledStateNames);

  return SHOPLIFTING_SECURITY_ALERTS.map((alert) => ({
    shop_key: alert.shopKey,
    shop_name: alert.shopName,
    enabled: alert.defaultEnabled
      ? !disabledOverrides.has(shopliftingAlertDisabledStateName(alert.shopKey))
      : enabledOverrides.has(shopliftingAlertEnabledStateName(alert.shopKey)),
    configurable: alert.configurable,
  }));
}

export async function updateShopliftingSecurityAlertSetting(
  env: Env,
  alert: ShopliftingSecurityAlertConfig,
  enabled: boolean,
): Promise<void> {
  if (enabled) {
    await clearSyncLatch(env, shopliftingAlertDisabledStateName(alert.shopKey));
    if (!alert.defaultEnabled) {
      await setSyncLatch(env, shopliftingAlertEnabledStateName(alert.shopKey), nowSeconds());
    }
    return;
  }

  await clearSyncLatch(env, shopliftingAlertEnabledStateName(alert.shopKey));
  if (alert.defaultEnabled) {
    await setSyncLatch(env, shopliftingAlertDisabledStateName(alert.shopKey), nowSeconds());
  }
  await clearSyncLatch(env, shopliftingAlertKey(alert));
}

export function shopliftingAlertKey(alert: Pick<ShopliftingSecurityAlertConfig, "shopKey">): string {
  return DISCORD_ALERT_KEYS.shopliftingSecurity(alert.shopKey);
}

function shopliftingAlertEnabledStateName(shopKey: ShopliftingSecurityAlertConfig["shopKey"]): string {
  return `${SHOPLIFTING_SECURITY_ALERT_ENABLED_STATE_PREFIX}:${shopKey}`;
}

function shopliftingAlertDisabledStateName(shopKey: ShopliftingSecurityAlertConfig["shopKey"]): string {
  return `${SHOPLIFTING_SECURITY_ALERT_DISABLED_STATE_PREFIX}:${shopKey}`;
}
