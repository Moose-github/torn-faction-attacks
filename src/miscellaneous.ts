import { sendDiscordMessage } from "./discord";
import { Env } from "./types";
import { json, nowSeconds } from "./utils";

const TORN_SHOPLIFTING_API_URL = "https://api.torn.com/v2/torn";
const SHOPLIFTING_CACHE_ID = 1;
const SHOPLIFTING_SECURITY_ALERT_STATE_PREFIX = "shoplifting_security_alert";
const SHOPLIFTING_SECURITY_ALERTS = [
  { shopKey: "big_als", shopName: "Big Als" },
  { shopKey: "jewelry_store", shopName: "Jewelry Store" },
] as const;

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

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      Authorization: `ApiKey ${env.TORN_API_KEY}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Torn shoplifting API error: ${response.status}`);
  }

  const data = (await response.json()) as TornShopliftingResponse;
  if (data.error) {
    throw new Error(data.error.error ?? data.error.message ?? `Torn API error ${data.error.code ?? ""}`.trim());
  }

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

  for (const alert of SHOPLIFTING_SECURITY_ALERTS) {
    const obstacles = shoplifting[alert.shopKey] ?? [];
    const stateName = `${SHOPLIFTING_SECURITY_ALERT_STATE_PREFIX}:${alert.shopKey}`;
    const allSecuritiesDown = obstacles.length >= 2 && obstacles.every((obstacle) => obstacle.disabled);

    if (!allSecuritiesDown) {
      await clearShopliftingSecurityAlert(env, stateName);
      continue;
    }

    if (await hasShopliftingSecurityAlertBeenSent(env, stateName)) {
      continue;
    }

    await sendDiscordMessage(env, formatShopliftingSecurityAlert(alert.shopName, obstacles));
    await markShopliftingSecurityAlertSent(env, stateName, fetchedAt);
    alertsSent += 1;
  }

  return alertsSent;
}

async function hasShopliftingSecurityAlertBeenSent(env: Env, stateName: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `
    SELECT name
    FROM sync_state
    WHERE name = ?
    LIMIT 1
    `,
  )
    .bind(stateName)
    .first<{ name: string }>();

  return Boolean(row);
}

async function markShopliftingSecurityAlertSent(env: Env, stateName: string, fetchedAt: number): Promise<void> {
  await env.DB.prepare(
    `
    INSERT INTO sync_state (name, last_started, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(name) DO UPDATE SET
      last_started = excluded.last_started,
      updated_at = CURRENT_TIMESTAMP
    `,
  )
    .bind(stateName, fetchedAt)
    .run();
}

async function clearShopliftingSecurityAlert(env: Env, stateName: string): Promise<void> {
  await env.DB.prepare(
    `
    DELETE FROM sync_state
    WHERE name = ?
    `,
  )
    .bind(stateName)
    .run();
}

function formatShopliftingSecurityAlert(shopName: string, _obstacles: TornShopliftingObstacle[]): string {
  return `Shoplifting alert: all securities are down at ${shopName}.`;
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
