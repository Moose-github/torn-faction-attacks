-- Usage reports filter/order by requested_at. Recent errors combine ok and
-- status predicates, so the status-leading index does not serve that query.
-- Keep the time and feature/time indexes; avoid an extra index write per call.
DROP INDEX IF EXISTS idx_torn_api_call_log_status_requested_at;
