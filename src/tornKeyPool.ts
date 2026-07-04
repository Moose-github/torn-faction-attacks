import { cleanString, readJsonObject } from "./backend/request";
import { TORN_KEY_INFO_API_URL, TORN_USER_BASIC_API_URL } from "./constants";
import { ExternalApiError } from "./external/http";
import { fetchTrackedTornJson } from "./external/torn";
import type { Env } from "./types";
import { json, nowSeconds } from "./utils";

export type TornKeyPoolFeature =
  | "arrest_scout"
  | "hospital_monitor"
  | "enemy_scouting"
  | "faction_lifestyle_stats"
  | "faction_contributor_stats"
  | "war_live_data"
  | "stock_tools"
  | "misc_utilities"
  | "experimental_features";

export type TornKeyPoolStatus = "active" | "disabled";
export type TornKeyPoolAccessRequirement = "public" | "faction";

export type TornKeyPoolRow = {
  id: string;
  label: string | null;
  encrypted_key: string;
  key_fingerprint: string;
  submitted_by_torn_user_id: number | null;
  owner_torn_user_id: number | null;
  owner_name: string | null;
  access_level: number | null;
  access_type: string | null;
  faction_access: number | null;
  status: TornKeyPoolStatus | string;
  allowed_features_json: string;
  max_requests_per_minute: number | null;
  last_validated_at: number | null;
  last_used_at: number | null;
  last_used_feature: string | null;
  monitor_last_used_at: number | null;
  paused_until: number | null;
  failure_count: number;
  last_error: string | null;
  created_at: number;
  updated_at: number;
};

export type TornKeyPoolCandidate = {
  id: string;
  key: string;
  keySource: string;
  sourceType: "submitted" | "secret" | "env";
  maxRequestsPerMinute: number | null;
  currentMinuteUsage: number;
  lastUsedAt: number | null;
  monitorLastUsedAt: number | null;
};

export type TornKeyPoolRunContext = {
  candidate: TornKeyPoolCandidate;
  key: string;
  keySource: string;
};

export type TornKeyPoolRunOptions<T> = {
  feature: TornKeyPoolFeature;
  run: (context: TornKeyPoolRunContext) => Promise<T>;
  now?: number;
  includeFallback?: boolean;
  usageCount?: number;
  failurePauseSeconds?: number;
  shouldRetryKey?: (error: unknown, context: TornKeyPoolRunContext) => boolean;
};

export type TornKeyPoolRunResult<T> = {
  result: T;
  candidate: TornKeyPoolCandidate;
};

export type TornKeyMetadata = {
  id: string;
  label: string | null;
  submitted_by_torn_user_id: number | null;
  owner_torn_user_id: number | null;
  owner_name: string | null;
  access_level: number | null;
  access_type: string | null;
  faction_access: boolean;
  status: string;
  allowed_features: TornKeyPoolFeature[];
  max_requests_per_minute: number | null;
  last_validated_at: number | null;
  last_used_at: number | null;
  last_used_feature: string | null;
  monitor_last_used_at: number | null;
  paused_until: number | null;
  failure_count: number;
  last_error: string | null;
  created_at: number;
  updated_at: number;
};

export type TornKeyPreviewMetadata = ValidatedTornKeyInfo & {
  duplicate: boolean;
};

const FEATURE_LABELS: Record<TornKeyPoolFeature, string> = {
  arrest_scout: "Arrest Scout",
  hospital_monitor: "Hospital Monitor",
  enemy_scouting: "Enemy scouting",
  faction_lifestyle_stats: "Faction Lifestyle Stats",
  faction_contributor_stats: "Faction Contributor Stats",
  war_live_data: "War Data Refresh",
  stock_tools: "Stocks Tools",
  misc_utilities: "Misc Utilities",
  experimental_features: "New feature testing",
};

const ALLOWED_FEATURES = new Set<TornKeyPoolFeature>([
  "arrest_scout",
  "hospital_monitor",
  "enemy_scouting",
  "faction_lifestyle_stats",
  "faction_contributor_stats",
  "war_live_data",
  "stock_tools",
  "misc_utilities",
  "experimental_features",
]);

const DEFAULT_ALLOWED_FEATURES: TornKeyPoolFeature[] = [
  "arrest_scout",
  "enemy_scouting",
  "faction_lifestyle_stats",
  "faction_contributor_stats",
  "war_live_data",
  "stock_tools",
  "misc_utilities",
];

const FALLBACK_KEY_FEATURES: TornKeyPoolFeature[] = [
  "arrest_scout",
  "hospital_monitor",
  "enemy_scouting",
  "faction_lifestyle_stats",
  "faction_contributor_stats",
  "war_live_data",
  "stock_tools",
  "misc_utilities",
  "experimental_features",
];

const ENCRYPTION_VERSION = "v1";
const MAX_LABEL_LENGTH = 80;
const MIN_REQUESTS_PER_MINUTE = 10;
const MAX_REQUESTS_PER_MINUTE = 75;
const DEFAULT_REQUESTS_PER_MINUTE = 35;
const MONITOR_RECENT_USE_SECONDS = 15;

type ValidatedTornKeyInfo = {
  key_name: string | null;
  owner_torn_user_id: number;
  owner_name: string | null;
  access_level: number | null;
  access_type: string | null;
  faction_access: boolean;
};

export function keyPoolFeatureOptions(): Array<{
  key: TornKeyPoolFeature;
  label: string;
  required_access: TornKeyPoolAccessRequirement;
}> {
  return Object.entries(FEATURE_LABELS).map(([key, label]) => {
    const feature = key as TornKeyPoolFeature;
    return {
      key: feature,
      label,
      required_access: featureAccessRequirement(feature),
    };
  });
}

export function defaultTornKeyPoolFeatures(): TornKeyPoolFeature[] {
  return [...DEFAULT_ALLOWED_FEATURES];
}

export async function previewMyTornApiKey(
  request: Request,
  env: Env,
  submittedByTornUserId: number | null,
): Promise<Response> {
  if (!submittedByTornUserId) {
    return json({ ok: false, error: "Unauthorized", code: "UNAUTHORIZED" }, 401);
  }

  const body = await readJsonObject(request);
  const rawKey = cleanString(body.key);
  if (!rawKey) {
    return json({ ok: false, error: "Torn API key is required", code: "MISSING_TORN_KEY" }, 400);
  }

  let keyInfo: ValidatedTornKeyInfo;
  try {
    keyInfo = await validateTornApiKey(env, rawKey);
  } catch (err) {
    return json({ ok: false, error: safeErrorMessage(err), code: "INVALID_TORN_KEY" }, 400);
  }

  const storageSecret = await readStorageSecret(env);
  const duplicate = storageSecret
    ? await isDuplicateTornKey(env, rawKey, storageSecret)
    : false;

  return json({
    ok: true,
    key: {
      ...keyInfo,
      duplicate,
    } satisfies TornKeyPreviewMetadata,
  });
}

export async function createMyTornApiKey(
  request: Request,
  env: Env,
  submittedByTornUserId: number | null,
): Promise<Response> {
  if (!submittedByTornUserId) {
    return json({ ok: false, error: "Unauthorized", code: "UNAUTHORIZED" }, 401);
  }

  const body = await readJsonObject(request);
  const rawKey = cleanString(body.key);
  if (!rawKey) {
    return json({ ok: false, error: "Torn API key is required", code: "MISSING_TORN_KEY" }, 400);
  }

  const storageSecret = await readStorageSecret(env);
  if (!storageSecret) {
    return json({ ok: false, error: "Key storage secret is not configured", code: "KEY_STORAGE_NOT_CONFIGURED" }, 503);
  }

  const now = nowSeconds();
  const fingerprint = await fingerprintTornApiKey(rawKey, storageSecret);
  const duplicate = await readDuplicateTornKey(env, fingerprint);

  if (duplicate) {
    const status = duplicate.submitted_by_torn_user_id === submittedByTornUserId ? 409 : 403;
    return json({ ok: false, error: "This Torn API key has already been submitted", code: "DUPLICATE_TORN_KEY" }, status);
  }

  let keyInfo: ValidatedTornKeyInfo;
  try {
    keyInfo = await validateTornApiKey(env, rawKey);
  } catch (err) {
    return json({ ok: false, error: safeErrorMessage(err), code: "INVALID_TORN_KEY" }, 400);
  }

  const allowedFeatures = normalizeAllowedFeatures(body.allowed_features ?? body.allowedFeatures, DEFAULT_ALLOWED_FEATURES);
  const maxRequestsPerMinute = normalizeMaxRequestsPerMinute(body.max_requests_per_minute ?? body.maxRequestsPerMinute);
  if (Number.isNaN(maxRequestsPerMinute)) {
    return json({ ok: false, error: "max_requests_per_minute must be between 10 and 75", code: "INVALID_RATE_LIMIT" }, 400);
  }
  const submittedByName = cleanString(body.submitted_by_name ?? body.submittedByName);

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `
    INSERT INTO torn_api_keys (
      id,
      label,
      encrypted_key,
      key_fingerprint,
      submitted_by_torn_user_id,
      owner_torn_user_id,
      owner_name,
      access_level,
      access_type,
      faction_access,
      status,
      allowed_features_json,
      max_requests_per_minute,
      last_validated_at,
      failure_count,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, 0, ?, ?)
    `,
  )
    .bind(
      id,
      generatedKeyLabel(keyInfo, submittedByName),
      await encryptTornApiKey(rawKey, storageSecret),
      fingerprint,
      submittedByTornUserId,
      keyInfo.owner_torn_user_id,
      keyInfo.owner_name,
      keyInfo.access_level,
      keyInfo.access_type,
      keyInfo.faction_access ? 1 : 0,
      JSON.stringify(allowedFeatures),
      maxRequestsPerMinute,
      now,
      now,
      now,
    )
    .run();

  const created = await readKeyById(env, id);
  return json({ ok: true, key: created ? metadataFromRow(created) : null }, 201);
}

export async function listMyTornApiKeys(env: Env, submittedByTornUserId: number | null): Promise<Response> {
  if (!submittedByTornUserId) {
    return json({ ok: false, error: "Unauthorized", code: "UNAUTHORIZED" }, 401);
  }

  const rows = await env.DB.prepare(
    `
    SELECT *
    FROM torn_api_keys
    WHERE submitted_by_torn_user_id = ?
    ORDER BY updated_at DESC
    `,
  )
    .bind(submittedByTornUserId)
    .all<TornKeyPoolRow>();

  return json({
    ok: true,
    features: keyPoolFeatureOptions(),
    default_allowed_features: DEFAULT_ALLOWED_FEATURES,
    keys: (rows.results ?? []).map(metadataFromRow),
  });
}

export async function updateMyTornApiKey(
  request: Request,
  env: Env,
  submittedByTornUserId: number | null,
  keyId: string,
): Promise<Response> {
  if (!submittedByTornUserId) {
    return json({ ok: false, error: "Unauthorized", code: "UNAUTHORIZED" }, 401);
  }

  const existing = await readOwnedKey(env, submittedByTornUserId, keyId);
  if (!existing) {
    return json({ ok: false, error: "Torn API key not found", code: "TORN_KEY_NOT_FOUND" }, 404);
  }

  const body = await readJsonObject(request);
  const status = normalizeStatus(body.status, existing.status);
  if (!status) {
    return json({ ok: false, error: "Invalid key status", code: "INVALID_STATUS" }, 400);
  }

  const allowedFeatures = body.allowed_features !== undefined || body.allowedFeatures !== undefined
    ? normalizeAllowedFeatures(body.allowed_features ?? body.allowedFeatures, allowedFeaturesFromRow(existing))
    : allowedFeaturesFromRow(existing);
  const maxRequestsPerMinute = body.max_requests_per_minute !== undefined || body.maxRequestsPerMinute !== undefined
    ? normalizeMaxRequestsPerMinute(body.max_requests_per_minute ?? body.maxRequestsPerMinute)
    : existing.max_requests_per_minute;
  if (Number.isNaN(maxRequestsPerMinute)) {
    return json({ ok: false, error: "max_requests_per_minute must be between 10 and 75", code: "INVALID_RATE_LIMIT" }, 400);
  }

  await env.DB.prepare(
    `
    UPDATE torn_api_keys
    SET
      label = ?,
      status = ?,
      allowed_features_json = ?,
      max_requests_per_minute = ?,
      paused_until = CASE WHEN ? = 'active' THEN NULL ELSE paused_until END,
      updated_at = ?
    WHERE id = ?
      AND submitted_by_torn_user_id = ?
    `,
  )
    .bind(
      generatedKeyLabel(existing),
      status,
      JSON.stringify(allowedFeatures),
      maxRequestsPerMinute,
      status,
      nowSeconds(),
      keyId,
      submittedByTornUserId,
    )
    .run();

  return json({ ok: true, key: metadataFromRow((await readKeyById(env, keyId)) ?? existing) });
}

export async function deleteMyTornApiKey(
  env: Env,
  submittedByTornUserId: number | null,
  keyId: string,
): Promise<Response> {
  if (!submittedByTornUserId) {
    return json({ ok: false, error: "Unauthorized", code: "UNAUTHORIZED" }, 401);
  }

  const existing = await readOwnedKey(env, submittedByTornUserId, keyId);
  if (!existing) {
    return json({ ok: false, error: "Torn API key not found", code: "TORN_KEY_NOT_FOUND" }, 404);
  }

  await env.DB.prepare(
    `
    UPDATE torn_api_keys
    SET status = 'disabled', updated_at = ?
    WHERE id = ?
      AND submitted_by_torn_user_id = ?
    `,
  )
    .bind(nowSeconds(), keyId, submittedByTornUserId)
    .run();

  return json({ ok: true, key: metadataFromRow((await readKeyById(env, keyId)) ?? existing) });
}

export async function listAdminTornApiKeys(env: Env): Promise<Response> {
  const rows = await env.DB.prepare(
    `
    SELECT *
    FROM torn_api_keys
    ORDER BY updated_at DESC
    LIMIT 500
    `,
  ).all<TornKeyPoolRow>();

  return json({
    ok: true,
    features: keyPoolFeatureOptions(),
    keys: (rows.results ?? []).map(metadataFromRow),
  });
}

export async function readAvailableTornApiKeys(
  env: Env,
  feature: TornKeyPoolFeature,
  now = nowSeconds(),
  options: { includeFallback?: boolean } = {},
): Promise<TornKeyPoolCandidate[]> {
  const candidates: TornKeyPoolCandidate[] = [];
  const storageSecret = await readStorageSecret(env);
  const windowStart = minuteWindowStart(now);

  if (storageSecret) {
    const rows = await env.DB.prepare(
      `
      SELECT k.*, COALESCE(w.request_count, 0) AS current_request_count
      FROM torn_api_keys k
      LEFT JOIN torn_api_key_usage_windows w
        ON w.key_id = k.id
       AND w.window_start = ?
      WHERE k.status = 'active'
        AND (k.paused_until IS NULL OR k.paused_until <= ?)
      ORDER BY COALESCE(k.last_used_at, 0) ASC, k.created_at ASC
      LIMIT 100
      `,
    )
      .bind(windowStart, now)
      .all<TornKeyPoolRow & { current_request_count?: number }>();

    for (const row of rows.results ?? []) {
      if (!isFeatureAllowed(row.allowed_features_json, feature)) continue;
      if (!isTornKeyCapableForFeature(row, feature)) continue;
      const currentMinuteUsage = Number(row.current_request_count ?? 0);
      if (!isUnderMinuteLimit(currentMinuteUsage, row.max_requests_per_minute)) continue;

      try {
        candidates.push({
          id: row.id,
          key: await decryptTornApiKey(row.encrypted_key, storageSecret),
          keySource: `key_pool:${row.id}`,
          sourceType: "submitted",
          maxRequestsPerMinute: row.max_requests_per_minute,
          currentMinuteUsage,
          lastUsedAt: row.last_used_at,
          monitorLastUsedAt: row.monitor_last_used_at,
        });
      } catch {
        await markTornKeyFailure(env, row.id, "Unable to decrypt stored key", now, 15 * 60);
      }
    }
  }

  if (options.includeFallback ?? true) {
    candidates.push(...await readFallbackKeyCandidates(env, feature));
  }

  return sortCandidatesForFeature(candidates, feature, now);
}

export async function recordTornKeyUse(
  env: Env,
  candidate: Pick<TornKeyPoolCandidate, "id" | "sourceType">,
  feature: TornKeyPoolFeature,
  now = nowSeconds(),
  count = 1,
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
        last_used_feature = ?,
        monitor_last_used_at = CASE WHEN ? = 'hospital_monitor' THEN ? ELSE monitor_last_used_at END,
        updated_at = ?
      WHERE id = ?
      `,
    ).bind(now, feature, feature, now, now, candidate.id),
  ]);
}

export async function markTornKeyFailure(
  env: Env,
  keyId: string,
  error: string,
  now = nowSeconds(),
  pauseSeconds = 60,
): Promise<void> {
  await env.DB.prepare(
    `
    UPDATE torn_api_keys
    SET
      failure_count = failure_count + 1,
      last_error = ?,
      paused_until = ?,
      updated_at = ?
    WHERE id = ?
    `,
  )
    .bind(error.slice(0, 240), now + pauseSeconds, now, keyId)
    .run();
}

export class TornKeyPoolUnavailableError extends Error {
  constructor(
    readonly feature: TornKeyPoolFeature,
    message = `No Torn API keys are available for ${feature}`,
  ) {
    super(message);
  }
}

export class TornKeyPoolExhaustedError extends Error {
  constructor(
    readonly feature: TornKeyPoolFeature,
    readonly lastError: unknown,
  ) {
    super(`All Torn API keys failed for ${feature}`);
  }
}

export async function runWithTornKeyPool<T>(
  env: Env,
  options: TornKeyPoolRunOptions<T>,
): Promise<TornKeyPoolRunResult<T>> {
  const now = options.now ?? nowSeconds();
  const candidates = await readAvailableTornApiKeys(env, options.feature, now, {
    includeFallback: options.includeFallback,
  });

  if (candidates.length === 0) {
    throw new TornKeyPoolUnavailableError(options.feature);
  }

  let lastRetryableError: unknown = null;
  for (const candidate of candidates) {
    const context: TornKeyPoolRunContext = {
      candidate,
      key: candidate.key,
      keySource: candidate.keySource,
    };

    try {
      const result = await options.run(context);
      await recordTornKeyUse(env, candidate, options.feature, now, options.usageCount ?? 1);
      return { result, candidate };
    } catch (err) {
      const retry = options.shouldRetryKey?.(err, context) ?? isRetryableTornKeyError(err);
      if (!retry) {
        throw err;
      }

      lastRetryableError = err;
      if (candidate.sourceType === "submitted") {
        await markTornKeyFailure(
          env,
          candidate.id,
          safeErrorMessage(err),
          now,
          options.failurePauseSeconds ?? pauseSecondsForTornKeyError(err),
        );
      }
    }
  }

  throw new TornKeyPoolExhaustedError(options.feature, lastRetryableError);
}

export async function withTornKeyPool<T>(
  env: Env,
  options: TornKeyPoolRunOptions<T>,
): Promise<T> {
  return (await runWithTornKeyPool(env, options)).result;
}

export function allowedFeaturesFromJson(value: string): TornKeyPoolFeature[] {
  return normalizeAllowedFeatures(parseJson(value), DEFAULT_ALLOWED_FEATURES);
}

export function isFeatureAllowed(allowedFeaturesJson: string, feature: TornKeyPoolFeature): boolean {
  return allowedFeaturesFromJson(allowedFeaturesJson).includes(feature);
}

export function isTornKeyCapableForFeature(
  key: Pick<TornKeyPoolRow, "access_level" | "access_type" | "faction_access">,
  feature: TornKeyPoolFeature,
): boolean {
  switch (feature) {
    case "faction_contributor_stats":
    case "war_live_data":
      return hasFactionCapability(key);
    case "arrest_scout":
    case "hospital_monitor":
    case "enemy_scouting":
    case "faction_lifestyle_stats":
    case "stock_tools":
    case "misc_utilities":
    case "experimental_features":
      return hasPublicCapability(key);
  }
}

export function featureAccessRequirement(feature: TornKeyPoolFeature): TornKeyPoolAccessRequirement {
  switch (feature) {
    case "faction_contributor_stats":
    case "war_live_data":
      return "faction";
    case "arrest_scout":
    case "hospital_monitor":
    case "enemy_scouting":
    case "faction_lifestyle_stats":
    case "stock_tools":
    case "misc_utilities":
    case "experimental_features":
      return "public";
  }
}

export function isUnderMinuteLimit(currentMinuteUsage: number, maxRequestsPerMinute: number | null): boolean {
  return maxRequestsPerMinute === null || currentMinuteUsage < maxRequestsPerMinute;
}

export function isRetryableTornKeyError(err: unknown): boolean {
  const status = errorStatus(err);
  if (status === 401 || status === 403 || status === 429) {
    return true;
  }

  const message = safeErrorMessage(err).toLowerCase();
  return message.includes("incorrect key") ||
    message.includes("invalid api key") ||
    message.includes("api key") ||
    message.includes("rate limit") ||
    message.includes("too many requests") ||
    message.includes("access level") ||
    message.includes("faction access");
}

export function sortCandidatesForFeature(
  candidates: TornKeyPoolCandidate[],
  feature: TornKeyPoolFeature,
  now: number,
): TornKeyPoolCandidate[] {
  return [...candidates].sort((left, right) => {
    if (feature !== "hospital_monitor") {
      const leftRecentlyUsedByMonitor = (left.monitorLastUsedAt ?? 0) >= now - MONITOR_RECENT_USE_SECONDS;
      const rightRecentlyUsedByMonitor = (right.monitorLastUsedAt ?? 0) >= now - MONITOR_RECENT_USE_SECONDS;
      if (leftRecentlyUsedByMonitor !== rightRecentlyUsedByMonitor) {
        return leftRecentlyUsedByMonitor ? 1 : -1;
      }
    }

    if (left.sourceType !== right.sourceType) {
      return left.sourceType === "submitted" ? -1 : 1;
    }

    const leftUsageRatio = usageRatio(left.currentMinuteUsage, left.maxRequestsPerMinute);
    const rightUsageRatio = usageRatio(right.currentMinuteUsage, right.maxRequestsPerMinute);
    if (leftUsageRatio !== rightUsageRatio) {
      return leftUsageRatio - rightUsageRatio;
    }

    return (left.lastUsedAt ?? 0) - (right.lastUsedAt ?? 0);
  });
}

export async function encryptTornApiKey(plaintext: string, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(secret);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    utf8(plaintext),
  );
  return `${ENCRYPTION_VERSION}:${base64FromBytes(iv)}:${base64FromBytes(new Uint8Array(encrypted))}`;
}

export async function decryptTornApiKey(encrypted: string, secret: string): Promise<string> {
  const [version, ivBase64, ciphertextBase64] = encrypted.split(":");
  if (version !== ENCRYPTION_VERSION || !ivBase64 || !ciphertextBase64) {
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

export async function fingerprintTornApiKey(tornKey: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    utf8(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, utf8(tornKey.trim()));
  return base64UrlFromBytes(new Uint8Array(signature));
}

async function validateTornApiKey(env: Env, tornKey: string): Promise<ValidatedTornKeyInfo> {
  const data = await fetchTrackedTornJson<any>(env, TORN_KEY_INFO_API_URL, {
    headers: {
      Accept: "application/json",
      Authorization: `ApiKey ${tornKey}`,
    },
  }, {
    feature: "torn-key-pool",
    keySource: "member_submitted:key_validation",
  }, {
    service: "Torn key info",
  });
  const info = data.info ?? data;
  const userInfo = info.user ?? {};
  const accessInfo = info.access ?? {};
  const id = Number(userInfo.id ?? userInfo.player_id ?? userInfo.user_id);

  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Torn key info response did not include a valid user ID");
  }

  const ownerName = cleanString(userInfo.name) || await fetchTornKeyOwnerName(env, tornKey, id);

  return {
    key_name: readTornKeyName(info),
    owner_torn_user_id: id,
    owner_name: ownerName,
    access_level: Number.isFinite(Number(accessInfo.level)) ? Number(accessInfo.level) : null,
    access_type: typeof accessInfo.type === "string" ? accessInfo.type : null,
    faction_access: accessInfo.faction === true,
  };
}

async function fetchTornKeyOwnerName(env: Env, tornKey: string, ownerTornUserId: number): Promise<string | null> {
  const url = new URL(TORN_USER_BASIC_API_URL);
  url.searchParams.set("striptags", "true");
  url.searchParams.set("key", tornKey);

  try {
    const data = await fetchTrackedTornJson<any>(env, url, {
      headers: {
        Accept: "application/json",
      },
    }, {
      feature: "torn-key-pool",
      keySource: "member_submitted:key_owner_lookup",
    }, {
      service: "Torn key owner lookup",
    });
    return readTornBasicOwnerName(data, ownerTornUserId);
  } catch {
    return null;
  }
}

export function readTornBasicOwnerName(data: unknown, expectedTornUserId: number): string | null {
  const candidates = [
    data,
    readObject(data, "profile"),
    readObject(data, "user"),
    readObject(data, "basic"),
  ];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const record = candidate as Record<string, unknown>;
    const id = Number(
      record.id ??
      record.player_id ??
      record.user_id,
    );
    if (Number.isInteger(id) && id > 0 && id !== expectedTornUserId) {
      continue;
    }
    const name = cleanString(
      record.name ??
      record.player_name ??
      record.username,
    );
    if (name) return name;
  }

  return null;
}

function readObject(source: unknown, key: string): Record<string, unknown> | null {
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  const value = (source as Record<string, unknown>)[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readTornKeyName(info: any): string | null {
  return cleanString(
    info.key?.name ??
    info.key?.title ??
    info.key_name ??
    info.name ??
    info.title,
  ) || null;
}

async function isDuplicateTornKey(env: Env, rawKey: string, storageSecret: string): Promise<boolean> {
  return (await readDuplicateTornKey(env, await fingerprintTornApiKey(rawKey, storageSecret))) !== null;
}

async function readDuplicateTornKey(
  env: Env,
  fingerprint: string,
): Promise<{ id: string; submitted_by_torn_user_id: number | null } | null> {
  return (await env.DB.prepare(
    `
    SELECT id, submitted_by_torn_user_id
    FROM torn_api_keys
    WHERE key_fingerprint = ?
    LIMIT 1
    `,
  )
    .bind(fingerprint)
    .first<{ id: string; submitted_by_torn_user_id: number | null }>()) ?? null;
}

async function readFallbackKeyCandidates(env: Env, feature: TornKeyPoolFeature): Promise<TornKeyPoolCandidate[]> {
  if (!FALLBACK_KEY_FEATURES.includes(feature)) return [];

  const fallbackBindings: Array<{ id: string; keySource: string; binding?: string | SecretsStoreSecret }> = [
    { id: "env:TORN_API_KEY", keySource: "env:TORN_API_KEY", binding: env.TORN_API_KEY },
  ];
  const candidates: TornKeyPoolCandidate[] = [];

  for (const fallback of fallbackBindings) {
    const key = await readSecretValue(fallback.binding);
    if (!key) continue;
    candidates.push({
      id: fallback.id,
      key,
      keySource: fallback.keySource,
      sourceType: fallback.id.startsWith("env:") ? "env" : "secret",
      maxRequestsPerMinute: null,
      currentMinuteUsage: 0,
      lastUsedAt: null,
      monitorLastUsedAt: null,
    });
  }

  return candidates;
}

async function readStorageSecret(env: Env): Promise<string | null> {
  return readSecretValue(env.TORN_KEY_STORAGE_SECRET);
}

async function readSecretValue(binding?: string | SecretsStoreSecret): Promise<string | null> {
  const value = typeof binding === "string" ? binding : await binding?.get();
  return value?.trim() || null;
}

function metadataFromRow(row: TornKeyPoolRow): TornKeyMetadata {
  return {
    id: row.id,
    label: row.label,
    submitted_by_torn_user_id: row.submitted_by_torn_user_id,
    owner_torn_user_id: row.owner_torn_user_id,
    owner_name: row.owner_name,
    access_level: row.access_level,
    access_type: row.access_type,
    faction_access: row.faction_access === 1,
    status: row.status,
    allowed_features: allowedFeaturesFromRow(row),
    max_requests_per_minute: row.max_requests_per_minute,
    last_validated_at: row.last_validated_at,
    last_used_at: row.last_used_at,
    last_used_feature: row.last_used_feature,
    monitor_last_used_at: row.monitor_last_used_at,
    paused_until: row.paused_until,
    failure_count: row.failure_count,
    last_error: row.last_error,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function allowedFeaturesFromRow(row: Pick<TornKeyPoolRow, "allowed_features_json">): TornKeyPoolFeature[] {
  return allowedFeaturesFromJson(row.allowed_features_json);
}

function normalizeAllowedFeatures(value: unknown, fallback: TornKeyPoolFeature[]): TornKeyPoolFeature[] {
  const raw = Array.isArray(value) ? value : [];
  const normalized = Array.from(new Set(raw.flatMap((item): TornKeyPoolFeature[] => {
    if (item === "background_stats") {
      return ["faction_lifestyle_stats"];
    }
    if (item === "faction_stats") {
      return ["faction_lifestyle_stats", "faction_contributor_stats"];
    }
    if (item === "war_tools") {
      return ["war_live_data"];
    }
    return typeof item === "string" && ALLOWED_FEATURES.has(item as TornKeyPoolFeature)
      ? [item as TornKeyPoolFeature]
      : [];
  })));
  return normalized.length > 0 ? normalized : [...fallback];
}

function normalizeMaxRequestsPerMinute(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return DEFAULT_REQUESTS_PER_MINUTE;
  const parsed = Math.floor(Number(value));
  return Number.isInteger(parsed) && parsed >= MIN_REQUESTS_PER_MINUTE && parsed <= MAX_REQUESTS_PER_MINUTE
    ? parsed
    : Number.NaN;
}

function hasPublicCapability(key: Pick<TornKeyPoolRow, "access_level" | "access_type">): boolean {
  return isFullAccessKey(key.access_type) || accessLevel(key.access_level) >= 1;
}

function hasFactionCapability(key: Pick<TornKeyPoolRow, "access_level" | "access_type" | "faction_access">): boolean {
  return isFullAccessKey(key.access_type) || Number(key.faction_access ?? 0) === 1;
}

function accessLevel(value: number | null): number {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function isFullAccessKey(accessType: string | null): boolean {
  const normalized = accessType?.trim().toLowerCase() ?? "";
  return normalized === "full" || normalized === "full access";
}

function generatedKeyLabel(source: {
  owner_name?: string | null;
  owner_torn_user_id?: number | null;
}, submittedByName?: string | null): string {
  const owner = submittedByName?.trim() || source.owner_name?.trim() || String(source.owner_torn_user_id ?? "TORN");
  const normalizedOwner = owner.replace(/\s+/g, "_").slice(0, Math.max(1, MAX_LABEL_LENGTH - 4));
  return `${normalizedOwner}_KEY`;
}

function normalizeStatus(value: unknown, fallback: string): TornKeyPoolStatus | null {
  const status = typeof value === "string" ? value.trim().toLowerCase() : fallback;
  if (status === "active" || status === "disabled") return status;
  return null;
}

function minuteWindowStart(now: number): number {
  return Math.floor(now / 60) * 60;
}

function usageRatio(currentMinuteUsage: number, maxRequestsPerMinute: number | null): number {
  return maxRequestsPerMinute === null ? 0 : currentMinuteUsage / Math.max(1, maxRequestsPerMinute);
}

function pauseSecondsForTornKeyError(err: unknown): number {
  return errorStatus(err) === 429 ? 60 : 15 * 60;
}

function errorStatus(err: unknown): number | null {
  if (err instanceof ExternalApiError) {
    return err.status;
  }
  const status = (err as { status?: unknown } | null)?.status;
  return Number.isFinite(Number(status)) ? Number(status) : null;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function readKeyById(env: Env, keyId: string): Promise<TornKeyPoolRow | null> {
  return env.DB.prepare(
    `
    SELECT *
    FROM torn_api_keys
    WHERE id = ?
    LIMIT 1
    `,
  )
    .bind(keyId)
    .first<TornKeyPoolRow>();
}

async function readOwnedKey(env: Env, submittedByTornUserId: number, keyId: string): Promise<TornKeyPoolRow | null> {
  return env.DB.prepare(
    `
    SELECT *
    FROM torn_api_keys
    WHERE id = ?
      AND submitted_by_torn_user_id = ?
    LIMIT 1
    `,
  )
    .bind(keyId, submittedByTornUserId)
    .first<TornKeyPoolRow>();
}

async function deriveAesKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", utf8(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64UrlFromBytes(bytes: Uint8Array): string {
  return base64FromBytes(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function bytesFromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function safeErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/(ApiKey\s+)[A-Za-z0-9_-]+/gi, "$1[redacted]");
}
