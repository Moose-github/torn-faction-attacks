import { nowSeconds } from "./utils";
import { readSyncTimestamp } from "./syncState";
import { Env } from "./types";
import { isWarRoomMemberTrackingActive } from "./warRoomTracking";

export type CacheTtl =
  | number
  | ((data: any) => number);

type MemoryCacheEntry = {
  body: string;
  expiresAt: number;
  headers: [string, string][];
  status: number;
};

const memoryResponseCache = new Map<string, MemoryCacheEntry>();
const MAX_MEMORY_CACHE_ENTRIES = 100;
const PRACTICAL_FINISH_CACHE_TTL_SECONDS = 15 * 60;
export const OFFICIAL_END_CACHE_TTL_SECONDS = 24 * 60 * 60;
const CLIENT_CACHE_CONTROL = "private, no-store";

export async function cachedGetJson(
  request: Request,
  ctx: ExecutionContext,
  ttl: CacheTtl,
  load: () => Promise<Response>,
  versionKeySuffix = "",
): Promise<Response> {
  if (request.method !== "GET") {
    return load();
  }

  const cacheKey = cacheRequestKey(request, versionKeySuffix);
  const now = nowSeconds();
  const memoryHit = memoryResponseCache.get(cacheKey.url);

  if (memoryHit && memoryHit.expiresAt > now) {
    return cachedResponseFromEntry(memoryHit, "HIT", "memory");
  }

  if (memoryHit) {
    memoryResponseCache.delete(cacheKey.url);
  }

  const edgeCached = await caches.default.match(cacheKey).catch(() => undefined);
  if (edgeCached) {
    const response = withCacheHeaders(edgeCached, "HIT", "edge");
    const text = await response.clone().text();
    rememberResponse(cacheKey.url, response, text, now + Math.max(1, Number(response.headers.get("X-Cache-TTL") ?? 60)));
    return response;
  }

  const loaded = await load();
  const body = await loaded.clone().text();
  const data = safeJsonParse(body);
  const ttlSeconds = Math.max(0, typeof ttl === "function" ? ttl(data) : ttl);

  if (loaded.status !== 200 || ttlSeconds <= 0) {
    return withCacheHeaders(new Response(body, loaded), "BYPASS", "none");
  }

  const response = responseForClient(loaded, body, ttlSeconds, "MISS", "none");
  const cacheResponse = responseForCache(loaded, body, ttlSeconds, "HIT", "edge");
  rememberResponse(cacheKey.url, cacheResponse, body, now + ttlSeconds);
  ctx.waitUntil(caches.default.put(cacheKey, cacheResponse.clone()).catch(() => undefined));
  return response;
}

export async function cachedVersionedGetJson(
  env: Env,
  request: Request,
  ctx: ExecutionContext,
  ttl: CacheTtl,
  versionNames: string[],
  load: () => Promise<Response>,
): Promise<Response> {
  const versionKeySuffix = await cacheVersionKeySuffix(env, versionNames);
  return cachedGetJson(request, ctx, ttl, load, versionKeySuffix);
}

export function warDataTtlSeconds(
  activeTtlSeconds: number,
  endedTtlSeconds: number,
  liveTtlSeconds?: number,
): (data: any) => number {
  return (data: any) => {
    const war = data?.war ?? data;

    if (war?.official_end_time !== null && war?.official_end_time !== undefined) {
      return endedTtlSeconds;
    }

    if (war?.practical_finish_time !== null && war?.practical_finish_time !== undefined) {
      return PRACTICAL_FINISH_CACHE_TTL_SECONDS;
    }

    if (liveTtlSeconds !== undefined && war?.status === "active") {
      return liveTtlSeconds;
    }

    return activeTtlSeconds;
  };
}

export function scoutingComparisonTtlSeconds(data: any): number {
  const war = data?.war ?? data;
  if (isWarRoomMemberTrackingActive(war, nowSeconds())) {
    return warDataTtlSeconds(5 * 60, OFFICIAL_END_CACHE_TTL_SECONDS, 55)(data);
  }

  if (data?.comparison_stats_complete === true) {
    return OFFICIAL_END_CACHE_TTL_SECONDS;
  }

  return warDataTtlSeconds(5 * 60, OFFICIAL_END_CACHE_TTL_SECONDS)(data);
}

async function cacheVersionKeySuffix(env: Env, versionNames: string[]): Promise<string> {
  if (versionNames.length === 0) {
    return "";
  }

  const versionParts = await Promise.all(
    versionNames.map(async (name) => `${name}:${await readSyncTimestamp(env, name)}`),
  );
  return versionParts.join("|");
}

function cacheRequestKey(request: Request, versionKeySuffix = ""): Request {
  const url = new URL(request.url);
  url.searchParams.sort();
  url.searchParams.set("_cache_v", "dashboard-v1");
  if (versionKeySuffix) {
    url.searchParams.set("_data_v", versionKeySuffix);
  }
  return new Request(url.toString(), { method: "GET" });
}

function responseForCache(
  source: Response,
  body: string,
  ttlSeconds: number,
  cacheStatus: "HIT" | "MISS",
  cacheSource: string,
): Response {
  const response = new Response(body, source);
  response.headers.set("Cache-Control", `public, max-age=${ttlSeconds}`);
  response.headers.set("X-Cache", cacheStatus);
  response.headers.set("X-Cache-Source", cacheSource);
  response.headers.set("X-Cache-TTL", String(ttlSeconds));
  response.headers.delete("Set-Cookie");
  return response;
}

function responseForClient(
  source: Response,
  body: string,
  ttlSeconds: number,
  cacheStatus: "HIT" | "MISS" | "BYPASS",
  cacheSource: string,
): Response {
  return withClientCacheHeaders(
    new Response(body, source),
    cacheStatus,
    cacheSource,
    ttlSeconds,
  );
}

function withCacheHeaders(
  source: Response,
  cacheStatus: "HIT" | "MISS" | "BYPASS",
  cacheSource: string,
): Response {
  const response = new Response(source.body, source);
  const ttlSeconds = Number(response.headers.get("X-Cache-TTL") ?? 0);
  return withClientCacheHeaders(response, cacheStatus, cacheSource, ttlSeconds);
}

function withClientCacheHeaders(
  response: Response,
  cacheStatus: "HIT" | "MISS" | "BYPASS",
  cacheSource: string,
  ttlSeconds: number,
): Response {
  response.headers.set("Cache-Control", CLIENT_CACHE_CONTROL);
  response.headers.set("X-Cache", cacheStatus);
  response.headers.set("X-Cache-Source", cacheSource);
  if (ttlSeconds > 0) {
    response.headers.set("X-Cache-TTL", String(ttlSeconds));
  } else {
    response.headers.delete("X-Cache-TTL");
  }
  response.headers.delete("Set-Cookie");
  return response;
}

function rememberResponse(
  key: string,
  response: Response,
  body: string,
  expiresAt: number,
): void {
  if (memoryResponseCache.size >= MAX_MEMORY_CACHE_ENTRIES) {
    const oldestKey = memoryResponseCache.keys().next().value;
    if (oldestKey) {
      memoryResponseCache.delete(oldestKey);
    }
  }

  memoryResponseCache.set(key, {
    body,
    expiresAt,
    headers: Array.from(response.headers.entries()),
    status: response.status,
  });
}

function cachedResponseFromEntry(
  entry: MemoryCacheEntry,
  cacheStatus: "HIT",
  cacheSource: string,
): Response {
  const response = new Response(entry.body, {
    status: entry.status,
    headers: entry.headers,
  });
  response.headers.set("X-Cache", cacheStatus);
  response.headers.set("X-Cache-Source", cacheSource);
  return withClientCacheHeaders(
    response,
    cacheStatus,
    cacheSource,
    Math.max(1, entry.expiresAt - nowSeconds()),
  );
}

function safeJsonParse(body: string): any {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}
