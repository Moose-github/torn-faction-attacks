import { sendDiscordMessage } from "./discord";
import { formatDiscordAlertMessage, readDiscordAlertMentions } from "./discordMentions";
import {
  readEnemyPushAlertSetting,
  updateEnemyPushAlertSetting,
} from "./enemyPushPressure";
import {
  clearSyncLatch,
  readSetSyncLatches,
  setSyncLatch,
} from "./syncLatches";
import { fetchTrackedTornJson } from "./external/torn";
import { Env } from "./types";
import { json, nowSeconds } from "./utils";
import { readJsonObject } from "./backend/request";

const TORN_SHOPLIFTING_API_URL = "https://api.torn.com/v2/torn";
const SHOPLIFTING_CACHE_ID = 1;
const SHOPLIFTING_CRIME_URL = "https://www.torn.com/page.php?sid=crimes#/shoplifting";
const SHOPLIFTING_SECURITY_ALERT_STATE_PREFIX = "shoplifting_security_alert";
const SHOPLIFTING_SECURITY_ALERT_ENABLED_STATE_PREFIX = "shoplifting_security_alert_enabled";
const SHOPLIFTING_SECURITY_ALERT_DISABLED_STATE_PREFIX = "shoplifting_security_alert_disabled";
const SHOPLIFTING_SECURITY_ALERTS = [
  { shopKey: "big_als", shopName: "Big Als", defaultEnabled: true, configurable: true },
  { shopKey: "jewelry_store", shopName: "Jewelry Store", defaultEnabled: false, configurable: true },
] as const;

type TornShopliftingObstacle = {
  title: string;
  disabled: boolean;
};

type ShopliftingSecurityAlertConfig = typeof SHOPLIFTING_SECURITY_ALERTS[number];

type ShopliftingSecurityAlertSetting = {
  shop_key: ShopliftingSecurityAlertConfig["shopKey"];
  shop_name: ShopliftingSecurityAlertConfig["shopName"];
  enabled: boolean;
  configurable: boolean;
};

type TornShopliftingResponse = {
  shoplifting?: Record<string, TornShopliftingObstacle[]>;
  error?: { error?: string; message?: string; code?: number };
};

type ShopliftingCacheRow = {
  data_json: string | null;
  fetched_at: number | null;
  error: string | null;
};

export async function getMiscellaneousData(env: Env): Promise<Response> {
  const row = await readShopliftingCache(env);
  return json({
    ok: true,
    shoplifting: parseCachedShoplifting(row?.data_json ?? null),
    fetched_at: row?.fetched_at ?? null,
    error: row?.error ?? null,
  });
}

export async function getAdminShopliftingAlertSettings(env: Env): Promise<Response> {
  return json({
    ok: true,
    alerts: await readShopliftingSecurityAlertSettings(env),
    enemy_push_alert: await readEnemyPushAlertSetting(env),
  });
}

export async function updateAdminShopliftingAlertSettings(request: Request, env: Env): Promise<Response> {
  const body = await readJsonObject(request);
  if (body.alert_key === "enemy_push") {
    if (typeof body.enabled !== "boolean") {
      return json({ ok: false, error: "enabled must be a boolean", code: "INVALID_ENABLED" }, 400);
    }

    await updateEnemyPushAlertSetting(env, body.enabled);
    return getAdminShopliftingAlertSettings(env);
  }

  const shopKey = typeof body.shop_key === "string" ? body.shop_key : "";
  const alert = SHOPLIFTING_SECURITY_ALERTS.find((candidate) => candidate.shopKey === shopKey);
  if (!alert || !alert.configurable) {
    return json({ ok: false, error: "Unknown shoplifting alert", code: "UNKNOWN_SHOPLIFTING_ALERT" }, 400);
  }
  if (typeof body.enabled !== "boolean") {
    return json({ ok: false, error: "enabled must be a boolean", code: "INVALID_ENABLED" }, 400);
  }

  if (body.enabled) {
    await clearSyncLatch(env, shopliftingAlertDisabledStateName(alert.shopKey));
    if (!alert.defaultEnabled) {
      await setSyncLatch(env, shopliftingAlertEnabledStateName(alert.shopKey), nowSeconds());
    }
  } else {
    await clearSyncLatch(env, shopliftingAlertEnabledStateName(alert.shopKey));
    if (alert.defaultEnabled) {
      await setSyncLatch(env, shopliftingAlertDisabledStateName(alert.shopKey), nowSeconds());
    }
    await clearShopliftingSecurityAlert(env, shopliftingAlertStateName(alert));
  }

  return getAdminShopliftingAlertSettings(env);
}

export async function refreshTornShoplifting(env: Env): Promise<{
  ok: boolean;
  shops: number;
  fetched_at: number | null;
  alerts_sent?: number;
  alert_error?: string;
  error?: string;
}> {
  try {
    const shoplifting = await fetchTornShoplifting(env);
    const fetchedAt = nowSeconds();

    await env.DB.prepare(
      `
      INSERT INTO torn_shoplifting_cache (id, data_json, fetched_at, error, updated_at)
      VALUES (?, ?, ?, NULL, unixepoch())
      ON CONFLICT(id) DO UPDATE SET
        data_json = excluded.data_json,
        fetched_at = excluded.fetched_at,
        error = NULL,
        updated_at = unixepoch()
      `,
    )
      .bind(SHOPLIFTING_CACHE_ID, JSON.stringify(shoplifting), fetchedAt)
      .run();

    let alertsSent = 0;
    let alertError: string | undefined;
    try {
      alertsSent = await sendShopliftingSecurityAlerts(env, shoplifting, fetchedAt);
    } catch (err: any) {
      alertError = err?.message || String(err);
      console.error("Shoplifting Discord alert failed:", alertError);
    }

    return {
      ok: true,
      shops: Object.keys(shoplifting).length,
      fetched_at: fetchedAt,
      alerts_sent: alertsSent,
      alert_error: alertError,
    };
  } catch (err: any) {
    const message = err?.message || String(err);
    await env.DB.prepare(
      `
      INSERT INTO torn_shoplifting_cache (id, error, updated_at)
      VALUES (?, ?, unixepoch())
      ON CONFLICT(id) DO UPDATE SET
        error = excluded.error,
        updated_at = unixepoch()
      `,
    )
      .bind(SHOPLIFTING_CACHE_ID, message)
      .run();

    return {
      ok: false,
      shops: 0,
      fetched_at: null,
      error: message,
    };
  }
}

async function readShopliftingCache(env: Env): Promise<ShopliftingCacheRow | null> {
  return (await env.DB.prepare(
    `
    SELECT data_json, fetched_at, error
    FROM torn_shoplifting_cache
    WHERE id = ?
    LIMIT 1
    `,
  )
    .bind(SHOPLIFTING_CACHE_ID)
    .first()) as ShopliftingCacheRow | null;
}

async function fetchTornShoplifting(env: Env): Promise<Record<string, TornShopliftingObstacle[]>> {
  const url = new URL(TORN_SHOPLIFTING_API_URL);
  url.searchParams.set("selections", "shoplifting");

  const data = await fetchTrackedTornJson<TornShopliftingResponse>(env, url, {
    headers: {
      Accept: "application/json",
      Authorization: `ApiKey ${env.TORN_API_KEY}`,
    },
  }, {
    feature: "miscellaneous:shoplifting",
    keySource: "env:TORN_API_KEY",
  }, {
    service: "Torn shoplifting",
  });

  return normalizeShoplifting(data.shoplifting ?? {});
}

function normalizeShoplifting(
  shoplifting: Record<string, TornShopliftingObstacle[]>,
): Record<string, TornShopliftingObstacle[]> {
  const normalized: Record<string, TornShopliftingObstacle[]> = {};

  for (const [shop, obstacles] of Object.entries(shoplifting)) {
    normalized[shop] = Array.isArray(obstacles)
      ? obstacles.map((obstacle) => ({
          title: String(obstacle.title ?? ""),
          disabled: Boolean(obstacle.disabled),
        }))
      : [];
  }

  return normalized;
}

async function sendShopliftingSecurityAlerts(
  env: Env,
  shoplifting: Record<string, TornShopliftingObstacle[]>,
  fetchedAt: number,
): Promise<number> {
  let alertsSent = 0;
  const sentAlertStates = await readSentShopliftingSecurityAlerts(env);
  const alertSettings = await readShopliftingSecurityAlertSettings(env);
  const enabledByShopKey = new Map(alertSettings.map((alert) => [alert.shop_key, alert.enabled]));

  for (const alert of SHOPLIFTING_SECURITY_ALERTS) {
    const obstacles = shoplifting[alert.shopKey] ?? [];
    const stateName = shopliftingAlertStateName(alert);
    const allSecuritiesDown = obstacles.length >= 2 && obstacles.every((obstacle) => obstacle.disabled);

    if (!enabledByShopKey.get(alert.shopKey)) {
      if (sentAlertStates.has(stateName)) {
        await clearShopliftingSecurityAlert(env, stateName);
      }
      continue;
    }

    if (!allSecuritiesDown) {
      if (sentAlertStates.has(stateName)) {
        await clearShopliftingSecurityAlert(env, stateName);
      }
      continue;
    }

    if (sentAlertStates.has(stateName)) {
      continue;
    }

    const mentions = await readDiscordAlertMentions(env, stateName);
    await sendDiscordMessage(
      env,
      formatDiscordAlertMessage(formatShopliftingSecurityAlert(alert.shopName), mentions.messageSuffix),
      mentions.allowedMentions,
    );
    await markShopliftingSecurityAlertSent(env, stateName, fetchedAt);
    alertsSent += 1;
  }

  return alertsSent;
}

async function readSentShopliftingSecurityAlerts(env: Env): Promise<Set<string>> {
  const stateNames = SHOPLIFTING_SECURITY_ALERTS.map(
    (alert) => shopliftingAlertStateName(alert),
  );
  return readSetSyncLatches(env, stateNames);
}

async function readShopliftingSecurityAlertSettings(env: Env): Promise<ShopliftingSecurityAlertSetting[]> {
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

async function markShopliftingSecurityAlertSent(env: Env, stateName: string, fetchedAt: number): Promise<void> {
  await setSyncLatch(env, stateName, fetchedAt);
}

async function clearShopliftingSecurityAlert(env: Env, stateName: string): Promise<void> {
  await clearSyncLatch(env, stateName);
}

function formatShopliftingSecurityAlert(shopName: string): string {
  return `[Shoplifting alert:](${SHOPLIFTING_CRIME_URL}) all securities are down at ${shopName}.`;
}

function shopliftingAlertStateName(alert: Pick<ShopliftingSecurityAlertConfig, "shopKey">): string {
  return `${SHOPLIFTING_SECURITY_ALERT_STATE_PREFIX}:${alert.shopKey}`;
}

function shopliftingAlertEnabledStateName(shopKey: ShopliftingSecurityAlertConfig["shopKey"]): string {
  return `${SHOPLIFTING_SECURITY_ALERT_ENABLED_STATE_PREFIX}:${shopKey}`;
}

function shopliftingAlertDisabledStateName(shopKey: ShopliftingSecurityAlertConfig["shopKey"]): string {
  return `${SHOPLIFTING_SECURITY_ALERT_DISABLED_STATE_PREFIX}:${shopKey}`;
}

function parseCachedShoplifting(value: string | null): Record<string, TornShopliftingObstacle[]> {
  if (!value) {
    return {};
  }

  try {
    return normalizeShoplifting(JSON.parse(value));
  } catch {
    return {};
  }
}
