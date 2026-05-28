CREATE TABLE IF NOT EXISTS xanax_competition_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 1,
  base_prize INTEGER NOT NULL DEFAULT 10000000,
  rollover_count INTEGER NOT NULL DEFAULT 0,
  last_rollover_month_key TEXT,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS xanax_competition_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  month_key TEXT NOT NULL UNIQUE,
  member_id INTEGER NOT NULL,
  member_name TEXT,
  xantaken INTEGER NOT NULL DEFAULT 0,
  prize_paid INTEGER NOT NULL,
  claimed_by_torn_user_id INTEGER,
  claimed_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_xanax_competition_claims_claimed
  ON xanax_competition_claims(claimed_at DESC);
