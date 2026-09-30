export type AuthFailure = { token: string; kind: "unauthorized" | "permissions" };
const listeners = new Set<(failure: AuthFailure) => void>();

export function reportAuthFailure(failure: AuthFailure): void {
  listeners.forEach(listener => listener(failure));
}

export function subscribeAuthFailures(listener: (failure: AuthFailure) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
