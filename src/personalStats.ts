import { Env } from "./types";
import { trackedTornFetch } from "./tornApiUsage";
import { finiteNumber } from "./utils";

const PERSONAL_STATS_API_BASE_URL = "https://api.torn.com/v2/user";
const PERSONAL_STATS_FETCH_TIMEOUT_MS = 12000;
const PERSONAL_STATS_RETRY_DELAYS_MS = [750, 1500];
const TRANSIENT_TORN_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

export async function fetchTornPersonalStats(
  env: Env,
  memberId: number,
  statKeys: readonly string[],
): Promise<Record<string, number | null>> {
  const url = new URL(`${PERSONAL_STATS_API_BASE_URL}/${memberId}/personalstats`);
  url.searchParams.set("stat", statKeys.join(","));

  const response = await fetchWithTransientRetry(env, url.toString(), {
    headers: {
      Accept: "application/json",
      Authorization: `ApiKey ${env.TORN_API_KEY}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Torn personalstats API error: ${response.status}`);
  }

  const data = (await response.json()) as any;
  if (data?.error) {
    throw new Error(data.error.error ?? data.error.message ?? "Torn personalstats API error");
  }

  return extractPersonalStats(data?.personalstats);
}

function extractPersonalStats(source: unknown): Record<string, number | null> {
  const stats: Record<string, number | null> = {};
  if (!source) {
    return stats;
  }

  if (Array.isArray(source)) {
    for (const item of source) {
      if (!item || typeof item !== "object") {
        continue;
      }

      const name = String((item as { name?: unknown }).name ?? "");
      if (name) {
        stats[name] = finiteNumber((item as { value?: unknown }).value);
      }
    }
    return stats;
  }

  if (typeof source === "object") {
    for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
      stats[key] = finiteNumber(value);
    }
  }

  return stats;
}

async function fetchWithTransientRetry(env: Env, input: string, init: RequestInit): Promise<Response> {
  let lastResponse: Response | null = null;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= PERSONAL_STATS_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const response = await trackedTornFetch(env, input, init, {
        feature: "personal-stats",
        keySource: "env:TORN_API_KEY",
        retryAttempt: attempt,
        timeoutMs: PERSONAL_STATS_FETCH_TIMEOUT_MS,
      });
      if (
        !TRANSIENT_TORN_STATUSES.has(response.status) ||
        attempt === PERSONAL_STATS_RETRY_DELAYS_MS.length
      ) {
        return response;
      }

      lastResponse = response;
    } catch (err) {
      lastError = err;
      if (attempt === PERSONAL_STATS_RETRY_DELAYS_MS.length) {
        throw err;
      }
    }

    await sleep(PERSONAL_STATS_RETRY_DELAYS_MS[attempt]);
  }

  if (lastResponse) {
    return lastResponse;
  }

  throw lastError instanceof Error ? lastError : new Error("Torn personalstats API request failed");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
