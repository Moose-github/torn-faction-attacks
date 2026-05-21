import { EnemyHospitalMonitor } from "./EnemyHospitalMonitor";
import type { ActiveWarConfig, MonitorEnv } from "./types";

export { EnemyHospitalMonitor };

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
};

export default {
  async fetch(request: Request, env: MonitorEnv): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const monitor = env.ENEMY_HOSPITAL_MONITOR.getByName("active-war");

    if (url.pathname === "/health") {
      return json({ ok: true });
    }

    if (url.pathname === "/ws" && request.method === "GET") {
      const authError = await requireMonitorTicket(url, env);
      if (authError) return authError;

      const activeWar = activeWarFromUrl(url);
      if (activeWar instanceof Response) return activeWar;

      return monitor.fetch(requestWithPath(request, "/ws", activeWar));
    }

    if (url.pathname === "/status" && request.method === "GET") {
      return monitor.fetch(requestWithPath(request, "/status"));
    }

    return json({ ok: false, error: "Not found" }, 404);
  },
};

function activeWarFromUrl(url: URL): ActiveWarConfig | Response {
  const warId = Number(url.searchParams.get("warId"));
  const warName = url.searchParams.get("warName")?.trim() ?? "";
  const enemyFactionId = Number(url.searchParams.get("enemyFactionId"));
  const tornWarIdRaw = url.searchParams.get("tornWarId");
  const tornWarId = tornWarIdRaw ? Number(tornWarIdRaw) : null;

  if (!Number.isInteger(warId) || warId <= 0) {
    return json({ ok: false, error: "Invalid warId" }, 400);
  }
  if (!warName) {
    return json({ ok: false, error: "Invalid warName" }, 400);
  }
  if (!Number.isInteger(enemyFactionId) || enemyFactionId <= 0) {
    return json({ ok: false, error: "Invalid enemyFactionId" }, 400);
  }
  if (tornWarIdRaw) {
    if (!Number.isInteger(tornWarId) || tornWarId === null || tornWarId <= 0) {
      return json({ ok: false, error: "Invalid tornWarId" }, 400);
    }
  }

  return { warId, warName, enemyFactionId, tornWarId: tornWarId ?? null };
}

async function requireMonitorTicket(url: URL, env: MonitorEnv): Promise<Response | null> {
  if (!env.MONITOR_TICKET_SECRET) {
    return null;
  }

  const ticket = url.searchParams.get("ticket");
  if (!ticket) {
    return json({ ok: false, error: "Missing monitor ticket" }, 401);
  }

  const valid = await verifyTicket(ticket, env.MONITOR_TICKET_SECRET);
  return valid ? null : json({ ok: false, error: "Invalid monitor ticket" }, 401);
}

async function verifyTicket(ticket: string, secret: string): Promise<boolean> {
  const [payload, signature] = ticket.split(".");
  if (!payload || !signature) return false;

  const data = parseBase64UrlJson<{ exp?: number }>(payload);
  if (!data || typeof data.exp !== "number" || data.exp < Math.floor(Date.now() / 1000)) {
    return false;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return timingSafeEqual(signature, base64UrlEncode(expected));
}

function parseBase64UrlJson<T>(value: string): T | null {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), "=");
    return JSON.parse(atob(padded)) as T;
  } catch {
    return null;
  }
}

function base64UrlEncode(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

function requestWithPath(request: Request, path: string, activeWar?: ActiveWarConfig): Request {
  const url = new URL(request.url);
  url.pathname = path;
  if (activeWar) {
    url.searchParams.set("warId", String(activeWar.warId));
    url.searchParams.set("warName", activeWar.warName);
    url.searchParams.set("enemyFactionId", String(activeWar.enemyFactionId));
    if (activeWar.tornWarId) {
      url.searchParams.set("tornWarId", String(activeWar.tornWarId));
    }
  }
  return new Request(url, request);
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: CORS_HEADERS });
}
