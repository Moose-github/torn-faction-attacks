import type { getDailyStatsAttention } from "../lifestyleStats/dailyAttention";
import type { GymContributorStatKey } from "../lifestyleStats/model";

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

export type DataHealthMetric = {
  label: string;
  value: string;
  timestamp?: number | null;
  title?: string | null;
};

export type DataHealthSubsystem = {
  key: string;
  label: string;
  status: DataHealthStatus;
  summary: string;
  updated_at: number | null;
  updated_label?: string | null;
  metrics: DataHealthMetric[];
};

export type IngestionRunRow = {
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

export type MaintenanceRunRow = {
  id: string;
  started_at: number;
  finished_at: number | null;
  status: string;
  task_count: number;
  write_statements: number;
  changed_rows: number;
  error: string | null;
};

export type MaintenanceTaskRow = {
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

export type RosterHealthRow = {
  current_members: number;
  profile_members: number;
  reportable_members: number;
  report_exempt_members: number;
  revivable_members: number;
  stat_estimates: number;
  networth_estimates: number;
  updated_at: number | null;
};

export type ApiUsageHealthRow = {
  window_seconds: number;
  requests: number;
  errors: number;
  rate_limited: number;
  avg_duration_ms: number | null;
  max_duration_ms: number | null;
  requests_per_minute: number;
};

export type ApiUsageFeatureRow = {
  feature: string;
  requests: number;
  errors: number;
  rate_limited: number;
  avg_duration_ms: number | null;
  last_requested_at: number | null;
};

export type ApiUsageKeyRow = {
  key_source: string;
  requests: number;
  errors: number;
  rate_limited: number;
  avg_duration_ms: number | null;
  last_requested_at: number | null;
  calls_per_minute?: number;
};

export type StockRunRow = {
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

export type StockCoverageRow = {
  total_stocks: number;
  stocks_with_snapshots: number;
  oldest_snapshot_at: number | null;
  newest_snapshot_at: number | null;
  stale_stocks: number;
};

export type WarReportHealthRow = {
  missing_reports: number;
  oldest_missing_finished_at: number | null;
};

export type GymStatsHealthRow = {
  target_date: string | null;
  target_refresh_at: number | null;
  latest_gym_snapshot_date: string | null;
  gym_lag_days: number | null;
  completed_gym_stats: GymContributorStatKey[];
  missing_gym_stats: GymContributorStatKey[];
  stale_gym_members: number;
};

export type PersonalStatsCoverageRow = {
  snapshot_date: string;
  ready_members: number;
  total_members: number;
};

export type PersonalStatsCoverageGapRow = {
  snapshot_date: string;
  member_id: number;
  member_name: string | null;
  latest_personal_ready_date: string | null;
  recent_snapshot_date: string | null;
  recent_status: string | null;
  recent_error: string | null;
  recent_updated_at: number | null;
};

export type EnemyScoutingCoverageRow = {
  faction_id: number;
  war_names: string | null;
  total_members: number;
  ff_stats_available: number;
  bsp_stats_available: number;
  networth_available: number;
  networth_pending: number;
  networth_failed: number;
  networth_retryable: number;
  status_checked_at: number | null;
  updated_at: number | null;
};

export type EnemyScoutingGapRow = {
  faction_id: number;
  member_id: number;
  name: string;
  level: number | null;
  status_state: string | null;
  ff_battlestats: number | null;
  bsp_battlestats: number | null;
  networth: number | null;
  networth_attempted_at: number | null;
  networth_attempt_count: number | null;
  networth_error: string | null;
  updated_at: number | null;
};

export type DataHealthSnapshot = {
  now: number;
  settings: DataHealthSettings;
  ingestion: IngestionRunRow | null;
  latestAttackStarted: number | null;
  maintenance: MaintenanceRunRow | null;
  maintenanceTasks: MaintenanceTaskRow[];
  dailyStats: Awaited<ReturnType<typeof getDailyStatsAttention>>;
  personalStatsCoverage: PersonalStatsCoverageRow[];
  personalStatsCoverageGaps: PersonalStatsCoverageGapRow[];
  gymStats: GymStatsHealthRow;
  roster: RosterHealthRow;
  apiUsage: ApiUsageHealthRow;
  apiDetailUsage: ApiUsageHealthRow;
  apiUsageWindowSeconds: number;
  apiKeyHealth: ApiUsageKeyRow[];
  apiKeys: ApiUsageKeyRow[];
  apiFeatures: ApiUsageFeatureRow[];
  apiEndpoints: ApiUsageFeatureRow[];
  apiRecentCalls: unknown[];
  stockRun: StockRunRow | null;
  stockCoverage: StockCoverageRow;
  stockLastError: string | null;
  warReports: WarReportHealthRow;
  enemyScoutingCoverage: EnemyScoutingCoverageRow[];
  enemyScoutingGaps: EnemyScoutingGapRow[];
};

export const DEFAULT_DATA_HEALTH_SETTINGS: DataHealthSettings = {
  ingestion_warn_seconds: 2 * 60,
  ingestion_critical_seconds: 5 * 60,
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

export const SETTINGS_ID = 1;
export const API_USAGE_WINDOW_SECONDS = 60 * 60;
export const KEY_HEALTH_WINDOW_SECONDS = 24 * 60 * 60;
export const DEFAULT_ADMIN_API_USAGE_WINDOW_SECONDS = 24 * 60 * 60;
export const MAX_ADMIN_API_USAGE_WINDOW_SECONDS = 7 * 24 * 60 * 60;
export const HEALTH_CACHE_TIME_SECONDS = 30;
export const ADMIN_ONLY_SUBSYSTEM_KEYS = new Set(["maintenance", "key_health", "war_reports"]);

export const STATUS_RANK: Record<DataHealthStatus, number> = {
  good: 0,
  unknown: 1,
  warn: 2,
  critical: 3,
};

export function statusForAgeSeconds(
  ageSeconds: number | null,
  warnSeconds: number,
  criticalSeconds: number,
): DataHealthStatus {
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
