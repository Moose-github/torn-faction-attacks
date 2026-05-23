import { Env, WarRow } from "./types";
import { json, nowSeconds } from "./utils";

const MONITOR_TICKET_SCOPE = "enemy-hospital-monitor";
const MONITOR_TICKET_TTL_SECONDS = 5 * 60;

type MonitorTicketPayload = {
  scope: typeof MONITOR_TICKET_SCOPE;
  warId: number;
  enemyFactionId: number;
  tornWarId: number | null;
  exp: number;
};

export async function createMonitorTicket(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { war_id?: unknown };
  const warId = Number(body.war_id);

  if (!Number.isInteger(warId) || warId <= 0) {
    return json({ ok: false, error: "A valid war_id is required", code: "INVALID_WAR_ID" }, 400);
  }

  const war = (await env.DB.prepare(
    `
    SELECT *
    FROM wars
    WHERE id = ?
      AND status = 'active'
      AND practical_finish_time IS NULL
      AND official_end_time IS NULL
    LIMIT 1
    `,
  )
    .bind(warId)
    .first()) as WarRow | null;

  if (!war) {
    return json({ ok: false, error: "Active war not found", code: "WAR_NOT_FOUND" }, 404);
  }

  if (war.enemy_faction_id === null) {
    return json({ ok: false, error: "War does not have an enemy faction ID", code: "MISSING_ENEMY_FACTION" }, 400);
  }

  const secret = await readMonitorTicketSecret(env.MONITOR_TICKET_SECRET);
  if (!secret) {
    return json(
      { ok: false, error: "Monitor ticket signing secret is not configured", code: "MONITOR_SECRET_MISSING" },
      503,
    );
  }

  const expiresAt = nowSeconds() + MONITOR_TICKET_TTL_SECONDS;
  const ticket = await signMonitorTicket(
    {
      scope: MONITOR_TICKET_SCOPE,
      warId: war.id,
      enemyFactionId: war.enemy_faction_id,
      tornWarId: war.torn_war_id,
      exp: expiresAt,
    },
    secret,
  );

  return json({
    ok: true,
    ticket,
    expires_at: expiresAt,
  });
}

async function signMonitorTicket(payload: MonitorTicketPayload, secret: string): Promise<string> {
  const encodedPayload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await hmacSha256(encodedPayload, secret);
  return `${encodedPayload}.${base64UrlEncode(signature)}`;
}

async function hmacSha256(payload: string, secret: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
}

async function readMonitorTicketSecret(binding: Env["MONITOR_TICKET_SECRET"]): Promise<string | null> {
  try {
    const value = typeof binding === "string" ? binding : await binding?.get();
    const trimmed = value?.trim() ?? "";
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

function base64UrlEncode(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
