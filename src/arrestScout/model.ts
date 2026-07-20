export type ArrestScoutClassification =
  | "current_target"
  | "future_target"
  | "inactive"
  | "ignored"
  | "error";

export type ArrestScoutSourceType = "manual" | "faction" | "future_targets_due";

export type ArrestScoutSettings = {
  lookback_seconds: number;
  min_counterfeiting_delta: number;
  min_fraud_delta: number;
  required_forgeryskill: number;
};

export type ArrestScoutTargetStats = {
  jailed: number | null;
  counterfeiting: number | null;
  forgeryskill: number | null;
  fraud: number | null;
  scammingskill: number | null;
  criminaloffenses: number | null;
};

export type ArrestScoutStatTimestamps = {
  jailed: number | null;
  counterfeiting: number | null;
  forgeryskill: number | null;
  fraud: number | null;
  scammingskill: number | null;
  criminaloffenses: number | null;
};

export type ArrestScoutScoreResult = {
  classification: ArrestScoutClassification;
  score: number;
  current_forgeryskill: number | null;
  current_counterfeiting: number | null;
  historical_counterfeiting: number | null;
  counterfeiting_delta: number | null;
  current_scammingskill: number | null;
  current_fraud: number | null;
  historical_fraud: number | null;
  fraud_delta: number | null;
  current_criminaloffenses: number | null;
  historical_criminaloffenses: number | null;
  criminaloffenses_delta: number | null;
  current_jailed: number | null;
  historical_jailed: number | null;
  jailed_delta: number | null;
  notes: string[];
};

export type ArrestScoutResultRow = {
  id: string;
  snapshot_id: string;
  target_user_id: number;
  name: string | null;
  classification: ArrestScoutClassification;
  score: number;
  current_forgeryskill: number | null;
  current_counterfeiting: number | null;
  historical_counterfeiting: number | null;
  counterfeiting_delta: number | null;
  current_scammingskill: number | null;
  current_fraud: number | null;
  historical_fraud: number | null;
  fraud_delta: number | null;
  current_criminaloffenses: number | null;
  historical_criminaloffenses: number | null;
  criminaloffenses_delta: number | null;
  current_jailed: number | null;
  historical_jailed: number | null;
  jailed_delta: number | null;
  current_jailed_timestamp: number | null;
  current_counterfeiting_timestamp: number | null;
  current_forgeryskill_timestamp: number | null;
  current_fraud_timestamp: number | null;
  current_scammingskill_timestamp: number | null;
  current_criminaloffenses_timestamp: number | null;
  historical_jailed_timestamp: number | null;
  historical_counterfeiting_timestamp: number | null;
  historical_forgeryskill_timestamp: number | null;
  historical_fraud_timestamp: number | null;
  historical_scammingskill_timestamp: number | null;
  historical_criminaloffenses_timestamp: number | null;
  lookback_seconds: number;
  historical_timestamp_requested: number;
  notes_json: string;
  current_personalstats_json: string | null;
  historical_personalstats_json: string | null;
  created_at: number;
};

export type ArrestScoutSnapshotRow = {
  id: string;
  source_type: string;
  source_faction_id: number | null;
  scanned_by_torn_user_id: number | null;
  scanned_at: number;
  lookback_seconds: number;
  min_counterfeiting_delta: number;
  min_fraud_delta: number;
  status: string;
  error: string | null;
  settings_json: string;
  target_count: number;
  checked_count: number;
  skill_100_count: number;
  current_target_count: number;
  future_target_count: number;
  inactive_count: number;
  ignored_count: number;
  error_count: number;
};

export type ArrestScoutFutureTargetRow = {
  target_user_id: number;
  name: string | null;
  best_score: number;
  last_classification: ArrestScoutClassification;
  last_counterfeiting_delta: number | null;
  last_fraud_delta: number | null;
  last_jailed_delta: number | null;
  first_seen_at: number;
  last_seen_at: number;
  next_check_after: number | null;
  latest_snapshot_id: string | null;
  notes_json: string;
};

export type ArrestScoutFactionHofFaction = {
  faction_id: number;
  name: string | null;
  rank: number | null;
  value: number | null;
  members: number | null;
  respect: number | null;
};

export type ArrestScoutFactionHofResponse = {
  ok: boolean;
  cat: string;
  limit: number;
  offset: number;
  key_source: string;
  factions: ArrestScoutFactionHofFaction[];
};

export type ArrestScoutScanResponse = {
  ok: boolean;
  snapshot_id: string;
  source_type: ArrestScoutSourceType;
  source_faction_id: number | null;
  lookback_days: number;
  min_counterfeiting_delta: number;
  min_fraud_delta: number;
  target_count: number;
  checked_count: number;
  skill_100_count: number;
  current_target_count: number;
  future_target_count: number;
  inactive_count: number;
  ignored_count: number;
  error_count: number;
  current_targets: ArrestScoutResultRow[];
  future_targets: ArrestScoutResultRow[];
  results: ArrestScoutResultRow[];
};

export const ARREST_SCOUT_STAT_KEYS = ["jailed", "counterfeiting", "forgeryskill", "fraud", "scammingskill", "criminaloffenses"] as const;
export const DEFAULT_LOOKBACK_DAYS = 7;
export const DEFAULT_MIN_COUNTERFEITING_DELTA = 500;
export const DEFAULT_MIN_FRAUD_DELTA = 500;
export const DEFAULT_REQUIRED_FORGERYSKILL = 100;
export const TORN_KEY_SOURCE = "member_supplied:arrest_scout";
