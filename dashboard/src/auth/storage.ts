import type { AuthSession } from "../api/types";

export const AUTH_TOKEN_STORAGE_KEY = "tornFactionAuthToken";
export const AUTH_SESSION_STORAGE_KEY = "tornFactionAuthSession";
export type StoredAuth = { token: string; session: AuthSession };

export function isAuthSession(value: unknown): value is AuthSession {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<AuthSession>;
  return session.ok === true && (session.access_level === "member" || session.access_level === "admin") &&
    typeof session.expires_at === "number" && Number.isFinite(session.expires_at) &&
    Number.isSafeInteger(session.user?.id) && Number(session.user?.id) > 0;
}

export function getAuthToken(): string | null {
  return window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
}

/** Reads legacy sessions too: /auth/me responses previously omitted the token. */
export function readStoredAuth(): StoredAuth | null {
  const token = getAuthToken();
  const raw = window.localStorage.getItem(AUTH_SESSION_STORAGE_KEY);
  if (!token || !raw) return null;
  try {
    const session: unknown = JSON.parse(raw);
    if (!isAuthSession(session) || session.expires_at * 1000 <= Date.now()) return null;
    if (session.token !== undefined && session.token !== token) return null;
    return { token, session };
  } catch {
    return null;
  }
}

export function writeStoredAuth({ token, session }: StoredAuth): void {
  window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
  window.localStorage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify({ ...session, token }));
}

export function clearStoredAuth(): void {
  window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  window.localStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
}
