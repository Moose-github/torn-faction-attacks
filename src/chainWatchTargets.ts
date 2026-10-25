import {
  CHAIN_TARGET_SEARCH_CURSORS, CHAIN_TARGET_SEARCH_FILTERS, type ChainTargetSearchPosition,
} from "./chainWatchTargetCursors";
import { fetchTrackedTornResponse } from "./external/torn";
import { markTornKeyFailure, readAvailableTornApiKeys, recordTornKeyUse, type TornKeyPoolCandidate } from "./tornKeyPool";
import type { Env } from "./types";
import { nowSeconds } from "./utils";

const MAX_BATCHES = 3;
// Live user/search calls can take longer than two seconds. Keep the optional
// warning enrichment bounded while allowing slow, healthy pages to complete.
const SEARCH_BUDGET_MS = 12_000;
const PAGE_TIMEOUT_MS = 5_000;
// Verified against live user/search responses: hospital, jail, federal jail,
// and travel (including abroad / "Hiding out in ...").
const UNAVAILABLE_ICON_IDS = new Set([15, 16, 70, 71]);
const UNAVAILABLE_TITLE = /\b(hospital(?:ized|ised)?|jail|federal|travel(?:l?ing)?|abroad|hiding[\s-]+out|fallen|resting in peace)\b/i;

export type ChainWatchTargetsResult = {
  target_ids: number[];
  status: "ok" | "no_targets" | "unavailable" | "timeout";
  pages_fetched: number;
  failed_pages: number;
  checked_at: number;
};

type SearchPage = { players: unknown[]; failed: boolean; timedOut: boolean; keyFailure: boolean };
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Availability only: deliberately does not filter faction, activity, or battle stats. */
export function isViableChainWatchTarget(player: unknown): player is { id: number } {
  if (!isRecord(player) || !Number.isSafeInteger(player.id) || Number(player.id) <= 0 || !Array.isArray(player.icons)) return false;
  return player.icons.every(icon => {
    if (!isRecord(icon) || !Number.isSafeInteger(icon.id) || typeof icon.title !== "string" || !icon.title.trim()) return false;
    // Do not scan descriptions: marriage/faction descriptions can contain arbitrary player names.
    return !UNAVAILABLE_ICON_IDS.has(Number(icon.id)) && !UNAVAILABLE_TITLE.test(icon.title);
  });
}

/** Random page sampling without replacement; no persistent target list or Discord side effects. */
export async function fetchChainWatchTargets(env: Env): Promise<ChainWatchTargetsResult> {
  const deadline = Date.now() + SEARCH_BUDGET_MS;
  const result: ChainWatchTargetsResult = { target_ids: [], status: "no_targets", pages_fetched: 0, failed_pages: 0, checked_at: nowSeconds() };
  const cursors = [...CHAIN_TARGET_SEARCH_CURSORS];
  let candidates: TornKeyPoolCandidate[];
  try {
    // Only keys explicitly enabled for Enemy scouting; no unrelated environment-key fallback.
    candidates = await readAvailableTornApiKeys(env, "enemy_scouting", nowSeconds(), { includeFallback: false });
  } catch {
    return { ...result, status: "unavailable" };
  }
  const disabledKeys = new Set<string>();
  let sawTimeout = false;
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    if (Date.now() >= deadline) return { ...result, status: "timeout" };
    const jobs: { position: ChainTargetSearchPosition; candidate: TornKeyPoolCandidate }[] = [];
    for (let slot = 0; slot < 2 && cursors.length; slot++) {
      const candidate = candidates.find(key => !disabledKeys.has(key.id) &&
        (key.maxRequestsPerMinute === null || key.currentMinuteUsage < key.maxRequestsPerMinute));
      if (!candidate) break;
      candidate.currentMinuteUsage++;
      const [position] = cursors.splice(Math.floor(Math.random() * cursors.length), 1);
      jobs.push({ position, candidate });
    }
    if (!jobs.length) return { ...result, status: "unavailable" };
    try {
      // Account for attempted calls, including errors; reserve before launching either page.
      for (const candidate of new Set(jobs.map(job => job.candidate))) {
        await recordTornKeyUse(env, candidate, "enemy_scouting", nowSeconds(), jobs.filter(job => job.candidate === candidate).length);
      }
    } catch {
      return { ...result, status: "unavailable" };
    }
    if (Date.now() >= deadline) return { ...result, status: "timeout" };
    const pages = await Promise.all(jobs.map(job => fetchSearchPage(env, job.position, job.candidate, batch, deadline)));
    const ids = new Set<number>();
    for (const [index, page] of pages.entries()) {
      result.pages_fetched++;
      if (page.failed) result.failed_pages++;
      sawTimeout ||= page.timedOut;
      if (page.keyFailure) {
        const candidate = jobs[index].candidate;
        if (!disabledKeys.has(candidate.id)) {
          disabledKeys.add(candidate.id);
          await markTornKeyFailure(env, candidate.id, "Chain target search key rejected or rate limited", nowSeconds(), 60).catch(() => undefined);
        }
      }
      for (const player of page.players) if (isViableChainWatchTarget(player)) ids.add(player.id);
    }
    if (ids.size) return { ...result, target_ids: [...ids], status: "ok", checked_at: nowSeconds() };
  }
  return { ...result, status: sawTimeout ? "timeout" : result.failed_pages ? "unavailable" : "no_targets", checked_at: nowSeconds() };
}

async function fetchSearchPage(
  env: Env, position: ChainTargetSearchPosition, candidate: TornKeyPoolCandidate, batch: number, deadline: number,
): Promise<SearchPage> {
  const url = new URL("https://api.torn.com/v2/user/search");
  url.searchParams.set("filters", CHAIN_TARGET_SEARCH_FILTERS);
  url.searchParams.set("sort", position.sort);
  url.searchParams.set("timestamp", String(Date.now()));
  if (position.cursor !== null) url.searchParams.set("cursor", position.cursor);
  const controller = new AbortController();
  const failure: SearchPage = { players: [], failed: true, timedOut: false, keyFailure: false };
  let timer: ReturnType<typeof setTimeout>;
  // Cover headers, body decoding and usage logging; the common fetch timeout only covers headers.
  const timeout = new Promise<SearchPage>(resolve => {
    timer = setTimeout(() => {
      resolve({ ...failure, timedOut: true });
      controller.abort();
    }, Math.max(0, Math.min(PAGE_TIMEOUT_MS, deadline - Date.now())));
  });
  const load = async (): Promise<SearchPage> => {
    try {
      const response = await fetchTrackedTornResponse(env, url, {
        headers: { Accept: "application/json", Authorization: `ApiKey ${candidate.key}` },
        signal: controller.signal,
      }, { feature: "chain-watch:targets", keySource: candidate.keySource, retryAttempt: batch });
      if (!response.ok) return { ...failure, keyFailure: [401, 403, 429].includes(response.status) };
      const data: unknown = await response.json();
      const error = isRecord(data) && isRecord(data.error) ? data.error : null;
      const keyFailure = [1, 2, 5, 7, 10, 12, 13, 16, 18].includes(Number(error?.code));
      if (!isRecord(data) || data.error || !Array.isArray(data.search)) return { ...failure, keyFailure };
      return { players: data.search, failed: false, timedOut: false, keyFailure: false };
    } catch {
      return failure;
    }
  };
  try { return await Promise.race([load(), timeout]); }
  finally { clearTimeout(timer!); }
}
