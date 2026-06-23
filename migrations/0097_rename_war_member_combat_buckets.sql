ALTER TABLE war_member_activity_buckets
  RENAME TO war_member_combat_buckets;

DROP INDEX IF EXISTS idx_war_member_activity_buckets_war_bucket;

CREATE INDEX IF NOT EXISTS idx_war_member_combat_buckets_war_bucket
  ON war_member_combat_buckets(war_id, bucket_start);
