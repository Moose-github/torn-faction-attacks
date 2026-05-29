import { warCacheVersionNames } from "../cacheVersions";
import { getEnemyPushPressureForWar } from "../enemyPushPressure";
import {
  getEnemyScoutingForWar,
  getScoutingComparisonForWar,
  refreshEnemyScoutingForWar,
} from "../enemyScouting";
import { getWarActivityHeatmap } from "../heatmap";
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
  getWarMemberActivityHeatmap,
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

export async function routeWarCommands(routeContext: RouteContext): Promise<RouteResult> {
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
