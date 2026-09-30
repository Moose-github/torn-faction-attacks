import { authenticateTornKey, refreshAuthSession } from "../api/auth";
import { ApiError } from "../api/client";
import type { AuthSession } from "../api/types";
import { startPolling, type PollController } from "../utils/polling";
import { subscribeAuthFailures } from "./events";
import {
  AUTH_SESSION_STORAGE_KEY, AUTH_TOKEN_STORAGE_KEY, clearStoredAuth, getAuthToken,
  isAuthSession, readStoredAuth, writeStoredAuth, type StoredAuth,
} from "./storage";

const REFRESH_MS = 30 * 60_000;
const RETRY_MS = [5_000, 15_000, 30_000, 60_000];

export type AuthSnapshot = {
  session: AuthSession | null;
  /** Changes on account, credential or permission changes; scopes authenticated page state. */
  scope: number;
  refreshing: boolean;
  refreshError: string | null;
};

/** One controller per provider. React only subscribes; all session writes happen here. */
export function createAuthController() {
  let auth = readStoredAuth();
  let snapshot: AuthSnapshot = { session: auth?.session ?? null, scope: 0, refreshing: false, refreshError: null };
  const listeners = new Set<() => void>();
  let active = false;
  let generation = 0;
  let poller: PollController | null = null;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  let loginRequest: AbortController | null = null;
  let failures = 0;
  let nextAttemptAt = 0;
  let lastPermissionCheckAt = -Infinity;

  function publish(update: Partial<AuthSnapshot>) {
    snapshot = { ...snapshot, ...update };
    listeners.forEach(listener => listener());
  }

  function stopWork() {
    generation++;
    poller?.stop();
    poller = null;
    clearTimeout(expiryTimer);
    loginRequest?.abort();
    loginRequest = null;
  }

  function scheduleExpiry() {
    clearTimeout(expiryTimer);
    if (!active || !auth) return;
    expiryTimer = setTimeout(() => {
      if (getAuthToken() !== auth?.token) synchronize();
      else signOut();
    }, Math.max(0, auth.session.expires_at * 1000 - Date.now()));
  }

  function updateSession(next: StoredAuth | null) {
    const scopeChanged = auth?.token !== next?.token || auth?.session.user.id !== next?.session.user.id ||
      auth?.session.access_level !== next?.session.access_level;
    const session = JSON.stringify(snapshot.session) === JSON.stringify(next?.session ?? null)
      ? snapshot.session : next?.session ?? null;
    auth = next;
    publish({ session, scope: snapshot.scope + Number(scopeChanged), refreshing: false, refreshError: null });
  }

  function install(next: StoredAuth | null, immediate: boolean) {
    stopWork();
    failures = 0;
    nextAttemptAt = immediate ? 0 : Date.now() + REFRESH_MS;
    updateSession(next);
    scheduleExpiry();
    if (active && auth) {
      poller = startPolling(async ({ signal, isCurrent }) => {
        const current = auth;
        const startedGeneration = generation;
        const accepts = () => active && isCurrent() && generation === startedGeneration &&
          getAuthToken() === current?.token;
        if (!current) return false;
        if (getAuthToken() !== current.token) { synchronize(); return false; }
        if (current.session.expires_at * 1000 <= Date.now()) { signOut(); return false; }
        if (Date.now() < nextAttemptAt) return nextAttemptAt - Date.now();
        publish({ refreshing: true });
        try {
          const session = await refreshAuthSession(signal);
          if (!accepts()) return false;
          if (!isAuthSession(session) || session.user.id !== current.session.user.id) {
            throw new ApiError("Server returned an invalid session", 200, "INVALID_RESPONSE");
          }
          if (session.expires_at * 1000 <= Date.now()) { signOut(); return false; }
          const next = { token: current.token, session: { ...session, token: current.token } };
          writeStoredAuth(next);
          updateSession(next);
          scheduleExpiry();
          failures = 0;
          nextAttemptAt = Date.now() + REFRESH_MS;
        } catch (error) {
          if (!accepts()) return false;
          if (error instanceof ApiError && error.status === 401) { signOut(); return false; }
          const retryMs = RETRY_MS[Math.min(failures++, RETRY_MS.length - 1)];
          nextAttemptAt = Date.now() + retryMs;
          publish({ refreshing: false, refreshError: "Unable to check your session. Retrying automatically." });
        } finally {
          // Storage events may not have arrived yet when an older request finishes.
          if (active && generation === startedGeneration && getAuthToken() !== current.token) synchronize();
        }
        return nextAttemptAt - Date.now();
      }, { intervalMs: REFRESH_MS, immediate, pauseWhenHidden: true });
    }
  }

  function synchronize() {
    const stored = readStoredAuth();
    if (JSON.stringify(stored) === JSON.stringify(auth)) return;
    install(stored, true);
  }

  function signOut() {
    clearStoredAuth();
    install(null, false);
  }

  function refresh() {
    synchronize();
    if (failures === 0) nextAttemptAt = 0;
    poller?.refresh();
  }

  function onWake() {
    if (document.hidden) return;
    synchronize();
    if (auth && auth.session.expires_at * 1000 <= Date.now()) signOut();
    else poller?.refresh();
  }

  function onStorage(event: StorageEvent) {
    if (event.storageArea && event.storageArea !== window.localStorage) return;
    if (event.key === AUTH_SESSION_STORAGE_KEY || event.key === null ||
      (event.key === AUTH_TOKEN_STORAGE_KEY && event.newValue === null)) synchronize();
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    refresh,
    signOut,
    async signIn(key: string): Promise<void> {
      stopWork();
      scheduleExpiry();
      const startedGeneration = generation;
      const previousToken = getAuthToken();
      const request = new AbortController();
      loginRequest = request;
      try {
        const session = await authenticateTornKey(key, request.signal);
        if (!active || generation !== startedGeneration || getAuthToken() !== previousToken) {
          throw new DOMException("Sign-in was superseded by a session change", "AbortError");
        }
        if (!isAuthSession(session) || !session.token || session.expires_at * 1000 <= Date.now()) {
          throw new ApiError("Server returned an invalid session", 200, "INVALID_RESPONSE");
        }
        const next = { token: session.token, session };
        writeStoredAuth(next);
        install(next, false);
      } finally {
        // A failed login must not stop expiry/validation of an existing session.
        if (active && generation === startedGeneration) install(readStoredAuth(), false);
      }
    },
    start() {
      active = true;
      const stored = readStoredAuth();
      if (!stored) clearStoredAuth();
      install(stored, true);
      window.addEventListener("storage", onStorage);
      window.addEventListener("focus", onWake);
      document.addEventListener("visibilitychange", onWake);
      const unsubscribe = subscribeAuthFailures(failure => {
        if (failure.token !== auth?.token || failure.token !== getAuthToken()) return;
        if (failure.kind === "unauthorized") signOut();
        else if (Date.now() - lastPermissionCheckAt >= 5_000) {
          lastPermissionCheckAt = Date.now();
          refresh();
        }
      });
      return () => {
        active = false;
        stopWork();
        unsubscribe();
        window.removeEventListener("storage", onStorage);
        window.removeEventListener("focus", onWake);
        document.removeEventListener("visibilitychange", onWake);
      };
    },
  };
}
