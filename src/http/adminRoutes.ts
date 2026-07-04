import { positiveIntegerOrNull, readJsonObject } from "../backend/request";
import { grantAdminAccess, listAdminUsers, readAuthenticatedUserId } from "../auth";
import { bumpGlobalWarCacheVersion, bumpWarCacheVersionById } from "../cacheVersions";
import {
  getAdminDataHealth,
  updateDataHealthSettingsFromRequest,
} from "../dataHealth";
import { sendDiscordMessageFromRequest } from "../discord";
import {
  clearDiscordTravelTrackerTargetFromRequest,
  getDiscordTravelTrackerTargetFromRequest,
  setDiscordTravelTrackerTargetFromRequest,
  syncDiscordTravelTrackerFromRequest,
  updateDiscordTravelTrackerSettingsFromRequest,
} from "../discordTravelTracker";
import {
  getAdminDiscordAlertSettings,
  updateAdminDiscordAlertSettingsFromRequest,
} from "../discordAlertSettings";
import {
  previewEnemyStatsImageFromRequest,
  resetEnemyStatsImageFromRequest,
} from "../enemyScoutingCron";
import { restartLiveEnemyTrackingFromRequest } from "../enemyScouting";
import {
  listHomeFactionReportExemptions,
  updateHomeFactionReportExemption,
} from "../homeFactionMembers";
import { getLatestIngestionRun, runIngestion } from "../ingestion";
import {
  cancelMemberLifestyleRepairJob,
  createMemberLifestyleRepairJob,
  getMemberLifestyleRepairJob,
  listMemberLifestyleRepairJobs,
} from "../lifestyleStats/repairJobs";
import {
  refreshDailyGymStats,
} from "../lifestyleStats/dailyGym";
import {
  refreshDailyMemberLifestyleStats,
} from "../lifestyleStats/dailyPersonal";
import { getLatestMaintenanceRun } from "../maintenance";
import { syncMemberDiscordLinksFromRequest } from "../memberDiscordLinks";
import { cachedGetJson } from "../responseCache";
import {
  matchesExactRoute,
  memberLifestyleRepairJobCancelIdFromRoute,
  memberLifestyleRepairJobIdFromRoute,
} from "../routes";
import { getStockIngestionStatus, refreshTornStockHistoryBatch } from "../stockMarket";
import {
  exportStockSnapshots,
  getStockPaperSimulations,
  getStockPaperStatus,
  getStockPaperTrades,
  resetStockPaperAccount,
  simulateStockPaperBotFromRequest,
} from "../stockPaperTrading";
import { rebuildWarStatsFromRaw } from "../warStats";
import { listMemberSuggestionsForAdmin } from "../suggestions";
import { getTornApiUsage } from "../tornApiUsage";
import { listAdminTornApiKeys } from "../tornKeyPool";
import { Env } from "../types";
import { json, parseLimit } from "../utils";
import {
  getWarControlSettings,
  updateWarControlSettingsFromRequest,
} from "../warControl";
import {
  getAdminXanaxCompetition,
  previewXanaxCompetitionImage,
  updateAdminXanaxCompetition,
} from "../xanaxCompetition";
import { getAttackWindow } from "../wars";
import { requireActionCooldown, RouteContext, RouteResult, withAdmin } from "./context";

export async function routeAdminApi(routeContext: RouteContext): Promise<RouteResult> {
  const { request, env, ctx, url } = routeContext;

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

  if (matchesExactRoute(url, request, "/api/admin/torn-api-usage", "GET")) {
    return withAdmin(routeContext, () =>
      cachedGetJson(request, ctx, 60, () => getTornApiUsage(url, env)),
    );
  }

  if (matchesExactRoute(url, request, "/api/admin/torn-key-pool/keys", "GET")) {
    return withAdmin(routeContext, () => listAdminTornApiKeys(env));
  }

  if (matchesExactRoute(url, request, "/api/admin/data-health", "GET")) {
    return withAdmin(routeContext, () => getAdminDataHealth(url, env));
  }

  if (matchesExactRoute(url, request, "/api/admin/data-health/settings", "POST")) {
    return withAdmin(routeContext, () => updateDataHealthSettingsFromRequest(request, env));
  }

  if (matchesExactRoute(url, request, "/api/admin/war-control-settings", "GET")) {
    return withAdmin(routeContext, () => getWarControlSettings(env));
  }

  if (matchesExactRoute(url, request, "/api/admin/war-control-settings", "POST")) {
    return withAdmin(routeContext, () => updateWarControlSettingsFromRequest(request, env));
  }

  if (matchesExactRoute(url, request, "/api/admin/member-lifestyle/import-now", "POST")) {
    return withAdmin(routeContext, async () => {
      const cooldownError = await requireActionCooldown(env, "manual_member_lifestyle_import", 60);
      if (cooldownError) return cooldownError;
      const personal = await refreshDailyMemberLifestyleStats(env, { limit: 40, useLock: false });
      const gym = await refreshDailyGymStats(env);
      return json({ ok: true, ...personal, gym });
    });
  }

  if (matchesExactRoute(url, request, "/api/admin/member-lifestyle/repair-jobs", "POST")) {
    return withAdmin(routeContext, () => createMemberLifestyleRepairJob(request, env));
  }

  if (matchesExactRoute(url, request, "/api/admin/member-lifestyle/repair-jobs", "GET")) {
    return withAdmin(routeContext, () => listMemberLifestyleRepairJobs(env));
  }

  if (matchesExactRoute(url, request, "/api/admin/home-faction-members/report-exemptions", "GET")) {
    return withAdmin(routeContext, () => listHomeFactionReportExemptions(env));
  }

  if (matchesExactRoute(url, request, "/api/admin/home-faction-members/report-exemptions", "POST")) {
    return withAdmin(routeContext, () => updateHomeFactionReportExemption(request, env));
  }

  const lifestyleRepairJobId = memberLifestyleRepairJobIdFromRoute(url, request);
  if (lifestyleRepairJobId !== null && request.method === "GET") {
    return withAdmin(routeContext, () => getMemberLifestyleRepairJob(env, lifestyleRepairJobId));
  }

  const lifestyleRepairCancelJobId = memberLifestyleRepairJobCancelIdFromRoute(url, request);
  if (lifestyleRepairCancelJobId !== null) {
    return withAdmin(routeContext, () => cancelMemberLifestyleRepairJob(env, lifestyleRepairCancelJobId));
  }

  if (matchesExactRoute(url, request, "/api/admin/stocks/ingestion-status", "GET")) {
    return withAdmin(routeContext, () => getStockIngestionStatus(env));
  }

  if (matchesExactRoute(url, request, "/api/admin/stocks/paper/status", "GET")) {
    return withAdmin(routeContext, () => getStockPaperStatus(env));
  }

  if (matchesExactRoute(url, request, "/api/admin/stocks/export-snapshots", "GET")) {
    return withAdmin(routeContext, () => exportStockSnapshots(url, env));
  }

  if (matchesExactRoute(url, request, "/api/admin/stocks/recover-now", "POST")) {
    return withAdmin(routeContext, async () => {
      const cooldownError = await requireActionCooldown(env, "manual_stock_recovery", 5 * 60);
      if (cooldownError) return cooldownError;
      const run = await refreshTornStockHistoryBatch(env, Date.now(), { forceAll: true });
      return json({ ok: true, run });
    });
  }

  if (matchesExactRoute(url, request, "/api/admin/stocks/paper/simulate", "POST")) {
    return withAdmin(routeContext, async () => {
      const cooldownError = await requireActionCooldown(env, "stock_paper_simulation", 60 * 60);
      if (cooldownError) return cooldownError;
      return simulateStockPaperBotFromRequest(request, env);
    });
  }

  if (matchesExactRoute(url, request, "/api/admin/stocks/paper/simulations", "GET")) {
    return withAdmin(routeContext, () => getStockPaperSimulations(env));
  }

  if (matchesExactRoute(url, request, "/api/admin/stocks/paper/trades", "GET")) {
    return withAdmin(routeContext, () => getStockPaperTrades(url, env));
  }

  if (matchesExactRoute(url, request, "/api/admin/stocks/paper/reset", "POST")) {
    return withAdmin(routeContext, () => resetStockPaperAccount(request, env));
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

  if (matchesExactRoute(url, request, "/api/admin/discord-links/sync", "POST")) {
    return withAdmin(routeContext, async () => {
      const cooldownError = await requireActionCooldown(env, "discord_links_sync", 60 * 60);
      if (cooldownError) return cooldownError;
      return syncMemberDiscordLinksFromRequest(env);
    });
  }

  if (matchesExactRoute(url, request, "/api/admin/discord-travel-tracker/sync", "POST")) {
    return withAdmin(routeContext, async () => {
      const cooldownError = await requireActionCooldown(env, "discord_travel_tracker_sync", 30);
      if (cooldownError) return cooldownError;
      return syncDiscordTravelTrackerFromRequest(env);
    });
  }

  if (matchesExactRoute(url, request, "/api/admin/discord-travel-tracker/target", "GET")) {
    return withAdmin(routeContext, () => getDiscordTravelTrackerTargetFromRequest(env));
  }

  if (matchesExactRoute(url, request, "/api/admin/discord-travel-tracker/target", "POST")) {
    return withAdmin(routeContext, () => setDiscordTravelTrackerTargetFromRequest(request, env));
  }

  if (matchesExactRoute(url, request, "/api/admin/discord-travel-tracker/target", "DELETE")) {
    return withAdmin(routeContext, () => clearDiscordTravelTrackerTargetFromRequest(env));
  }

  if (matchesExactRoute(url, request, "/api/admin/discord-travel-tracker/settings", "POST")) {
    return withAdmin(routeContext, () => updateDiscordTravelTrackerSettingsFromRequest(request, env));
  }

  if (
    matchesExactRoute(url, request, "/api/admin/discord-alerts/settings", "GET") ||
    matchesExactRoute(url, request, "/api/admin/shoplifting-alerts", "GET")
  ) {
    return withAdmin(routeContext, () => getAdminDiscordAlertSettings(env));
  }

  if (
    matchesExactRoute(url, request, "/api/admin/discord-alerts/settings", "POST") ||
    matchesExactRoute(url, request, "/api/admin/shoplifting-alerts", "POST")
  ) {
    return withAdmin(routeContext, () => updateAdminDiscordAlertSettingsFromRequest(request, env));
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

  if (matchesExactRoute(url, request, "/api/admin/xanax-competition", "GET")) {
    return withAdmin(routeContext, () => getAdminXanaxCompetition(env));
  }

  if (matchesExactRoute(url, request, "/api/admin/xanax-competition/image", "GET")) {
    return withAdmin(routeContext, () => previewXanaxCompetitionImage(env));
  }

  if (matchesExactRoute(url, request, "/api/admin/xanax-competition", "POST")) {
    return withAdmin(routeContext, async () =>
      updateAdminXanaxCompetition(
        request,
        env,
        await readAuthenticatedUserId(request, env),
      ),
    );
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

async function rebuildStatsFromRequest(request: Request, env: Env): Promise<Response> {
  const body = await readJsonObject(request);
  const warId = body.war_id === undefined || body.war_id === null || body.war_id === ""
    ? undefined
    : positiveIntegerOrNull(body.war_id) ?? Number.NaN;
  if (warId !== undefined && !Number.isInteger(warId)) {
    return json({ ok: false, error: "Invalid war_id", code: "INVALID_WAR_ID" }, 400);
  }

  const cooldownError = await requireActionCooldown(
    env,
    warId === undefined ? "manual_rebuild:all" : `manual_rebuild:${warId}`,
    15 * 60,
  );
  if (cooldownError) return cooldownError;

  const result = await rebuildWarStatsFromRaw(env, warId === undefined
    ? { scope: "all-wars", reason: "admin" }
    : { scope: "single-war", warId, reason: "admin" });
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
