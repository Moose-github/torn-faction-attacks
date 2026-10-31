-- One Discord message per opening attack. Finalized rows retain only a short-lived
-- deduplication marker; message references are cleared after the final edit.
CREATE TABLE retaliation_discord_messages (
  opening_attack_id INTEGER PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  discord_message_id TEXT,
  discord_channel_id TEXT,
  last_rendered_hash TEXT,
  last_edited_at INTEGER,
  finalized_at INTEGER,
  lease_token TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_retaliation_discord_messages_active
  ON retaliation_discord_messages(finalized_at, expires_at);

CREATE INDEX idx_attacks_retaliation_openings
  ON attacks(defender_faction_id, ended, id)
  WHERE result IN ('Hospitalized','Mugged','Attacked','Arrested');
