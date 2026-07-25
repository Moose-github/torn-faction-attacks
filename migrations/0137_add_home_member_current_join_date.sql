ALTER TABLE home_faction_members ADD COLUMN current_join_date TEXT;

UPDATE home_faction_members
SET current_join_date = CASE
  WHEN member_id = 3889541 THEN '2026-07-06'
  WHEN days_in_faction IS NOT NULL AND updated_at IS NOT NULL
    THEN date(updated_at, 'unixepoch', '-' || days_in_faction || ' days')
  ELSE NULL
END
WHERE is_current = 1;

CREATE INDEX IF NOT EXISTS idx_home_faction_members_reportable_join
  ON home_faction_members(faction_id, is_current, report_exempt, current_join_date, member_id);
