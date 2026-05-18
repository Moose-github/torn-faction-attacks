import {
  authenticateWithTornKey,
  getCurrentAuthSession,
  grantAdminAccess,
  listAdminUsers,
  requireAdmin,
  requireMember,
} from "./auth";
import {
  getEnemyPushPressureForWar,
  getEnemyScoutingForWar,
  getScoutingComparisonForWar,
  refreshEnemyScoutingForWar,
  refreshCurrentEnemyMemberTracking,
  refreshMissingScoutingNetworth,
} from "./enemyScouting";
import { getWarActivityHeatmap } from "./heatmap";
import { getLatestIngestionRun, runIngestion } from "./ingestion";
import {
  getMemberLifestyleStats,
  refreshDailyMemberLifestyleStats,
  refreshMemberLifestyleStatsFromRequest,
} from "./lifestyleStats";
import { getMiscellaneousData, refreshTornShoplifting } from "./miscellaneous";
import { getDiceGameState, rollDiceGame, sendXanaxToDiceGame } from "./diceGame";
import { sendDiscordMessageFromRequest } from "./discord";
import { getLatestMaintenanceRun, runScheduledMaintenance } from "./maintenance";
import { fetchRankedWarReport, getWarReportDiscrepancies } from "./reports";
import { rebuildDerivedStatsFromRaw } from "./summaries";
import { readSyncTimestamp, upsertSyncTimestamp } from "./syncState";
import { Env, TornFactionMember } from "./types";
import { corsHeaders, json, nowSeconds, parseLimit } from "./utils";
import {
  deleteWar,
  endActiveWar,
  getAttackWindow,
  getOverallStats,
  getWar,
  getWarActivity,
  getWarMemberActivityHeatmap,
  getWarAttacks,
  getWarChainBonusesForWar,
  exportWarAttacksCsv,
  getWarMemberAttacks,
  importHistoricalWar,
  listWars,
  previewHistoricalWarImport,
  relinkWarAttacks,
  updateOfficialWar,
} from "./wars";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const routeContext = { request, env, ctx, url };

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    return (await routeApiRequest(routeContext)) ?? json({ error: "Not found" }, 404);
  },

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const minute = new Date(event.scheduledTime).getUTCMinutes();
    const jobs: Array<{ label: string; run: () => Promise<unknown> }> = [];

    jobs.push({ label: "Cron Torn shoplifting", run: () => refreshTornShoplifting(env) });

    if (minute % 15 === 0) {
      jobs.push({ label: "Cron ingestion", run: () => runIngestion(env) });
      jobs.push({ label: "Cron enemy tracking and maintenance", run: () => runEnemyTrackingAndMaintenance(env) });
    } else if (minute % 5 === 0) {
      jobs.push({ label: "Cron ingestion", run: () => runIngestion(env) });
      jobs.push({
        label: "Cron enemy member tracking",
        run: () => refreshCurrentEnemyMemberTracking(env),
      });
    } else {
      jobs.push({
        label: "Cron live enemy member tracking",
        run: () => refreshCurrentEnemyMemberTracking(env, { liveOnly: true }),
      });
      jobs.push({
        label: "Cron lifestyle stats",
        run: () => refreshDailyMemberLifestyleStats(env, { limit: 40, useLock: true }),
      });
      jobs.push({
        label: "Cron scouting networth",
        run: () => refreshMissingScoutingNetworth(env, { limit: 40 }),
      });
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

type RouteContext = {
  request: Request;
  env: Env;
  ctx: ExecutionContext;
  url: URL;
};

type RouteResult = Response | null;
type RouteHandler = () => Promise<Response> | Response;

async function routeApiRequest(routeContext: RouteContext): Promise<RouteResult> {
  return (
    (await routePublicApi(routeContext)) ??
    (await routeAdminApi(routeContext)) ??
    (await routeMemberUtilityApi(routeContext)) ??
    (await routeWarCommands(routeContext)) ??
    (await routeWarReads(routeContext))
  );
}

async function routePublicApi({ request, env, url }: RouteContext): Promise<RouteResult> {
  if (matchesRoute(url, request, "/api/auth/torn", "POST")) {
    return authenticateWithTornKey(request, env);
  }

  if (matchesRoute(url, request, "/api/auth/me", "GET")) {
    return getCurrentAuthSession(request, env);
  }

  if (matchesRoute(url, request, "/api/health")) {
    return json({ ok: true });
  }

  return null;
}

async function routeAdminApi(routeContext: RouteContext): Promise<RouteResult> {
  const { request, env, url } = routeContext;

  if (matchesRoute(url, request, "/api/run", "POST")) {
    return withAdmin(routeContext, async () => {
      const cooldownError = await requireActionCooldown(env, "manual_ingestion", 5 * 60);
      if (cooldownError) return cooldownError;
      await runIngestion(env, "manual");
      return json({ ok: true });
    });
  }

  if (matchesRoute(url, request, "/api/admin/ingestion-run", "GET")) {
    return withAdmin(routeContext, () => getLatestIngestionRun(env));
  }

  if (matchesRoute(url, request, "/api/admin/maintenance-run", "GET")) {
    return withAdmin(routeContext, () => getLatestMaintenanceRun(env));
  }

  if (matchesRoute(url, request, "/api/admin/users", "GET")) {
    return withAdmin(routeContext, () => listAdminUsers(env));
  }

  if (matchesRoute(url, request, "/api/admin/users/grant", "POST")) {
    return withAdmin(routeContext, () => grantAdminAccess(request, env));
  }

  if (matchesRoute(url, request, "/api/admin/discord/message", "POST")) {
    return withAdmin(routeContext, () => sendDiscordMessageFromRequest(request, env));
  }

  if (matchesRoute(url, request, "/api/rebuild", "POST")) {
    return withAdmin(routeContext, () => rebuildStatsFromRequest(request, env));
  }

  if (matchesRoute(url, request, "/api/attacks")) {
    return withAdmin(routeContext, () => getRecentAttacks(url, env));
  }

  if (matchesRoute(url, request, "/api/attacks/window", "POST")) {
    return withAdmin(routeContext, () => getAttackWindow(request, env));
  }

  return null;
}

async function routeMemberUtilityApi(routeContext: RouteContext): Promise<RouteResult> {
  const { request, env, url } = routeContext;

  if (matchesRoute(url, request, "/api/member-lifestyle-stats", "GET")) {
    return cachedMemberGet(routeContext, 5 * 60, () => getMemberLifestyleStats(url, env));
  }

  if (matchesRoute(url, request, "/api/member-lifestyle-stats/refresh", "POST")) {
    return withAdmin(routeContext, async () => {
      const cooldownError = await requireActionCooldown(env, "member_lifestyle_stats_refresh", 30 * 60);
      if (cooldownError) return cooldownError;
      return refreshMemberLifestyleStatsFromRequest(request, env);
    });
  }

  if (matchesRoute(url, request, "/api/miscellaneous", "GET")) {
    return cachedMemberGet(routeContext, 55, () => getMiscellaneousData(env));
  }

  if (matchesRoute(url, request, "/api/dice-game", "GET")) {
    return withMember(routeContext, () => getDiceGameState(request, env, url));
  }

  if (matchesRoute(url, request, "/api/dice-game/roll", "POST")) {
    return withMember(routeContext, () => rollDiceGame(request, env));
  }

  if (matchesRoute(url, request, "/api/dice-game/send-xanax", "POST")) {
    return withMember(routeContext, () => sendXanaxToDiceGame(request, env));
  }

  if (matchesRoute(url, request, "/api/stats", "GET")) {
    return cachedMemberGet(routeContext, 55, () => getOverallStats(url, env));
  }

  return null;
}

async function routeWarCommands(routeContext: RouteContext): Promise<RouteResult> {
  const { request, env, url } = routeContext;

  if (matchesRoute(url, request, "/api/wars", "POST")) {
    return withAdmin(routeContext, () =>
      json(
        {
          ok: false,
          error: "Manual war creation is disabled. Wars are auto-created from Torn or imported after they finish.",
          code: "MANUAL_WAR_CREATION_DISABLED",
        },
        410,
      ),
    );
  }

  if (matchesRoute(url, request, "/api/wars/import", "POST")) {
    return withAdmin(routeContext, () => importHistoricalWar(request, env));
  }

  if (matchesRoute(url, request, "/api/wars/import-event", "POST")) {
    return withAdmin(routeContext, () =>
      json(
        {
          ok: false,
          error: "Manual event import is disabled. Use historical war import for war records.",
          code: "MANUAL_EVENT_IMPORT_DISABLED",
        },
        410,
      ),
    );
  }

  if (matchesRoute(url, request, "/api/wars/import/preview", "POST")) {
    return withAdmin(routeContext, () => previewHistoricalWarImport(request, env));
  }

  if (matchesRoute(url, request, "/api/wars/import-event/preview", "POST")) {
    return withAdmin(routeContext, () =>
      json(
        {
          ok: false,
          error: "Manual event import preview is disabled.",
          code: "MANUAL_EVENT_IMPORT_DISABLED",
        },
        410,
      ),
    );
  }

  if (matchesRoute(url, request, "/api/wars/update-official", "POST")) {
    return withAdmin(routeContext, () => updateOfficialWar(request, env));
  }

  if (matchesRoute(url, request, "/api/wars/update-event", "POST")) {
    return withAdmin(routeContext, () =>
      json(
        {
          ok: false,
          error: "Manual event editing is disabled.",
          code: "MANUAL_EVENT_EDIT_DISABLED",
        },
        410,
      ),
    );
  }

  if (matchesRoute(url, request, "/api/wars/delete", "POST")) {
    return withAdmin(routeContext, () => deleteWar(request, env));
  }

  if (matchesRoute(url, request, "/api/wars/relink-attacks", "POST")) {
    return withAdmin(routeContext, () => relinkWarAttacks(request, env));
  }

  if (matchesRoute(url, request, "/api/wars/end", "POST")) {
    return withAdmin(routeContext, () => endActiveWar(request, env));
  }

  if (isTornWarReportFetchRoute(url, request)) {
    return withAdmin(routeContext, async () => {
      const cooldownError = await requireActionCooldown(env, `ranked_war_report_fetch:${url.pathname}`, 15 * 60);
      if (cooldownError) return cooldownError;
      return fetchRankedWarReport(url, env);
    });
  }

  if (isWarSubroute(url, request, "/enemy-scouting", "POST")) {
    return withAdmin(routeContext, async () => {
      const cooldownError = await requireActionCooldown(env, `enemy_scouting_refresh:${url.pathname}`, 15 * 60);
      if (cooldownError) return cooldownError;
      return refreshEnemyScoutingForWar(url, env);
    });
  }

  return null;
}

async function routeWarReads(routeContext: RouteContext): Promise<RouteResult> {
  const { request, env, url } = routeContext;

  if (matchesRoute(url, request, "/api/wars", "GET")) {
    return cachedMemberGet(routeContext, 55, () => listWars(url, env));
  }

  if (isWarSubroute(url, request, "/report-discrepancies", "GET")) {
    return cachedMemberGet(routeContext, warDataTtlSeconds(30 * 60, OFFICIAL_END_CACHE_TTL_SECONDS), () =>
      getWarReportDiscrepancies(url, env),
    );
  }

  if (isWarSubroute(url, request, "/enemy-push-pressure", "GET")) {
    return cachedMemberGet(routeContext, warDataTtlSeconds(55, OFFICIAL_END_CACHE_TTL_SECONDS), () =>
      getEnemyPushPressureForWar(url, env),
    );
  }

  if (isWarSubroute(url, request, "/enemy-scouting", "GET")) {
    return cachedMemberGet(routeContext, warDataTtlSeconds(5 * 60, OFFICIAL_END_CACHE_TTL_SECONDS, 55), () =>
      getEnemyScoutingForWar(url, env),
    );
  }

  if (isWarSubroute(url, request, "/scouting-comparison", "GET")) {
    return cachedMemberGet(routeContext, warDataTtlSeconds(5 * 60, OFFICIAL_END_CACHE_TTL_SECONDS), () =>
      getScoutingComparisonForWar(url, env),
    );
  }

  if (isWarMemberAttacksRoute(url, request)) {
    return cachedMemberGet(routeContext, warDataTtlSeconds(5 * 60, OFFICIAL_END_CACHE_TTL_SECONDS), () =>
      getWarMemberAttacks(url, env),
    );
  }

  if (isWarSubroute(url, request, "/member-activity-heatmap", "GET")) {
    return cachedMemberGet(routeContext, warDataTtlSeconds(55, OFFICIAL_END_CACHE_TTL_SECONDS), () =>
      getWarMemberActivityHeatmap(url, env),
    );
  }

  if (isWarSubroute(url, request, "/activity", "GET")) {
    return cachedMemberGet(routeContext, warDataTtlSeconds(5 * 60, OFFICIAL_END_CACHE_TTL_SECONDS), () =>
      getWarActivity(url, env),
    );
  }

  if (isWarSubroute(url, request, "/activity-heatmap", "GET")) {
    return cachedMemberGet(routeContext, warDataTtlSeconds(5 * 60, OFFICIAL_END_CACHE_TTL_SECONDS), () =>
      getWarActivityHeatmap(url, env),
    );
  }

  if (isWarSubroute(url, request, "/chain-bonuses", "GET")) {
    return cachedMemberGet(routeContext, warDataTtlSeconds(15 * 60, OFFICIAL_END_CACHE_TTL_SECONDS), () =>
      getWarChainBonusesForWar(url, env),
    );
  }

  if (isWarSubroute(url, request, "/attacks", "GET")) {
    return withAdmin(routeContext, () =>
      url.searchParams.get("format") === "csv" ? exportWarAttacksCsv(url, env) : getWarAttacks(url, env),
    );
  }

  if (isWarDetailRoute(url, request)) {
    return cachedMemberGet(routeContext, warDataTtlSeconds(55, OFFICIAL_END_CACHE_TTL_SECONDS), () =>
      getWar(url, env),
    );
  }

  return null;
}

async function withAdmin(routeContext: RouteContext, handler: RouteHandler): Promise<Response> {
  const authError = await requireAdmin(routeContext.request, routeContext.env);
  return authError ?? await handler();
}

async function withMember(routeContext: RouteContext, handler: RouteHandler): Promise<Response> {
  const authError = await requireMember(routeContext.request, routeContext.env);
  return authError ?? await handler();
}

async function cachedMemberGet(
  routeContext: RouteContext,
  ttl: CacheTtl,
  load: () => Promise<Response>,
): Promise<Response> {
  return withMember(routeContext, () => cachedGetJson(routeContext.request, routeContext.ctx, ttl, load));
}

async function rebuildStatsFromRequest(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { war_id?: unknown };
  const warId = body.war_id === undefined || body.war_id === null || body.war_id === ""
    ? undefined
    : Number(body.war_id);
  if (warId !== undefined && (!Number.isInteger(warId) || warId <= 0)) {
    return json({ ok: false, error: "Invalid war_id", code: "INVALID_WAR_ID" }, 400);
  }

  const cooldownError = await requireActionCooldown(
    env,
    warId === undefined ? "manual_rebuild:all" : `manual_rebuild:${warId}`,
    15 * 60,
  );
  if (cooldownError) return cooldownError;

  const result = await rebuildDerivedStatsFromRaw(env, warId);
  if (warId !== undefined && result.wars_rebuilt === 0) {
    return json({ ok: false, error: "War not found", code: "WAR_NOT_FOUND" }, 404);
  }
  return json({ ok: true, ...result });
}

async function getRecentAttacks(url: URL, env: Env): Promise<Response> {
  const limit = parseLimit(url.searchParams.get("limit"), 50, 100);
  const rows = await env.DB.prepare(`SELECT * FROM attacks ORDER BY started DESC LIMIT ?`)
    .bind(limit)
    .all();

  return json(rows.results ?? []);
}

function matchesRoute(url: URL, request: Request, pathname: string, method?: string): boolean {
  return url.pathname === pathname && (!method || request.method === method);
}

function isTornWarReportFetchRoute(url: URL, request: Request): boolean {
  return request.method === "POST" && url.pathname.startsWith("/api/torn-wars/") && url.pathname.endsWith("/report/fetch");
}

function isWarSubroute(url: URL, request: Request, suffix: string, method: string): boolean {
  return request.method === method && url.pathname.startsWith("/api/wars/") && url.pathname.endsWith(suffix);
}

function isWarMemberAttacksRoute(url: URL, request: Request): boolean {
  return (
    request.method === "GET" &&
    url.pathname.startsWith("/api/wars/") &&
    url.pathname.includes("/members/") &&
    url.pathname.endsWith("/attacks")
  );
}

function isWarDetailRoute(url: URL, request: Request): boolean {
  return request.method === "GET" && url.pathname.startsWith("/api/wars/") && !url.pathname.endsWith("/attacks");
}

async function runEnemyTrackingAndMaintenance(env: Env): Promise<void> {
  const heatmapMembersByFaction = new Map<number, TornFactionMember[]>();

  try {
    const tracking = await refreshCurrentEnemyMemberTracking(env, { includeMembers: true });
    if (tracking.factionId && tracking.members) {
      heatmapMembersByFaction.set(tracking.factionId, tracking.members);
    }
  } catch (err: any) {
    console.error("Cron enemy member tracking failed:", err?.message || err);
    console.error(err);
  }

  await runScheduledMaintenance(env, { heatmapMembersByFaction });
}

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
const PRACTICAL_FINISH_CACHE_TTL_SECONDS = 15 * 60;
const OFFICIAL_END_CACHE_TTL_SECONDS = 3 * 60 * 60;

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

function warDataTtlSeconds(
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
  const lastStarted = await readSyncTimestamp(env, name);
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

  await upsertSyncTimestamp(env, name, now, null);

  return null;
}

