ALTER TABLE wars RENAME COLUMN start_time TO practical_start_time;

DROP INDEX IF EXISTS idx_wars_status_started;
CREATE INDEX IF NOT EXISTS idx_wars_status_practical_start
  ON wars(status, practical_start_time DESC);
