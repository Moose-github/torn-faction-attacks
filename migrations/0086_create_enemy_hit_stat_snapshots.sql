CREATE TABLE IF NOT EXISTS enemy_hit_stat_snapshots (
  war_id INTEGER NOT NULL,
  faction_id INTEGER NOT NULL,
  member_id INTEGER NOT NULL,
  member_name TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,
  snapshot_kind TEXT NOT NULL,
  requested_at INTEGER,
  rankedwarhits INTEGER,
  attackhits INTEGER,
  temphits INTEGER,
  piercinghits INTEGER,
  slashinghits INTEGER,
  clubbinghits INTEGER,
  mechanicalhits INTEGER,
  h2hhits INTEGER,
  retals INTEGER,
  specialammoused INTEGER,
  rankedwarhits_timestamp INTEGER,
  attackhits_timestamp INTEGER,
  temphits_timestamp INTEGER,
  piercinghits_timestamp INTEGER,
  slashinghits_timestamp INTEGER,
  clubbinghits_timestamp INTEGER,
  mechanicalhits_timestamp INTEGER,
  h2hhits_timestamp INTEGER,
  retals_timestamp INTEGER,
  specialammoused_timestamp INTEGER,
  attempted_at INTEGER,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  key_source TEXT,
  completed_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (war_id, faction_id, member_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_enemy_hit_stat_snapshots_pending
  ON enemy_hit_stat_snapshots(war_id, faction_id, completed_at, attempt_count, attempted_at, snapshot_kind, snapshot_date, member_name)
  WHERE completed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_enemy_hit_stat_snapshots_member
  ON enemy_hit_stat_snapshots(war_id, faction_id, member_id, snapshot_date);
