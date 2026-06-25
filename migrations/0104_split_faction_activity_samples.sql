CREATE TABLE IF NOT EXISTS home_faction_activity_samples (
  faction_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  interval_index INTEGER NOT NULL,
  active_count INTEGER NOT NULL,
  total_count INTEGER NOT NULL,
  sampled_at INTEGER NOT NULL,
  PRIMARY KEY (faction_id, date, interval_index)
);

CREATE TABLE IF NOT EXISTS enemy_faction_activity_samples (
  war_id INTEGER NOT NULL,
  faction_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  interval_index INTEGER NOT NULL,
  active_count INTEGER NOT NULL,
  total_count INTEGER NOT NULL,
  sampled_at INTEGER NOT NULL,
  PRIMARY KEY (war_id, faction_id, date, interval_index)
);

CREATE TABLE IF NOT EXISTS enemy_member_activity_samples (
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

INSERT OR IGNORE INTO home_faction_activity_samples (
  faction_id,
  date,
  interval_index,
  active_count,
  total_count,
  sampled_at
)
SELECT
  faction_id,
  date,
  interval_index,
  active_count,
  total_count,
  sampled_at
FROM faction_activity_heatmap
WHERE faction_id = 8803;

INSERT OR IGNORE INTO enemy_faction_activity_samples (
  war_id,
  faction_id,
  date,
  interval_index,
  active_count,
  total_count,
  sampled_at
)
SELECT
  (
    SELECT id
    FROM wars
    WHERE enemy_faction_id = faction_activity_heatmap.faction_id
    ORDER BY practical_start_time DESC, id DESC
    LIMIT 1
  ),
  faction_id,
  date,
  interval_index,
  active_count,
  total_count,
  sampled_at
FROM faction_activity_heatmap
WHERE faction_id != 8803
  AND EXISTS (
    SELECT 1
    FROM wars
    WHERE enemy_faction_id = faction_activity_heatmap.faction_id
  );

INSERT OR IGNORE INTO enemy_member_activity_samples (
  war_id,
  faction_id,
  member_id,
  member_name,
  date,
  interval_index,
  is_recently_active,
  last_action_status,
  last_action_timestamp,
  sampled_at
)
SELECT
  war_id,
  faction_id,
  member_id,
  member_name,
  date,
  interval_index,
  is_recently_active,
  last_action_status,
  last_action_timestamp,
  sampled_at
FROM enemy_member_activity_heatmap;

DROP TABLE faction_activity_heatmap;

DROP TABLE enemy_member_activity_heatmap;

CREATE INDEX IF NOT EXISTS idx_home_faction_activity_samples_faction_sampled
  ON home_faction_activity_samples(faction_id, sampled_at);

CREATE INDEX IF NOT EXISTS idx_home_faction_activity_samples_sampled
  ON home_faction_activity_samples(sampled_at);

CREATE INDEX IF NOT EXISTS idx_enemy_faction_activity_samples_war_bucket
  ON enemy_faction_activity_samples(war_id, date, interval_index);

CREATE INDEX IF NOT EXISTS idx_enemy_faction_activity_samples_faction_sampled
  ON enemy_faction_activity_samples(faction_id, sampled_at);

CREATE INDEX IF NOT EXISTS idx_enemy_member_activity_samples_war_member
  ON enemy_member_activity_samples(war_id, member_id, date, interval_index);

CREATE INDEX IF NOT EXISTS idx_enemy_member_activity_samples_war_bucket
  ON enemy_member_activity_samples(war_id, date, interval_index);
