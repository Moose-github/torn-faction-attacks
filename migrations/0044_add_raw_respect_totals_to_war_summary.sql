ALTER TABLE war_summary
  ADD COLUMN total_respect_gain_raw REAL NOT NULL DEFAULT 0;

ALTER TABLE war_summary
  ADD COLUMN total_respect_lost_raw REAL NOT NULL DEFAULT 0;

UPDATE war_summary
SET
  total_respect_gain_raw = total_respect_gain,
  total_respect_lost_raw = total_respect_lost;
