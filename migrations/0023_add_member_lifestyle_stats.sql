CREATE TABLE member_lifestyle_stats (
  member_id INTEGER PRIMARY KEY,
  member_name TEXT,
  level INTEGER,
  position TEXT,
  xantaken INTEGER,
  overdosed INTEGER,
  drugsused INTEGER,
  refills INTEGER,
  statenhancersused INTEGER,
  energydrinkused INTEGER,
  boostersused INTEGER,
  alcoholused INTEGER,
  candyused INTEGER,
  rehabs INTEGER,
  useractivity INTEGER,
  updated_at INTEGER,
  error TEXT
);

CREATE INDEX idx_member_lifestyle_stats_updated
  ON member_lifestyle_stats(updated_at);
