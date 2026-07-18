import type { AuthSession } from "./types";

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ??
  (import.meta.env.DEV ? "" : "https://torn-faction-attacks.moose-3065754.workers.dev");
export const MONITOR_WORKER_URL =
  import.meta.env.VITE_MONITOR_WORKER_URL ?? "https://torn-enemy-hospital-monitor.moose-3065754.workers.dev";

const AUTH_TOKEN_STORAGE_KEY = "tornFactionAuthToken";
const AUTH_SESSION_STORAGE_KEY = "tornFactionAuthSession";

export function getStoredAuthSession(): AuthSession | null {
  const raw = window.localStorage.getItem(AUTH_SESSION_STORAGE_KEY);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as AuthSession;
    if (session.expires_at <= Math.floor(Date.now() / 1000)) {
      clearStoredAuthSession();
      return null;
    }
    return session;
  } catch {
    clearStoredAuthSession();
    return null;
  }
}

export function storeAuthSession(session: AuthSession): void {
  if (session.token) window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, session.token);
  window.localStorage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function clearStoredAuthSession() {
  window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  window.localStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
}

export async function getJson<T>(path: string, includeAuth = true): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, { headers: authHeaders(includeAuth) });
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(data.error ?? `Request failed: ${response.status}`);
  return data as T;
}

export async function postJson<T = unknown>(path: string, body?: unknown, includeAuth = true): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: body === undefined ? authHeaders(includeAuth) : { "Content-Type": "application/json", ...authHeaders(includeAuth) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(data.error ?? `Request failed: ${response.status}`);
  return data as T;
}

export async function putJson<T = unknown>(path: string, body: unknown, includeAuth = true): Promise<T> {
  return writeJson<T>("PUT", path, body, includeAuth);
}

export async function deleteJson<T = unknown>(path: string, includeAuth = true): Promise<T> {
  return writeJson<T>("DELETE", path, undefined, includeAuth);
}

async function writeJson<T = unknown>(method: "PUT" | "DELETE", path: string, body: unknown, includeAuth: boolean): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: body === undefined ? authHeaders(includeAuth) : { "Content-Type": "application/json", ...authHeaders(includeAuth) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(data.error ?? `Request failed: ${response.status}`);
  return data as T;
}

export function authHeaders(includeAuth: boolean): Record<string, string> | undefined {
  if (!includeAuth) return undefined;
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : undefined;
}

function getAuthToken(): string | null { return window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY); }

export function filenameFromContentDisposition(value: string): string | null {
  const match = value.match(/filename="([^"]+)"/);
  return match?.[1] ?? null;
}
