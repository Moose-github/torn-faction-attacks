import { warCacheVersionNames } from "../cacheVersions";
import {
  getChainWatchForWar,
  updateChainWatchForWar,
} from "../chainWatch";
import {
  addEnemyBigHitterForWar,
  getEnemyBigHittersForWar,
  removeEnemyBigHitterForWar,
} from "../enemyBigHitters";
import { getEnemyPushPressureForWar } from "../enemyPushPressure";
import {
  getEnemyScoutingForWar,
  getScoutingComparisonForWar,
  refreshEnemyHitStatsForWar,
  refreshEnemyScoutingForWar,
} from "../enemyScouting";
import { getEnemyMemberActivityHeatmap, getWarActivityHeatmap } from "../heatmap";
import { fetchRankedWarReport, getWarReportDiscrepancies } from "../reports";
import {
  OFFICIAL_END_CACHE_TTL_SECONDS,
  scoutingComparisonTtlSeconds,
  warDataTtlSeconds,
} from "../responseCache";
import {
  isTornWarReportFetchRoute,
  isWarDetailRoute,
  isWarMemberAttacksRoute,
  isWarSubroute,
  matchesExactRoute,
  warNameFromWarRoute,
} from "../routes";
import { json } from "../utils";
import {
  deleteWar,
  endActiveWar,
  exportWarAttacksCsv,
  getWar,
  getWarActivity,
  getWarAttacks,
  getWarChainBonusesForWar,
  getWarMemberCombatHeatmap,
  getWarMemberAttacks,
  importHistoricalWar,
  listWars,
  previewHistoricalWarImport,
  relinkWarAttacks,
  updateOfficialWar,
} from "../wars";
import {
  cachedMemberGet,
  requireActionCooldown,
  RouteContext,
  RouteResult,
  withAdmin,
} from "./context";
import { routeExact, type ExactRoute } from "./routeTable";
import { getWarControlForWar } from "../warControl";

export async function routeWarCommands(routeContext: RouteContext): Promise<RouteResult> {
  const { request, env, url } = routeContext;

  const exactRouteResult = await routeExact(routeContext, warCommandExactRoutes(request, env));
  if (exactRouteResult) {
    return exactRouteResult;
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

  if (isWarSubroute(url, request, "/enemy-hit-stats/refresh", "POST")) {
    return withAdmin(routeContext, async () => {
      const cooldownError = await requireActionCooldown(env, `enemy_hit_stats_refresh:${url.pathname}`, 5 * 60);
      if (cooldownError) return cooldownError;
      return refreshEnemyHitStatsForWar(url, env);
    });
  }

  if (isWarSubroute(url, request, "/chain-watch", "POST")) {
    return withAdmin(routeContext, () => updateChainWatchForWar(request, url, env));
  }

  if (isWarSubroute(url, request, "/enemy-big-hitters", "POST")) {
    return withAdmin(routeContext, () => addEnemyBigHitterForWar(request, url, env));
  }

  if (isWarSubroute(url, request, "/enemy-big-hitters/remove", "POST")) {
    return withAdmin(routeContext, () => removeEnemyBigHitterForWar(request, url, env));
  }

  return null;
}

function warCommandExactRoutes(request: Request, env: RouteContext["env"]): ExactRoute[] {
  return [
    {
      path: "/api/wars",
      method: "POST",
      handle: (routeContext) =>
        withAdmin(routeContext, () =>
          disabledWarCommandResponse(
            "Manual war creation is disabled. Wars are auto-created from Torn or imported after they finish.",
            "MANUAL_WAR_CREATION_DISABLED",
          ),
        ),
    },
    {
      path: "/api/wars/import",
      method: "POST",
      handle: (routeContext) => withAdmin(routeContext, () => importHistoricalWar(request, env)),
    },
    {
      path: "/api/wars/import-event",
      method: "POST",
      handle: (routeContext) =>
        withAdmin(routeContext, () =>
          disabledWarCommandResponse(
            "Manual event import is disabled. Use historical war import for war records.",
            "MANUAL_EVENT_IMPORT_DISABLED",
          ),
        ),
    },
    {
      path: "/api/wars/import/preview",
      method: "POST",
      handle: (routeContext) => withAdmin(routeContext, () => previewHistoricalWarImport(request, env)),
    },
    {
      path: "/api/wars/import-event/preview",
      method: "POST",
      handle: (routeContext) =>
        withAdmin(routeContext, () =>
          disabledWarCommandResponse(
            "Manual event import preview is disabled.",
            "MANUAL_EVENT_IMPORT_DISABLED",
          ),
        ),
    },
    {
      path: "/api/wars/update-official",
      method: "POST",
      handle: (routeContext) => withAdmin(routeContext, () => updateOfficialWar(request, env)),
    },
    {
      path: "/api/wars/update-event",
      method: "POST",
      handle: (routeContext) =>
        withAdmin(routeContext, () =>
          disabledWarCommandResponse(
            "Manual event editing is disabled.",
            "MANUAL_EVENT_EDIT_DISABLED",
          ),
        ),
    },
    {
      path: "/api/wars/delete",
      method: "POST",
      handle: (routeContext) => withAdmin(routeContext, () => deleteWar(request, env)),
    },
    {
      path: "/api/wars/relink-attacks",
      method: "POST",
      handle: (routeContext) => withAdmin(routeContext, () => relinkWarAttacks(request, env)),
    },
    {
      path: "/api/wars/end",
      method: "POST",
      handle: (routeContext) => withAdmin(routeContext, () => endActiveWar(request, env)),
    },
  ];
}

function disabledWarCommandResponse(error: string, code: string): Response {
  return json({ ok: false, error, code }, 410);
}

export async function routeWarReads(routeContext: RouteContext): Promise<RouteResult> {
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
      warVersionNames,
    );
  }

  if (isWarSubroute(url, request, "/war-control", "GET")) {
    return cachedMemberGet(
      routeContext,
      warDataTtlSeconds(5 * 60, OFFICIAL_END_CACHE_TTL_SECONDS, 55),
      () => getWarControlForWar(url, env),
      warVersionNames,
    );
  }

  if (isWarSubroute(url, request, "/enemy-scouting", "GET")) {
    return cachedMemberGet(
      routeContext,
      warDataTtlSeconds(5 * 60, OFFICIAL_END_CACHE_TTL_SECONDS, 55),
      () => getEnemyScoutingForWar(url, env),
      warVersionNames,
    );
  }

  if (isWarSubroute(url, request, "/enemy-big-hitters", "GET")) {
    return cachedMemberGet(
      routeContext,
      warDataTtlSeconds(5 * 60, OFFICIAL_END_CACHE_TTL_SECONDS, 55),
      () => getEnemyBigHittersForWar(url, env),
      warVersionNames,
    );
  }

  if (isWarSubroute(url, request, "/scouting-comparison", "GET")) {
    return cachedMemberGet(
      routeContext,
      scoutingComparisonTtlSeconds,
      () => getScoutingComparisonForWar(url, env),
      warVersionNames,
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

  if (
    isWarSubroute(url, request, "/member-combat-heatmap", "GET") ||
    isWarSubroute(url, request, "/member-activity-heatmap", "GET")
  ) {
    return cachedMemberGet(
      routeContext,
      warDataTtlSeconds(5 * 60, OFFICIAL_END_CACHE_TTL_SECONDS),
      () => getWarMemberCombatHeatmap(url, env),
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

  if (isWarSubroute(url, request, "/enemy-member-activity-heatmap", "GET")) {
    return cachedMemberGet(
      routeContext,
      warDataTtlSeconds(5 * 60, OFFICIAL_END_CACHE_TTL_SECONDS),
      () => getEnemyMemberActivityHeatmap(url, env),
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

  if (isWarSubroute(url, request, "/chain-watch", "GET")) {
    return cachedMemberGet(
      routeContext,
      15,
      () => getChainWatchForWar(url, env),
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
