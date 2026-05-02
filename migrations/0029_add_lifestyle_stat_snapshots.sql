ALTER TABLE member_lifestyle_stats ADD COLUMN useractivity INTEGER;

CREATE TABLE member_lifestyle_stat_snapshots (
  member_id INTEGER NOT NULL,
  snapshot_date TEXT NOT NULL,
  member_name TEXT,
  xantaken INTEGER,
  overdosed INTEGER,
  refills INTEGER,
  useractivity INTEGER,
  gymenergy INTEGER,
  gymstrength INTEGER,
  gymspeed INTEGER,
  gymdefense INTEGER,
  gymdexterity INTEGER,
  captured_at INTEGER NOT NULL,
  PRIMARY KEY (member_id, snapshot_date)
);

CREATE INDEX idx_member_lifestyle_snapshots_date
  ON member_lifestyle_stat_snapshots(snapshot_date);
