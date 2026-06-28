CREATE TABLE IF NOT EXISTS alert_settings (
  alert_key TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  configurable INTEGER NOT NULL DEFAULT 1 CHECK (configurable IN (0, 1)),
  scope TEXT NOT NULL DEFAULT 'global',
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

INSERT OR IGNORE INTO alert_settings (alert_key, enabled, configurable, scope, updated_at)
SELECT 'chain_watch', 1, 1, 'global', unixepoch();

INSERT OR IGNORE INTO alert_settings (alert_key, enabled, configurable, scope, updated_at)
SELECT
  'enemy_push',
  CASE WHEN EXISTS (
    SELECT 1
    FROM sync_state
    WHERE name = 'enemy_push_alert_discord_enabled'
  ) THEN 1 ELSE 0 END,
  1,
  'global',
  unixepoch();

INSERT OR IGNORE INTO alert_settings (alert_key, enabled, configurable, scope, updated_at)
SELECT
  'shoplifting_security_alert:big_als',
  CASE WHEN EXISTS (
    SELECT 1
    FROM sync_state
    WHERE name = 'shoplifting_security_alert_disabled:big_als'
  ) THEN 0 ELSE 1 END,
  1,
  'global',
  unixepoch();

INSERT OR IGNORE INTO alert_settings (alert_key, enabled, configurable, scope, updated_at)
SELECT
  'shoplifting_security_alert:jewelry_store',
  CASE WHEN EXISTS (
    SELECT 1
    FROM sync_state
    WHERE name = 'shoplifting_security_alert_enabled:jewelry_store'
  ) THEN 1 ELSE 0 END,
  1,
  'global',
  unixepoch();
