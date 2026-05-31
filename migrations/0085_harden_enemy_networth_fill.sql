ALTER TABLE enemy_faction_members ADD COLUMN networth_attempted_at INTEGER;

ALTER TABLE enemy_faction_members ADD COLUMN networth_attempt_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE enemy_faction_members ADD COLUMN networth_error TEXT;

ALTER TABLE enemy_faction_members ADD COLUMN networth_key_source TEXT;

CREATE INDEX IF NOT EXISTS idx_enemy_faction_members_pending_networth
  ON enemy_faction_members(
    faction_id,
    networth_updated_at,
    networth_attempt_count,
    networth_attempted_at,
    level DESC,
    name
  )
  WHERE networth_updated_at IS NULL;
