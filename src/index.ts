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
} from "./enemyScouting";
import { getWarActivityHeatmap } from "./heatmap";
import { getLatestIngestionRun, runIngestion } from "./ingestion";
import {
  getMemberLifestyleStats,
  refreshDailyMemberLifestyleStats,
  refreshMemberLifestyleStatsFromRequest,
} from "./lifestyleStats";
import { runScheduledMaintenance } from "./maintenance";
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
      return getMemberLifestyleStats(url, env);
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
      return listWars(url, env);
    }

    if (
      url.pathname.startsWith("/api/wars/") &&
      url.pathname.endsWith("/report-discrepancies") &&
      request.method === "GET"
    ) {
      const authError = await requireMember(request, env);
      if (authError) return authError;
      return getWarReportDiscrepancies(url, env);
    }

    if (
      url.pathname.startsWith("/api/wars/") &&
      url.pathname.endsWith("/enemy-scouting") &&
      request.method === "GET"
    ) {
      const authError = await requireMember(request, env);
      if (authError) return authError;
      return getEnemyScoutingForWar(url, env);
    }

    if (
      url.pathname.startsWith("/api/wars/") &&
      url.pathname.endsWith("/scouting-comparison") &&
      request.method === "GET"
    ) {
      const authError = await requireMember(request, env);
      if (authError) return authError;
      return getScoutingComparisonForWar(url, env);
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
      return getWarActivity(url, env);
    }

    if (
      url.pathname.startsWith("/api/wars/") &&
      url.pathname.endsWith("/activity-heatmap") &&
      request.method === "GET"
    ) {
      const authError = await requireMember(request, env);
      if (authError) return authError;
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
      const authError = await requireMember(request, env);
      if (authError) return authError;
      return getWar(url, env);
    }

    if (url.pathname === "/api/stats" && request.method === "GET") {
      const authError = await requireMember(request, env);
      if (authError) return authError;
      return getOverallStats(url, env);
    }

    return json({ error: "Not found" }, 404);
  },

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (event.cron === "*/15 * * * *") {
      ctx.waitUntil(
        runScheduledMaintenance(env).catch((err) => {
          console.error("Cron maintenance failed:", err?.message || err);
          console.error(err);
        }),
      );
      return;
    }

    ctx.waitUntil(
      Promise.allSettled([
        runIngestion(env),
        refreshDailyMemberLifestyleStats(env),
      ]).then((results) => {
        results.forEach((result, index) => {
          if (result.status === "rejected") {
            const label = index === 0 ? "Cron ingestion" : "Cron lifestyle stats";
            const err = result.reason;
            console.error(`${label} failed:`, err?.message || err);
            console.error(err);
          }
        });
      }),
    );
  },
};

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

