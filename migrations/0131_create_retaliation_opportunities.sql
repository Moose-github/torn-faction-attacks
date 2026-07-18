CREATE TABLE IF NOT EXISTS retaliation_opportunities (
  target_id INTEGER PRIMARY KEY,
  opening_attack_id INTEGER NOT NULL,
  attack_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  code TEXT,
  started INTEGER,
  ended INTEGER NOT NULL,
  attacker_id INTEGER NOT NULL,
  attacker_name TEXT,
  attacker_faction_id INTEGER,
  attacker_faction_name TEXT,
  defender_id INTEGER,
  defender_name TEXT,
  defender_faction_id INTEGER,
  defender_faction_name TEXT,
  result TEXT NOT NULL,
  respect_gain REAL DEFAULT 0,
  respect_loss REAL DEFAULT 0,
  m_retaliation REAL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_retaliation_opportunities_opening_attack
  ON retaliation_opportunities(opening_attack_id);

CREATE INDEX IF NOT EXISTS idx_retaliation_opportunities_attack_at
  ON retaliation_opportunities(attack_at DESC, opening_attack_id DESC);

CREATE INDEX IF NOT EXISTS idx_retaliation_opportunities_expires
  ON retaliation_opportunities(expires_at);

INSERT OR IGNORE INTO retaliation_opportunities (
  target_id,
  opening_attack_id,
  attack_at,
  expires_at,
  code,
  started,
  ended,
  attacker_id,
  attacker_name,
  attacker_faction_id,
  attacker_faction_name,
  defender_id,
  defender_name,
  defender_faction_id,
  defender_faction_name,
  result,
  respect_gain,
  respect_loss,
  m_retaliation,
  created_at,
  updated_at
)
SELECT
  a.attacker_id AS target_id,
  a.id AS opening_attack_id,
  a.ended AS attack_at,
  a.ended + 300 AS expires_at,
  a.code,
  a.started,
  a.ended,
  a.attacker_id,
  a.attacker_name,
  a.attacker_faction_id,
  a.attacker_faction_name,
  a.defender_id,
  a.defender_name,
  a.defender_faction_id,
  a.defender_faction_name,
  a.result,
  a.respect_gain,
  a.respect_loss,
  a.m_retaliation,
  unixepoch(),
  unixepoch()
FROM attacks a
WHERE a.attacker_id IS NOT NULL
  AND a.defender_faction_id = 8803
  AND a.result IN ('Hospitalized', 'Mugged', 'Attacked', 'Arrested')
  AND a.ended IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM attacks newer
    WHERE newer.attacker_id = a.attacker_id
      AND newer.defender_faction_id = 8803
      AND newer.result IN ('Hospitalized', 'Mugged', 'Attacked', 'Arrested')
      AND newer.ended IS NOT NULL
      AND (
        newer.ended > a.ended
        OR (newer.ended = a.ended AND newer.id > a.id)
      )
  );
