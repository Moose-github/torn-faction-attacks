import {
  authenticateWithTornKey,
  getCurrentAuthSession,
  grantAdminAccess,
  listAdminUsers,
  requireAdmin,
  requireMember,
} from "./auth";
import {
  getEnemyScoutingForWar,
  getScoutingComparisonForWar,
  refreshEnemyScoutingForWar,
  refreshCurrentEnemyTravelStatuses,
  refreshMissingScoutingNetworth,
} from "./enemyScouting";
import { getWarActivityHeatmap } from "./heatmap";
import { getLatestIngestionRun, runIngestion } from "./ingestion";
import {
  getMemberLifestyleStats,
  refreshDailyMemberLifestyleStats,
  refreshMemberLifestyleStatsFromRequest,
} from "./lifestyleStats";
import { getLatestMaintenanceRun, runScheduledMaintenance } from "./maintenance";
import { fetchRankedWarReport, getWarReportDiscrepancies } from "./reports";
import { rebuildDerivedStatsFromRaw } from "./summaries";
import { ExecutionContext, Env, ScheduledController } from "./types";
import { corsHeaders, json, nowSeconds, parseLimit } from "./utils";
import {
  createWar,
  deleteWar,
  endActiveWar,
  getAttackWindow,
  getOverallStats,
  getWar,
  getWarActivity,
  getWarAttacks,
  exportWarAttacksCsv,
  importHistoricalEvent,
  getWarMemberAttacks,
  importHistoricalWar,
  listWars,
  previewHistoricalEventImport,
  previewHistoricalWarImport,
  relinkWarAttacks,
  updateEvent,
  updateOfficialWar,
} from "./wars";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    if (url.pathname === "/api/auth/torn" && request.method === "POST") {
      return authenticateWithTornKey(request, env);
    }

    if (url.pathname === "/api/auth/me" && request.method === "GET") {
      return getCurrentAuthSession(request, env);
    }

    if (url.pathname === "/api/run" && request.method === "POST") {
      const authError = await requireAdmin(request, env);
      if (authError) return authError;
      const cooldownError = await requireActionCooldown(env, "manual_ingestion", 5 * 60);
      if (cooldownError) return cooldownError;
      await runIngestion(env, "manual");
      return json({ ok: true });
    }

    if (url.pathname === "/api/admin/ingestion-run" && request.method === "GET") {
      const authError = await requireAdmin(request, env);
      if (authError) return authError;
      return getLatestIngestionRun(env);
    }

    if (url.pathname === "/api/admin/maintenance-run" && request.method === "GET") {
      const authError = await requireAdmin(request, env);
      if (authError) return authError;
      return getLatestMaintenanceRun(env);
    }

    if (url.pathname === "/api/admin/users" && request.method === "GET") {
      const authError = await requireAdmin(request, env);
      if (authError) return authError;
      return listAdminUsers(env);
    }

    if (url.pathname === "/api/admin/users/grant" && request.method === "POST") {
      const authError = await requireAdmin(request, env);
      if (authError) return authError;
      return grantAdminAccess(request, env);
    }

    if (url.pathname === "/api/rebuild" && request.method === "POST") {
      const authError = await requireAdmin(request, env);
      if (authError) return authError;
      const cooldownError = await requireActionCooldown(env, "manual_rebuild", 15 * 60);
      if (cooldownError) return cooldownError;
      const result = await rebuildDerivedStatsFromRaw(env);
      return json({ ok: true, ...result });
    }

    if (url.pathname === "/api/health") {
      return json({ ok: true });
    }

    if (url.pathname === "/api/attacks") {
      const authError = await requireAdmin(request, env);
      if (authError) return authError;
      const limit = parseLimit(url.searchParams.get("limit"), 50, 100);
      const rows = await env.DB.prepare(`SELECT * FROM attacks ORDER BY started DESC LIMIT ?`)
        .bind(limit)
        .all();

      return json(rows.results ?? []);
    }

    if (url.pathname === "/api/attacks/window" && request.method === "POST") {
      const authError = await requireAdmin(request, env);
      if (authError) return authError;
      return getAttackWindow(request, env);
    }

    if (url.pathname === "/api/member-lifestyle-stats" && request.method === "GET") {
      const authError = await requireMember(request, env);
      if (authError) return authError;
      return cachedGetJson(request, ctx, 5 * 60, () => getMemberLifestyleStats(url, env));
    }

    if (url.pathname === "/api/member-lifestyle-stats/refresh" && request.method === "POST") {
      const authError = await requireAdmin(request, env);
      if (authError) return authError;
      const cooldownError = await requireActionCooldown(env, "member_lifestyle_stats_refresh", 30 * 60);
      if (cooldownError) return cooldownError;
      return refreshMemberLifestyleStatsFromRequest(request, env);
    }

    if (url.pathname === "/api/wars" && request.method === "POST") {
      const authError = await requireAdmin(request, env);
      if (authError) return authError;
      return createWar(request, env);
    }

    if (url.pathname === "/api/wars/import" && request.method === "POST") {
      const authError = await requireAdmin(request, env);
      if (authError) return authError;
      return importHistoricalWar(request, env);
    }

    if (url.pathname === "/api/wars/import-event" && request.method === "POST") {
      const authError = await requireAdmin(request, env);
      if (authError) return authError;
      return importHistoricalEvent(request, env);
    }

    if (url.pathname === "/api/wars/import/preview" && request.method === "POST") {
      const authError = await requireAdmin(request, env);
      if (authError) return authError;
      return previewHistoricalWarImport(request, env);
    }

    if (url.pathname === "/api/wars/import-event/preview" && request.method === "POST") {
      const authError = await requireAdmin(request, env);
      if (authError) return authError;
      return previewHistoricalEventImport(request, env);
    }

    if (url.pathname === "/api/wars/update-official" && request.method === "POST") {
      const authError = await requireAdmin(request, env);
      if (authError) return authError;
      return updateOfficialWar(request, env);
    }

    if (url.pathname === "/api/wars/update-event" && request.method === "POST") {
      const authError = await requireAdmin(request, env);
      if (authError) return authError;
      return updateEvent(request, env);
    }

    if (url.pathname === "/api/wars/delete" && request.method === "POST") {
      const authError = await requireAdmin(request, env);
      if (authError) return authError;
      return deleteWar(request, env);
    }

    if (url.pathname === "/api/wars/relink-attacks" && request.method === "POST") {
      const authError = await requireAdmin(request, env);
      if (authError) return authError;
      return relinkWarAttacks(request, env);
    }

    if (url.pathname === "/api/wars/end" && request.method === "POST") {
      const authError = await requireAdmin(request, env);
      if (authError) return authError;
      return endActiveWar(env);
    }

    if (
      url.pathname.startsWith("/api/torn-wars/") &&
      url.pathname.endsWith("/report/fetch") &&
      request.method === "POST"
    ) {
      const authError = await requireAdmin(request, env);
      if (authError) return authError;
      const cooldownError = await requireActionCooldown(
        env,
        `ranked_war_report_fetch:${url.pathname}`,
        15 * 60,
      );
      if (cooldownError) return cooldownError;
      return fetchRankedWarReport(url, env);
    }

    if (url.pathname === "/api/wars" && request.method === "GET") {
      const authError = await requireMember(request, env);
      if (authError) return authError;
      return cachedGetJson(request, ctx, 55, () => listWars(url, env));
    }

    if (
      url.pathname.startsWith("/api/wars/") &&
      url.pathname.endsWith("/report-discrepancies") &&
      request.method === "GET"
    ) {
      const authError = await requireMember(request, env);
      if (authError) return authError;
      return cachedGetJson(request, ctx, 30 * 60, () => getWarReportDiscrepancies(url, env));
    }

    if (
      url.pathname.startsWith("/api/wars/") &&
      url.pathname.endsWith("/enemy-scouting") &&
      request.method === "GET"
    ) {
      const authError = await requireMember(request, env);
      if (authError) return authError;
      return cachedGetJson(request, ctx, 5 * 60, () => getEnemyScoutingForWar(url, env));
    }

    if (
      url.pathname.startsWith("/api/wars/") &&
      url.pathname.endsWith("/scouting-comparison") &&
      request.method === "GET"
    ) {
      const authError = await requireMember(request, env);
      if (authError) return authError;
      return cachedGetJson(request, ctx, 5 * 60, () => getScoutingComparisonForWar(url, env));
    }

    if (
      url.pathname.startsWith("/api/wars/") &&
      url.pathname.endsWith("/enemy-scouting") &&
      request.method === "POST"
    ) {
      const authError = await requireAdmin(request, env);
      if (authError) return authError;
      const cooldownError = await requireActionCooldown(
        env,
        `enemy_scouting_refresh:${url.pathname}`,
        15 * 60,
      );
      if (cooldownError) return cooldownError;
      return refreshEnemyScoutingForWar(url, env);
    }

    if (
      url.pathname.startsWith("/api/wars/") &&
      url.pathname.includes("/members/") &&
      url.pathname.endsWith("/attacks") &&
      request.method === "GET"
    ) {
      const authError = await requireMember(request, env);
      if (authError) return authError;
      return getWarMemberAttacks(url, env);
    }

    if (
      url.pathname.startsWith("/api/wars/") &&
      url.pathname.endsWith("/activity") &&
      request.method === "GET"
    ) {
      const authError = await requireMember(request, env);
      if (authError) return authError;
      return cachedGetJson(request, ctx, warDataTtlSeconds(5 * 60, 30 * 60), () => getWarActivity(url, env));
    }

    if (
      url.pathname.startsWith("/api/wars/") &&
      url.pathname.endsWith("/activity-heatmap") &&
      request.method === "GET"
    ) {
      const authError = await requireMember(request, env);
      if (authError) return authError;
      return cachedGetJson(request, ctx, 5 * 60, () => getWarActivityHeatmap(url, env));
    }

    if (
      url.pathname.startsWith("/api/wars/") &&
      url.pathname.endsWith("/attacks") &&
      request.method === "GET"
    ) {
      const authError = await requireAdmin(request, env);
      if (authError) return authError;
      if (url.searchParams.get("format") === "csv") {
        return exportWarAttacksCsv(url, env);
      }
      return getWarAttacks(url, env);
    }

    if (
      url.pathname.startsWith("/api/wars/") &&
      !url.pathname.endsWith("/attacks") &&
      request.method === "GET"
    ) {
      const authError = await requireMember(request, env);
      if (authError) return authError;
      return cachedGetJson(request, ctx, warDataTtlSeconds(55, 30 * 60), () => getWar(url, env));
    }

    if (url.pathname === "/api/stats" && request.method === "GET") {
      const authError = await requireMember(request, env);
      if (authError) return authError;
      return cachedGetJson(request, ctx, 55, () => getOverallStats(url, env));
    }

    return json({ error: "Not found" }, 404);
  },

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const minute = new Date(event.scheduledTime).getUTCMinutes();
    const jobs: Array<{ label: string; run: () => Promise<unknown> }> = [];

    if (minute % 5 === 0) {
      jobs.push({ label: "Cron ingestion", run: () => runIngestion(env) });
      jobs.push({
        label: "Cron enemy travel",
        run: () => refreshCurrentEnemyTravelStatuses(env),
      });
    } else {
      jobs.push({
        label: "Cron lifestyle stats",
        run: () => refreshDailyMemberLifestyleStats(env, { limit: 40, useLock: true }),
      });
      jobs.push({
        label: "Cron scouting networth",
        run: () => refreshMissingScoutingNetworth(env, { limit: 40 }),
      });
    }

    if (minute % 15 === 0) {
      jobs.push({ label: "Cron maintenance", run: () => runScheduledMaintenance(env) });
    }

    ctx.waitUntil(
      Promise.allSettled(jobs.map((job) => job.run())).then((results) => {
        results.forEach((result, index) => {
          if (result.status === "rejected") {
            const err = result.reason;
            console.error(`${jobs[index]?.label ?? "Cron job"} failed:`, err?.message || err);
            console.error(err);
          }
        });
      }),
    );
  },
};

type CacheTtl =
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

async function cachedGetJson(
  request: Request,
  ctx: ExecutionContext,
  ttl: CacheTtl,
  load: () => Promise<Response>,
): Promise<Response> {
  if (request.method !== "GET") {
    return load();
  }

  const cacheKey = cacheRequestKey(request);
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

  const response = responseForCache(loaded, body, ttlSeconds, "MISS", "none");
  const cacheResponse = responseForCache(loaded, body, ttlSeconds, "HIT", "edge");
  rememberResponse(cacheKey.url, cacheResponse, body, now + ttlSeconds);
  ctx.waitUntil(caches.default.put(cacheKey, cacheResponse.clone()).catch(() => undefined));
  return response;
}

function cacheRequestKey(request: Request): Request {
  const url = new URL(request.url);
  url.searchParams.sort();
  url.searchParams.set("_cache_v", "dashboard-v1");
  return new Request(url.toString(), { method: "GET" });
}

function warDataTtlSeconds(activeTtlSeconds: number, endedTtlSeconds: number): (data: any) => number {
  return (data: any) => {
    const war = data?.war ?? data;

    if (war?.official_end_time !== null && war?.official_end_time !== undefined) {
      return endedTtlSeconds;
    }

    if (war?.practical_finish_time !== null && war?.practical_finish_time !== undefined) {
      return 5 * 60;
    }

    return activeTtlSeconds;
  };
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

function withCacheHeaders(
  source: Response,
  cacheStatus: "HIT" | "MISS" | "BYPASS",
  cacheSource: string,
): Response {
  const response = new Response(source.body, source);
  response.headers.set("X-Cache", cacheStatus);
  response.headers.set("X-Cache-Source", cacheSource);
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
  return response;
}

function safeJsonParse(body: string): any {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

async function requireActionCooldown(
  env: Env,
  name: string,
  cooldownSeconds: number,
): Promise<Response | null> {
  const now = nowSeconds();
  const existing = (await env.DB.prepare(
    `
    SELECT last_started
    FROM sync_state
    WHERE name = ?
    LIMIT 1
    `,
  )
    .bind(name)
    .first()) as { last_started: number | null } | null;
  const lastStarted = Number(existing?.last_started ?? 0);
  const retryAfterSeconds = lastStarted > 0 ? cooldownSeconds - (now - lastStarted) : 0;

  if (retryAfterSeconds > 0) {
    return json(
      {
        ok: false,
        error: `Please wait ${retryAfterSeconds} seconds before trying again`,
        code: "COOLDOWN_ACTIVE",
        retry_after_seconds: retryAfterSeconds,
      },
      429,
    );
  }

  await env.DB.prepare(
    `
    INSERT INTO sync_state (name, last_started, active_war_id)
    VALUES (?, ?, NULL)
    ON CONFLICT(name) DO UPDATE SET
      last_started = excluded.last_started,
      updated_at = CURRENT_TIMESTAMP
    `,
  )
    .bind(name, now)
    .run();

  return null;
}

