import type { Env } from "./types";

// Only explicitly opted-in background work shares these reads. Never cache
// authentication, claims, rate limits or mutable sync state here.
const scopes = new WeakMap<Env, Map<string, Promise<unknown>>>();

export function createBackgroundReadScope(env: Env): Env {
  if (scopes.has(env)) return env;
  const scoped = { ...env };
  scopes.set(scoped, new Map());
  return scoped;
}

export function readBackgroundSetting<T>(env: Env, key: string, read: () => Promise<T>): Promise<T> {
  const cache = scopes.get(env);
  if (!cache) return read();
  const existing = cache.get(key);
  if (existing) return existing as Promise<T>;
  const pending = read().catch((error) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, pending);
  return pending;
}
