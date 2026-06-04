export const LIFESTYLE_STAT_KEYS = [
  "xantaken",
  "overdosed",
  "refills",
  "useractivity",
  "networth",
  "daysbeendonator",
] as const;
export const TORN_LIFESTYLE_STAT_KEYS = [
  "xantaken",
  "overdosed",
  "refills",
  "timeplayed",
  "networth",
  "daysbeendonator",
] as const;
export const GYM_CONTRIBUTOR_STAT_KEYS = [
  "gymenergy",
  "gymstrength",
  "gymspeed",
  "gymdefense",
  "gymdexterity",
] as const;
export const GYM_CONTRIBUTOR_FETCH_TIMEOUT_MS = 5000;
export const LIFESTYLE_FETCH_TIMEOUT_MS = 12000;
export const DAILY_REFRESH_AFTER_UTC_HOUR = 0;
export const DAILY_REFRESH_AFTER_UTC_MINUTE = 10;
export const MAX_LIFESTYLE_PERIOD_DAYS = 90;
export const DAILY_LIFESTYLE_REFRESH_LIMIT = 40;
export const EXPIRED_PERSONAL_STATS_RETRY_LIMIT = 5;
export const DAILY_LIFESTYLE_COMPLETE_STATE_NAME = "member_personal_stats_recent_daily";
export const DAILY_GYM_COMPLETE_STATE_NAME = "member_gym_stats_current_daily";
export const DAILY_GYM_LOCK_STATE_NAME = "member_gym_stats_current_daily_lock";
export const DAILY_GYM_RETRY_STATE_NAME = "member_gym_stats_current_daily_retry";
export const DAILY_GYM_RETRY_REFRESH_STATE_NAME = "member_gym_stats_current_daily_retry_refresh";
export const DAILY_GYM_FAILED_STATE_NAME = "member_gym_stats_current_daily_failed";
export const DAILY_LIFESTYLE_LOCK_SECONDS = 75;
export const DAILY_LIFESTYLE_LOCK_STATE_NAME = "member_personal_stats_recent_daily_lock";
export const OLD_PERSONALSTATS_BUCKET_ERROR_CODE = "OLD_PERSONALSTATS_BUCKET";
export const MISSING_PERSONALSTATS_BUCKET_ERROR_CODE = "MISSING_PERSONALSTATS_BUCKET";
export const MISSING_DONATOR_DAYS_ERROR_CODE = "MISSING_DONATOR_DAYS";
export const RETRY_EXPIRED_PERSONALSTATS_ERROR_CODE = "RETRY_EXPIRED_PERSONALSTATS";
export const PERSONALSTATS_BUCKET_MISMATCH_ERROR_CODE = "PERSONALSTATS_BUCKET_MISMATCH";
export const DEFAULT_REPAIR_CALLS_PER_MINUTE_PER_KEY = 35;
export const MAX_REPAIR_DATE_RANGE_DAYS = 120;
export const REPAIR_JOB_PROCESS_LIMIT_SECONDS = 45;
export const REPAIR_KEY_PAUSE_PREFIX = "member_lifestyle_repair_key_pause";
export const REPAIR_FAILURE_ALERT_PREFIX = "member_lifestyle_repair_failure_alert";

export type LifestyleStatKey = (typeof LIFESTYLE_STAT_KEYS)[number];
export type GymContributorStatKey = (typeof GYM_CONTRIBUTOR_STAT_KEYS)[number];
export type LifestyleTimestampKey = `${LifestyleStatKey}_timestamp`;

export type LifestyleStats = Record<LifestyleStatKey, number | null>;
export type LifestyleStatTimestamps = Record<LifestyleTimestampKey, number | null>;
export type TimedLifestyleStats = LifestyleStats & LifestyleStatTimestamps & {
  personalstats_bucket_date: string | null;
  personalstats_requested_at: number | null;
  personalstats_key_source: string | null;
};
export type GymContributorStats = Record<GymContributorStatKey, number | null>;

export type LifestyleMemberRow = {
  member_id: number;
  name: string;
  level: number | null;
  position: string | null;
  personal_captured_at: number | null;
};

export type LifestylePeriodRow = {
  member_id: number;
  member_name: string | null;
  overdosed: number;
  total_xantaken: number;
  average_xantaken: number;
  adjusted_average_xantaken: number;
  average_refills: number;
  average_useractivity: number;
  networth: number | null;
  total_gymenergy: number;
  average_gymenergy: number;
  average_gymstrength: number;
  average_gymspeed: number;
  average_gymdefense: number;
  average_gymdexterity: number;
  first_snapshot_date: string | null;
  last_snapshot_date: string | null;
  updated_at: number | null;
};

export type LifestyleSnapshotRow = {
  member_id: number;
  snapshot_date: string;
  member_name: string | null;
  xantaken: number | null;
  overdosed: number | null;
  refills: number | null;
  useractivity: number | null;
  networth: number | null;
  daysbeendonator: number | null;
  xantaken_timestamp: number | null;
  overdosed_timestamp: number | null;
  refills_timestamp: number | null;
  useractivity_timestamp: number | null;
  networth_timestamp: number | null;
  daysbeendonator_timestamp: number | null;
  personalstats_bucket_date: string | null;
  personalstats_requested_at: number | null;
  personalstats_key_source: string | null;
  gymenergy: number | null;
  gymstrength: number | null;
  gymspeed: number | null;
  gymdefense: number | null;
  gymdexterity: number | null;
  personal_captured_at: number | null;
  gym_captured_at: number | null;
  gym_error: string | null;
  personal_ready: number;
  gym_ready: number;
  fully_ready: number;
  captured_at: number;
  validation_error: string | null;
};

export type LifestyleSnapshotNumberKey =
  | "xantaken"
  | "overdosed"
  | "refills"
  | "useractivity"
  | "daysbeendonator"
  | "gymenergy"
  | "gymstrength"
  | "gymspeed"
  | "gymdefense"
  | "gymdexterity";

export type LifestyleDailyChartMetric = LifestyleSnapshotNumberKey | "networth";
export type LifestyleSnapshotReadyColumn = "personal_ready" | "gym_ready" | "fully_ready";
export type LifestyleSnapshotReadyFilter = LifestyleSnapshotReadyColumn | "any_ready";
export type PersonalStatsRecentStatus = "pending" | "completed" | "retry_expired" | "failed";

export const LIFESTYLE_DAILY_CHART_METRICS = new Set<LifestyleDailyChartMetric>([
  "xantaken",
  "overdosed",
  "refills",
  "useractivity",
  "gymenergy",
  "gymstrength",
  "gymspeed",
  "gymdefense",
  "gymdexterity",
  "networth",
]);

export type DailyStatsAttention = {
  stale_personalstats: number;
  missing_donator_days: number;
  personalstats_target_date: string | null;
  latest_personalstats_bucket_date: string | null;
  personalstats_lag_days: number | null;
  affected_members: Array<{
    member_id: number;
    member_name: string | null;
    error: string | null;
    updated_at: number | null;
  }>;
};

export type RepairJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type RepairItemStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export type LifestyleRepairJobRow = {
  id: string;
  status: RepairJobStatus;
  start_date: string;
  end_date: string;
  effective_start_date: string;
  member_scope: "current";
  member_id: number | null;
  calls_per_minute_per_key: number;
  include_primary_key: number;
  active_key_count: number;
  total_items: number;
  completed_items: number;
  failed_items: number;
  skipped_items: number;
  started_at: number | null;
  finished_at: number | null;
  created_at: number;
  updated_at: number;
  alert_sent_at: number | null;
  last_error: string | null;
};

export type LifestyleRepairItemRow = {
  id: string;
  job_id: string;
  member_id: number;
  member_name: string | null;
  snapshot_date: string;
  requested_at: number;
  status: RepairItemStatus;
  attempts: number;
  key_source: string | null;
  returned_bucket_date: string | null;
  error: string | null;
  started_at: number | null;
  finished_at: number | null;
  updated_at: number;
};

export type RepairKey = {
  key: string;
  keySource: string;
};

export type PersonalStatsRecentRow = {
  member_id: number;
  snapshot_date: string;
  member_name: string | null;
  level: number | null;
  position: string | null;
  target_timestamp: number;
  attempted_at: number | null;
  personal_captured_at: number | null;
  status: PersonalStatsRecentStatus;
  error: string | null;
};
