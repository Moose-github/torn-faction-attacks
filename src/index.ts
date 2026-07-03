import { buildCronPlan } from "./cronPlan";
export { ChainWatchAlarm } from "./chainWatchAlarm";
import { handleDiscordInteractions } from "./discordInteractions";
import { routeAdminApi } from "./http/adminRoutes";
import { routeArrestScoutApi } from "./http/arrestScoutRoutes";
import { RouteContext, RouteResult } from "./http/context";
import { routeMemberUtilityApi } from "./http/memberRoutes";
import { routePublicApi } from "./http/publicRoutes";
import { routeTradeApi } from "./http/tradeRoutes";
import { routeWarCommands, routeWarReads } from "./http/warRoutes";
import { Env } from "./types";
import { corsHeaders, json } from "./utils";

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

    const discordResponse = await handleDiscordInteractions(request, env);
    if (discordResponse) {
      return discordResponse;
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

async function routeApiRequest(routeContext: RouteContext): Promise<RouteResult> {
  return (
    (await routePublicApi(routeContext)) ??
    (await routeAdminApi(routeContext)) ??
    (await routeArrestScoutApi(routeContext)) ??
    (await routeTradeApi(routeContext)) ??
    (await routeMemberUtilityApi(routeContext)) ??
    (await routeWarCommands(routeContext)) ??
    (await routeWarReads(routeContext))
  );
}
