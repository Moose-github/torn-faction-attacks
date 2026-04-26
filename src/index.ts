import { runIngestion } from "./ingestion";
import { rebuildDerivedStatsFromRaw } from "./summaries";
import { ExecutionContext, Env, ScheduledController } from "./types";
import { corsHeaders, json, parseLimit } from "./utils";
import {
  createWar,
  endActiveWar,
  getOverallStats,
  getWar,
  getWarAttacks,
  importHistoricalWar,
  listWars,
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

    if (url.pathname === "/api/run" && request.method === "POST") {
      await runIngestion(env);
      return json({ ok: true });
    }

    if (url.pathname === "/api/rebuild" && request.method === "POST") {
      const result = await rebuildDerivedStatsFromRaw(env);
      return json({ ok: true, ...result });
    }

    if (url.pathname === "/api/health") {
      return json({ ok: true });
    }

    if (url.pathname === "/api/attacks") {
      const limit = parseLimit(url.searchParams.get("limit"), 50, 100);
      const rows = await env.DB.prepare(`SELECT * FROM attacks ORDER BY started DESC LIMIT ?`)
        .bind(limit)
        .all();

      return json(rows.results ?? []);
    }

    if (url.pathname === "/api/wars" && request.method === "POST") {
      return createWar(request, env);
    }

    if (url.pathname === "/api/wars/import" && request.method === "POST") {
      return importHistoricalWar(request, env);
    }

    if (url.pathname === "/api/wars/end" && request.method === "POST") {
      return endActiveWar(env);
    }

    if (url.pathname === "/api/wars" && request.method === "GET") {
      return listWars(url, env);
    }

    if (
      url.pathname.startsWith("/api/wars/") &&
      !url.pathname.endsWith("/attacks") &&
      request.method === "GET"
    ) {
      return getWar(url, env);
    }

    if (
      url.pathname.startsWith("/api/wars/") &&
      url.pathname.endsWith("/attacks") &&
      request.method === "GET"
    ) {
      return getWarAttacks(url, env);
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
