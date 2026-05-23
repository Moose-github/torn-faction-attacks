ALTER TABLE home_faction_members ADD COLUMN is_current INTEGER NOT NULL DEFAULT 1;

UPDATE home_faction_members
SET is_current = CASE
  WHEN updated_at >= (
    SELECT COALESCE(MAX(updated_at), 0) - 300
    FROM home_faction_members
  )
  THEN 1
  ELSE 0
END;

CREATE INDEX IF NOT EXISTS idx_home_faction_members_current
  ON home_faction_members(is_current, member_id);
