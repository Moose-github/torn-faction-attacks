import { Env } from "./types";
import { json, nowSeconds } from "./utils";

const TORN_SHOPLIFTING_API_URL = "https://api.torn.com/v2/torn";
const SHOPLIFTING_CACHE_ID = 1;

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

    return {
      ok: true,
      shops: Object.keys(shoplifting).length,
      fetched_at: fetchedAt,
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
