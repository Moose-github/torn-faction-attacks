CREATE TABLE IF NOT EXISTS discord_alert_mentions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_key TEXT NOT NULL,
  mention_type TEXT NOT NULL CHECK (mention_type IN ('user', 'role')),
  discord_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(alert_key, mention_type, discord_id)
);

CREATE INDEX IF NOT EXISTS idx_discord_alert_mentions_alert
  ON discord_alert_mentions (alert_key, enabled);

INSERT INTO discord_alert_mentions (alert_key, mention_type, discord_id, enabled)
VALUES ('shoplifting_security_alert:big_als', 'user', '327916221330620436', 1)
ON CONFLICT(alert_key, mention_type, discord_id) DO UPDATE SET
  enabled = 1,
  updated_at = unixepoch();
