import {
  markTornKeyFailure,
  readAvailableTornApiKeys,
  readFallbackKeyCandidates,
  recordTornKeyUse,
  sortCandidatesForFeature,
  type TornKeyPoolCandidate,
} from "../../../src/tornKeyPool";
import type { Env } from "../../../src/types";
import type { MonitorEnv } from "./types";

// Thin adapter over the shared key pool, so key selection, decryption and usage
// tracking match the main worker. The monitor keeps its own candidate shape for
// its per-key backoff state.

export type MonitorKeyCandidate = {
  id: string;
  key: string;
  alias: string;
  sourceType: "submitted" | "secret";
  keySource: string;
  maxRequestsPerMinute: number | null;
  currentMinuteUsage: number;
  lastUsedAt: number | null;
};

const FEATURE = "hospital_monitor";

// The shared key pool only reads DB, TORN_API_KEY and TORN_KEY_STORAGE_SECRET,
// which the monitor binds as well.
function poolEnv(env: MonitorEnv): Env {
  return env as unknown as Env;
}

export async function readMonitorKeyCandidates(env: MonitorEnv, now: number): Promise<MonitorKeyCandidate[]> {
  // Keep polling on the fallback key if the pool cannot be read.
  const submitted = await readAvailableTornApiKeys(poolEnv(env), FEATURE, now, { includeFallback: false })
    .catch(() => []);
  const fallback = await readFallbackKeyCandidates(poolEnv(env), FEATURE);
  return sortCandidatesForFeature([...submitted, ...fallback], FEATURE, now).map(toMonitorCandidate);
}

export async function recordMonitorKeyUsage(
  env: MonitorEnv,
  candidate: MonitorKeyCandidate,
  now: number,
  count: number,
): Promise<void> {
  await recordTornKeyUse(poolEnv(env), candidate, FEATURE, now, count);
}

export async function markMonitorKeyFailure(
  env: MonitorEnv,
  candidate: MonitorKeyCandidate,
  error: string,
  now: number,
  pauseSeconds: number,
): Promise<void> {
  if (candidate.sourceType !== "submitted") return;
  await markTornKeyFailure(poolEnv(env), candidate.id, error, now, Math.max(1, pauseSeconds));
}

function toMonitorCandidate(candidate: TornKeyPoolCandidate): MonitorKeyCandidate {
  const submitted = candidate.sourceType === "submitted";
  return {
    id: candidate.id,
    key: candidate.key,
    alias: submitted ? `pool:${candidate.id.slice(0, 8)}` : "admin-fallback",
    sourceType: submitted ? "submitted" : "secret",
    keySource: candidate.keySource,
    maxRequestsPerMinute: candidate.maxRequestsPerMinute,
    currentMinuteUsage: candidate.currentMinuteUsage,
    lastUsedAt: candidate.lastUsedAt,
  };
}
