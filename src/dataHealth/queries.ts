import { HOME_FACTION_ID } from "../constants";
import {
  DAILY_GYM_COMPLETE_STATE_NAME,
  DAILY_REFRESH_AFTER_UTC_HOUR,
  DAILY_REFRESH_AFTER_UTC_MINUTE,
  GYM_CONTRIBUTOR_STAT_KEYS,
  type GymContributorStatKey,
} from "../lifestyleStats/model";
import type { Env } from "../types";
import {
  DEFAULT_DATA_HEALTH_SETTINGS,
  SETTINGS_ID,
  type ApiUsageFeatureRow,
  type ApiUsageHealthRow,
  type ApiUsageKeyRow,
  type ApiUsageRecentErrorRow,
  type DataHealthSettings,
  type EnemyScoutingCoverageRow,
  type EnemyScoutingGapRow,
  type GymStatsHealthRow,
  type IngestionRunRow,
  type KeyPoolCountRow,
  type MaintenanceRunRow,
  type MaintenanceTaskRow,
  type PersonalStatsCoverageGapRow,
  type PersonalStatsCoverageRow,
  type RosterHealthRow,
  type StockCoverageRow,
  type StockRunRow,
  type WarReportHealthRow,
} from "./model";

export async function readDataHealthSettings(env: Env): Promise<DataHealthSettings> {
  const row = await env.DB.prepare(
    `
    SELECT *
    FROM data_health_settings
    WHERE id = ?
    LIMIT 1
    `,
  ).bind(SETTINGS_ID).first<Partial<DataHealthSettings>>();

  if (!row) {
    await saveDataHealthSettings(env, DEFAULT_DATA_HEALTH_SETTINGS);
    return DEFAULT_DATA_HEALTH_SETTINGS;
  }

  return settingsFromRow(row);
}

export async function saveDataHealthSettings(env: Env, settings: DataHealthSettings): Promise<void> {
  await env.DB.prepare(
    `
    INSERT INTO data_health_settings (
      id,
      ingestion_warn_seconds,
      ingestion_critical_seconds,
      maintenance_warn_seconds,
      maintenance_critical_seconds,
      daily_stats_lag_warn_days,
      daily_stats_lag_critical_days,
      stale_daily_members_warn,
      stale_daily_members_critical,
      api_error_rate_warn_percent,
      api_error_rate_critical_percent,
      api_rate_limited_warn,
      api_rate_limited_critical,
      stock_freshness_warn_seconds,
      stock_freshness_critical_seconds,
      stale_stocks_warn,
      stale_stocks_critical,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
    ON CONFLICT(id) DO UPDATE SET
      ingestion_warn_seconds = excluded.ingestion_warn_seconds,
      ingestion_critical_seconds = excluded.ingestion_critical_seconds,
      maintenance_warn_seconds = excluded.maintenance_warn_seconds,
      maintenance_critical_seconds = excluded.maintenance_critical_seconds,
      daily_stats_lag_warn_days = excluded.daily_stats_lag_warn_days,
      daily_stats_lag_critical_days = excluded.daily_stats_lag_critical_days,
      stale_daily_members_warn = excluded.stale_daily_members_warn,
      stale_daily_members_critical = excluded.stale_daily_members_critical,
      api_error_rate_warn_percent = excluded.api_error_rate_warn_percent,
      api_error_rate_critical_percent = excluded.api_error_rate_critical_percent,
      api_rate_limited_warn = excluded.api_rate_limited_warn,
      api_rate_limited_critical = excluded.api_rate_limited_critical,
      stock_freshness_warn_seconds = excluded.stock_freshness_warn_seconds,
      stock_freshness_critical_seconds = excluded.stock_freshness_critical_seconds,
      stale_stocks_warn = excluded.stale_stocks_warn,
      stale_stocks_critical = excluded.stale_stocks_critical,
      updated_at = excluded.updated_at
    `,
  ).bind(
    SETTINGS_ID,
    settings.ingestion_warn_seconds,
    settings.ingestion_critical_seconds,
    settings.maintenance_warn_seconds,
    settings.maintenance_critical_seconds,
    settings.daily_stats_lag_warn_days,
    settings.daily_stats_lag_critical_days,
    settings.stale_daily_members_warn,
    settings.stale_daily_members_critical,
    settings.api_error_rate_warn_percent,
    settings.api_error_rate_critical_percent,
    settings.api_rate_limited_warn,
    settings.api_rate_limited_critical,
    settings.stock_freshness_warn_seconds,
    settings.stock_freshness_critical_seconds,
    settings.stale_stocks_warn,
    settings.stale_stocks_critical,
  ).run();
}

export function normalizeSettingsPatch(
  body: Record<string, unknown>,
  current: DataHealthSettings,
): { settings: DataHealthSettings } | { error: string } {
  const settings = { ...current };
  for (const key of Object.keys(DEFAULT_DATA_HEALTH_SETTINGS) as Array<keyof DataHealthSettings>) {
    if (body[key] === undefined) continue;
    const value = Number(body[key]);
    if (!Number.isFinite(value) || value < 0) {
      return { error: `${key} must be a non-negative number` };
    }
    settings[key] = Number.isInteger(DEFAULT_DATA_HEALTH_SETTINGS[key]) ? Math.floor(value) : value;
  }

  const thresholdPairs: Array<[keyof DataHealthSettings, keyof DataHealthSettings, string]> = [
    ["ingestion_warn_seconds", "ingestion_critical_seconds", "ingestion"],
    ["maintenance_warn_seconds", "maintenance_critical_seconds", "maintenance"],
    ["daily_stats_lag_warn_days", "daily_stats_lag_critical_days", "daily stats lag"],
    ["stale_daily_members_warn", "stale_daily_members_critical", "stale daily members"],
    ["api_error_rate_warn_percent", "api_error_rate_critical_percent", "API error rate"],
    ["api_rate_limited_warn", "api_rate_limited_critical", "API rate limits"],
    ["stock_freshness_warn_seconds", "stock_freshness_critical_seconds", "stock freshness"],
    ["stale_stocks_warn", "stale_stocks_critical", "stale stocks"],
  ];
  for (const [warnKey, criticalKey, label] of thresholdPairs) {
    if (settings[warnKey] > settings[criticalKey]) {
      return { error: `${label} warning threshold must be less than or equal to critical threshold` };
    }
  }

  return { settings };
}

export async function readLatestIngestionRun(env: Env): Promise<IngestionRunRow | null> {
  return env.DB.prepare(
    `
    SELECT *
    FROM ingestion_runs
    ORDER BY started_at DESC
    LIMIT 1
    `,
  ).first<IngestionRunRow>();
}

export async function readLatestAttackStarted(env: Env): Promise<number | null> {
  const row = await env.DB.prepare(
    `
    SELECT MAX(started) AS latest_attack_started
    FROM attacks
    `,
  ).first<{ latest_attack_started: number | null }>();
  return nullableNumber(row?.latest_attack_started);
}

export async function readLatestMaintenance(env: Env): Promise<{ run: MaintenanceRunRow | null; tasks: MaintenanceTaskRow[] }> {
  const run = await env.DB.prepare(
    `
    SELECT *
    FROM scheduled_maintenance_runs
    ORDER BY started_at DESC
    LIMIT 1
    `,
  ).first<MaintenanceRunRow>();
  if (!run) return { run: null, tasks: [] };

  const tasks = await env.DB.prepare(
    `
    SELECT *
    FROM scheduled_maintenance_tasks
    WHERE run_id = ?
    ORDER BY started_at ASC, task_name ASC
    `,
  ).bind(run.id).all<MaintenanceTaskRow>();
  return { run, tasks: tasks.results ?? [] };
}

export async function readRosterHealth(env: Env): Promise<RosterHealthRow> {
  const row = await env.DB.prepare(
    `
    SELECT
      COUNT(CASE WHEN is_current = 1 THEN 1 END) AS current_members,
      COUNT(CASE WHEN is_current = 1 AND name IS NOT NULL AND level IS NOT NULL AND position IS NOT NULL THEN 1 END) AS profile_members,
      COUNT(CASE WHEN is_current = 1 AND report_exempt = 0 THEN 1 END) AS reportable_members,
      COUNT(CASE WHEN is_current = 1 AND report_exempt = 1 THEN 1 END) AS report_exempt_members,
      COUNT(CASE WHEN is_current = 1 AND live.is_revivable = 1 THEN 1 END) AS revivable_members,
      COUNT(CASE WHEN is_current = 1 AND (ff_battlestats IS NOT NULL OR bsp_battlestats IS NOT NULL) THEN 1 END) AS stat_estimates,
      COUNT(CASE WHEN is_current = 1 AND networth IS NOT NULL THEN 1 END) AS networth_estimates,
      MAX(members.updated_at) AS updated_at
    FROM home_faction_members members
    LEFT JOIN home_member_live_status live
      ON live.member_id = members.member_id
     AND live.faction_id = members.faction_id
    WHERE members.faction_id = ?
    `,
  ).bind(HOME_FACTION_ID).first<Partial<RosterHealthRow>>();

  return {
    current_members: Number(row?.current_members ?? 0),
    profile_members: Number(row?.profile_members ?? 0),
    reportable_members: Number(row?.reportable_members ?? 0),
    report_exempt_members: Number(row?.report_exempt_members ?? 0),
    revivable_members: Number(row?.revivable_members ?? 0),
    stat_estimates: Number(row?.stat_estimates ?? 0),
    networth_estimates: Number(row?.networth_estimates ?? 0),
    updated_at: nullableNumber(row?.updated_at),
  };
}

export async function readPersonalStatsCoverage(env: Env, targetDate: string | null): Promise<PersonalStatsCoverageRow[]> {
  const dates = recentPersonalStatsCoverageDates(targetDate);
  if (dates.length !== 2) return [];

  const rows = await env.DB.prepare(
    `
    WITH target_dates(snapshot_date) AS (
      SELECT ? UNION ALL SELECT ?
    )
    SELECT
      target_dates.snapshot_date,
      COUNT(snapshots.member_id) AS ready_members,
      COUNT(members.member_id) AS total_members
    FROM target_dates
    LEFT JOIN home_faction_members members
      ON members.faction_id = ?
     AND members.is_current = 1
     AND members.report_exempt = 0
    LEFT JOIN member_lifestyle_stat_snapshots snapshots
      ON snapshots.member_id = members.member_id
     AND snapshots.snapshot_date = target_dates.snapshot_date
     AND snapshots.personal_ready = 1
    GROUP BY target_dates.snapshot_date
    ORDER BY target_dates.snapshot_date ASC
    `,
  ).bind(dates[0], dates[1], HOME_FACTION_ID).all<PersonalStatsCoverageRow>();

  return (rows.results ?? []).map((row) => ({
    snapshot_date: row.snapshot_date,
    ready_members: Number(row.ready_members ?? 0),
    total_members: Number(row.total_members ?? 0),
  }));
}

export async function readPersonalStatsCoverageGaps(
  env: Env,
  targetDate: string | null,
): Promise<PersonalStatsCoverageGapRow[]> {
  const dates = recentPersonalStatsCoverageDates(targetDate);
  if (dates.length !== 2) return [];

  const rows = await env.DB.prepare(
    `
    WITH target_dates(snapshot_date) AS (
      SELECT ? UNION ALL SELECT ?
    ),
    reportable_members AS (
      SELECT member_id, name
      FROM home_faction_members
      WHERE faction_id = ?
        AND is_current = 1
        AND report_exempt = 0
    )
    SELECT
      target_dates.snapshot_date,
      members.member_id,
      members.name AS member_name,
      (
        SELECT MAX(existing.snapshot_date)
        FROM member_lifestyle_stat_snapshots existing
        WHERE existing.member_id = members.member_id
          AND existing.personal_ready = 1
      ) AS latest_personal_ready_date,
      recent.snapshot_date AS recent_snapshot_date,
      recent.status AS recent_status,
      recent.error AS recent_error,
      recent.updated_at AS recent_updated_at
    FROM target_dates
    JOIN reportable_members members
    LEFT JOIN member_lifestyle_stat_snapshots snapshots
      ON snapshots.member_id = members.member_id
     AND snapshots.snapshot_date = target_dates.snapshot_date
     AND snapshots.personal_ready = 1
    LEFT JOIN member_personal_stats_recent recent
      ON recent.member_id = members.member_id
     AND recent.snapshot_date = target_dates.snapshot_date
    WHERE snapshots.member_id IS NULL
    ORDER BY target_dates.snapshot_date ASC, members.name ASC
    LIMIT 25
    `,
  ).bind(dates[0], dates[1], HOME_FACTION_ID).all<PersonalStatsCoverageGapRow>();

  return (rows.results ?? []).map((row) => ({
    snapshot_date: row.snapshot_date,
    member_id: Number(row.member_id),
    member_name: row.member_name ?? null,
    latest_personal_ready_date: row.latest_personal_ready_date ?? null,
    recent_snapshot_date: row.recent_snapshot_date ?? null,
    recent_status: row.recent_status ?? null,
    recent_error: row.recent_error ?? null,
    recent_updated_at: nullableNumber(row.recent_updated_at),
  }));
}

export async function readGymStatsHealth(env: Env, targetDate: string | null, now: number): Promise<GymStatsHealthRow> {
  const latestRow = await env.DB.prepare(
    `
    SELECT snapshots.snapshot_date AS snapshot_date
    FROM member_lifestyle_stat_snapshots snapshots
    JOIN home_faction_members members
      ON members.member_id = snapshots.member_id
     AND members.faction_id = ?
     AND members.is_current = 1
     AND members.report_exempt = 0
    WHERE snapshots.gym_ready = 1
    ORDER BY snapshots.snapshot_date DESC
    LIMIT 1
    `,
  ).bind(HOME_FACTION_ID).first<{ snapshot_date: string | null }>();
  const latestGymSnapshotDate = latestRow?.snapshot_date ?? null;
  const targetRefreshAt = dailyGymRefreshReadyAt(now);
  const streamStates = targetRefreshAt === null
    ? { completedGymStats: [...GYM_CONTRIBUTOR_STAT_KEYS], missingGymStats: [] as GymContributorStatKey[] }
    : await readGymStatStreamHealth(env, targetRefreshAt);

  const staleRow = targetDate
    ? await env.DB.prepare(
      `
      SELECT COUNT(CASE WHEN snapshots.member_id IS NULL THEN 1 END) AS stale_gym_members
      FROM home_faction_members members
      LEFT JOIN member_lifestyle_stat_snapshots snapshots
        ON snapshots.member_id = members.member_id
       AND snapshots.snapshot_date = ?
       AND snapshots.gym_ready = 1
      WHERE members.faction_id = ?
        AND members.is_current = 1
        AND members.report_exempt = 0
      `,
    ).bind(targetDate, HOME_FACTION_ID).first<{ stale_gym_members: number | null }>()
    : null;

  return {
    target_date: targetDate,
    target_refresh_at: targetRefreshAt,
    latest_gym_snapshot_date: latestGymSnapshotDate,
    gym_lag_days: targetDate && latestGymSnapshotDate ? calendarDateDiffDays(latestGymSnapshotDate, targetDate) : null,
    completed_gym_stats: streamStates.completedGymStats,
    missing_gym_stats: streamStates.missingGymStats,
    stale_gym_members: Number(staleRow?.stale_gym_members ?? 0),
  };
}

export async function readApiUsageHealth(env: Env, now: number, windowSeconds: number): Promise<ApiUsageHealthRow> {
  const row = await env.DB.prepare(
    `
    SELECT
      COUNT(*) AS requests,
      SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS errors,
      SUM(CASE WHEN status = 429 THEN 1 ELSE 0 END) AS rate_limited,
      AVG(duration_ms) AS avg_duration_ms,
      MAX(duration_ms) AS max_duration_ms
    FROM torn_api_call_log
    WHERE requested_at >= ?
    `,
  ).bind(now - windowSeconds).first<ApiUsageHealthRow>();
  const requests = Number(row?.requests ?? 0);
  return {
    window_seconds: windowSeconds,
    requests,
    errors: Number(row?.errors ?? 0),
    rate_limited: Number(row?.rate_limited ?? 0),
    avg_duration_ms: nullableNumber(row?.avg_duration_ms),
    max_duration_ms: nullableNumber(row?.max_duration_ms),
    requests_per_minute: Number((requests / Math.max(1, windowSeconds / 60)).toFixed(2)),
  };
}

export async function readApiUsageHealthRollup(env: Env, now: number, windowSeconds: number): Promise<ApiUsageHealthRow> {
  const row = await env.DB.prepare(
    `
    SELECT
      SUM(requests) AS requests,
      SUM(errors) AS errors,
      SUM(rate_limited) AS rate_limited,
      CASE
        WHEN SUM(requests) > 0 THEN SUM(total_duration_ms) * 1.0 / SUM(requests)
        ELSE NULL
      END AS avg_duration_ms,
      MAX(max_duration_ms) AS max_duration_ms
    FROM torn_api_usage_rollup_15m
    WHERE group_type = 'feature'
      AND bucket_start >= ?
    `,
  ).bind(rollupWindowStart(now, windowSeconds)).first<ApiUsageHealthRow>();
  const requests = Number(row?.requests ?? 0);
  return {
    window_seconds: windowSeconds,
    requests,
    errors: Number(row?.errors ?? 0),
    rate_limited: Number(row?.rate_limited ?? 0),
    avg_duration_ms: nullableNumber(row?.avg_duration_ms),
    max_duration_ms: nullableNumber(row?.max_duration_ms),
    requests_per_minute: Number((requests / Math.max(1, windowSeconds / 60)).toFixed(2)),
  };
}

export async function readApiUsageFeatures(
  env: Env,
  now: number,
  groupBy: "feature" | "endpoint",
  windowSeconds: number,
): Promise<ApiUsageFeatureRow[]> {
  const rows = await env.DB.prepare(
    `
    SELECT
      group_value AS feature,
      SUM(requests) AS requests,
      SUM(errors) AS errors,
      SUM(rate_limited) AS rate_limited,
      CASE
        WHEN SUM(requests) > 0 THEN SUM(total_duration_ms) * 1.0 / SUM(requests)
        ELSE NULL
      END AS avg_duration_ms,
      MAX(last_requested_at) AS last_requested_at
    FROM torn_api_usage_rollup_15m
    WHERE bucket_start >= ?
      AND group_type = ?
    GROUP BY group_value
    ORDER BY errors DESC, rate_limited DESC, requests DESC, group_value ASC
    LIMIT 12
    `,
  ).bind(rollupWindowStart(now, windowSeconds), groupBy).all<ApiUsageFeatureRow>();
  return (rows.results ?? []).map((row) => ({
    feature: row.feature,
    requests: Number(row.requests ?? 0),
    errors: Number(row.errors ?? 0),
    rate_limited: Number(row.rate_limited ?? 0),
    avg_duration_ms: nullableNumber(row.avg_duration_ms),
    last_requested_at: nullableNumber(row.last_requested_at),
  }));
}

export async function readApiUsageKeys(env: Env, now: number, windowSeconds: number): Promise<ApiUsageKeyRow[]> {
  const rows = await env.DB.prepare(
    `
    WITH key_usage AS (
      SELECT
        group_value AS key_source,
        SUM(requests) AS requests,
        SUM(errors) AS errors,
        SUM(rate_limited) AS rate_limited,
        CASE
          WHEN SUM(requests) > 0 THEN SUM(total_duration_ms) * 1.0 / SUM(requests)
          ELSE NULL
        END AS avg_duration_ms,
        MAX(last_requested_at) AS last_requested_at
      FROM torn_api_usage_rollup_15m
      WHERE bucket_start >= ?
        AND group_type = 'key_source'
        AND group_value <> 'member_supplied:auth'
      GROUP BY group_value
    )
    SELECT
      key_usage.key_source,
      COALESCE(
        NULLIF(keys.label, ''),
        NULLIF(keys.owner_name, ''),
        CASE
          WHEN keys.owner_torn_user_id IS NOT NULL THEN 'Torn user #' || keys.owner_torn_user_id
          ELSE NULL
        END
      ) AS key_label,
      key_usage.requests,
      key_usage.errors,
      key_usage.rate_limited,
      key_usage.avg_duration_ms,
      key_usage.last_requested_at
    FROM key_usage
    LEFT JOIN torn_api_keys keys
      ON key_usage.key_source LIKE 'key_pool:%'
      AND keys.id = substr(key_usage.key_source, 10)
    ORDER BY key_usage.requests DESC, key_usage.key_source ASC
    LIMIT 12
    `,
  ).bind(rollupWindowStart(now, windowSeconds)).all<ApiUsageKeyRow>();
  const minutes = Math.max(1, windowSeconds / 60);
  return (rows.results ?? []).map((row) => ({
    ...row,
    key_label: typeof row.key_label === "string" && row.key_label.trim() ? row.key_label.trim() : null,
    requests: Number(row.requests ?? 0),
    errors: Number(row.errors ?? 0),
    rate_limited: Number(row.rate_limited ?? 0),
    avg_duration_ms: nullableNumber(row.avg_duration_ms),
    calls_per_minute: Number(row.requests ?? 0) / minutes,
  }));
}

export async function readKeyPoolCounts(env: Env): Promise<KeyPoolCountRow> {
  const row = await env.DB.prepare(
    `
    SELECT
      COUNT(*) AS saved_keys,
      SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_saved_keys
    FROM torn_api_keys
    `,
  ).first<KeyPoolCountRow>();

  return {
    saved_keys: Number(row?.saved_keys ?? 0),
    active_saved_keys: Number(row?.active_saved_keys ?? 0),
  };
}

export async function readRecentApiErrors(env: Env): Promise<ApiUsageRecentErrorRow[]> {
  const rows = await env.DB.prepare(
    `
    SELECT
      calls.*,
      COALESCE(
        NULLIF(keys.label, ''),
        NULLIF(keys.owner_name, ''),
        CASE
          WHEN keys.owner_torn_user_id IS NOT NULL THEN 'Torn user #' || keys.owner_torn_user_id
          ELSE NULL
        END
      ) AS key_label
    FROM torn_api_call_log calls
    LEFT JOIN torn_api_keys keys
      ON calls.key_source LIKE 'key_pool:%'
      AND keys.id = substr(calls.key_source, 10)
    WHERE calls.ok = 0
      OR calls.status >= 400
    ORDER BY calls.requested_at DESC, calls.id DESC
    LIMIT 12
    `,
  ).all<ApiUsageRecentErrorRow>();
  return rows.results ?? [];
}

function rollupWindowStart(now: number, windowSeconds: number): number {
  const bucketSeconds = 15 * 60;
  const start = Math.max(0, now - windowSeconds);
  return start - (start % bucketSeconds);
}

export async function readLatestStockRun(env: Env): Promise<StockRunRow | null> {
  return env.DB.prepare(
    `
    SELECT *
    FROM stock_ingestion_runs
    ORDER BY started_at DESC
    LIMIT 1
    `,
  ).first<StockRunRow>();
}

export async function readStockCoverage(env: Env, now: number, settings: DataHealthSettings): Promise<StockCoverageRow> {
  const row = await env.DB.prepare(
    `
    WITH latest AS (
      SELECT
        p.stock_id,
        (
          SELECT observed_at
          FROM stock_price_snapshots
          WHERE stock_id = p.stock_id
          ORDER BY observed_at DESC
          LIMIT 1
        ) AS latest_observed_at
      FROM stock_profiles p
    )
    SELECT
      COUNT(*) AS total_stocks,
      COUNT(latest_observed_at) AS stocks_with_snapshots,
      MIN(latest_observed_at) AS oldest_snapshot_at,
      MAX(latest_observed_at) AS newest_snapshot_at,
      SUM(CASE WHEN latest_observed_at IS NULL OR latest_observed_at < ? THEN 1 ELSE 0 END) AS stale_stocks
    FROM latest
    `,
  ).bind(now - settings.stock_freshness_warn_seconds).first<StockCoverageRow>();

  return {
    total_stocks: Number(row?.total_stocks ?? 0),
    stocks_with_snapshots: Number(row?.stocks_with_snapshots ?? 0),
    oldest_snapshot_at: nullableNumber(row?.oldest_snapshot_at),
    newest_snapshot_at: nullableNumber(row?.newest_snapshot_at),
    stale_stocks: Number(row?.stale_stocks ?? 0),
  };
}

export async function readStockLastError(env: Env): Promise<string | null> {
  const row = await env.DB.prepare(
    `
    SELECT error
    FROM stock_ingestion_runs
    WHERE error IS NOT NULL
    ORDER BY started_at DESC
    LIMIT 1
    `,
  ).first<{ error: string | null }>();
  return row?.error ?? null;
}

export async function readWarReportHealth(env: Env): Promise<WarReportHealthRow> {
  const row = await env.DB.prepare(
    `
    SELECT
      COUNT(*) AS missing_reports,
      MIN(COALESCE(official_end_time, practical_finish_time)) AS oldest_missing_finished_at
    FROM wars
    WHERE status = 'ended'
      AND war_type IN ('real', 'termed')
      AND torn_war_id IS NOT NULL
      AND torn_report_fetched_at IS NULL
    `,
  ).first<WarReportHealthRow>();
  return {
    missing_reports: Number(row?.missing_reports ?? 0),
    oldest_missing_finished_at: nullableNumber(row?.oldest_missing_finished_at),
  };
}

export async function readEnemyScoutingCoverage(env: Env): Promise<EnemyScoutingCoverageRow[]> {
  const rows = await env.DB.prepare(
    `
    WITH tracked_factions AS (
      SELECT
        enemy_faction_id AS faction_id,
        GROUP_CONCAT(name, ', ') AS war_names,
        MAX(enemy_scouting_status_checked_at) AS status_checked_at
      FROM wars
      WHERE enemy_faction_id IS NOT NULL
        AND status IN ('active', 'scheduled')
      GROUP BY enemy_faction_id
    )
    SELECT
      tf.faction_id,
      tf.war_names,
      COUNT(m.member_id) AS total_members,
      SUM(CASE WHEN m.ff_battlestats IS NOT NULL THEN 1 ELSE 0 END) AS ff_stats_available,
      SUM(CASE WHEN m.bsp_battlestats IS NOT NULL THEN 1 ELSE 0 END) AS bsp_stats_available,
      SUM(CASE WHEN m.networth IS NOT NULL THEN 1 ELSE 0 END) AS networth_available,
      SUM(CASE WHEN m.networth IS NULL AND COALESCE(m.networth_attempt_count, 0) = 0 THEN 1 ELSE 0 END) AS networth_pending,
      SUM(CASE WHEN m.networth IS NULL AND COALESCE(m.networth_attempt_count, 0) >= 3 THEN 1 ELSE 0 END) AS networth_failed,
      SUM(CASE WHEN m.networth IS NULL AND COALESCE(m.networth_attempt_count, 0) BETWEEN 1 AND 2 THEN 1 ELSE 0 END) AS networth_retryable,
      tf.status_checked_at,
      MAX(m.updated_at) AS updated_at
    FROM tracked_factions tf
    LEFT JOIN enemy_faction_members m ON m.faction_id = tf.faction_id
    GROUP BY tf.faction_id, tf.war_names, tf.status_checked_at
    ORDER BY tf.status_checked_at DESC, tf.faction_id ASC
    LIMIT 10
    `,
  ).all<Partial<EnemyScoutingCoverageRow>>();

  return (rows.results ?? []).map((row) => ({
    faction_id: Number(row.faction_id ?? 0),
    war_names: row.war_names ?? null,
    total_members: Number(row.total_members ?? 0),
    ff_stats_available: Number(row.ff_stats_available ?? 0),
    bsp_stats_available: Number(row.bsp_stats_available ?? 0),
    networth_available: Number(row.networth_available ?? 0),
    networth_pending: Number(row.networth_pending ?? 0),
    networth_failed: Number(row.networth_failed ?? 0),
    networth_retryable: Number(row.networth_retryable ?? 0),
    status_checked_at: nullableNumber(row.status_checked_at),
    updated_at: nullableNumber(row.updated_at),
  }));
}

export async function readEnemyScoutingGaps(env: Env): Promise<EnemyScoutingGapRow[]> {
  const rows = await env.DB.prepare(
    `
    WITH tracked_factions AS (
      SELECT DISTINCT enemy_faction_id AS faction_id
      FROM wars
      WHERE enemy_faction_id IS NOT NULL
        AND status IN ('active', 'scheduled')
    )
    SELECT
      m.faction_id,
      m.member_id,
      m.name,
      m.level,
      live.status_state,
      m.ff_battlestats,
      m.bsp_battlestats,
      m.networth,
      m.networth_attempted_at,
      m.networth_attempt_count,
      m.networth_error,
      m.updated_at
    FROM enemy_faction_members m
    INNER JOIN tracked_factions tf ON tf.faction_id = m.faction_id
    LEFT JOIN enemy_member_live_status live
      ON live.member_id = m.member_id
     AND live.faction_id = m.faction_id
    WHERE m.ff_battlestats IS NULL
       OR m.bsp_battlestats IS NULL
       OR m.networth IS NULL
    ORDER BY
      CASE WHEN m.networth IS NULL AND COALESCE(m.networth_attempt_count, 0) >= 3 THEN 0 ELSE 1 END,
      CASE WHEN m.networth IS NULL AND COALESCE(m.networth_attempt_count, 0) BETWEEN 1 AND 2 THEN 0 ELSE 1 END,
      COALESCE(m.level, 0) DESC,
      m.name ASC
    LIMIT 25
    `,
  ).all<EnemyScoutingGapRow>();

  return (rows.results ?? []).map((row) => ({
    faction_id: Number(row.faction_id),
    member_id: Number(row.member_id),
    name: row.name,
    level: nullableNumber(row.level),
    status_state: row.status_state ?? null,
    ff_battlestats: nullableNumber(row.ff_battlestats),
    bsp_battlestats: nullableNumber(row.bsp_battlestats),
    networth: nullableNumber(row.networth),
    networth_attempted_at: nullableNumber(row.networth_attempted_at),
    networth_attempt_count: nullableNumber(row.networth_attempt_count),
    networth_error: row.networth_error ?? null,
    updated_at: nullableNumber(row.updated_at),
  }));
}

function settingsFromRow(row: Partial<DataHealthSettings>): DataHealthSettings {
  return {
    ingestion_warn_seconds: positiveSetting(row.ingestion_warn_seconds, DEFAULT_DATA_HEALTH_SETTINGS.ingestion_warn_seconds),
    ingestion_critical_seconds: positiveSetting(row.ingestion_critical_seconds, DEFAULT_DATA_HEALTH_SETTINGS.ingestion_critical_seconds),
    maintenance_warn_seconds: positiveSetting(row.maintenance_warn_seconds, DEFAULT_DATA_HEALTH_SETTINGS.maintenance_warn_seconds),
    maintenance_critical_seconds: positiveSetting(row.maintenance_critical_seconds, DEFAULT_DATA_HEALTH_SETTINGS.maintenance_critical_seconds),
    daily_stats_lag_warn_days: positiveSetting(row.daily_stats_lag_warn_days, DEFAULT_DATA_HEALTH_SETTINGS.daily_stats_lag_warn_days),
    daily_stats_lag_critical_days: positiveSetting(row.daily_stats_lag_critical_days, DEFAULT_DATA_HEALTH_SETTINGS.daily_stats_lag_critical_days),
    stale_daily_members_warn: positiveSetting(row.stale_daily_members_warn, DEFAULT_DATA_HEALTH_SETTINGS.stale_daily_members_warn),
    stale_daily_members_critical: positiveSetting(row.stale_daily_members_critical, DEFAULT_DATA_HEALTH_SETTINGS.stale_daily_members_critical),
    api_error_rate_warn_percent: positiveSetting(row.api_error_rate_warn_percent, DEFAULT_DATA_HEALTH_SETTINGS.api_error_rate_warn_percent),
    api_error_rate_critical_percent: positiveSetting(row.api_error_rate_critical_percent, DEFAULT_DATA_HEALTH_SETTINGS.api_error_rate_critical_percent),
    api_rate_limited_warn: positiveSetting(row.api_rate_limited_warn, DEFAULT_DATA_HEALTH_SETTINGS.api_rate_limited_warn),
    api_rate_limited_critical: positiveSetting(row.api_rate_limited_critical, DEFAULT_DATA_HEALTH_SETTINGS.api_rate_limited_critical),
    stock_freshness_warn_seconds: positiveSetting(row.stock_freshness_warn_seconds, DEFAULT_DATA_HEALTH_SETTINGS.stock_freshness_warn_seconds),
    stock_freshness_critical_seconds: positiveSetting(row.stock_freshness_critical_seconds, DEFAULT_DATA_HEALTH_SETTINGS.stock_freshness_critical_seconds),
    stale_stocks_warn: positiveSetting(row.stale_stocks_warn, DEFAULT_DATA_HEALTH_SETTINGS.stale_stocks_warn),
    stale_stocks_critical: positiveSetting(row.stale_stocks_critical, DEFAULT_DATA_HEALTH_SETTINGS.stale_stocks_critical),
  };
}

async function readGymStatStreamHealth(
  env: Env,
  targetRefreshAt: number,
): Promise<{ completedGymStats: GymContributorStatKey[]; missingGymStats: GymContributorStatKey[] }> {
  const stateNames = GYM_CONTRIBUTOR_STAT_KEYS.map(gymContributorStatCompleteStateName);
  const placeholders = stateNames.map(() => "?").join(", ");
  const rows = await env.DB.prepare(
    `
    SELECT name, last_started
    FROM sync_state
    WHERE name IN (${placeholders})
    `,
  ).bind(...stateNames).all<{ name: string; last_started: number | null }>();
  const completedStateNames = new Set(
    (rows.results ?? [])
      .filter((row) => Number(row.last_started ?? 0) >= targetRefreshAt)
      .map((row) => row.name),
  );
  const completedGymStats = GYM_CONTRIBUTOR_STAT_KEYS.filter((stat) =>
    completedStateNames.has(gymContributorStatCompleteStateName(stat)));
  const missingGymStats = GYM_CONTRIBUTOR_STAT_KEYS.filter((stat) =>
    !completedStateNames.has(gymContributorStatCompleteStateName(stat)));
  return { completedGymStats, missingGymStats };
}

function positiveSetting(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function nullableNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function recentPersonalStatsCoverageDates(targetDate: string | null): string[] {
  if (!targetDate) return [];
  const previousDate = dateKeyFromOffset(targetDate, -1);
  return previousDate ? [previousDate, targetDate] : [];
}

function dateKeyFromOffset(dateKey: string, dayOffset: number): string | null {
  const parsed = Date.parse(`${dateKey}T00:00:00.000Z`);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed + dayOffset * 86_400_000).toISOString().slice(0, 10);
}

function calendarDateDiffDays(startDate: string, endDate: string): number {
  const [startYear, startMonth, startDay] = startDate.split("-").map(Number);
  const [endYear, endMonth, endDay] = endDate.split("-").map(Number);
  if (
    !Number.isFinite(startYear) || !Number.isFinite(startMonth) || !Number.isFinite(startDay) ||
    !Number.isFinite(endYear) || !Number.isFinite(endMonth) || !Number.isFinite(endDay)
  ) {
    return 0;
  }
  const start = Date.UTC(startYear, startMonth - 1, startDay);
  const end = Date.UTC(endYear, endMonth - 1, endDay);
  return Math.max(0, Math.floor((end - start) / 86_400_000));
}

function dailyGymRefreshReadyAt(timestamp: number): number | null {
  const date = new Date(timestamp * 1000);
  const readyAt = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    DAILY_REFRESH_AFTER_UTC_HOUR,
    DAILY_REFRESH_AFTER_UTC_MINUTE,
    0,
  );

  return timestamp * 1000 >= readyAt ? Math.floor(readyAt / 1000) : null;
}

function gymContributorStatCompleteStateName(stat: GymContributorStatKey): string {
  return `${DAILY_GYM_COMPLETE_STATE_NAME}_${stat}`;
}
