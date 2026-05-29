ALTER TABLE home_faction_members ADD COLUMN report_exempt INTEGER NOT NULL DEFAULT 0;
ALTER TABLE home_faction_members ADD COLUMN report_exempt_reason TEXT;
ALTER TABLE home_faction_members ADD COLUMN report_exempt_updated_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_home_faction_members_reportable
  ON home_faction_members(faction_id, is_current, report_exempt, member_id);
