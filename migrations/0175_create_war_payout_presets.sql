CREATE TABLE war_payout_presets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(name)) BETWEEN 1 AND 80),
  config_json TEXT NOT NULL CHECK (json_valid(config_json)),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  created_by INTEGER NOT NULL,
  updated_by INTEGER NOT NULL
);
