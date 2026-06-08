UPDATE data_health_settings
SET
  ingestion_warn_seconds = 120,
  ingestion_critical_seconds = 300,
  updated_at = unixepoch()
WHERE id = 1
  AND ingestion_warn_seconds = 600
  AND ingestion_critical_seconds = 1800;
