import { EnemyHospitalMonitor } from "./EnemyHospitalMonitor";
import { parseActiveWarFromUrl } from "./activeWar";
import type { ActiveWarConfig, MonitorEnv } from "./types";

export { EnemyHospitalMonitor };

const MONITOR_TICKET_SCOPE = "enemy-hospital-monitor";

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
      const activeWar = activeWarFromUrl(url);
      if (activeWar instanceof Response) return activeWar;

      const authError = await requireMonitorTicket(url, env, activeWar);
      if (authError) return authError;

      return monitor.fetch(requestWithPath(request, "/ws", activeWar));
    }

    if (url.pathname === "/status" && request.method === "GET") {
      return monitor.fetch(requestWithPath(request, "/status"));
    }

    return json({ ok: false, error: "Not found" }, 404);
  },
};

function activeWarFromUrl(url: URL): ActiveWarConfig | Response {
  const parsed = parseActiveWarFromUrl(url);
  return parsed.ok ? parsed.activeWar : json({ ok: false, error: parsed.error }, 400);
}

async function requireMonitorTicket(
  url: URL,
  env: MonitorEnv,
  activeWar: ActiveWarConfig,
): Promise<Response | null> {
  const secret = await readMonitorTicketSecret(env.MONITOR_TICKET_SECRET);
  if (!secret) {
    return json({ ok: false, error: "Monitor ticket secret is not configured" }, 503);
  }
  const ticket = url.searchParams.get("ticket");
  if (!ticket) {
    return json({ ok: false, error: "Missing monitor ticket" }, 401);
  }

  const payload = await verifyTicket(ticket, secret);
  if (!payload || !ticketMatchesActiveWar(payload, activeWar)) {
    return json({ ok: false, error: "Invalid monitor ticket" }, 401);
  }

  return null;
}

async function verifyTicket(ticket: string, secret: string): Promise<MonitorTicketPayload | null> {
  const parts = ticket.split(".");
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;
  if (!payload || !signature) return null;

  const data = parseBase64UrlJson<MonitorTicketPayload>(payload);
  if (!isValidTicketPayload(data)) {
    return null;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return timingSafeEqual(signature, base64UrlEncode(expected)) ? data : null;
}

async function readMonitorTicketSecret(binding: MonitorEnv["MONITOR_TICKET_SECRET"]): Promise<string | null> {
  try {
    const value = typeof binding === "string" ? binding : await binding?.get();
    const trimmed = value?.trim() ?? "";
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

function isValidTicketPayload(value: MonitorTicketPayload | null): value is MonitorTicketPayload {
  return Boolean(
    value &&
      value.scope === MONITOR_TICKET_SCOPE &&
      Number.isInteger(value.warId) &&
      value.warId > 0 &&
      Number.isInteger(value.enemyFactionId) &&
      value.enemyFactionId > 0 &&
      (value.tornWarId === null || (Number.isInteger(value.tornWarId) && value.tornWarId > 0)) &&
      Number.isInteger(value.exp) &&
      value.exp >= Math.floor(Date.now() / 1000),
  );
}

function ticketMatchesActiveWar(payload: MonitorTicketPayload, activeWar: ActiveWarConfig): boolean {
  return (
    payload.warId === activeWar.warId &&
    payload.enemyFactionId === activeWar.enemyFactionId &&
    payload.tornWarId === (activeWar.tornWarId ?? null)
  );
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

type MonitorTicketPayload = {
  scope: typeof MONITOR_TICKET_SCOPE;
  warId: number;
  enemyFactionId: number;
  tornWarId: number | null;
  exp: number;
};
