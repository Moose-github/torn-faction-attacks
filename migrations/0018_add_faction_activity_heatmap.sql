CREATE TABLE IF NOT EXISTS faction_activity_heatmap (
  faction_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  interval_index INTEGER NOT NULL,
  active_count INTEGER NOT NULL,
  total_count INTEGER NOT NULL,
  sampled_at INTEGER NOT NULL,
  PRIMARY KEY (faction_id, date, interval_index)
);

CREATE INDEX IF NOT EXISTS idx_faction_activity_heatmap_sampled
  ON faction_activity_heatmap(sampled_at);
