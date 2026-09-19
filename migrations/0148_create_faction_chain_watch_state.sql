-- The live chain belongs to the faction, independently of wars and schedules.
-- Keep the legacy table for historical war reads during the transition.
CREATE TABLE faction_chain_watch_state (
  faction_id INTEGER PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'stored',
  current_chain INTEGER,
  reset_at INTEGER,
  timeout_at INTEGER,
  last_hit_id INTEGER,
  last_hit_at INTEGER,
  last_hit_attacker_name TEXT,
  last_hit_defender_name TEXT,
  last_hit_result TEXT,
  scheduled_alarm_stage TEXT,
  scheduled_alarm_at INTEGER,
  warning_60_sent_at INTEGER,
  warning_30_sent_at INTEGER,
  drop_sent_at INTEGER,
  alert_chain INTEGER,
  alert_reset_at INTEGER,
  discord_message_id TEXT,
  last_checked_at INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Reuse the current monitor's message and sent-warning markers. The first
-- worker tick schedules the faction alarm; old war alarms retire themselves.
INSERT INTO faction_chain_watch_state (
  faction_id, enabled, source, current_chain, reset_at, timeout_at,
  last_hit_id, last_hit_at, last_hit_attacker_name, last_hit_defender_name, last_hit_result,
  scheduled_alarm_stage, scheduled_alarm_at, warning_60_sent_at, warning_30_sent_at,
  drop_sent_at, alert_chain, alert_reset_at, discord_message_id,
  last_checked_at, last_error, created_at, updated_at
)
SELECT 8803, c.enabled, c.source, c.current_chain, c.reset_at, c.timeout_at,
  c.last_hit_id, c.last_hit_at, c.last_hit_attacker_name, c.last_hit_defender_name, c.last_hit_result,
  c.scheduled_alarm_stage, c.scheduled_alarm_at, c.warning_60_sent_at, c.warning_30_sent_at,
  c.drop_sent_at, c.alert_chain, c.alert_reset_at, c.discord_message_id,
  c.last_checked_at, c.last_error, c.created_at, c.updated_at
FROM chain_watch_state c JOIN sync_state s ON s.active_war_id = c.war_id
WHERE s.name = 'attacks' AND s.war_state = 'current';

CREATE INDEX idx_attacks_faction_chain_latest
  ON attacks(attacker_faction_id, COALESCE(ended, started) DESC, id DESC);
