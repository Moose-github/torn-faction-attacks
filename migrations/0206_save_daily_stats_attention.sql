-- Saved missing member/date pairs, including pending and accepted issues.
-- Status, errors and acceptance are read from their existing authoritative rows.
CREATE TABLE daily_stats_attention_gaps (
  member_id INTEGER NOT NULL,
  snapshot_date TEXT NOT NULL,
  PRIMARY KEY (member_id, snapshot_date)
);
CREATE INDEX idx_daily_stats_attention_gaps_date
  ON daily_stats_attention_gaps(snapshot_date);
CREATE INDEX idx_daily_stats_issue_acceptances_date
  ON daily_stats_issue_acceptances(snapshot_date);

-- One-time historical bootstrap preserves existing old unresolved and accepted
-- issues. Normal runtime audits are bounded to the last seven completed dates.
WITH tracked_dates(snapshot_date) AS (
  SELECT snapshot_date FROM member_lifestyle_stat_snapshots
  UNION SELECT snapshot_date FROM member_personal_stats_recent
  UNION SELECT snapshot_date FROM daily_stats_issue_acceptances
  UNION SELECT date('now', '-2 days')
)
INSERT INTO daily_stats_attention_gaps (member_id, snapshot_date)
SELECT m.member_id, dates.snapshot_date
FROM tracked_dates dates
JOIN home_faction_members m ON m.faction_id = 8803
  AND m.is_current = 1 AND m.report_exempt = 0
  AND (m.current_join_date IS NULL OR dates.snapshot_date >= m.current_join_date)
WHERE dates.snapshot_date <= date('now')
  AND NOT EXISTS (SELECT 1 FROM member_lifestyle_stat_snapshots s
    WHERE s.member_id = m.member_id AND s.snapshot_date = dates.snapshot_date
      AND s.personal_ready = 1);

-- These run in the same transaction as collection/repair writes. Existing queue
-- rows expose changed errors/status immediately without rewriting the gap table.
CREATE TRIGGER daily_attention_queue_insert AFTER INSERT ON member_personal_stats_recent
BEGIN
  INSERT OR IGNORE INTO daily_stats_attention_gaps (member_id, snapshot_date)
  SELECT NEW.member_id, NEW.snapshot_date
  WHERE EXISTS (SELECT 1 FROM home_faction_members m
    WHERE m.member_id = NEW.member_id AND m.faction_id = 8803
      AND m.is_current = 1 AND m.report_exempt = 0
      AND (m.current_join_date IS NULL OR NEW.snapshot_date >= m.current_join_date))
    AND NOT EXISTS (SELECT 1 FROM member_lifestyle_stat_snapshots s
      WHERE s.member_id = NEW.member_id AND s.snapshot_date = NEW.snapshot_date
        AND s.personal_ready = 1);
END;

CREATE TRIGGER daily_attention_snapshot_insert AFTER INSERT ON member_lifestyle_stat_snapshots
BEGIN
  DELETE FROM daily_stats_attention_gaps
  WHERE member_id = NEW.member_id AND snapshot_date = NEW.snapshot_date
    AND NEW.personal_ready = 1;
  INSERT OR IGNORE INTO daily_stats_attention_gaps (member_id, snapshot_date)
  SELECT NEW.member_id, NEW.snapshot_date
  WHERE EXISTS (SELECT 1 FROM home_faction_members m
    WHERE m.member_id = NEW.member_id AND m.faction_id = 8803
      AND m.is_current = 1 AND m.report_exempt = 0
      AND (m.current_join_date IS NULL OR NEW.snapshot_date >= m.current_join_date))
    AND NOT EXISTS (SELECT 1 FROM member_lifestyle_stat_snapshots s
      WHERE s.member_id = NEW.member_id AND s.snapshot_date = NEW.snapshot_date
        AND s.personal_ready = 1);
END;

CREATE TRIGGER daily_attention_snapshot_ready AFTER UPDATE OF personal_ready ON member_lifestyle_stat_snapshots
WHEN OLD.personal_ready IS NOT NEW.personal_ready
BEGIN
  DELETE FROM daily_stats_attention_gaps
  WHERE member_id = NEW.member_id AND snapshot_date = NEW.snapshot_date
    AND NEW.personal_ready = 1;
  INSERT OR IGNORE INTO daily_stats_attention_gaps (member_id, snapshot_date)
  SELECT NEW.member_id, NEW.snapshot_date
  WHERE EXISTS (SELECT 1 FROM home_faction_members m
    WHERE m.member_id = NEW.member_id AND m.faction_id = 8803
      AND m.is_current = 1 AND m.report_exempt = 0
      AND (m.current_join_date IS NULL OR NEW.snapshot_date >= m.current_join_date))
    AND NOT EXISTS (SELECT 1 FROM member_lifestyle_stat_snapshots s
      WHERE s.member_id = NEW.member_id AND s.snapshot_date = NEW.snapshot_date
        AND s.personal_ready = 1);
END;

CREATE TRIGGER daily_attention_snapshot_delete AFTER DELETE ON member_lifestyle_stat_snapshots
BEGIN
  INSERT OR IGNORE INTO daily_stats_attention_gaps (member_id, snapshot_date)
  SELECT OLD.member_id, OLD.snapshot_date
  WHERE EXISTS (SELECT 1 FROM home_faction_members m
    WHERE m.member_id = OLD.member_id AND m.faction_id = 8803
      AND m.is_current = 1 AND m.report_exempt = 0
      AND (m.current_join_date IS NULL OR OLD.snapshot_date >= m.current_join_date))
    AND NOT EXISTS (SELECT 1 FROM member_lifestyle_stat_snapshots s
      WHERE s.member_id = OLD.member_id AND s.snapshot_date = OLD.snapshot_date
        AND s.personal_ready = 1);
END;

CREATE TRIGGER daily_attention_acceptance_insert AFTER INSERT ON daily_stats_issue_acceptances
BEGIN
  INSERT OR IGNORE INTO daily_stats_attention_gaps (member_id, snapshot_date)
  SELECT NEW.member_id, NEW.snapshot_date
  WHERE EXISTS (SELECT 1 FROM home_faction_members m
    WHERE m.member_id = NEW.member_id AND m.faction_id = 8803
      AND m.is_current = 1 AND m.report_exempt = 0
      AND (m.current_join_date IS NULL OR NEW.snapshot_date >= m.current_join_date))
    AND NOT EXISTS (SELECT 1 FROM member_lifestyle_stat_snapshots s
      WHERE s.member_id = NEW.member_id AND s.snapshot_date = NEW.snapshot_date
        AND s.personal_ready = 1);
END;
