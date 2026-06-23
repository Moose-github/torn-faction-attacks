CREATE TABLE IF NOT EXISTS enemy_big_hitters (
  war_id INTEGER NOT NULL,
  faction_id INTEGER NOT NULL,
  member_id INTEGER NOT NULL,
  member_name TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (war_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_enemy_big_hitters_faction
  ON enemy_big_hitters(faction_id, member_name);
