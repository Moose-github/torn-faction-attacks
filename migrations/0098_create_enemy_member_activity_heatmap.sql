CREATE TABLE IF NOT EXISTS enemy_member_activity_heatmap (
  war_id INTEGER NOT NULL,
  faction_id INTEGER NOT NULL,
  member_id INTEGER NOT NULL,
  member_name TEXT NOT NULL,
  date TEXT NOT NULL,
  interval_index INTEGER NOT NULL,
  is_recently_active INTEGER NOT NULL DEFAULT 0,
  last_action_status TEXT,
  last_action_timestamp INTEGER,
  sampled_at INTEGER NOT NULL,
  PRIMARY KEY (war_id, faction_id, member_id, date, interval_index)
);

CREATE INDEX IF NOT EXISTS idx_enemy_member_activity_heatmap_war_member
  ON enemy_member_activity_heatmap(war_id, member_id, date, interval_index);

CREATE INDEX IF NOT EXISTS idx_enemy_member_activity_heatmap_war_bucket
  ON enemy_member_activity_heatmap(war_id, date, interval_index);
