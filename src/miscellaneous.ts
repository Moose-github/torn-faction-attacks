import { sendDiscordMessage } from "./discord";
import {
  readShopliftingSecurityAlertSettings,
  SHOPLIFTING_SECURITY_ALERTS,
  shopliftingAlertKey,
} from "./discordAlertSettings";
import { formatDiscordAlertMessage, readDiscordAlertMentions } from "./discordMentions";
import {
  clearSyncLatch,
  readSetSyncLatches,
  setSyncLatch,
} from "./syncLatches";
import { fetchTrackedTornJson } from "./external/torn";
import { withTornKeyPool } from "./tornKeyPool";
import { Env } from "./types";
import { json, nowSeconds } from "./utils";

const TORN_SHOPLIFTING_API_URL = "https://api.torn.com/v2/torn";
const SHOPLIFTING_CACHE_ID = 1;
const SHOPLIFTING_CRIME_URL = "https://www.torn.com/page.php?sid=crimes#/shoplifting";

type TornShopliftingObstacle = {
  title: string;
  disabled: boolean;
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

  const data = await withTornKeyPool(env, {
    feature: "misc_utilities",
    run: ({ key, keySource }) => fetchTrackedTornJson<TornShopliftingResponse>(env, url, {
      headers: {
        Accept: "application/json",
        Authorization: `ApiKey ${key}`,
      },
    }, {
      feature: "miscellaneous:shoplifting",
      keySource,
    }, {
      service: "Torn shoplifting",
    }),
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
    const alertKey = shopliftingAlertKey(alert);
    const allSecuritiesDown = obstacles.length >= 2 && obstacles.every((obstacle) => obstacle.disabled);

    if (!enabledByShopKey.get(alert.shopKey)) {
      if (sentAlertStates.has(alertKey)) {
        await clearShopliftingSecurityAlert(env, alertKey);
      }
      continue;
    }

    if (!allSecuritiesDown) {
      if (sentAlertStates.has(alertKey)) {
        await clearShopliftingSecurityAlert(env, alertKey);
      }
      continue;
    }

    if (sentAlertStates.has(alertKey)) {
      continue;
    }

    const mentions = await readDiscordAlertMentions(env, alertKey);
    await sendDiscordMessage(
      env,
      formatDiscordAlertMessage(formatShopliftingSecurityAlert(alert.shopName), mentions.messageSuffix),
      mentions.allowedMentions,
    );
    await markShopliftingSecurityAlertSent(env, alertKey, fetchedAt);
    alertsSent += 1;
  }

  return alertsSent;
}

async function readSentShopliftingSecurityAlerts(env: Env): Promise<Set<string>> {
  const alertKeys = SHOPLIFTING_SECURITY_ALERTS.map(
    (alert) => shopliftingAlertKey(alert),
  );
  return readSetSyncLatches(env, alertKeys);
}

async function markShopliftingSecurityAlertSent(env: Env, alertKey: string, fetchedAt: number): Promise<void> {
  await setSyncLatch(env, alertKey, fetchedAt);
}

async function clearShopliftingSecurityAlert(env: Env, alertKey: string): Promise<void> {
  await clearSyncLatch(env, alertKey);
}

function formatShopliftingSecurityAlert(shopName: string): string {
  return `[Shoplifting alert:](${SHOPLIFTING_CRIME_URL}) all securities are down at ${shopName}.`;
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
