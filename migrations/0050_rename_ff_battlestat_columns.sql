ALTER TABLE enemy_faction_members RENAME COLUMN estimated_stats TO ff_battlestats;

ALTER TABLE enemy_faction_members RENAME COLUMN estimated_stats_updated_at TO ff_battlestats_updated_at;

ALTER TABLE home_faction_members RENAME COLUMN estimated_stats TO ff_battlestats;

ALTER TABLE home_faction_members RENAME COLUMN estimated_stats_updated_at TO ff_battlestats_updated_at;
