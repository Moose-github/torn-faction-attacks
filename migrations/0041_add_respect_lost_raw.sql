ALTER TABLE war_member_stats
  ADD COLUMN respect_lost_raw REAL NOT NULL DEFAULT 0;

UPDATE war_member_stats
SET respect_lost_raw = respect_lost;
