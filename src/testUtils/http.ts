import type { Env } from "../types";

export function routeContext(rawUrl: string, init?: RequestInit) {
  const request = new Request(rawUrl, init);
  const url = new URL(rawUrl);
  return {
    request,
    env: {} as Env,
    ctx: {} as ExecutionContext,
    url,
  };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
