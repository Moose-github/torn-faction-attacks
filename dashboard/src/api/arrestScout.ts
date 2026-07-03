import { getJson, postJson } from "./client";

export type ArrestScoutClassification =
  | "current_target"
  | "future_target"
  | "inactive"
  | "ignored"
  | "error";

export type ArrestScoutSourceType = "manual" | "future_targets_due";

export type ArrestScoutResult = {
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
  current_jailed: number | null;
  historical_jailed: number | null;
  jailed_delta: number | null;
  notes_json: string;
  created_at: number;
};

export type ArrestScoutSnapshot = {
  id: string;
  source_type: string;
  scanned_at: number;
  lookback_seconds: number;
  min_counterfeiting_delta: number;
  status: string;
  error: string | null;
  target_count: number;
  checked_count: number;
  skill_100_count: number;
  current_target_count: number;
  future_target_count: number;
  inactive_count: number;
  ignored_count: number;
  error_count: number;
};

export type ArrestScoutFutureTarget = {
  target_user_id: number;
  name: string | null;
  best_score: number;
  last_classification: ArrestScoutClassification;
  last_counterfeiting_delta: number | null;
  last_jailed_delta: number | null;
  first_seen_at: number;
  last_seen_at: number;
  next_check_after: number | null;
  latest_snapshot_id: string | null;
};

export type ArrestScoutScanPayload = {
  source: ArrestScoutSourceType;
  torn_key: string;
  target_user_ids?: number[];
  lookback_days?: number;
  min_counterfeiting_delta?: number;
};

export type ArrestScoutScanResponse = {
  ok: boolean;
  snapshot_id: string;
  source_type: ArrestScoutSourceType;
  lookback_days: number;
  min_counterfeiting_delta: number;
  target_count: number;
  checked_count: number;
  skill_100_count: number;
  current_target_count: number;
  future_target_count: number;
  inactive_count: number;
  ignored_count: number;
  error_count: number;
  current_targets: ArrestScoutResult[];
  future_targets: ArrestScoutResult[];
  results: ArrestScoutResult[];
};

export type ArrestScoutSnapshotsResponse = {
  ok: boolean;
  snapshots: ArrestScoutSnapshot[];
};

export type ArrestScoutFutureTargetsResponse = {
  ok: boolean;
  future_targets: ArrestScoutFutureTarget[];
};

export type ArrestScoutSnapshotResponse = {
  ok: boolean;
  snapshot: ArrestScoutSnapshot;
  results: ArrestScoutResult[];
};

export async function scanArrestScout(payload: ArrestScoutScanPayload): Promise<ArrestScoutScanResponse> {
  return postJson<ArrestScoutScanResponse>("/api/arrest-scout/scan", payload);
}

export async function getArrestScoutSnapshots(): Promise<ArrestScoutSnapshotsResponse> {
  return getJson<ArrestScoutSnapshotsResponse>("/api/arrest-scout/snapshots");
}

export async function getArrestScoutSnapshot(snapshotId: string): Promise<ArrestScoutSnapshotResponse> {
  return getJson<ArrestScoutSnapshotResponse>(`/api/arrest-scout/snapshots/${encodeURIComponent(snapshotId)}`);
}

export async function getArrestScoutFutureTargets(): Promise<ArrestScoutFutureTargetsResponse> {
  return getJson<ArrestScoutFutureTargetsResponse>("/api/arrest-scout/future-targets");
}
