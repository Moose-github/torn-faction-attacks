import {
  authenticateWithTornKey,
  getCurrentAuthSession,
  grantAdminAccess,
  listAdminUsers,
  readAuthenticatedUserId,
  requireAdmin,
  requireMember,
} from "./auth";
import { buildCronPlan } from "./cronPlan";
import {
  bumpGlobalWarCacheVersion,
  bumpWarCacheVersionById,
  MEMBER_LIFESTYLE_CACHE_VERSION_NAME,
  warCacheVersionNames,
} from "./cacheVersions";
import { getEnemyPushPressureForWar } from "./enemyPushPressure";
import {
  getEnemyScoutingForWar,
  getScoutingComparisonForWar,
  refreshEnemyScoutingForWar,
  restartLiveEnemyTrackingFromRequest,
} from "./enemyScouting";
import { getRecentFactionAttacks } from "./factionAttacks";
import { getWarActivityHeatmap } from "./heatmap";
import { getCurrentHomeFactionMemberSummary } from "./homeFactionMembers";
import { getLatestIngestionRun, runIngestion } from "./ingestion";
import {
  getMemberLifestyleStats,
} from "./lifestyleStats";
import { listMemberAchievementSummaries } from "./memberAchievements";
import { getMiscellaneousData } from "./miscellaneous";
import { getDiceGameState, rollDiceGame, sendXanaxToDiceGame } from "./diceGame";
import { sendDiscordMessageFromRequest } from "./discord";
import {
  previewEnemyStatsImageFromRequest,
  resetEnemyStatsImageFromRequest,
} from "./enemyScoutingCron";
import { getLatestMaintenanceRun } from "./maintenance";
import { createMonitorTicket } from "./monitorTickets";
import { fetchRankedWarReport, getWarReportDiscrepancies } from "./reports";
import {
  cachedGetJson,
  cachedVersionedGetJson,
  CacheTtl,
  OFFICIAL_END_CACHE_TTL_SECONDS,
  scoutingComparisonTtlSeconds,
  warDataTtlSeconds,
} from "./responseCache";
import {
  isTornWarReportFetchRoute,
  isWarDetailRoute,
  isWarMemberAttacksRoute,
  isWarSubroute,
  matchesExactRoute,
  tradeWatchlistIdFromDetailPath,
  tradeWatchlistIdFromScanPath,
  warNameFromWarRoute,
} from "./routes";
import { rebuildDerivedStatsFromRaw } from "./summaries";
import { readSyncTimestamp, upsertSyncTimestamp } from "./syncState";
import { createMemberSuggestion, listMemberSuggestionsForAdmin } from "./suggestions";
import {
  createTradeWatchlist,
  deleteTradeWatchlist,
  getTradeOpportunities,
  getTradeSearchOpportunities,
  listTradeWatchlists,
  scanTradeSearch,
  scanTradeWatchlist,
  updateTradeWatchlist,
} from "./tradeScout";
import { Env } from "./types";
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
    const jobs = buildCronPlan(env, event.scheduledTime);

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
    (await routeTradeApi(routeContext)) ??
    (await routeMemberUtilityApi(routeContext)) ??
    (await routeWarCommands(routeContext)) ??
    (await routeWarReads(routeContext))
  );
}

async function routePublicApi({ request, env, url }: RouteContext): Promise<RouteResult> {
  if (matchesExactRoute(url, request, "/api/auth/torn", "POST")) {
    return authenticateWithTornKey(request, env);
  }

  if (matchesExactRoute(url, request, "/api/auth/me", "GET")) {
    return getCurrentAuthSession(request, env);
  }

  if (matchesExactRoute(url, request, "/api/health")) {
    return json({ ok: true });
  }

  return null;
}

async function routeAdminApi(routeContext: RouteContext): Promise<RouteResult> {
  const { request, env, url } = routeContext;

  if (matchesExactRoute(url, request, "/api/run", "POST")) {
    return withAdmin(routeContext, async () => {
      const cooldownError = await requireActionCooldown(env, "manual_ingestion", 5 * 60);
      if (cooldownError) return cooldownError;
      await runIngestion(env, "manual");
      return json({ ok: true });
    });
  }

  if (matchesExactRoute(url, request, "/api/admin/ingestion-run", "GET")) {
    return withAdmin(routeContext, () => getLatestIngestionRun(env));
  }

  if (matchesExactRoute(url, request, "/api/admin/maintenance-run", "GET")) {
    return withAdmin(routeContext, () => getLatestMaintenanceRun(env));
  }

  if (matchesExactRoute(url, request, "/api/admin/users", "GET")) {
    return withAdmin(routeContext, () => listAdminUsers(env));
  }

  if (matchesExactRoute(url, request, "/api/admin/users/grant", "POST")) {
    return withAdmin(routeContext, () => grantAdminAccess(request, env));
  }

  if (matchesExactRoute(url, request, "/api/admin/discord/message", "POST")) {
    return withAdmin(routeContext, () => sendDiscordMessageFromRequest(request, env));
  }

  if (matchesExactRoute(url, request, "/api/admin/enemy-stats-image/reset", "POST")) {
    return withAdmin(routeContext, () => resetEnemyStatsImageFromRequest(env));
  }

  if (matchesExactRoute(url, request, "/api/admin/enemy-stats-image/preview", "GET")) {
    return withAdmin(routeContext, () => previewEnemyStatsImageFromRequest(url, env));
  }

  if (matchesExactRoute(url, request, "/api/admin/live-enemy-tracking/restart", "POST")) {
    return withAdmin(routeContext, async () => {
      const cooldownError = await requireActionCooldown(env, "restart_live_enemy_tracking", 30);
      if (cooldownError) return cooldownError;
      return restartLiveEnemyTrackingFromRequest(request, env);
    });
  }

  if (matchesExactRoute(url, request, "/api/admin/suggestions", "GET")) {
    return withAdmin(routeContext, () => listMemberSuggestionsForAdmin(url, env));
  }

  if (matchesExactRoute(url, request, "/api/rebuild", "POST")) {
    return withAdmin(routeContext, () => rebuildStatsFromRequest(request, env));
  }

  if (matchesExactRoute(url, request, "/api/attacks")) {
    return withAdmin(routeContext, () => getRecentAttacks(url, env));
  }

  if (matchesExactRoute(url, request, "/api/attacks/window", "POST")) {
    return withAdmin(routeContext, () => getAttackWindow(request, env));
  }

  return null;
}

async function routeTradeApi(routeContext: RouteContext): Promise<RouteResult> {
  const { request, env, url } = routeContext;

  if (matchesExactRoute(url, request, "/api/trade/watchlists", "GET")) {
    return withMember(routeContext, () => listTradeWatchlists(env));
  }

  if (matchesExactRoute(url, request, "/api/trade/watchlists", "POST")) {
    return withMember(routeContext, async () =>
      createTradeWatchlist(
        request,
        env,
        await readAuthenticatedUserId(request, env),
      ),
    );
  }

  const detailWatchlistId = tradeWatchlistIdFromDetailPath(url.pathname);
  if (detailWatchlistId !== null && request.method === "PUT") {
    return withAdmin(routeContext, () => updateTradeWatchlist(request, env, detailWatchlistId));
  }

  if (detailWatchlistId !== null && request.method === "DELETE") {
    return withAdmin(routeContext, () => deleteTradeWatchlist(env, detailWatchlistId));
  }

  const watchlistIdToScan = tradeWatchlistIdFromScanPath(url.pathname);
  if (watchlistIdToScan !== null && request.method === "POST") {
    return withMember(routeContext, async () =>
      scanTradeWatchlist(
        request,
        env,
        watchlistIdToScan,
        await readAuthenticatedUserId(request, env),
      ),
    );
  }

  if (matchesExactRoute(url, request, "/api/trade/search/opportunities", "POST")) {
    return withMember(routeContext, () => getTradeSearchOpportunities(request, env));
  }

  if (matchesExactRoute(url, request, "/api/trade/search/scan", "POST")) {
    return withMember(routeContext, async () =>
      scanTradeSearch(
        request,
        env,
        await readAuthenticatedUserId(request, env),
      ),
    );
  }

  if (matchesExactRoute(url, request, "/api/trade/opportunities", "GET")) {
    return withMember(routeContext, () => getTradeOpportunities(url, env));
  }

  return null;
}

async function routeMemberUtilityApi(routeContext: RouteContext): Promise<RouteResult> {
  const { request, env, url } = routeContext;

  if (matchesExactRoute(url, request, "/api/member-lifestyle-stats", "GET")) {
    return cachedMemberGet(
      routeContext,
      OFFICIAL_END_CACHE_TTL_SECONDS,
      () => getMemberLifestyleStats(url, env),
      [MEMBER_LIFESTYLE_CACHE_VERSION_NAME],
    );
  }

  if (matchesExactRoute(url, request, "/api/member-achievements", "GET")) {
    return cachedMemberGet(routeContext, 55, () => listMemberAchievementSummaries(env));
  }

  if (matchesExactRoute(url, request, "/api/miscellaneous", "GET")) {
    return cachedMemberGet(routeContext, 55, () => getMiscellaneousData(env));
  }

  if (matchesExactRoute(url, request, "/api/home-faction-members/summary", "GET")) {
    return cachedMemberGet(routeContext, 55, () => getCurrentHomeFactionMemberSummary(env));
  }

  if (matchesExactRoute(url, request, "/api/faction-attacks/recent", "GET")) {
    return cachedMemberGet(routeContext, 15, () => getRecentFactionAttacks(url, env));
  }

  if (matchesExactRoute(url, request, "/api/suggestions", "POST")) {
    return withMember(routeContext, async () => {
      const userId = await readAuthenticatedUserId(request, env);
      if (!userId) {
        return json({ ok: false, error: "Unauthorized", code: "UNAUTHORIZED" }, 401);
      }
      const cooldownError = await requireActionCooldown(env, `member_suggestion:${userId}`, 60);
      if (cooldownError) return cooldownError;
      return createMemberSuggestion(request, env, userId);
    });
  }

  if (matchesExactRoute(url, request, "/api/monitor-ticket", "POST")) {
    return withMember(routeContext, () => createMonitorTicket(request, env));
  }

  if (matchesExactRoute(url, request, "/api/dice-game", "GET")) {
    return withMember(routeContext, () => getDiceGameState(request, env, url));
  }

  if (matchesExactRoute(url, request, "/api/dice-game/roll", "POST")) {
    return withMember(routeContext, () => rollDiceGame(request, env));
  }

  if (matchesExactRoute(url, request, "/api/dice-game/send-xanax", "POST")) {
    return withMember(routeContext, () => sendXanaxToDiceGame(request, env));
  }

  if (matchesExactRoute(url, request, "/api/stats", "GET")) {
    return cachedMemberGet(routeContext, 55, () => getOverallStats(url, env));
  }

  return null;
}

async function routeWarCommands(routeContext: RouteContext): Promise<RouteResult> {
  const { request, env, url } = routeContext;

  if (matchesExactRoute(url, request, "/api/wars", "POST")) {
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

  if (matchesExactRoute(url, request, "/api/wars/import", "POST")) {
    return withAdmin(routeContext, () => importHistoricalWar(request, env));
  }

  if (matchesExactRoute(url, request, "/api/wars/import-event", "POST")) {
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

  if (matchesExactRoute(url, request, "/api/wars/import/preview", "POST")) {
    return withAdmin(routeContext, () => previewHistoricalWarImport(request, env));
  }

  if (matchesExactRoute(url, request, "/api/wars/import-event/preview", "POST")) {
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

  if (matchesExactRoute(url, request, "/api/wars/update-official", "POST")) {
    return withAdmin(routeContext, () => updateOfficialWar(request, env));
  }

  if (matchesExactRoute(url, request, "/api/wars/update-event", "POST")) {
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

  if (matchesExactRoute(url, request, "/api/wars/delete", "POST")) {
    return withAdmin(routeContext, () => deleteWar(request, env));
  }

  if (matchesExactRoute(url, request, "/api/wars/relink-attacks", "POST")) {
    return withAdmin(routeContext, () => relinkWarAttacks(request, env));
  }

  if (matchesExactRoute(url, request, "/api/wars/end", "POST")) {
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

  if (matchesExactRoute(url, request, "/api/wars", "GET")) {
    return cachedMemberGet(routeContext, 55, () => listWars(url, env));
  }

  const warVersionNames = warCacheVersionNames(warNameFromWarRoute(url));

  if (isWarSubroute(url, request, "/report-discrepancies", "GET")) {
    return cachedMemberGet(
      routeContext,
      warDataTtlSeconds(30 * 60, OFFICIAL_END_CACHE_TTL_SECONDS),
      () => getWarReportDiscrepancies(url, env),
      warVersionNames,
    );
  }

  if (isWarSubroute(url, request, "/enemy-push-pressure", "GET")) {
    return cachedMemberGet(
      routeContext,
      warDataTtlSeconds(5 * 60, OFFICIAL_END_CACHE_TTL_SECONDS, 55),
      () => getEnemyPushPressureForWar(url, env),
    );
  }

  if (isWarSubroute(url, request, "/enemy-scouting", "GET")) {
    return cachedMemberGet(
      routeContext,
      warDataTtlSeconds(5 * 60, OFFICIAL_END_CACHE_TTL_SECONDS, 55),
      () => getEnemyScoutingForWar(url, env),
    );
  }

  if (isWarSubroute(url, request, "/scouting-comparison", "GET")) {
    return cachedMemberGet(
      routeContext,
      scoutingComparisonTtlSeconds,
      () => getScoutingComparisonForWar(url, env),
    );
  }

  if (isWarMemberAttacksRoute(url, request)) {
    return cachedMemberGet(
      routeContext,
      warDataTtlSeconds(5 * 60, OFFICIAL_END_CACHE_TTL_SECONDS),
      () => getWarMemberAttacks(url, env),
      warVersionNames,
    );
  }

  if (isWarSubroute(url, request, "/member-activity-heatmap", "GET")) {
    return cachedMemberGet(
      routeContext,
      warDataTtlSeconds(5 * 60, OFFICIAL_END_CACHE_TTL_SECONDS),
      () => getWarMemberActivityHeatmap(url, env),
      warVersionNames,
    );
  }

  if (isWarSubroute(url, request, "/activity", "GET")) {
    return cachedMemberGet(
      routeContext,
      warDataTtlSeconds(5 * 60, OFFICIAL_END_CACHE_TTL_SECONDS),
      () => getWarActivity(url, env),
      warVersionNames,
    );
  }

  if (isWarSubroute(url, request, "/activity-heatmap", "GET")) {
    return cachedMemberGet(
      routeContext,
      warDataTtlSeconds(5 * 60, OFFICIAL_END_CACHE_TTL_SECONDS),
      () => getWarActivityHeatmap(url, env),
      warVersionNames,
    );
  }

  if (isWarSubroute(url, request, "/chain-bonuses", "GET")) {
    return cachedMemberGet(
      routeContext,
      warDataTtlSeconds(15 * 60, OFFICIAL_END_CACHE_TTL_SECONDS),
      () => getWarChainBonusesForWar(url, env),
      warVersionNames,
    );
  }

  if (isWarSubroute(url, request, "/attacks", "GET")) {
    return withAdmin(routeContext, () =>
      url.searchParams.get("format") === "csv" ? exportWarAttacksCsv(url, env) : getWarAttacks(url, env),
    );
  }

  if (isWarDetailRoute(url, request)) {
    return cachedMemberGet(
      routeContext,
      warDataTtlSeconds(55, OFFICIAL_END_CACHE_TTL_SECONDS),
      () => getWar(url, env),
      warVersionNames,
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
  versionNames: string[] = [],
): Promise<Response> {
  return withMember(routeContext, () =>
    versionNames.length > 0
      ? cachedVersionedGetJson(routeContext.env, routeContext.request, routeContext.ctx, ttl, versionNames, load)
      : cachedGetJson(routeContext.request, routeContext.ctx, ttl, load),
  );
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
  if (warId === undefined) {
    await bumpGlobalWarCacheVersion(env);
  } else {
    await bumpWarCacheVersionById(env, warId);
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
