import { TORN_FACTION_API_BASE_URL } from "../constants";
import { bumpMemberLifestyleCacheVersion } from "../cacheVersions";
import { fetchTrackedTornJson } from "../external/torn";
import { claimDailyBatchGate } from "../scheduledGates";
import { deleteSyncState, readSyncState, readSyncTimestamp, upsertSyncTimestamp } from "../syncState";
import { Env } from "../types";
import { finiteNumber, nowSeconds } from "../utils";
import { dailyRefreshReadyAt, utcDateKey } from "./dates";
import {
  DAILY_GYM_COMPLETE_STATE_NAME,
  DAILY_GYM_FAILED_STATE_NAME,
  DAILY_GYM_LOCK_STATE_NAME,
  DAILY_GYM_RETRY_REFRESH_STATE_NAME,
  DAILY_GYM_RETRY_STATE_NAME,
  DAILY_LIFESTYLE_LOCK_SECONDS,
  GYM_CONTRIBUTOR_FETCH_TIMEOUT_MS,
  GYM_CONTRIBUTOR_STAT_KEYS,
} from "./model";
import type {
  GymContributorStatKey,
} from "./model";
import {
  syncHomeFactionMemberList,
  writeLifestyleSnapshotForDate,
} from "./internal";

const DAILY_GYM_HOT_RETRY_LIMIT = 5;
const DAILY_GYM_HOT_RETRY_DELAY_SECONDS = 60;
const DAILY_GYM_COLD_RETRY_DELAY_SECONDS = 15 * 60;
const DAILY_GYM_RETRY_WINDOW_SECONDS = 6 * 60 * 60;

type DailyGymStatsOptions = { homeMembersSynced?: boolean; now?: number };

type DailyGymStatsResult = {
  refreshed_stats: number;
  updated_members: number;
  skipped: boolean;
  failed: boolean;
  retry_at: number | null;
};

type DailyGymRetryContext = {
  active: boolean;
  retryAt: number;
  failedAttempts: number;
};

export async function refreshDailyGymStats(
  env: Env,
  options: DailyGymStatsOptions = {},
): Promise<DailyGymStatsResult> {
  const now = Math.floor(options.now ?? nowSeconds());
  const refreshAt = dailyRefreshReadyAt(now);
  if (refreshAt === null) {
    return skippedDailyGymStatsResult();
  }

  if ((await readSyncTimestamp(env, DAILY_GYM_COMPLETE_STATE_NAME)) >= refreshAt) {
    return skippedDailyGymStatsResult();
  }

  const retry = await readDailyGymRetryContext(env, refreshAt);
  if (retry.retryAt > now) {
    return skippedDailyGymStatsResult(retry.retryAt);
  }

  const gate = await claimDailyBatchGate(env, {
    completeStateName: DAILY_GYM_COMPLETE_STATE_NAME,
    completeAfter: refreshAt,
    lockStateName: DAILY_GYM_LOCK_STATE_NAME,
    now,
    lockSeconds: DAILY_LIFESTYLE_LOCK_SECONDS,
  });
  if (gate.completed || !gate.locked) {
    return skippedDailyGymStatsResult(retry.retryAt || null);
  }
  if (retry.active && hasGymRetryWindowExpired(refreshAt, now)) {
    await finalizeFailedDailyGymImport(env, refreshAt, options);
    return failedDailyGymStatsResult();
  }

  const fullImport = shouldRunFullGymImport(retry.failedAttempts);
  const statKeys = fullImport
    ? GYM_CONTRIBUTOR_STAT_KEYS
    : await readMissingGymContributorStatKeys(env, refreshAt);

  try {
    const result = await refreshGymContributorStats(env, {
      refreshAt,
      statKeys,
      resetImport: fullImport,
    });
    await completeDailyGymImport(env, refreshAt, options);
    return { ...result, skipped: false, failed: false, retry_at: null };
  } catch (err) {
    if (hasGymRetryWindowExpired(refreshAt, now)) {
      await finalizeFailedDailyGymImport(env, refreshAt, options);
      return failedDailyGymStatsResult();
    }

    await scheduleDailyGymRetry(env, refreshAt, now, retry.failedAttempts);
    throw err;
  }
}

function skippedDailyGymStatsResult(retryAt: number | null = null): DailyGymStatsResult {
  return { refreshed_stats: 0, updated_members: 0, skipped: true, failed: false, retry_at: retryAt };
}

function failedDailyGymStatsResult(): DailyGymStatsResult {
  return { refreshed_stats: 0, updated_members: 0, skipped: false, failed: true, retry_at: null };
}

async function readDailyGymRetryContext(env: Env, refreshAt: number): Promise<DailyGymRetryContext> {
  const retryState = await readSyncState(env, DAILY_GYM_RETRY_STATE_NAME);
  const retryRefreshAt = await readSyncTimestamp(env, DAILY_GYM_RETRY_REFRESH_STATE_NAME);
  if (retryState && retryRefreshAt < refreshAt) {
    await clearDailyGymRetryState(env);
    return { active: false, retryAt: 0, failedAttempts: 0 };
  }

  const active = retryState !== null && retryRefreshAt >= refreshAt;
  return {
    active,
    retryAt: active ? Number(retryState?.last_started ?? 0) : 0,
    failedAttempts: active ? Math.max(0, Number(retryState?.active_war_id ?? 0)) : 0,
  };
}

function shouldRunFullGymImport(failedAttempts: number): boolean {
  return failedAttempts === 0 || failedAttempts > DAILY_GYM_HOT_RETRY_LIMIT;
}

function hasGymRetryWindowExpired(refreshAt: number, now: number): boolean {
  return now >= gymRetryExpiresAt(refreshAt);
}

function gymRetryExpiresAt(refreshAt: number): number {
  return refreshAt + DAILY_GYM_RETRY_WINDOW_SECONDS;
}

async function scheduleDailyGymRetry(
  env: Env,
  refreshAt: number,
  now: number,
  failedAttempts: number,
): Promise<void> {
  const nextAttempts = failedAttempts + 1;
  const delaySeconds = nextAttempts <= DAILY_GYM_HOT_RETRY_LIMIT
    ? DAILY_GYM_HOT_RETRY_DELAY_SECONDS
    : DAILY_GYM_COLD_RETRY_DELAY_SECONDS;
  const nextRetryAt = Math.min(now + delaySeconds, gymRetryExpiresAt(refreshAt));
  await upsertSyncTimestamp(env, DAILY_GYM_RETRY_STATE_NAME, nextRetryAt, nextAttempts);
  await upsertSyncTimestamp(env, DAILY_GYM_RETRY_REFRESH_STATE_NAME, refreshAt, null);
  await deleteSyncState(env, DAILY_GYM_LOCK_STATE_NAME);
}

async function completeDailyGymImport(
  env: Env,
  refreshAt: number,
  options: Pick<DailyGymStatsOptions, "homeMembersSynced">,
): Promise<void> {
  await syncHomeMembersForDailyGymSnapshot(env, options);
  await writeLifestyleSnapshotForDate(env, utcDateKey(refreshAt), { freshAfter: refreshAt });
  await bumpMemberLifestyleCacheVersion(env);
  await upsertSyncTimestamp(env, DAILY_GYM_COMPLETE_STATE_NAME, refreshAt, null);
  await deleteSyncState(env, DAILY_GYM_FAILED_STATE_NAME);
  await clearDailyGymRetryState(env);
  await deleteSyncState(env, DAILY_GYM_LOCK_STATE_NAME);
}

async function finalizeFailedDailyGymImport(
  env: Env,
  refreshAt: number,
  options: Pick<DailyGymStatsOptions, "homeMembersSynced">,
): Promise<void> {
  await syncHomeMembersForDailyGymSnapshot(env, options);
  const snapshotDate = utcDateKey(refreshAt);
  const missingStats = await readMissingGymContributorStatKeys(env, refreshAt);
  await markGymContributorStatsPartialFailed(env, missingStats);
  await writeLifestyleSnapshotForDate(env, snapshotDate, { freshAfter: refreshAt, allowPartialGym: true });
  await bumpMemberLifestyleCacheVersion(env);
  await upsertSyncTimestamp(env, DAILY_GYM_FAILED_STATE_NAME, refreshAt, null);
  await upsertSyncTimestamp(env, DAILY_GYM_COMPLETE_STATE_NAME, refreshAt, null);
  await clearDailyGymRetryState(env);
  await deleteSyncState(env, DAILY_GYM_LOCK_STATE_NAME);
}

async function syncHomeMembersForDailyGymSnapshot(
  env: Env,
  options: Pick<DailyGymStatsOptions, "homeMembersSynced">,
): Promise<void> {
  if (!options.homeMembersSynced) {
    await syncHomeFactionMemberList(env);
  }
}

async function clearDailyGymRetryState(env: Env): Promise<void> {
  await deleteSyncState(env, DAILY_GYM_RETRY_STATE_NAME);
  await deleteSyncState(env, DAILY_GYM_RETRY_REFRESH_STATE_NAME);
}

async function refreshGymContributorStats(
  env: Env,
  options: {
    refreshAt: number;
    resetImport?: boolean;
    statKeys?: readonly GymContributorStatKey[];
  },
): Promise<{ refreshed_stats: number; updated_members: number }> {
  if (options.resetImport) {
    await resetGymContributorImportRows(env);
  }

  const statKeys = options.statKeys ?? GYM_CONTRIBUTOR_STAT_KEYS;
  let allowInsert = options.resetImport || !(await hasCurrentGymContributorStatCompletions(env, options.refreshAt));
  let refreshedStats = 0;
  const failedStats: string[] = [];
  for (const stat of statKeys) {
    let contributors: Map<number, number>;
    try {
      contributors = await fetchFactionContributorStat(env, stat);
    } catch (err) {
      failedStats.push(`${stat}: ${errorMessage(err)}`);
      continue;
    }
    await upsertGymContributorStat(env, stat, contributors, { allowInsert });
    await upsertSyncTimestamp(env, gymContributorStatCompleteStateName(stat), options.refreshAt, null);
    allowInsert = false;
    refreshedStats += 1;
  }

  const missingStats = await readMissingGymContributorStatKeys(env, options.refreshAt);
  if (missingStats.length > 0) {
    const details = failedStats.length > 0 ? ` (${failedStats.join("; ")})` : "";
    throw new Error(`Gym contributor import incomplete: missing ${missingStats.join(", ")}${details}`);
  }

  await markGymContributorStatsComplete(env);
  return {
    refreshed_stats: refreshedStats,
    updated_members: await countImportedGymContributorRows(env),
  };
}

async function resetGymContributorImportRows(env: Env): Promise<void> {
  await env.DB.prepare(
    `
    UPDATE member_gym_stats_current
    SET gymenergy = NULL,
        gymstrength = NULL,
        gymspeed = NULL,
        gymdefense = NULL,
        gymdexterity = NULL,
        gym_captured_at = NULL,
        gym_error = NULL
    `,
  )
    .run();
}

async function upsertGymContributorStat(
  env: Env,
  stat: GymContributorStatKey,
  contributors: Map<number, number>,
  options: { allowInsert: boolean },
): Promise<void> {
  const statements = Array.from(contributors.entries()).map(([memberId, contributed]) =>
    options.allowInsert
      ? env.DB.prepare(
      `
      INSERT INTO member_gym_stats_current (
        member_id,
        member_name,
        level,
        position,
        ${stat},
        gym_captured_at,
        gym_error
      )
      VALUES (?, NULL, NULL, NULL, ?, NULL, NULL)
      ON CONFLICT(member_id) DO UPDATE SET
        member_name = COALESCE(excluded.member_name, member_gym_stats_current.member_name),
        level = COALESCE(excluded.level, member_gym_stats_current.level),
        position = COALESCE(excluded.position, member_gym_stats_current.position),
        ${stat} = excluded.${stat},
        gym_captured_at = NULL,
        gym_error = NULL
      `,
    ).bind(
      memberId,
      contributed,
    )
      : env.DB.prepare(
        `
        UPDATE member_gym_stats_current
        SET ${stat} = ?,
            gym_captured_at = NULL,
            gym_error = NULL
        WHERE member_id = ?
        `,
      ).bind(contributed, memberId),
  );

  if (statements.length > 0) {
    await env.DB.batch(statements);
  }
}

async function readMissingGymContributorStatKeys(
  env: Env,
  refreshAt: number,
): Promise<GymContributorStatKey[]> {
  const missing: GymContributorStatKey[] = [];
  for (const stat of GYM_CONTRIBUTOR_STAT_KEYS) {
    if ((await readSyncTimestamp(env, gymContributorStatCompleteStateName(stat))) < refreshAt) {
      missing.push(stat);
    }
  }
  return missing;
}

async function hasCurrentGymContributorStatCompletions(env: Env, refreshAt: number): Promise<boolean> {
  for (const stat of GYM_CONTRIBUTOR_STAT_KEYS) {
    if ((await readSyncTimestamp(env, gymContributorStatCompleteStateName(stat))) >= refreshAt) {
      return true;
    }
  }
  return false;
}

async function countImportedGymContributorRows(env: Env): Promise<number> {
  const row = await env.DB.prepare(
    `
    SELECT COUNT(*) AS count
    FROM member_gym_stats_current
    WHERE gymenergy IS NOT NULL
       OR gymstrength IS NOT NULL
       OR gymspeed IS NOT NULL
       OR gymdefense IS NOT NULL
       OR gymdexterity IS NOT NULL
    `,
  ).first<{ count: number | null }>();

  return Number(row?.count ?? 0);
}

async function markGymContributorStatsComplete(env: Env): Promise<void> {
  await env.DB.prepare(
    `
    UPDATE member_gym_stats_current
    SET gym_captured_at = unixepoch(),
        gym_error = NULL
    WHERE gymenergy IS NOT NULL
       OR gymstrength IS NOT NULL
       OR gymspeed IS NOT NULL
       OR gymdefense IS NOT NULL
       OR gymdexterity IS NOT NULL
    `,
  )
    .run();
}

async function markGymContributorStatsPartialFailed(
  env: Env,
  missingStats: readonly GymContributorStatKey[],
): Promise<void> {
  const message = missingStats.length > 0
    ? `Missing gym contributor stats: ${missingStats.join(", ")}`
    : "Gym contributor import failed";
  await env.DB.prepare(
    `
    UPDATE member_gym_stats_current
    SET gym_captured_at = unixepoch(),
        gym_error = ?
    WHERE gymenergy IS NOT NULL
       OR gymstrength IS NOT NULL
       OR gymspeed IS NOT NULL
       OR gymdefense IS NOT NULL
       OR gymdexterity IS NOT NULL
    `,
  )
    .bind(message)
    .run();
}

function gymContributorStatCompleteStateName(stat: GymContributorStatKey): string {
  return `${DAILY_GYM_COMPLETE_STATE_NAME}_${stat}`;
}

async function fetchFactionContributorStat(
  env: Env,
  stat: GymContributorStatKey,
): Promise<Map<number, number>> {
  const url = new URL(`${TORN_FACTION_API_BASE_URL}/contributors`);
  url.searchParams.set("stat", stat);
  url.searchParams.set("cat", "current");

  const data = await fetchTrackedTornJson<any>(env, url, {
    headers: {
      Accept: "application/json",
      Authorization: `ApiKey ${env.TORN_API_KEY}`,
    },
  }, {
    feature: "lifestyle:contributors",
    keySource: "env:TORN_API_KEY",
    timeoutMs: GYM_CONTRIBUTOR_FETCH_TIMEOUT_MS,
  }, {
    service: `Torn faction contributors ${stat}`,
  });

  return extractContributorValues(data?.contributors, stat);
}

function extractContributorValues(
  source: unknown,
  stat: GymContributorStatKey,
): Map<number, number> {
  const contributors = new Map<number, number>();
  const statContainer =
    source && typeof source === "object" && !Array.isArray(source)
      ? ((source as Record<string, unknown>)[stat] ?? source)
      : source;

  if (!statContainer || typeof statContainer !== "object") {
    return contributors;
  }

  if (Array.isArray(statContainer)) {
    for (const item of statContainer) {
      addContributorValue(
        contributors,
        item?.id ?? item?.member_id ?? item?.user_id ?? item?.player_id,
        item,
      );
    }
    return contributors;
  }

  for (const [memberId, value] of Object.entries(statContainer)) {
    addContributorValue(contributors, memberId, value);
  }

  return contributors;
}

function addContributorValue(
  contributors: Map<number, number>,
  memberIdValue: unknown,
  source: any,
) {
  const memberId = Number(memberIdValue);
  if (!Number.isInteger(memberId) || memberId <= 0) {
    return;
  }

  const contributed =
    source && typeof source === "object"
      ? finiteNumber(source.contributed ?? source.value ?? source.amount)
      : finiteNumber(source);

  if (contributed !== null) {
    contributors.set(memberId, contributed);
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
