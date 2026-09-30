import { getJson, postJson } from "./client";
import type { AuthSession } from "./types";

export function authenticateTornKey(key: string, signal?: AbortSignal): Promise<AuthSession> {
  return postJson<AuthSession>("/api/auth/torn", { key }, false, signal);
}

export function refreshAuthSession(signal?: AbortSignal): Promise<AuthSession> {
  return getJson<AuthSession>("/api/auth/me", true, signal);
}
