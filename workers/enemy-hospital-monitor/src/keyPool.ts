import type { MonitorEnv } from "./types";

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

type StoredKeyRow = {
  id: string;
  encrypted_key: string;
  allowed_features_json: string;
  access_level: number | null;
  access_type: string | null;
  faction_access: number | null;
  max_requests_per_minute: number | null;
  last_used_at: number | null;
  paused_until: number | null;
  current_request_count?: number;
};

const CACHE_FEATURE = "hospital_monitor";

export async function readMonitorKeyCandidates(env: MonitorEnv, now: number): Promise<MonitorKeyCandidate[]> {
  const submitted = await readSubmittedMonitorKeys(env, now);
  const fallback = await readFallbackMonitorKeys(env);
  return [...submitted, ...fallback].sort((left, right) => {
    if (left.sourceType !== right.sourceType) {
      return left.sourceType === "submitted" ? -1 : 1;
    }
    return (left.lastUsedAt ?? 0) - (right.lastUsedAt ?? 0);
  });
}

export async function recordMonitorKeyUsage(
  env: MonitorEnv,
  candidate: MonitorKeyCandidate,
  now: number,
  count: number,
): Promise<void> {
  if (candidate.sourceType !== "submitted" || count <= 0) return;

  const windowStart = minuteWindowStart(now);
  await env.DB.batch([
    env.DB.prepare(
      `
      INSERT INTO torn_api_key_usage_windows (key_id, window_start, request_count)
      VALUES (?, ?, ?)
      ON CONFLICT(key_id, window_start) DO UPDATE SET
        request_count = request_count + excluded.request_count
      `,
    ).bind(candidate.id, windowStart, count),
    env.DB.prepare(
      `
      UPDATE torn_api_keys
      SET
        last_used_at = ?,
        last_used_feature = 'hospital_monitor',
        monitor_last_used_at = ?,
        updated_at = ?
      WHERE id = ?
      `,
    ).bind(now, now, now, candidate.id),
  ]);
}

async function readSubmittedMonitorKeys(env: MonitorEnv, now: number): Promise<MonitorKeyCandidate[]> {
  const storageSecret = await readSecretValue(env.TORN_KEY_STORAGE_SECRET);
  if (!storageSecret) return [];

  let rows: D1Result<StoredKeyRow>;
  try {
    rows = await env.DB.prepare(
      `
      SELECT k.*, COALESCE(w.request_count, 0) AS current_request_count
      FROM torn_api_keys k
      LEFT JOIN torn_api_key_usage_windows w
        ON w.key_id = k.id
       AND w.window_start = ?
      WHERE k.status = 'active'
        AND (k.paused_until IS NULL OR k.paused_until <= ?)
      ORDER BY COALESCE(k.monitor_last_used_at, k.last_used_at, 0) ASC, k.created_at ASC
      LIMIT 100
      `,
    )
      .bind(minuteWindowStart(now), now)
      .all<StoredKeyRow>();
  } catch {
    return [];
  }

  const candidates: MonitorKeyCandidate[] = [];
  for (const row of rows.results ?? []) {
    if (!featureAllowed(row.allowed_features_json, CACHE_FEATURE)) continue;
    if (!hasPublicCapability(row)) continue;
    const currentMinuteUsage = Number(row.current_request_count ?? 0);
    if (row.max_requests_per_minute !== null && currentMinuteUsage >= row.max_requests_per_minute) continue;

    try {
      candidates.push({
        id: row.id,
        key: await decryptTornApiKey(row.encrypted_key, storageSecret),
        alias: `pool:${row.id.slice(0, 8)}`,
        sourceType: "submitted",
        keySource: `key_pool:${row.id}`,
        maxRequestsPerMinute: row.max_requests_per_minute,
        currentMinuteUsage,
        lastUsedAt: row.last_used_at,
      });
    } catch {
      continue;
    }
  }

  return candidates;
}

async function readFallbackMonitorKeys(env: MonitorEnv): Promise<MonitorKeyCandidate[]> {
  const definitions = [
    {
      id: "secrets:TORN_API_KEY_POOL_1",
      alias: "monitor-1",
      binding: env.TORN_API_KEY_POOL_1,
      fallback: env.MONITOR_TORN_API_KEY_1,
    },
    {
      id: "secrets:TORN_API_KEY_POOL_2",
      alias: "monitor-2",
      binding: env.TORN_API_KEY_POOL_2,
      fallback: env.MONITOR_TORN_API_KEY_2,
    },
  ];
  const candidates: MonitorKeyCandidate[] = [];

  for (const definition of definitions) {
    const key = (await readSecretValue(definition.binding)) ?? definition.fallback?.trim() ?? null;
    if (!key) continue;
    candidates.push({
      id: definition.id,
      key,
      alias: definition.alias,
      sourceType: "secret",
      keySource: definition.id,
      maxRequestsPerMinute: null,
      currentMinuteUsage: 0,
      lastUsedAt: null,
    });
  }

  return candidates;
}

async function readSecretValue(binding?: string | SecretsStoreSecret): Promise<string | null> {
  const value = typeof binding === "string" ? binding : await binding?.get();
  return value?.trim() || null;
}

function featureAllowed(json: string, feature: string): boolean {
  try {
    const features = JSON.parse(json);
    return Array.isArray(features) && features.includes(feature);
  } catch {
    return false;
  }
}

function hasPublicCapability(row: Pick<StoredKeyRow, "access_level" | "access_type">): boolean {
  const accessType = row.access_type?.trim().toLowerCase() ?? "";
  return accessType === "full" || accessType === "full access" || Number(row.access_level ?? 0) >= 1;
}

async function decryptTornApiKey(encrypted: string, secret: string): Promise<string> {
  const [version, ivBase64, ciphertextBase64] = encrypted.split(":");
  if (version !== "v1" || !ivBase64 || !ciphertextBase64) {
    throw new Error("Unsupported encrypted key format");
  }
  const key = await deriveAesKey(secret);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytesFromBase64(ivBase64) },
    key,
    bytesFromBase64(ciphertextBase64),
  );
  return new TextDecoder().decode(decrypted);
}

async function deriveAesKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["decrypt"]);
}

function bytesFromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function minuteWindowStart(now: number): number {
  return Math.floor(now / 60) * 60;
}
