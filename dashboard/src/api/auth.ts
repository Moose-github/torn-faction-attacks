import { clearStoredAuthSession, getJson, getStoredAuthSession, postJson, storeAuthSession } from "./client";
import type { AuthSession } from "./types";

export { clearStoredAuthSession, getStoredAuthSession } from "./client";

export async function authenticateTornKey(key: string): Promise<AuthSession> {
  const session = await postJson<AuthSession>("/api/auth/torn", { key }, false);
  storeAuthSession(session);
  return session;
}

export async function refreshAuthSession(): Promise<AuthSession | null> {
  if (!getStoredAuthSession()) return null;
  try {
    const session = await getJson<AuthSession>("/api/auth/me", true);
    storeAuthSession(session);
    return session;
  } catch {
    clearStoredAuthSession();
    return null;
  }
}
