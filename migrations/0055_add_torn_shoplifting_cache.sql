CREATE TABLE IF NOT EXISTS torn_shoplifting_cache (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data_json TEXT,
  fetched_at INTEGER,
  error TEXT,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
