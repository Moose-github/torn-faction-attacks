import type { ActiveWarConfig } from "./types";

export type ActiveWarParseResult =
  | { ok: true; activeWar: ActiveWarConfig }
  | { ok: false; error: string };

export function parseActiveWarFromUrl(url: URL): ActiveWarParseResult {
  const warId = Number(url.searchParams.get("warId"));
  const warName = url.searchParams.get("warName")?.trim() ?? "";
  const enemyFactionId = Number(url.searchParams.get("enemyFactionId"));
  const tornWarIdRaw = url.searchParams.get("tornWarId");
  const tornWarId = tornWarIdRaw ? Number(tornWarIdRaw) : null;

  if (!Number.isInteger(warId) || warId <= 0) {
    return { ok: false, error: "Invalid warId" };
  }
  if (!warName) {
    return { ok: false, error: "Invalid warName" };
  }
  if (!Number.isInteger(enemyFactionId) || enemyFactionId <= 0) {
    return { ok: false, error: "Invalid enemyFactionId" };
  }
  if (tornWarIdRaw) {
    if (!Number.isInteger(tornWarId) || tornWarId === null || tornWarId <= 0) {
      return { ok: false, error: "Invalid tornWarId" };
    }
  }

  return {
    ok: true,
    activeWar: { warId, warName, enemyFactionId, tornWarId: tornWarId ?? null },
  };
}
