CREATE TABLE IF NOT EXISTS enemy_faction_members (
  member_id INTEGER PRIMARY KEY,
  faction_id INTEGER NOT NULL,
  faction_name TEXT,
  name TEXT NOT NULL,
  level INTEGER,
  position TEXT,
  days_in_faction INTEGER,
  is_revivable INTEGER,
  estimated_stats INTEGER,
  estimated_stats_updated_at INTEGER,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_enemy_faction_members_faction
  ON enemy_faction_members(faction_id);
