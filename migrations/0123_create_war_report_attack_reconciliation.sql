CREATE TABLE war_report_attack_reconciliation_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  war_id INTEGER NOT NULL,
  torn_report_fetched_at INTEGER,
  official_start_time INTEGER NOT NULL,
  official_end_time INTEGER NOT NULL,
  member_ids_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  torn_attacks_fetched INTEGER NOT NULL DEFAULT 0,
  comparable_torn_attacks INTEGER NOT NULL DEFAULT 0,
  local_attacks_checked INTEGER NOT NULL DEFAULT 0,
  findings_count INTEGER NOT NULL DEFAULT 0,
  truncated INTEGER NOT NULL DEFAULT 0 CHECK (truncated IN (0, 1)),
  error TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  completed_at INTEGER
);

CREATE TABLE war_report_attack_reconciliation_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES war_report_attack_reconciliation_runs(id) ON DELETE CASCADE,
  war_id INTEGER NOT NULL,
  member_id INTEGER NOT NULL,
  member_name TEXT,
  attack_id INTEGER,
  attack_code TEXT,
  source TEXT NOT NULL CHECK (source IN ('torn', 'local', 'both')),
  classification TEXT NOT NULL,
  reason TEXT NOT NULL,
  started INTEGER,
  ended INTEGER,
  attacker_id INTEGER,
  attacker_name TEXT,
  defender_id INTEGER,
  defender_name TEXT,
  defender_faction_id INTEGER,
  defender_faction_name TEXT,
  result TEXT,
  respect_gain REAL,
  chain INTEGER,
  local_war_id INTEGER,
  local_included INTEGER CHECK (local_included IN (0, 1)),
  torn_included INTEGER CHECK (torn_included IN (0, 1)),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_report_attack_recon_runs_war
  ON war_report_attack_reconciliation_runs(war_id, created_at DESC);

CREATE INDEX idx_report_attack_recon_runs_report
  ON war_report_attack_reconciliation_runs(war_id, torn_report_fetched_at);

CREATE INDEX idx_report_attack_recon_items_run
  ON war_report_attack_reconciliation_items(run_id, member_id, classification);
