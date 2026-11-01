-- Respect totals changed since the war's queue was last applied. Bonus hits
-- are revisited only when their own or fallback average may have moved.
CREATE TABLE war_respect_changes (
  war_id INTEGER NOT NULL REFERENCES wars(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK(direction IN ('outgoing', 'incoming')),
  attacker_id INTEGER NOT NULL,
  PRIMARY KEY (war_id, direction, attacker_id)
);

CREATE TRIGGER war_respect_change_insert AFTER INSERT ON war_respect_totals
BEGIN
  INSERT INTO war_respect_changes (war_id, direction, attacker_id)
  VALUES (NEW.war_id, NEW.direction, NEW.attacker_id)
  ON CONFLICT(war_id, direction, attacker_id) DO NOTHING;
END;

CREATE TRIGGER war_respect_change_update AFTER UPDATE ON war_respect_totals
BEGIN
  INSERT INTO war_respect_changes (war_id, direction, attacker_id)
  VALUES (NEW.war_id, NEW.direction, NEW.attacker_id)
  ON CONFLICT(war_id, direction, attacker_id) DO NOTHING;
END;

CREATE TRIGGER war_respect_change_delete AFTER DELETE ON war_respect_totals
BEGIN
  INSERT INTO war_respect_changes (war_id, direction, attacker_id)
  SELECT OLD.war_id, OLD.direction, OLD.attacker_id
  WHERE EXISTS (SELECT 1 FROM wars WHERE id = OLD.war_id)
  ON CONFLICT(war_id, direction, attacker_id) DO NOTHING;
END;

-- Work queued before this migration has no change rows. Mark every total for
-- those wars so their next run revisits all bonus hits, as before.
INSERT INTO war_respect_changes (war_id, direction, attacker_id)
SELECT t.war_id, t.direction, t.attacker_id FROM war_respect_totals t
WHERE t.war_id IN (SELECT war_id FROM war_stats_dirty UNION SELECT war_id FROM event_stats_dirty)
ON CONFLICT(war_id, direction, attacker_id) DO NOTHING;
