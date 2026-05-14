CREATE TABLE IF NOT EXISTS war_member_activity_buckets (
  war_id INTEGER NOT NULL,
  member_id INTEGER NOT NULL,
  bucket_start INTEGER NOT NULL,

  attacks_successful INTEGER NOT NULL DEFAULT 0,
  outside_hits INTEGER NOT NULL DEFAULT 0,
  defends_lost INTEGER NOT NULL DEFAULT 0,

  respect_gained REAL NOT NULL DEFAULT 0,
  respect_lost REAL NOT NULL DEFAULT 0,

  PRIMARY KEY (war_id, member_id, bucket_start),
  FOREIGN KEY (war_id) REFERENCES wars(id)
);

CREATE INDEX IF NOT EXISTS idx_war_member_activity_buckets_war_bucket
  ON war_member_activity_buckets(war_id, bucket_start);

CREATE INDEX IF NOT EXISTS idx_war_member_activity_buckets_war_member
  ON war_member_activity_buckets(war_id, member_id);

