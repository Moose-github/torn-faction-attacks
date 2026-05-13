ALTER TABLE enemy_faction_members ADD COLUMN bsp_battlestats INTEGER;

ALTER TABLE enemy_faction_members ADD COLUMN bsp_battlestats_updated_at INTEGER;

ALTER TABLE enemy_faction_members ADD COLUMN bsp_battlestats_result INTEGER;

ALTER TABLE enemy_faction_members ADD COLUMN bsp_battlestats_reason TEXT;

ALTER TABLE enemy_faction_members ADD COLUMN bsp_battlestats_prediction_date TEXT;

ALTER TABLE home_faction_members ADD COLUMN bsp_battlestats INTEGER;

ALTER TABLE home_faction_members ADD COLUMN bsp_battlestats_updated_at INTEGER;

ALTER TABLE home_faction_members ADD COLUMN bsp_battlestats_result INTEGER;

ALTER TABLE home_faction_members ADD COLUMN bsp_battlestats_reason TEXT;

ALTER TABLE home_faction_members ADD COLUMN bsp_battlestats_prediction_date TEXT;
