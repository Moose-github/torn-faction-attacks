import {
  ENEMY_NETWORTH_MAX_ATTEMPTS,
  ENEMY_NETWORTH_PER_KEY_LIMIT,
  enemyNetworthCandidateLimit,
  partitionEnemyNetworthCandidates,
  pauseEnemyNetworthKey,
  readAvailableEnemyNetworthKeys,
  type TornApiKey,
} from "./enemyNetworth";
import {
  fetchTornPersonalStatsWithTimestamps,
  TornPersonalStatsHttpError,
  type TornPersonalStatsResponse,
} from "./personalStats";
import { setSyncLatch } from "./syncLatches";
import { recordTornKeyUse } from "./tornKeyPool";
import { Env } from "./types";
import { d1Changes, finiteNumber, nowSeconds } from "./utils";

export const ENEMY_HIT_STAT_KEYS = [
  "rankedwarhits",
  "attackhits",
  "temphits",
  "piercinghits",
  "slashinghits",
  "clubbinghits",
  "mechanicalhits",
  "h2hhits",
  "retals",
  "specialammoused",
] as const;

export const ENEMY_HIT_STAT_MAX_ATTEMPTS = ENEMY_NETWORTH_MAX_ATTEMPTS;
export const ENEMY_HIT_STAT_PER_KEY_LIMIT = ENEMY_NETWORTH_PER_KEY_LIMIT;

const MAX_STORED_HIT_STAT_ERROR_LENGTH = 240;
const WEDNESDAY_UTC_DAY = 3;
const WEDNESDAY_SNAPSHOT_MINUTES = 10;
const SECONDS_PER_DAY = 24 * 60 * 60;
const SECONDS_PER_WEEK = 7 * SECONDS_PER_DAY;
const HIGH_RANKED_WAR_HITS_PER_WEEK = 75;
const MEDIUM_RANKED_WAR_HITS_PER_WEEK = 25;
const HIGH_RETALS_PER_WEEK = 2;
const MEDIUM_RETALS_PER_WEEK = 1;

type EnemyHitStatKey = typeof ENEMY_HIT_STAT_KEYS[number];

type EnemyHitStatMemberSeed = {
  member_id: number;
  name: string;
};

export type EnemyHitStatSnapshotTarget = {
  snapshotDate: string;
  snapshotKind: "current" | "wednesday";
  requestedAt: number;
  apiTimestamp: number | null;
};

export type EnemyHitStatSnapshotRow = {
  war_id: number;
  faction_id: number;
  member_id: number;
  member_name: string;
  snapshot_date: string;
  snapshot_kind: "current" | "wednesday";
  requested_at: number;
  rankedwarhits: number | null;
  attackhits: number | null;
  temphits: number | null;
  piercinghits: number | null;
  slashinghits: number | null;
  clubbinghits: number | null;
  mechanicalhits: number | null;
  h2hhits: number | null;
  retals: number | null;
  specialammoused: number | null;
  rankedwarhits_timestamp: number | null;
  attackhits_timestamp: number | null;
  temphits_timestamp: number | null;
  piercinghits_timestamp: number | null;
  slashinghits_timestamp: number | null;
  clubbinghits_timestamp: number | null;
  mechanicalhits_timestamp: number | null;
  h2hhits_timestamp: number | null;
  retals_timestamp: number | null;
  specialammoused_timestamp: number | null;
  attempted_at: number | null;
  attempt_count: number;
  error: string | null;
  key_source: string | null;
  completed_at: number | null;
  created_at: number;
  updated_at: number;
};

export type EnemyHitStatsRefreshMetrics = {
  writeStatements: number;
  changedRows: number;
  candidates: number;
  updated: number;
  failed: number;
  rateLimited: number;
  activeKeys: number;
  skipped: boolean;
};

export type EnemyHitStatHealth = {
  total: number;
  completed: number;
  pending: number;
  failed: number;
  retryable: number;
};

export type EnemyHitStatTrend = {
  member_id: number;
  member_name: string;
  priority: "high" | "medium" | "low";
  snapshot_count: number;
  oldest_snapshot_date: string;
  latest_snapshot_date: string;
  weeks: number;
  rankedwarhits_per_week: number;
  retals_per_week: number;
  specialammoused_per_week: number;
  temphits_per_week: number;
  meleehits_per_week: number;
  gunhits_per_week: number;
  oldest_temphits: number;
  oldest_meleehits: number;
  oldest_gunhits: number;
  latest_temphits: number;
  latest_meleehits: number;
  latest_gunhits: number;
  snapshots: EnemyHitStatTrendSnapshot[];
};

export type EnemyHitStatTrendSnapshot = {
  snapshot_date: string;
  rankedwarhits: number | null;
  retals: number | null;
  specialammoused: number | null;
};

export function enemyHitStatSnapshotTargets(detectedAt: number): EnemyHitStatSnapshotTarget[] {
  const targets: EnemyHitStatSnapshotTarget[] = [
    {
      snapshotDate: utcDateKey(detectedAt),
      snapshotKind: "current",
      requestedAt: detectedAt,
      apiTimestamp: null,
    },
  ];
  let cursor = previousWednesdaySnapshotAt(detectedAt);

  for (let index = 0; index < 4; index += 1) {
    targets.push({
      snapshotDate: utcDateKey(cursor),
      snapshotKind: "wednesday",
      requestedAt: cursor,
      apiTimestamp: cursor,
    });
    cursor -= SECONDS_PER_WEEK;
  }

  return targets;
}

export async function seedEnemyHitStatSnapshots(
  env: Env,
  warId: number,
  factionId: number,
  members: EnemyHitStatMemberSeed[],
  detectedAt: number,
): Promise<{ writeStatements: number; changedRows: number; seededRows: number }> {
  const targets = enemyHitStatSnapshotTargets(detectedAt);
  const statements: D1PreparedStatement[] = [];

  for (const member of members) {
    for (const target of targets) {
      statements.push(env.DB.prepare(
        `
        INSERT INTO enemy_hit_stat_snapshots (
          war_id,
          faction_id,
          member_id,
          member_name,
          snapshot_date,
          snapshot_kind,
          requested_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())
        ON CONFLICT(war_id, faction_id, member_id, snapshot_date) DO UPDATE SET
          member_name = excluded.member_name,
          updated_at = unixepoch()
        `,
      ).bind(
        warId,
        factionId,
        member.member_id,
        member.name,
        target.snapshotDate,
        target.snapshotKind,
        target.requestedAt,
      ));
    }
  }

  if (statements.length === 0) {
    return { writeStatements: 0, changedRows: 0, seededRows: 0 };
  }

  const results = await env.DB.batch(statements);
  return {
    writeStatements: statements.length,
    changedRows: results.reduce((total: number, result: unknown) => total + d1Changes(result), 0),
    seededRows: statements.length,
  };
}

export async function refreshMissingEnemyHitStats(
  env: Env,
  options: {
    warId: number;
    enemyFactionId: number;
    completeLatchName: string;
    activeLatches?: Set<string>;
    limit?: number;
  },
): Promise<EnemyHitStatsRefreshMetrics> {
  const metrics = emptyEnemyHitStatsRefreshMetrics();
  if (options.activeLatches?.has(options.completeLatchName)) {
    return metrics;
  }

  const perKeyLimit = Math.max(
    1,
    Math.min(Math.floor(options.limit ?? ENEMY_HIT_STAT_PER_KEY_LIMIT), ENEMY_HIT_STAT_PER_KEY_LIMIT),
  );
  const now = nowSeconds();
  const activeKeys = await readAvailableEnemyNetworthKeys(env, now);
  metrics.activeKeys = activeKeys.length;
  metrics.skipped = false;

  if (activeKeys.length === 0) {
    if (!(await hasRetryableEnemyHitStatRows(env, options.warId, options.enemyFactionId))) {
      await markEnemyHitStatsComplete(env, options);
    }
    return { ...metrics, skipped: true };
  }

  const rows = await readRetryableEnemyHitStatRows(
    env,
    options.warId,
    options.enemyFactionId,
    enemyNetworthCandidateLimit(activeKeys.length, perKeyLimit),
  );
  metrics.candidates = rows.length;

  if (rows.length === 0) {
    await markEnemyHitStatsComplete(env, options);
    return metrics;
  }

  const batches = partitionEnemyNetworthCandidates(rows, activeKeys, perKeyLimit);
  const results = await Promise.all(
    batches.map((batch) => processEnemyHitStatBatch(env, batch.key, batch.rows)),
  );
  for (const result of results) {
    metrics.writeStatements += result.writeStatements;
    metrics.changedRows += result.changedRows;
    metrics.updated += result.updated;
    metrics.failed += result.failed;
    metrics.rateLimited += result.rateLimited;
  }

  if (!(await hasRetryableEnemyHitStatRows(env, options.warId, options.enemyFactionId))) {
    await markEnemyHitStatsComplete(env, options);
  }

  return metrics;
}

export async function readEnemyHitStatHealth(
  env: Env,
  warId: number,
  enemyFactionId: number,
): Promise<EnemyHitStatHealth> {
  const row = (await env.DB.prepare(
    `
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN completed_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS completed,
      COALESCE(SUM(CASE WHEN completed_at IS NULL THEN 1 ELSE 0 END), 0) AS pending,
      COALESCE(SUM(CASE WHEN completed_at IS NULL AND attempt_count >= ? THEN 1 ELSE 0 END), 0) AS failed,
      COALESCE(SUM(CASE WHEN completed_at IS NULL AND attempt_count < ? THEN 1 ELSE 0 END), 0) AS retryable
    FROM enemy_hit_stat_snapshots
    WHERE war_id = ?
      AND faction_id = ?
    `,
  )
    .bind(ENEMY_HIT_STAT_MAX_ATTEMPTS, ENEMY_HIT_STAT_MAX_ATTEMPTS, warId, enemyFactionId)
    .first()) as Record<string, number | null> | null;

  return {
    total: Number(row?.total ?? 0),
    completed: Number(row?.completed ?? 0),
    pending: Number(row?.pending ?? 0),
    failed: Number(row?.failed ?? 0),
    retryable: Number(row?.retryable ?? 0),
  };
}

export async function readEnemyHitStatTrends(
  env: Env,
  warId: number,
  enemyFactionId: number,
): Promise<EnemyHitStatTrend[]> {
  const rows = ((await env.DB.prepare(
    `
    SELECT *
    FROM enemy_hit_stat_snapshots
    WHERE war_id = ?
      AND faction_id = ?
      AND completed_at IS NOT NULL
    ORDER BY member_name ASC, requested_at ASC
    `,
  )
    .bind(warId, enemyFactionId)
    .all()).results ?? []) as EnemyHitStatSnapshotRow[];

  return buildEnemyHitStatTrends(rows);
}

export function buildEnemyHitStatTrends(
  rows: EnemyHitStatSnapshotRow[],
): EnemyHitStatTrend[] {
  const byMember = new Map<number, EnemyHitStatSnapshotRow[]>();
  for (const row of rows) {
    const group = byMember.get(row.member_id) ?? [];
    group.push(row);
    byMember.set(row.member_id, group);
  }

  const trends: EnemyHitStatTrend[] = [];
  for (const memberRows of byMember.values()) {
    const ordered = memberRows
      .filter((row) => row.requested_at !== null)
      .sort((a, b) => Number(a.requested_at) - Number(b.requested_at));
    if (ordered.length < 2) {
      continue;
    }

    const oldest = ordered[0];
    const latest = ordered[ordered.length - 1];
    const oldestMeleeHits = meleeHits(oldest);
    const latestMeleeHits = meleeHits(latest);
    const oldestGunHits = gunHits(oldest);
    const latestGunHits = gunHits(latest);
    const weeks = Math.max(1, (Number(latest.requested_at) - Number(oldest.requested_at)) / SECONDS_PER_WEEK);
    const trend = {
      member_id: latest.member_id,
      member_name: latest.member_name,
      priority: "low" as EnemyHitStatTrend["priority"],
      snapshot_count: ordered.length,
      oldest_snapshot_date: oldest.snapshot_date,
      latest_snapshot_date: latest.snapshot_date,
      weeks,
      rankedwarhits_per_week: weeklyDelta(latest.rankedwarhits, oldest.rankedwarhits, weeks),
      retals_per_week: weeklyDelta(latest.retals, oldest.retals, weeks),
      specialammoused_per_week: weeklyDelta(latest.specialammoused, oldest.specialammoused, weeks),
      temphits_per_week: weeklyDelta(latest.temphits, oldest.temphits, weeks),
      meleehits_per_week: weeklyDelta(latestMeleeHits, oldestMeleeHits, weeks),
      gunhits_per_week: weeklyDelta(latestGunHits, oldestGunHits, weeks),
      oldest_temphits: Number(oldest.temphits ?? 0),
      oldest_meleehits: oldestMeleeHits,
      oldest_gunhits: oldestGunHits,
      latest_temphits: Number(latest.temphits ?? 0),
      latest_meleehits: latestMeleeHits,
      latest_gunhits: latestGunHits,
      snapshots: ordered.map((row) => ({
        snapshot_date: row.snapshot_date,
        rankedwarhits: row.rankedwarhits,
        retals: row.retals,
        specialammoused: row.specialammoused,
      })),
    };
    trend.priority = hitStatWatchPriority(trend);
    trends.push(trend);
  }

  return trends.sort(compareEnemyHitStatTrends);
}

export function meleeHits(row: Pick<
  EnemyHitStatSnapshotRow,
  "piercinghits" | "slashinghits" | "clubbinghits" | "mechanicalhits" | "h2hhits"
>): number {
  return Number(row.piercinghits ?? 0) +
    Number(row.slashinghits ?? 0) +
    Number(row.clubbinghits ?? 0) +
    Number(row.mechanicalhits ?? 0) +
    Number(row.h2hhits ?? 0);
}

export function gunHits(row: Pick<
  EnemyHitStatSnapshotRow,
  "attackhits" | "temphits" | "piercinghits" | "slashinghits" | "clubbinghits" | "mechanicalhits" | "h2hhits"
>): number {
  return Math.max(0, Number(row.attackhits ?? 0) - (meleeHits(row) + Number(row.temphits ?? 0)));
}

function compareEnemyHitStatTrends(left: EnemyHitStatTrend, right: EnemyHitStatTrend): number {
  const priorityDiff = watchPriorityRank(right.priority) - watchPriorityRank(left.priority);
  if (priorityDiff !== 0) {
    return priorityDiff;
  }
  const rankedDiff = right.rankedwarhits_per_week - left.rankedwarhits_per_week;
  if (rankedDiff !== 0) {
    return rankedDiff;
  }
  const retalDiff = right.retals_per_week - left.retals_per_week;
  if (retalDiff !== 0) {
    return retalDiff;
  }
  return left.member_name.localeCompare(right.member_name);
}

function hitStatWatchPriority(trend: Pick<EnemyHitStatTrend, "rankedwarhits_per_week" | "retals_per_week">): EnemyHitStatTrend["priority"] {
  if (
    trend.rankedwarhits_per_week >= HIGH_RANKED_WAR_HITS_PER_WEEK ||
    trend.retals_per_week >= HIGH_RETALS_PER_WEEK
  ) {
    return "high";
  }
  if (
    trend.rankedwarhits_per_week >= MEDIUM_RANKED_WAR_HITS_PER_WEEK ||
    trend.retals_per_week >= MEDIUM_RETALS_PER_WEEK
  ) {
    return "medium";
  }
  return "low";
}

function watchPriorityRank(priority: EnemyHitStatTrend["priority"]): number {
  if (priority === "high") {
    return 3;
  }
  if (priority === "medium") {
    return 2;
  }
  return 1;
}

function weeklyDelta(latest: number | null, oldest: number | null, weeks: number): number {
  return Math.max(0, (Number(latest ?? 0) - Number(oldest ?? 0)) / weeks);
}

async function readRetryableEnemyHitStatRows(
  env: Env,
  warId: number,
  enemyFactionId: number,
  limit: number,
): Promise<EnemyHitStatSnapshotRow[]> {
  return ((await env.DB.prepare(
    `
    SELECT *
    FROM enemy_hit_stat_snapshots
    WHERE war_id = ?
      AND faction_id = ?
      AND completed_at IS NULL
      AND attempt_count < ?
    ORDER BY COALESCE(attempted_at, 0) ASC, snapshot_kind DESC, requested_at DESC, member_name ASC
    LIMIT ?
    `,
  )
    .bind(warId, enemyFactionId, ENEMY_HIT_STAT_MAX_ATTEMPTS, limit)
    .all()).results ?? []) as EnemyHitStatSnapshotRow[];
}

async function hasRetryableEnemyHitStatRows(
  env: Env,
  warId: number,
  enemyFactionId: number,
): Promise<boolean> {
  const row = await env.DB.prepare(
    `
    SELECT 1
    FROM enemy_hit_stat_snapshots
    WHERE war_id = ?
      AND faction_id = ?
      AND completed_at IS NULL
      AND attempt_count < ?
    LIMIT 1
    `,
  )
    .bind(warId, enemyFactionId, ENEMY_HIT_STAT_MAX_ATTEMPTS)
    .first();

  return row !== null;
}

async function processEnemyHitStatBatch(
  env: Env,
  key: TornApiKey,
  rows: EnemyHitStatSnapshotRow[],
): Promise<Pick<EnemyHitStatsRefreshMetrics, "writeStatements" | "changedRows" | "updated" | "failed" | "rateLimited">> {
  const metrics = {
    writeStatements: 0,
    changedRows: 0,
    updated: 0,
    failed: 0,
    rateLimited: 0,
  };

  for (const row of rows) {
    try {
      const stats = await fetchTornPersonalStatsWithTimestamps(env, row.member_id, ENEMY_HIT_STAT_KEYS, {
        timestamp: row.snapshot_kind === "wednesday" ? row.requested_at : undefined,
        apiKey: key.key,
        keySource: key.keySource,
      });
      await recordTornKeyUse(env, key, "enemy_scouting");
      const result = await updateEnemyHitStatSnapshot(env, row, stats, key.keySource);
      const changes = d1Changes(result);
      metrics.writeStatements += 1;
      metrics.changedRows += changes;
      metrics.updated += changes;
    } catch (err: any) {
      if (err instanceof TornPersonalStatsHttpError && err.status === 429) {
        await pauseEnemyNetworthKey(env, key.keySource, nowSeconds());
        await markEnemyHitStatRateLimited(env, row, key.keySource, err.message);
        metrics.writeStatements += 2;
        metrics.rateLimited += 1;
        break;
      }

      const result = await env.DB.prepare(
        `
        UPDATE enemy_hit_stat_snapshots
        SET attempted_at = unixepoch(),
            attempt_count = attempt_count + 1,
            error = ?,
            key_source = ?,
            updated_at = unixepoch()
        WHERE war_id = ?
          AND faction_id = ?
          AND member_id = ?
          AND snapshot_date = ?
          AND completed_at IS NULL
        `,
      )
        .bind(storedHitStatError(err), key.keySource, row.war_id, row.faction_id, row.member_id, row.snapshot_date)
        .run();
      const changes = d1Changes(result);
      metrics.writeStatements += 1;
      metrics.changedRows += changes;
      metrics.failed += changes;
    }
  }

  return metrics;
}

function updateEnemyHitStatSnapshot(
  env: Env,
  row: EnemyHitStatSnapshotRow,
  stats: TornPersonalStatsResponse,
  keySource: string,
): Promise<D1Result> {
  return env.DB.prepare(
    `
    UPDATE enemy_hit_stat_snapshots
    SET rankedwarhits = ?,
        attackhits = ?,
        temphits = ?,
        piercinghits = ?,
        slashinghits = ?,
        clubbinghits = ?,
        mechanicalhits = ?,
        h2hhits = ?,
        retals = ?,
        specialammoused = ?,
        rankedwarhits_timestamp = ?,
        attackhits_timestamp = ?,
        temphits_timestamp = ?,
        piercinghits_timestamp = ?,
        slashinghits_timestamp = ?,
        clubbinghits_timestamp = ?,
        mechanicalhits_timestamp = ?,
        h2hhits_timestamp = ?,
        retals_timestamp = ?,
        specialammoused_timestamp = ?,
        attempted_at = unixepoch(),
        error = NULL,
        key_source = ?,
        completed_at = unixepoch(),
        updated_at = unixepoch()
    WHERE war_id = ?
      AND faction_id = ?
      AND member_id = ?
      AND snapshot_date = ?
      AND completed_at IS NULL
    `,
  )
    .bind(
      statValue(stats, "rankedwarhits"),
      statValue(stats, "attackhits"),
      statValue(stats, "temphits"),
      statValue(stats, "piercinghits"),
      statValue(stats, "slashinghits"),
      statValue(stats, "clubbinghits"),
      statValue(stats, "mechanicalhits"),
      statValue(stats, "h2hhits"),
      statValue(stats, "retals"),
      statValue(stats, "specialammoused"),
      statTimestamp(stats, "rankedwarhits"),
      statTimestamp(stats, "attackhits"),
      statTimestamp(stats, "temphits"),
      statTimestamp(stats, "piercinghits"),
      statTimestamp(stats, "slashinghits"),
      statTimestamp(stats, "clubbinghits"),
      statTimestamp(stats, "mechanicalhits"),
      statTimestamp(stats, "h2hhits"),
      statTimestamp(stats, "retals"),
      statTimestamp(stats, "specialammoused"),
      keySource,
      row.war_id,
      row.faction_id,
      row.member_id,
      row.snapshot_date,
    )
    .run();
}

async function markEnemyHitStatRateLimited(
  env: Env,
  row: EnemyHitStatSnapshotRow,
  keySource: string,
  error: string,
): Promise<void> {
  await env.DB.prepare(
    `
    UPDATE enemy_hit_stat_snapshots
    SET attempted_at = unixepoch(),
        error = ?,
        key_source = ?,
        updated_at = unixepoch()
    WHERE war_id = ?
      AND faction_id = ?
      AND member_id = ?
      AND snapshot_date = ?
      AND completed_at IS NULL
    `,
  )
    .bind(storedHitStatError(error), keySource, row.war_id, row.faction_id, row.member_id, row.snapshot_date)
    .run();
}

async function markEnemyHitStatsComplete(
  env: Env,
  options: {
    completeLatchName: string;
    activeLatches?: Set<string>;
  },
): Promise<void> {
  await setSyncLatch(env, options.completeLatchName, nowSeconds());
  options.activeLatches?.add(options.completeLatchName);
}

function statValue(stats: TornPersonalStatsResponse, key: EnemyHitStatKey): number | null {
  return finiteNumber(stats[key]?.value);
}

function statTimestamp(stats: TornPersonalStatsResponse, key: EnemyHitStatKey): number | null {
  return finiteNumber(stats[key]?.timestamp);
}

function previousWednesdaySnapshotAt(detectedAt: number): number {
  const detected = new Date(detectedAt * 1000);
  const midnight = Date.UTC(
    detected.getUTCFullYear(),
    detected.getUTCMonth(),
    detected.getUTCDate(),
    0,
    WEDNESDAY_SNAPSHOT_MINUTES,
    0,
  ) / 1000;
  const daysSinceWednesday = (detected.getUTCDay() - WEDNESDAY_UTC_DAY + 7) % 7;
  if (daysSinceWednesday === 0) {
    return midnight - SECONDS_PER_WEEK;
  }
  const candidate = midnight - daysSinceWednesday * SECONDS_PER_DAY;
  return candidate < detectedAt ? candidate : candidate - SECONDS_PER_WEEK;
}

function utcDateKey(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

function storedHitStatError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.length > MAX_STORED_HIT_STAT_ERROR_LENGTH
    ? `${message.slice(0, MAX_STORED_HIT_STAT_ERROR_LENGTH - 3)}...`
    : message;
}

export function emptyEnemyHitStatsRefreshMetrics(): EnemyHitStatsRefreshMetrics {
  return {
    writeStatements: 0,
    changedRows: 0,
    candidates: 0,
    updated: 0,
    failed: 0,
    rateLimited: 0,
    activeKeys: 0,
    skipped: true,
  };
}
