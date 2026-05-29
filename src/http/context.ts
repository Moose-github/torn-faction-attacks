import { requireAdmin, requireMember } from "../auth";
import { cachedGetJson, cachedVersionedGetJson, CacheTtl } from "../responseCache";
import { readSyncTimestamp, upsertSyncTimestamp } from "../syncState";
import { Env } from "../types";
import { json, nowSeconds } from "../utils";

export type RouteContext = {
  request: Request;
  env: Env;
  ctx: ExecutionContext;
  url: URL;
};

export type RouteResult = Response | null;
type RouteHandler = () => Promise<Response> | Response;

export async function withAdmin(routeContext: RouteContext, handler: RouteHandler): Promise<Response> {
  const authError = await requireAdmin(routeContext.request, routeContext.env);
  return authError ?? await handler();
}

export async function withMember(routeContext: RouteContext, handler: RouteHandler): Promise<Response> {
  const authError = await requireMember(routeContext.request, routeContext.env);
  return authError ?? await handler();
}

export async function cachedMemberGet(
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

export async function requireActionCooldown(
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
