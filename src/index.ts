import { authenticateWithTornKey, getCurrentAuthSession, requireAdmin } from "./auth";
import {
  getEnemyScoutingForWar,
  getScoutingComparisonForWar,
  refreshEnemyScoutingForWar,
} from "./enemyScouting";
import { getWarActivityHeatmap } from "./heatmap";
import { getLatestIngestionRun, runIngestion } from "./ingestion";
import { fetchRankedWarReport, getWarReportDiscrepancies } from "./reports";
import { rebuildDerivedStatsFromRaw } from "./summaries";
import { ExecutionContext, Env, ScheduledController } from "./types";
import { corsHeaders, json, parseLimit } from "./utils";
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
  async fetch(request: Request, env: Env): Promise<Response> {
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
      await runIngestion(env, "manual");
      return json({ ok: true });
    }

    if (url.pathname === "/api/admin/ingestion-run" && request.method === "GET") {
      const authError = await requireAdmin(request, env);
      if (authError) return authError;
      return getLatestIngestionRun(env);
    }

    if (url.pathname === "/api/rebuild" && request.method === "POST") {
      const authError = await requireAdmin(request, env);
      if (authError) return authError;
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
      return fetchRankedWarReport(url, env);
    }

    if (url.pathname === "/api/wars" && request.method === "GET") {
      return listWars(url, env);
    }

    if (
      url.pathname.startsWith("/api/wars/") &&
      url.pathname.endsWith("/report-discrepancies") &&
      request.method === "GET"
    ) {
      return getWarReportDiscrepancies(url, env);
    }

    if (
      url.pathname.startsWith("/api/wars/") &&
      url.pathname.endsWith("/enemy-scouting") &&
      request.method === "GET"
    ) {
      return getEnemyScoutingForWar(url, env);
    }

    if (
      url.pathname.startsWith("/api/wars/") &&
      url.pathname.endsWith("/scouting-comparison") &&
      request.method === "GET"
    ) {
      return getScoutingComparisonForWar(url, env);
    }

    if (
      url.pathname.startsWith("/api/wars/") &&
      url.pathname.endsWith("/enemy-scouting") &&
      request.method === "POST"
    ) {
      const authError = await requireAdmin(request, env);
      if (authError) return authError;
      return refreshEnemyScoutingForWar(url, env);
    }

    if (
      url.pathname.startsWith("/api/wars/") &&
      url.pathname.includes("/members/") &&
      url.pathname.endsWith("/attacks") &&
      request.method === "GET"
    ) {
      return getWarMemberAttacks(url, env);
    }

    if (
      url.pathname.startsWith("/api/wars/") &&
      url.pathname.endsWith("/activity") &&
      request.method === "GET"
    ) {
      return getWarActivity(url, env);
    }

    if (
      url.pathname.startsWith("/api/wars/") &&
      url.pathname.endsWith("/activity-heatmap") &&
      request.method === "GET"
    ) {
      return getWarActivityHeatmap(url, env);
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
      return getWar(url, env);
    }

    if (url.pathname === "/api/stats" && request.method === "GET") {
      return getOverallStats(url, env);
    }

    return json({ error: "Not found" }, 404);
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      runIngestion(env).catch((err) => {
        console.error("Cron ingestion failed:", err?.message || err);
        console.error(err);
      }),
    );
  },
};

