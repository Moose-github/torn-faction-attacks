import {
  AUTH_SESSION_TTL_SECONDS,
  HOME_FACTION_ID,
  TORN_KEY_INFO_API_URL,
} from "./constants";
import { trackedTornFetch } from "./tornApiUsage";
import { Env } from "./types";
import { json, nowSeconds } from "./utils";

type AccessLevel = "member" | "admin";

type TornAuthUser = {
  id: number;
  name: string | null;
  key_access_level: number | null;
  key_access_type: string | null;
  key_faction_access: boolean;
};

type AuthSession = TornAuthUser & {
  access_level: AccessLevel;
  expires_at: number;
};

type CachedAuthSession = {
  session: AuthSession;
  cache_expires_at: number;
};

const AUTH_SESSION_CACHE_TTL_SECONDS = 60;
const MAX_AUTH_SESSION_CACHE_ENTRIES = 250;
const authSessionCache = new Map<string, CachedAuthSession>();

export async function authenticateWithTornKey(request: Request, env: Env): Promise<Response> {
  try {
    const body = (await request.json()) as { key?: unknown };
    const tornKey = typeof body.key === "string" ? body.key.trim() : "";

    if (!tornKey) {
      return json({ ok: false, error: "Torn API key is required", code: "MISSING_TORN_KEY" }, 400);
    }

    const keyInfo = await fetchTornKeyInfo(env, tornKey);
    const user = keyInfo.user;

    if (keyInfo.factionId !== HOME_FACTION_ID) {
      return json(
        {
          ok: false,
          error: "This Torn key does not belong to the configured faction",
          code: "NOT_FACTION_MEMBER",
        },
        403,
      );
    }

    let admin = await env.DB.prepare(
      `
      SELECT torn_user_id
      FROM admin_users
      WHERE torn_user_id = ?
      LIMIT 1
      `,
    )
      .bind(user.id)
      .first();

    if (!admin && user.key_faction_access) {
      await env.DB.prepare(
        `
        INSERT INTO admin_users (torn_user_id)
        VALUES (?)
        ON CONFLICT(torn_user_id) DO NOTHING
        `,
      )
        .bind(user.id)
        .run();
      admin = { torn_user_id: user.id };
    }

    const accessLevel: AccessLevel = admin ? "admin" : "member";
    const token = createSessionToken();
    const issuedAt = nowSeconds();
    const expiresAt = issuedAt + AUTH_SESSION_TTL_SECONDS;

    await env.DB.batch([
      env.DB.prepare(`DELETE FROM auth_sessions WHERE expires_at <= ?`).bind(issuedAt),
      env.DB.prepare(
        `
        INSERT INTO auth_sessions (token, torn_user_id, access_level, expires_at)
        VALUES (?, ?, ?, ?)
        `,
      ).bind(token, user.id, accessLevel, expiresAt),
    ]);

    rememberAuthSession(
      token,
      {
        ...user,
        access_level: accessLevel,
        expires_at: expiresAt,
      },
      issuedAt,
    );

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
      key_access_level: null,
      key_access_type: null,
      key_faction_access: false,
    },
  });
}

export async function listAdminUsers(env: Env): Promise<Response> {
  const rows = await env.DB.prepare(
    `
    SELECT torn_user_id, created_at
    FROM admin_users
    ORDER BY torn_user_id ASC
    `,
  ).all();

  return json({
    ok: true,
    admins: rows.results ?? [],
  });
}

export async function grantAdminAccess(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { torn_user_id?: unknown };
  const tornUserId = Number(body.torn_user_id);

  if (!Number.isInteger(tornUserId) || tornUserId <= 0) {
    return json(
      {
        ok: false,
        error: "A valid Torn user ID is required",
        code: "INVALID_TORN_USER_ID",
      },
      400,
    );
  }

  await env.DB.batch([
    env.DB.prepare(
      `
      INSERT INTO admin_users (torn_user_id)
      VALUES (?)
      ON CONFLICT(torn_user_id) DO NOTHING
      `,
    ).bind(tornUserId),
    env.DB.prepare(
      `
      UPDATE auth_sessions
      SET access_level = 'admin'
      WHERE torn_user_id = ?
      `,
    ).bind(tornUserId),
  ]);

  authSessionCache.clear();

  return json({
    ok: true,
    granted: {
      torn_user_id: tornUserId,
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

export async function requireMember(request: Request, env: Env): Promise<Response | null> {
  const session = await readAuthSession(request, env);

  if (!session) {
    return json({ ok: false, error: "Unauthorized", code: "UNAUTHORIZED" }, 401);
  }

  return null;
}

export async function readAuthenticatedUserId(request: Request, env: Env): Promise<number | null> {
  const session = await readAuthSession(request, env);
  return session?.id ?? null;
}

export async function revokeSessionsForFormerFactionMembers(
  env: Env,
  currentMemberIds: Iterable<number>,
): Promise<number> {
  const ids = Array.from(new Set(Array.from(currentMemberIds).filter((id) => Number.isInteger(id) && id > 0)));

  if (ids.length === 0) {
    return 0;
  }

  const placeholders = ids.map(() => "?").join(", ");
  const result = await env.DB.prepare(
    `
    DELETE FROM auth_sessions
    WHERE torn_user_id NOT IN (${placeholders})
    `,
  )
    .bind(...ids)
    .run();

  const changes = Number(result.meta?.changes ?? 0);
  if (changes > 0) {
    authSessionCache.clear();
  }

  return changes;
}

async function readAuthSession(request: Request, env: Env): Promise<AuthSession | null> {
  const token = bearerToken(request);
  if (!token) {
    return null;
  }

  const now = nowSeconds();
  const cached = authSessionCache.get(token);
  if (cached) {
    if (cached.cache_expires_at > now && cached.session.expires_at > now) {
      return cached.session;
    }
    authSessionCache.delete(token);
  }

  const session = (await env.DB.prepare(
    `
    SELECT torn_user_id, access_level, expires_at
    FROM auth_sessions
    WHERE token = ?
      AND expires_at > ?
    LIMIT 1
    `,
  )
    .bind(token, now)
    .first()) as {
    torn_user_id: number;
    access_level: AccessLevel;
    expires_at: number;
  } | null;

  if (!session) {
    return null;
  }

  const authSession = {
    id: session.torn_user_id,
    name: null,
    key_access_level: null,
    key_access_type: null,
    key_faction_access: false,
    access_level: session.access_level,
    expires_at: session.expires_at,
  };

  rememberAuthSession(token, authSession, now);
  return authSession;
}

function rememberAuthSession(token: string, session: AuthSession, now: number): void {
  if (authSessionCache.size >= MAX_AUTH_SESSION_CACHE_ENTRIES) {
    const oldestToken = authSessionCache.keys().next().value;
    if (oldestToken) {
      authSessionCache.delete(oldestToken);
    }
  }

  authSessionCache.set(token, {
    session,
    cache_expires_at: Math.min(session.expires_at, now + AUTH_SESSION_CACHE_TTL_SECONDS),
  });
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("Authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() || null;
}

async function fetchTornKeyInfo(env: Env, tornKey: string): Promise<{
  user: TornAuthUser;
  factionId: number | null;
}> {
  const data = await fetchTornJson(env, TORN_KEY_INFO_API_URL, tornKey);
  const info = data.info ?? data;
  const userInfo = info.user ?? {};
  const accessInfo = info.access ?? {};
  const id = Number(userInfo.id ?? userInfo.player_id ?? userInfo.user_id);
  const factionId = Number(userInfo.faction_id);

  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Torn key info response did not include a valid user ID");
  }

  return {
    user: {
      id,
      name: null,
      key_access_level: Number.isFinite(Number(accessInfo.level)) ? Number(accessInfo.level) : null,
      key_access_type: typeof accessInfo.type === "string" ? accessInfo.type : null,
      key_faction_access: accessInfo.faction === true,
    },
    factionId: Number.isInteger(factionId) && factionId > 0 ? factionId : null,
  };
}

async function fetchTornJson(
  env: Env,
  baseUrl: string,
  tornKey: string,
  params: Record<string, string> = {},
): Promise<any> {
  const url = new URL(baseUrl);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const response = await trackedTornFetch(env, url, {
    headers: {
      Accept: "application/json",
      Authorization: `ApiKey ${tornKey}`,
    },
  }, {
    feature: "auth",
    keySource: "member_supplied:auth",
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
