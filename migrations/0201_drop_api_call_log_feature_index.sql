-- D1 keeps no sqlite_stat1, so without statistics the planner scans this whole
-- index for the per-feature usage report instead of the requested_at range.
-- Every reader filters by requested_at; avoid an extra index write per call.
DROP INDEX IF EXISTS idx_torn_api_call_log_feature_requested_at;
