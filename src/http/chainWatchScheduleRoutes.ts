import { readAuthenticatedUserId } from "../auth";
import { getChainWatchLive } from "../chainWatch";
import { readJsonObject } from "../backend/request";
import { changeWatchSlots, readWatch, readWatchHistory, setWatchFinish, WatchError } from "../chainWatchSchedule";
import { syncWatchBoardsSafely } from "../chainWatchScheduleDiscord";
import { json } from "../utils";
import { withAdmin, withMember, type RouteContext, type RouteResult } from "./context";

export async function routeWatchScheduleApi(context: RouteContext): Promise<RouteResult> {
  const { request, env, url, ctx } = context;
  const live = url.pathname === "/api/chain-watch/live";
  const admin = url.pathname.startsWith("/api/admin/chain-watch");
  const base = admin ? "/api/admin/chain-watch" : "/api/chain-watch";
  const history = url.pathname === `${base}/history`;
  if (!live && !history && url.pathname !== base && url.pathname !== `${base}/slots` && url.pathname !== `${base}/finish`) return null;
  return (admin ? withAdmin : withMember)(context, async () => {
    try {
      if (live) return request.method === "GET" ? await getChainWatchLive(env) : json({ ok: false, error: "Method not allowed" }, 405);
      if (history) return request.method === "GET" ? json(await readWatchHistory(env)) : json({ ok: false, error: "Method not allowed" }, 405);
      if (request.method === "GET" && url.pathname === base) return json(await readWatch(env, url.searchParams.get("watch")));
      if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
      const actorId = await readAuthenticatedUserId(request, env);
      if (!actorId) return json({ ok: false, error: "Sign in to manage your slots." }, 401);
      const body = await readJsonObject(request);
      if (typeof body.watch_id !== "string") throw new WatchError("Choose a watch.");
      if (url.pathname === `${base}/slots`) {
        if (!admin && body.action !== "claim" && body.action !== "leave") throw new WatchError("Choose claim or leave.");
        if (admin && body.target_id !== null && typeof body.target_id !== "number") throw new WatchError("Choose a faction member or remove the assignment.");
        await changeWatchSlots(env, {
          watchId: body.watch_id, starts: body.starts, actorId, admin,
          targetId: admin ? body.target_id as number | null : body.action === "claim" ? actorId : null,
        });
      } else if (admin && url.pathname === `${base}/finish`) {
        await setWatchFinish(env, body.watch_id, body.finish);
      } else return json({ ok: false, error: "Route not found" }, 404);
      ctx.waitUntil(syncWatchBoardsSafely(env));
      return json(await readWatch(env, body.watch_id));
    } catch (error) {
      if (error instanceof WatchError) return json({ ok: false, error: error.message }, error.status);
      console.error("Chain watch API failed", error);
      return json({ ok: false, error: "Chain watch is temporarily unavailable. Try again shortly." }, 500);
    }
  });
}
