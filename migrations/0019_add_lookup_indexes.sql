CREATE UNIQUE INDEX IF NOT EXISTS idx_wars_torn_war_id_unique
  ON wars(torn_war_id)
  WHERE torn_war_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wars_lower_name
  ON wars(LOWER(name));

CREATE INDEX IF NOT EXISTS idx_enemy_faction_members_ranked
  ON enemy_faction_members(faction_id, estimated_stats DESC, level DESC, name);

CREATE INDEX IF NOT EXISTS idx_home_faction_members_ranked
  ON home_faction_members(faction_id, estimated_stats DESC, level DESC, name);

CREATE INDEX IF NOT EXISTS idx_faction_activity_heatmap_faction_sampled
  ON faction_activity_heatmap(faction_id, sampled_at);
