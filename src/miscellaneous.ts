import { DiscordAllowedMentions, sendDiscordMessage } from "./discord";
import {
  clearSyncLatch,
  readSetSyncLatches,
  setSyncLatch,
} from "./syncLatches";
import { Env } from "./types";
import { json, nowSeconds } from "./utils";

const TORN_SHOPLIFTING_API_URL = "https://api.torn.com/v2/torn";
const SHOPLIFTING_CACHE_ID = 1;
const SHOPLIFTING_CRIME_URL = "https://www.torn.com/page.php?sid=crimes#/shoplifting";
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

type DiscordAlertMentionRow = {
  mention_type: string;
  discord_id: string;
};

type DiscordAlertMentions = {
  messageSuffix: string;
  allowedMentions: DiscordAllowedMentions | undefined;
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
  const sentAlertStates = await readSentShopliftingSecurityAlerts(env);

  for (const alert of SHOPLIFTING_SECURITY_ALERTS) {
    const obstacles = shoplifting[alert.shopKey] ?? [];
    const stateName = `${SHOPLIFTING_SECURITY_ALERT_STATE_PREFIX}:${alert.shopKey}`;
    const allSecuritiesDown = obstacles.length >= 2 && obstacles.every((obstacle) => obstacle.disabled);

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
    (alert) => `${SHOPLIFTING_SECURITY_ALERT_STATE_PREFIX}:${alert.shopKey}`,
  );
  return readSetSyncLatches(env, stateNames);
}

async function markShopliftingSecurityAlertSent(env: Env, stateName: string, fetchedAt: number): Promise<void> {
  await setSyncLatch(env, stateName, fetchedAt);
}

async function clearShopliftingSecurityAlert(env: Env, stateName: string): Promise<void> {
  await clearSyncLatch(env, stateName);
}

async function readDiscordAlertMentions(env: Env, alertKey: string): Promise<DiscordAlertMentions> {
  const result = await env.DB.prepare(
    `
    SELECT mention_type, discord_id
    FROM discord_alert_mentions
    WHERE alert_key = ?
      AND enabled = 1
    ORDER BY mention_type, discord_id
    `,
  )
    .bind(alertKey)
    .all<DiscordAlertMentionRow>();
  const rows = result.results ?? [];
  const users = uniqueDiscordIds(rows, "user");
  const roles = uniqueDiscordIds(rows, "role");
  const messageSuffix = [
    ...users.map((id) => `<@${id}>`),
    ...roles.map((id) => `<@&${id}>`),
  ].join(" ");

  return {
    messageSuffix,
    allowedMentions: users.length > 0 || roles.length > 0
      ? {
          users,
          roles,
        }
      : undefined,
  };
}

function uniqueDiscordIds(rows: DiscordAlertMentionRow[], mentionType: "user" | "role"): string[] {
  return [...new Set(
    rows
      .filter((row) => row.mention_type === mentionType)
      .map((row) => row.discord_id.trim())
      .filter((id) => /^\d{5,32}$/.test(id)),
  )];
}

function formatDiscordAlertMessage(alertText: string, messageSuffix: string): string {
  return messageSuffix ? `${alertText}\n${messageSuffix}` : alertText;
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
