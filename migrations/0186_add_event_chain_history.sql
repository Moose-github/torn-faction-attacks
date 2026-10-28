CREATE TABLE event_chain_history (
  war_id INTEGER NOT NULL REFERENCES wars(id) ON DELETE CASCADE,
  sampled_at INTEGER NOT NULL,
  chain_count INTEGER,
  attack_id INTEGER,
  recorded_at INTEGER NOT NULL,
  PRIMARY KEY (war_id, sampled_at)
);
