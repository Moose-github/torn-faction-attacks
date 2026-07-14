CREATE TABLE IF NOT EXISTS retaliation_claim_signals (
  opening_attack_id INTEGER PRIMARY KEY,
  target_id INTEGER NOT NULL,
  claimant_torn_user_id INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('dashboard', 'tampermonkey')),
  attack_url TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_retaliation_claim_signals_expires
  ON retaliation_claim_signals(expires_at);

CREATE INDEX IF NOT EXISTS idx_retaliation_claim_signals_target
  ON retaliation_claim_signals(target_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS retaliation_board_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  discord_message_id TEXT,
  last_rendered_hash TEXT,
  last_edited_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_attacks_retaliation_enemy_list
  ON attacks(defender_faction_id, started DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_attacks_retaliation_claim_lookup
  ON attacks(defender_id, attacker_faction_id, started DESC, id DESC);

INSERT OR IGNORE INTO alert_settings (alert_key, enabled, configurable, scope, updated_at)
VALUES ('retaliation_board', 1, 1, 'global', unixepoch());
