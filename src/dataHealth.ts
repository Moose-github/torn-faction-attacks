import { readJsonObject } from "./backend/request";
import { HOME_FACTION_ID } from "./constants";
import { getDailyStatsAttention } from "./lifestyleStats";
import { Env } from "./types";
import { json, nowSeconds } from "./utils";

export type DataHealthStatus = "good" | "warn" | "critical" | "unknown";

export type DataHealthSettings = {
  ingestion_warn_seconds: number;
  ingestion_critical_seconds: number;
  maintenance_warn_seconds: number;
  maintenance_critical_seconds: number;
  daily_stats_lag_warn_days: number;
  daily_stats_lag_critical_days: number;
  stale_daily_members_warn: number;
  stale_daily_members_critical: number;
  api_error_rate_warn_percent: number;
  api_error_rate_critical_percent: number;
  api_rate_limited_warn: number;
  api_rate_limited_critical: number;
  stock_freshness_warn_seconds: number;
  stock_freshness_critical_seconds: number;
  stale_stocks_warn: number;
  stale_stocks_critical: number;
};

export type DataHealthIssue = {
  key: string;
  subsystem: string;
  status: Exclude<DataHealthStatus, "good">;
  title: string;
  detail: string;
  action_view: string | null;
  action_label: string | null;
};

type DataHealthMetric = {
  label: string;
  value: string;
  timestamp?: number | null;
};

type DataHealthSubsystem = {
  key: string;
  label: string;
  status: DataHealthStatus;
  summary: string;
  updated_at: number | null;
  updated_label?: string | null;
  metrics: DataHealthMetric[];
};

type IngestionRunRow = {
  id: string;
  trigger_source: string;
  started_at: number;
  ranked_war_checked_at: number | null;
  attacks_fetch_finished_at: number | null;
  d1_writes_finished_at: number | null;
  stats_finished_at: number | null;
  report_finished_at: number | null;
  heatmap_finished_at: number | null;
  finished_at: number | null;
  latest_attack_started: number | null;
  fetched_pages: number;
  fetched_attacks: number;
  wrote_batches: number;
  saw_rows: number;
  active_war_id: number | null;
  status: string;
  error: string | null;
  attack_write_statements?: number;
  sync_state_writes?: number;
  stat_write_operations?: number;
  report_write_operations?: number;
};

type MaintenanceRunRow = {
  id: string;
  started_at: number;
  finished_at: number | null;
  status: string;
  task_count: number;
  write_statements: number;
  changed_rows: number;
  error: string | null;
};

type MaintenanceTaskRow = {
  id: string;
  run_id: string;
  task_name: string;
  started_at: number;
  finished_at: number | null;
  status: string;
  write_statements: number;
  changed_rows: number;
  details: string | null;
  error: string | null;
};

type RosterHealthRow = {
  current_members: number;
  reportable_members: number;
  report_exempt_members: number;
  revivable_members: number;
  stat_estimates: number;
  networth_estimates: number;
  updated_at: number | null;
};

type ApiUsageHealthRow = {
  requests: number;
  errors: number;
  rate_limited: number;
  avg_duration_ms: number | null;
  max_duration_ms: number | null;
};

type ApiUsageFeatureRow = {
  feature: string;
  requests: number;
  errors: number;
  rate_limited: number;
  avg_duration_ms: number | null;
  last_requested_at: number | null;
};

type StockRunRow = {
  id: string;
  batch_group: string;
  started_at: number;
  finished_at: number | null;
  status: string;
  stocks_attempted: number;
  stocks_succeeded: number;
  stocks_failed: number;
  points_seen: number;
  points_written: number;
  recoverable_gap_count: number;
  unrecoverable_gap_count: number;
  error: string | null;
  details_json: string | null;
};

type StockCoverageRow = {
  total_stocks: number;
  stocks_with_snapshots: number;
  oldest_snapshot_at: number | null;
  newest_snapshot_at: number | null;
  stale_stocks: number;
};

type WarReportHealthRow = {
  missing_reports: number;
  oldest_missing_finished_at: number | null;
};

type GymStatsHealthRow = {
  target_date: string | null;
  latest_gym_snapshot_date: string | null;
  gym_lag_days: number | null;
  stale_gym_members: number;
};

type PersonalStatsCoverageRow = {
  snapshot_date: string;
  ready_members: number;
  total_members: number;
};

type DataHealthSnapshot = {
  now: number;
  settings: DataHealthSettings;
  ingestion: IngestionRunRow | null;
  latestAttackStarted: number | null;
  maintenance: MaintenanceRunRow | null;
  maintenanceTasks: MaintenanceTaskRow[];
  dailyStats: Awaited<ReturnType<typeof getDailyStatsAttention>>;
  personalStatsCoverage: PersonalStatsCoverageRow[];
  gymStats: GymStatsHealthRow;
  roster: RosterHealthRow;
  apiUsage: ApiUsageHealthRow;
  apiFeatures: ApiUsageFeatureRow[];
  apiEndpoints: ApiUsageFeatureRow[];
  apiRecentCalls: unknown[];
  stockRun: StockRunRow | null;
  stockCoverage: StockCoverageRow;
  stockLastError: string | null;
  warReports: WarReportHealthRow;
};

export const DEFAULT_DATA_HEALTH_SETTINGS: DataHealthSettings = {
  ingestion_warn_seconds: 10 * 60,
  ingestion_critical_seconds: 30 * 60,
  maintenance_warn_seconds: 45 * 60,
  maintenance_critical_seconds: 2 * 60 * 60,
  daily_stats_lag_warn_days: 1,
  daily_stats_lag_critical_days: 2,
  stale_daily_members_warn: 1,
  stale_daily_members_critical: 5,
  api_error_rate_warn_percent: 5,
  api_error_rate_critical_percent: 15,
  api_rate_limited_warn: 1,
  api_rate_limited_critical: 5,
  stock_freshness_warn_seconds: 5 * 60,
  stock_freshness_critical_seconds: 30 * 60,
  stale_stocks_warn: 1,
  stale_stocks_critical: 5,
};

const SETTINGS_ID = 1;
const API_USAGE_WINDOW_SECONDS = 60 * 60;
const HEALTH_CACHE_TIME_SECONDS = 30;

const STATUS_RANK: Record<DataHealthStatus, number> = {
  good: 0,
  unknown: 1,
  warn: 2,
  critical: 3,
};

export async function getDataHealthSummary(env: Env): Promise<Response> {
  const snapshot = await readDataHealthSnapshot(env, { includeAdminDetail: false });
  return json({
    ok: true,
    generated_at: snapshot.now,
    cache_seconds: HEALTH_CACHE_TIME_SECONDS,
    overall_status: overallStatus(subsystemsFromSnapshot(snapshot)),
    subsystems: sanitizeSubsystems(subsystemsFromSnapshot(snapshot)),
  });
}

export async function getAdminDataHealth(env: Env): Promise<Response> {
  const snapshot = await readDataHealthSnapshot(env, { includeAdminDetail: true });
  const subsystems = subsystemsFromSnapshot(snapshot);
  return json({
    ok: true,
    generated_at: snapshot.now,
    cache_seconds: HEALTH_CACHE_TIME_SECONDS,
    overall_status: overallStatus(subsystems),
    settings: snapshot.settings,
    subsystems,
    issues: issuesFromSnapshot(snapshot, subsystems),
    details: {
      ingestion_run: snapshot.ingestion,
      maintenance_run: snapshot.maintenance,
      maintenance_tasks: snapshot.maintenanceTasks,
      daily_stats_attention: snapshot.dailyStats,
      gym_stats_health: snapshot.gymStats,
      roster: snapshot.roster,
      api_usage: snapshot.apiUsage,
      api_features: snapshot.apiFeatures,
      api_endpoints: snapshot.apiEndpoints,
      api_recent_calls: snapshot.apiRecentCalls,
      stock_run: snapshot.stockRun,
      stock_coverage: snapshot.stockCoverage,
      stock_last_error: snapshot.stockLastError,
      war_reports: snapshot.warReports,
    },
  });
}

export async function updateDataHealthSettingsFromRequest(request: Request, env: Env): Promise<Response> {
  const body = await readJsonObject(request);
  const current = await readDataHealthSettings(env);
  const next = normalizeSettingsPatch(body, current);
  if ("error" in next) {
    return json({ ok: false, error: next.error, code: "INVALID_DATA_HEALTH_SETTINGS" }, 400);
  }

  await saveDataHealthSettings(env, next.settings);
  return json({
    ok: true,
    settings: await readDataHealthSettings(env),
  });
}

export function statusForAgeSeconds(ageSeconds: number | null, warnSeconds: number, criticalSeconds: number): DataHealthStatus {
  if (ageSeconds === null) return "unknown";
  if (ageSeconds >= criticalSeconds) return "critical";
  if (ageSeconds >= warnSeconds) return "warn";
  return "good";
}

export function statusForCount(count: number, warnCount: number, criticalCount: number): DataHealthStatus {
  if (count >= criticalCount) return "critical";
  if (count >= warnCount) return "warn";
  return "good";
}

export function statusForPercent(value: number, warnPercent: number, criticalPercent: number): DataHealthStatus {
  if (value >= criticalPercent) return "critical";
  if (value >= warnPercent) return "warn";
  return "good";
}

async function readDataHealthSnapshot(
  env: Env,
  options: { includeAdminDetail: boolean },
): Promise<DataHealthSnapshot> {
  const now = nowSeconds();
  const settings = await readDataHealthSettings(env);

  const [
    ingestion,
    latestAttack,
    maintenance,
    dailyStats,
    roster,
    apiUsage,
    apiFeatures,
    apiEndpoints,
    apiRecentCalls,
    stockRun,
    stockCoverage,
    stockLastError,
    warReports,
  ] = await Promise.all([
    readLatestIngestionRun(env),
    readLatestAttackStarted(env),
    readLatestMaintenance(env),
    getDailyStatsAttention(env),
    readRosterHealth(env),
    readApiUsageHealth(env, now),
    options.includeAdminDetail ? readApiUsageFeatures(env, now, "feature") : Promise.resolve([]),
    options.includeAdminDetail ? readApiUsageFeatures(env, now, "endpoint") : Promise.resolve([]),
    options.includeAdminDetail ? readRecentApiCalls(env) : Promise.resolve([]),
    readLatestStockRun(env),
    readStockCoverage(env, now, settings),
    readStockLastError(env),
    readWarReportHealth(env),
  ]);
  const [personalStatsCoverage, gymStats] = await Promise.all([
    readPersonalStatsCoverage(env, dailyStats.personalstats_target_date),
    readGymStatsHealth(env, dailyStats.personalstats_target_date),
  ]);

  return {
    now,
    settings,
    ingestion,
    latestAttackStarted: latestAttack,
    maintenance: maintenance.run,
    maintenanceTasks: maintenance.tasks,
    dailyStats,
    personalStatsCoverage,
    gymStats,
    roster,
    apiUsage,
    apiFeatures,
    apiEndpoints,
    apiRecentCalls,
    stockRun,
    stockCoverage,
    stockLastError,
    warReports,
  };
}

async function readDataHealthSettings(env: Env): Promise<DataHealthSettings> {
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

async function saveDataHealthSettings(env: Env, settings: DataHealthSettings): Promise<void> {
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

function normalizeSettingsPatch(
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

async function readLatestIngestionRun(env: Env): Promise<IngestionRunRow | null> {
  return env.DB.prepare(
    `
    SELECT *
    FROM ingestion_runs
    ORDER BY started_at DESC
    LIMIT 1
    `,
  ).first<IngestionRunRow>();
}

async function readLatestAttackStarted(env: Env): Promise<number | null> {
  const row = await env.DB.prepare(
    `
    SELECT MAX(started) AS latest_attack_started
    FROM attacks
    `,
  ).first<{ latest_attack_started: number | null }>();
  return nullableNumber(row?.latest_attack_started);
}

async function readLatestMaintenance(env: Env): Promise<{ run: MaintenanceRunRow | null; tasks: MaintenanceTaskRow[] }> {
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

async function readRosterHealth(env: Env): Promise<RosterHealthRow> {
  const row = await env.DB.prepare(
    `
    SELECT
      COUNT(CASE WHEN is_current = 1 THEN 1 END) AS current_members,
      COUNT(CASE WHEN is_current = 1 AND report_exempt = 0 THEN 1 END) AS reportable_members,
      COUNT(CASE WHEN is_current = 1 AND report_exempt = 1 THEN 1 END) AS report_exempt_members,
      COUNT(CASE WHEN is_current = 1 AND is_revivable = 1 THEN 1 END) AS revivable_members,
      COUNT(CASE WHEN is_current = 1 AND (ff_battlestats IS NOT NULL OR bsp_battlestats IS NOT NULL) THEN 1 END) AS stat_estimates,
      COUNT(CASE WHEN is_current = 1 AND networth IS NOT NULL THEN 1 END) AS networth_estimates,
      MAX(updated_at) AS updated_at
    FROM home_faction_members
    WHERE faction_id = ?
    `,
  ).bind(HOME_FACTION_ID).first<Partial<RosterHealthRow>>();

  return {
    current_members: Number(row?.current_members ?? 0),
    reportable_members: Number(row?.reportable_members ?? 0),
    report_exempt_members: Number(row?.report_exempt_members ?? 0),
    revivable_members: Number(row?.revivable_members ?? 0),
    stat_estimates: Number(row?.stat_estimates ?? 0),
    networth_estimates: Number(row?.networth_estimates ?? 0),
    updated_at: nullableNumber(row?.updated_at),
  };
}

async function readPersonalStatsCoverage(env: Env, targetDate: string | null): Promise<PersonalStatsCoverageRow[]> {
  const dates = recentPersonalStatsCoverageDates(targetDate);
  if (dates.length !== 2) return [];

  const rows = await env.DB.prepare(
    `
    WITH target_dates(snapshot_date) AS (
      SELECT ? AS snapshot_date
      UNION ALL
      SELECT ? AS snapshot_date
    )
    SELECT
      target_dates.snapshot_date AS snapshot_date,
      COUNT(members.member_id) AS total_members,
      COUNT(CASE WHEN snapshots.member_id IS NOT NULL THEN 1 END) AS ready_members
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

async function readGymStatsHealth(env: Env, targetDate: string | null): Promise<GymStatsHealthRow> {
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
    latest_gym_snapshot_date: latestGymSnapshotDate,
    gym_lag_days: targetDate && latestGymSnapshotDate ? calendarDateDiffDays(latestGymSnapshotDate, targetDate) : null,
    stale_gym_members: Number(staleRow?.stale_gym_members ?? 0),
  };
}

async function readApiUsageHealth(env: Env, now: number): Promise<ApiUsageHealthRow> {
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
  ).bind(now - API_USAGE_WINDOW_SECONDS).first<ApiUsageHealthRow>();
  return {
    requests: Number(row?.requests ?? 0),
    errors: Number(row?.errors ?? 0),
    rate_limited: Number(row?.rate_limited ?? 0),
    avg_duration_ms: nullableNumber(row?.avg_duration_ms),
    max_duration_ms: nullableNumber(row?.max_duration_ms),
  };
}

async function readApiUsageFeatures(
  env: Env,
  now: number,
  groupBy: "feature" | "endpoint",
): Promise<ApiUsageFeatureRow[]> {
  const column = groupBy === "feature" ? "feature" : "endpoint";
  const rows = await env.DB.prepare(
    `
    SELECT
      ${column} AS feature,
      COUNT(*) AS requests,
      SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS errors,
      SUM(CASE WHEN status = 429 THEN 1 ELSE 0 END) AS rate_limited,
      AVG(duration_ms) AS avg_duration_ms,
      MAX(requested_at) AS last_requested_at
    FROM torn_api_call_log
    WHERE requested_at >= ?
    GROUP BY ${column}
    ORDER BY errors DESC, rate_limited DESC, requests DESC, ${column} ASC
    LIMIT 12
    `,
  ).bind(now - API_USAGE_WINDOW_SECONDS).all<ApiUsageFeatureRow>();
  return rows.results ?? [];
}

async function readRecentApiCalls(env: Env): Promise<unknown[]> {
  const rows = await env.DB.prepare(
    `
    SELECT *
    FROM torn_api_call_log
    ORDER BY requested_at DESC, id DESC
    LIMIT 12
    `,
  ).all();
  return rows.results ?? [];
}

async function readLatestStockRun(env: Env): Promise<StockRunRow | null> {
  return env.DB.prepare(
    `
    SELECT *
    FROM stock_ingestion_runs
    ORDER BY started_at DESC
    LIMIT 1
    `,
  ).first<StockRunRow>();
}

async function readStockCoverage(env: Env, now: number, settings: DataHealthSettings): Promise<StockCoverageRow> {
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

async function readStockLastError(env: Env): Promise<string | null> {
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

async function readWarReportHealth(env: Env): Promise<WarReportHealthRow> {
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

function subsystemsFromSnapshot(snapshot: DataHealthSnapshot): DataHealthSubsystem[] {
  return [
    ingestionSubsystem(snapshot),
    maintenanceSubsystem(snapshot),
    personalStatsSubsystem(snapshot),
    gymStatsSubsystem(snapshot),
    rosterSubsystem(snapshot),
    apiSubsystem(snapshot),
    stockSubsystem(snapshot),
    warReportsSubsystem(snapshot),
  ];
}

function ingestionSubsystem(snapshot: DataHealthSnapshot): DataHealthSubsystem {
  const run = snapshot.ingestion;
  if (!run) {
    return unknownSubsystem("ingestion", "Attack ingestion", "No ingestion run has been recorded");
  }

  const age = snapshot.now - (run.finished_at ?? run.started_at);
  const freshnessStatus = statusForAgeSeconds(age, snapshot.settings.ingestion_warn_seconds, snapshot.settings.ingestion_critical_seconds);
  const status = run.status === "error" ? "critical" : maxStatus(freshnessStatus, run.status === "running" ? "warn" : "good");
  const completedAt = run.finished_at ?? run.started_at;
  const staleThresholdSeconds = freshnessStatus === "critical"
    ? snapshot.settings.ingestion_critical_seconds
    : snapshot.settings.ingestion_warn_seconds;
  const summary = run.status === "error"
    ? "Latest attack ingestion failed"
    : freshnessStatus !== "good"
      ? `Last completed ingestion is older than ${formatDurationLabel(staleThresholdSeconds)}`
      : run.status === "running"
        ? "Attack ingestion is currently running"
        : `${run.fetched_attacks} attacks fetched in latest run`;

  return {
    key: "ingestion",
    label: "Attack ingestion",
    status,
    summary,
    updated_at: completedAt,
    metrics: [
      { label: "Latest run", value: run.status, timestamp: run.started_at },
      { label: "Last completed", value: "Recorded", timestamp: completedAt },
      { label: "Fetched attacks", value: String(run.fetched_attacks) },
      { label: "Latest attack", value: snapshot.latestAttackStarted === null ? "-" : "Recorded", timestamp: snapshot.latestAttackStarted },
    ],
  };
}

function maintenanceSubsystem(snapshot: DataHealthSnapshot): DataHealthSubsystem {
  const run = snapshot.maintenance;
  if (!run) {
    return unknownSubsystem("maintenance", "Scheduled maintenance", "No maintenance run has been recorded");
  }

  const failedTasks = snapshot.maintenanceTasks.filter((task) => task.status === "error").length;
  const age = snapshot.now - (run.finished_at ?? run.started_at);
  const freshnessStatus = statusForAgeSeconds(age, snapshot.settings.maintenance_warn_seconds, snapshot.settings.maintenance_critical_seconds);
  const status = failedTasks > 0 || run.status === "error" ? "critical" : maxStatus(freshnessStatus, run.status === "running" ? "warn" : "good");
  const staleThresholdSeconds = freshnessStatus === "critical"
    ? snapshot.settings.maintenance_critical_seconds
    : snapshot.settings.maintenance_warn_seconds;
  const summary = failedTasks > 0
    ? `${failedTasks} maintenance task failed`
    : run.status === "error"
      ? "Latest scheduled maintenance failed"
      : freshnessStatus !== "good"
        ? `Last completed maintenance is older than ${formatDurationLabel(staleThresholdSeconds)}`
        : run.status === "running"
          ? "Scheduled maintenance is currently running"
          : `${run.task_count} tasks logged`;
  return {
    key: "maintenance",
    label: "Scheduled maintenance",
    status,
    summary,
    updated_at: run.finished_at ?? run.started_at,
    metrics: [
      { label: "Latest run", value: run.status, timestamp: run.started_at },
      { label: "Tasks", value: String(run.task_count) },
      { label: "Changed rows", value: String(run.changed_rows) },
    ],
  };
}

function personalStatsSubsystem(snapshot: DataHealthSnapshot): DataHealthSubsystem {
  const attention = snapshot.dailyStats;
  const affectedCount = attention.stale_personalstats + attention.missing_donator_days;
  const missingCoverage = snapshot.personalStatsCoverage.reduce(
    (total, coverage) => total + Math.max(0, coverage.total_members - coverage.ready_members),
    0,
  );
  const coverageStatus = snapshot.personalStatsCoverage.length === 0 || snapshot.personalStatsCoverage.every((coverage) => coverage.total_members === 0)
    ? "unknown"
    : statusForCount(
      missingCoverage,
      snapshot.settings.stale_daily_members_warn,
      snapshot.settings.stale_daily_members_critical,
    );
  const countStatus = statusForCount(
    affectedCount,
    snapshot.settings.stale_daily_members_warn,
    snapshot.settings.stale_daily_members_critical,
  );
  const status = maxStatus(coverageStatus, countStatus);
  const coverageMetrics = snapshot.personalStatsCoverage.map((coverage) => ({
    label: coverage.snapshot_date,
    value: `${coverage.ready_members}/${coverage.total_members}`,
  }));
  const outstandingMetric = {
    label: attention.missing_donator_days > 0 ? "Outstanding" : "Stale",
    value: String(affectedCount),
  };
  return {
    key: "personal_stats",
    label: "Personal stats",
    status,
    summary: affectedCount > 0 ? `${affectedCount} reportable members need personal stat attention` : "Personal stats are current",
    updated_at: null,
    updated_label: snapshotDateLabel(attention.latest_personalstats_bucket_date),
    metrics: [
      ...coverageMetrics,
      outstandingMetric,
    ],
  };
}

function gymStatsSubsystem(snapshot: DataHealthSnapshot): DataHealthSubsystem {
  const gymStats = snapshot.gymStats;
  const lagStatus = gymStats.gym_lag_days === null
    ? "unknown"
    : statusForCount(
      gymStats.gym_lag_days,
      snapshot.settings.daily_stats_lag_warn_days,
      snapshot.settings.daily_stats_lag_critical_days,
    );
  const countStatus = statusForCount(
    gymStats.stale_gym_members,
    snapshot.settings.stale_daily_members_warn,
    snapshot.settings.stale_daily_members_critical,
  );
  const status = maxStatus(lagStatus, countStatus);
  return {
    key: "gym_stats",
    label: "Gym stats",
    status,
    summary: gymStats.stale_gym_members > 0
      ? `${gymStats.stale_gym_members} reportable members need gym snapshots`
      : "Gym stats are current",
    updated_at: null,
    updated_label: snapshotDateLabel(gymStats.latest_gym_snapshot_date),
    metrics: [
      { label: "Lag days", value: gymStats.gym_lag_days === null ? "-" : String(gymStats.gym_lag_days) },
      { label: "Stale members", value: String(gymStats.stale_gym_members) },
      { label: "Latest snapshot", value: gymStats.latest_gym_snapshot_date ?? "-" },
    ],
  };
}

function rosterSubsystem(snapshot: DataHealthSnapshot): DataHealthSubsystem {
  const roster = snapshot.roster;
  return {
    key: "roster",
    label: "Home roster",
    status: roster.current_members > 0 ? "good" : "unknown",
    summary: roster.current_members > 0 ? `${roster.current_members} current faction members` : "No current members found",
    updated_at: roster.updated_at,
    metrics: [
      { label: "Current", value: String(roster.current_members) },
      { label: "Stat estimates", value: String(roster.stat_estimates) },
      { label: "Networth estimates", value: String(roster.networth_estimates) },
    ],
  };
}

function apiSubsystem(snapshot: DataHealthSnapshot): DataHealthSubsystem {
  const usage = snapshot.apiUsage;
  const errorRate = usage.requests > 0 ? usage.errors / usage.requests * 100 : 0;
  const errorStatus = usage.requests === 0
    ? "unknown"
    : statusForPercent(
      errorRate,
      snapshot.settings.api_error_rate_warn_percent,
      snapshot.settings.api_error_rate_critical_percent,
    );
  const rateLimitStatus = statusForCount(
    usage.rate_limited,
    snapshot.settings.api_rate_limited_warn,
    snapshot.settings.api_rate_limited_critical,
  );
  const status = maxStatus(errorStatus, rateLimitStatus);
  return {
    key: "torn_api",
    label: "Torn API usage",
    status,
    summary: usage.requests > 0 ? `${usage.requests} calls in the last hour` : "No calls recorded in the last hour",
    updated_at: null,
    metrics: [
      { label: "Requests", value: String(usage.requests) },
      { label: "Errors", value: String(usage.errors) },
      { label: "429s", value: String(usage.rate_limited) },
    ],
  };
}

function stockSubsystem(snapshot: DataHealthSnapshot): DataHealthSubsystem {
  const coverage = snapshot.stockCoverage;
  const stockAge = coverage.newest_snapshot_at === null ? null : snapshot.now - coverage.newest_snapshot_at;
  const freshnessStatus = statusForAgeSeconds(
    stockAge,
    snapshot.settings.stock_freshness_warn_seconds,
    snapshot.settings.stock_freshness_critical_seconds,
  );
  const staleStatus = statusForCount(
    coverage.stale_stocks,
    snapshot.settings.stale_stocks_warn,
    snapshot.settings.stale_stocks_critical,
  );
  const runStatus = snapshot.stockRun?.status === "error" ? "critical" : "good";
  const status = maxStatus(freshnessStatus, staleStatus, runStatus);
  return {
    key: "stock_data",
    label: "Stock data",
    status,
    summary: `${coverage.stocks_with_snapshots}/${coverage.total_stocks} stocks have snapshots`,
    updated_at: coverage.newest_snapshot_at,
    metrics: [
      { label: "Coverage", value: `${coverage.stocks_with_snapshots}/${coverage.total_stocks}` },
      { label: "Stale stocks", value: String(coverage.stale_stocks) },
      { label: "Latest snapshot", value: formatTimestampMetric(coverage.newest_snapshot_at), timestamp: coverage.newest_snapshot_at },
    ],
  };
}

function warReportsSubsystem(snapshot: DataHealthSnapshot): DataHealthSubsystem {
  const missing = snapshot.warReports.missing_reports;
  return {
    key: "war_reports",
    label: "War reports",
    status: missing > 0 ? "warn" : "good",
    summary: missing > 0 ? `${missing} ended wars are missing reports` : "Ended war reports are reconciled",
    updated_at: snapshot.warReports.oldest_missing_finished_at,
    metrics: [
      { label: "Missing reports", value: String(missing) },
      { label: "Oldest missing", value: formatTimestampMetric(snapshot.warReports.oldest_missing_finished_at), timestamp: snapshot.warReports.oldest_missing_finished_at },
    ],
  };
}

function issuesFromSnapshot(snapshot: DataHealthSnapshot, subsystems: DataHealthSubsystem[]): DataHealthIssue[] {
  return subsystems
    .filter((subsystem) => subsystem.status !== "good")
    .map((subsystem) => ({
      key: subsystem.key,
      subsystem: subsystem.label,
      status: subsystem.status as Exclude<DataHealthStatus, "good">,
      title: subsystem.summary,
      detail: issueDetailForSubsystem(snapshot, subsystem),
      action_view: actionForSubsystem(subsystem.key)?.view ?? null,
      action_label: actionForSubsystem(subsystem.key)?.label ?? null,
    }))
    .sort((left, right) => STATUS_RANK[right.status] - STATUS_RANK[left.status]);
}

function issueDetailForSubsystem(snapshot: DataHealthSnapshot, subsystem: DataHealthSubsystem): string {
  if (subsystem.key === "ingestion") {
    if (snapshot.ingestion?.error) return snapshot.ingestion.error;
    const completedAt = snapshot.ingestion?.finished_at ?? snapshot.ingestion?.started_at ?? null;
    return [
      `Last completed: ${formatTimestampLabel(completedAt)}`,
      `warning target: ${formatDurationLabel(snapshot.settings.ingestion_warn_seconds)}`,
      `critical target: ${formatDurationLabel(snapshot.settings.ingestion_critical_seconds)}`,
      `fetched attacks: ${snapshot.ingestion?.fetched_attacks ?? 0}`,
      `latest attack: ${formatTimestampLabel(snapshot.latestAttackStarted)}`,
    ].join("; ");
  }
  if (subsystem.key === "maintenance" && snapshot.maintenance?.error) return snapshot.maintenance.error;
  if (subsystem.key === "stock_data" && snapshot.stockRun?.error) return snapshot.stockRun.error;
  if (subsystem.key === "personal_stats") {
    return `${snapshot.dailyStats.stale_personalstats} stale personalstats, ${snapshot.dailyStats.missing_donator_days} missing donator-day gaps`;
  }
  if (subsystem.key === "gym_stats") {
    return `${snapshot.gymStats.stale_gym_members} stale gym snapshots; latest gym snapshot: ${snapshot.gymStats.latest_gym_snapshot_date ?? "-"}`;
  }
  return subsystem.metrics.map((metric) => `${metric.label}: ${metric.value}`).join("; ");
}

function actionForSubsystem(key: string): { view: string; label: string } | null {
  if (key === "stock_data") return { view: "stockMarketStatus", label: "Open stock market" };
  if (key === "personal_stats" || key === "gym_stats" || key === "roster") return { view: "lifestyle", label: "Open member stats" };
  if (key === "war_reports") return { view: "admin", label: "Open admin controls" };
  return { view: "admin", label: "Open admin controls" };
}

function sanitizeSubsystems(subsystems: DataHealthSubsystem[]): DataHealthSubsystem[] {
  return subsystems.map((subsystem) => ({
    ...subsystem,
    metrics: subsystem.metrics.slice(0, 3),
  }));
}

function unknownSubsystem(key: string, label: string, summary: string): DataHealthSubsystem {
  return {
    key,
    label,
    status: "unknown",
    summary,
    updated_at: null,
    metrics: [],
  };
}

function overallStatus(subsystems: DataHealthSubsystem[]): DataHealthStatus {
  if (subsystems.length === 0) return "unknown";
  return maxStatus(...subsystems.map((subsystem) => subsystem.status));
}

function maxStatus(...statuses: DataHealthStatus[]): DataHealthStatus {
  return statuses.reduce((highest, status) =>
    STATUS_RANK[status] > STATUS_RANK[highest] ? status : highest,
  "good" as DataHealthStatus);
}

function positiveSetting(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function nullableNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function snapshotDateLabel(snapshotDate: string | null): string | null {
  return snapshotDate ? `Latest snapshot ${snapshotDate}` : null;
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

function formatTimestampMetric(timestamp: number | null): string {
  return timestamp === null ? "-" : String(timestamp);
}

function formatTimestampLabel(timestamp: number | null): string {
  if (timestamp === null) return "-";
  return new Date(timestamp * 1000).toISOString().replace("T", " ").replace(".000Z", " UTC");
}

function formatDurationLabel(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds >= 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 60)}m`;
}
