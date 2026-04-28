import {
  AUTH_SESSION_TTL_SECONDS,
  HOME_FACTION_ID,
  TORN_USER_BASIC_API_URL,
  TORN_USER_FACTION_API_URL,
} from "./constants";
import { Env } from "./types";
import { json, nowSeconds } from "./utils";

type AccessLevel = "member" | "admin";

type TornAuthUser = {
  id: number;
  name: string | null;
};

type AuthSession = TornAuthUser & {
  access_level: AccessLevel;
  expires_at: number;
};

export async function authenticateWithTornKey(request: Request, env: Env): Promise<Response> {
  try {
    const body = (await request.json()) as { key?: unknown };
    const tornKey = typeof body.key === "string" ? body.key.trim() : "";

    if (!tornKey) {
      return json({ ok: false, error: "Torn API key is required", code: "MISSING_TORN_KEY" }, 400);
    }

    const [user, factionId] = await Promise.all([
      fetchTornUserBasic(tornKey),
      fetchTornUserFactionId(tornKey),
    ]);

    if (factionId !== HOME_FACTION_ID) {
      return json(
        {
          ok: false,
          error: "This Torn key does not belong to the configured faction",
          code: "NOT_FACTION_MEMBER",
        },
        403,
      );
    }

    const admin = await env.DB.prepare(
      `
      SELECT torn_user_id
      FROM admin_users
      WHERE torn_user_id = ?
      LIMIT 1
      `,
    )
      .bind(user.id)
      .first();
    const accessLevel: AccessLevel = admin ? "admin" : "member";
    const token = createSessionToken();
    const expiresAt = nowSeconds() + AUTH_SESSION_TTL_SECONDS;

    await env.DB.batch([
      env.DB.prepare(`DELETE FROM auth_sessions WHERE expires_at <= ?`).bind(nowSeconds()),
      env.DB.prepare(
        `
        INSERT INTO auth_sessions (token, torn_user_id, name, access_level, expires_at)
        VALUES (?, ?, ?, ?, ?)
        `,
      ).bind(token, user.id, user.name, accessLevel, expiresAt),
    ]);

    return json({
      ok: true,
      token,
      access_level: accessLevel,
      expires_at: expiresAt,
      user,
    });
  } catch (err: any) {
    return json({ ok: false, error: err?.message || String(err), code: "AUTH_FAILED" }, 401);
  }
}

export async function getCurrentAuthSession(request: Request, env: Env): Promise<Response> {
  const session = await readAuthSession(request, env);
  if (!session) {
    return json({ ok: false, error: "Unauthorized", code: "UNAUTHORIZED" }, 401);
  }

  return json({
    ok: true,
    access_level: session.access_level,
    expires_at: session.expires_at,
    user: {
      id: session.id,
      name: session.name,
    },
  });
}

export async function requireAdmin(request: Request, env: Env): Promise<Response | null> {
  const session = await readAuthSession(request, env);

  if (!session) {
    return json({ ok: false, error: "Unauthorized", code: "UNAUTHORIZED" }, 401);
  }

  if (session.access_level !== "admin") {
    return json({ ok: false, error: "Admin access required", code: "ADMIN_REQUIRED" }, 403);
  }

  return null;
}

async function readAuthSession(request: Request, env: Env): Promise<AuthSession | null> {
  const token = bearerToken(request);
  if (!token) {
    return null;
  }

  const session = (await env.DB.prepare(
    `
    SELECT torn_user_id, name, access_level, expires_at
    FROM auth_sessions
    WHERE token = ?
      AND expires_at > ?
    LIMIT 1
    `,
  )
    .bind(token, nowSeconds())
    .first()) as {
    torn_user_id: number;
    name: string | null;
    access_level: AccessLevel;
    expires_at: number;
  } | null;

  if (!session) {
    return null;
  }

  return {
    id: session.torn_user_id,
    name: session.name,
    access_level: session.access_level,
    expires_at: session.expires_at,
  };
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("Authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() || null;
}

async function fetchTornUserBasic(tornKey: string): Promise<TornAuthUser> {
  const data = await fetchTornJson(TORN_USER_BASIC_API_URL, tornKey, { striptags: "true" });
  const source = data.basic ?? data.profile ?? data.user ?? data;
  const id = Number(source.id ?? source.player_id ?? source.user_id);
  const name =
    typeof source.name === "string"
      ? source.name
      : typeof source.username === "string"
        ? source.username
        : null;

  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Torn basic response did not include a valid user ID");
  }

  return { id, name };
}

async function fetchTornUserFactionId(tornKey: string): Promise<number | null> {
  const data = await fetchTornJson(TORN_USER_FACTION_API_URL, tornKey);
  const faction = data.faction ?? data;
  const id = Number(faction.id ?? faction.faction_id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function fetchTornJson(
  baseUrl: string,
  tornKey: string,
  params: Record<string, string> = {},
): Promise<any> {
  const url = new URL(baseUrl);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("key", tornKey);

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Torn auth API error: ${response.status}`);
  }

  const data = (await response.json()) as any;
  if (data?.error) {
    throw new Error(data.error.error ?? data.error.message ?? "Torn API rejected the key");
  }

  return data;
}

function createSessionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
