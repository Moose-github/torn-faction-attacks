-- Events select attacks by window instead of owning them through war_id. Store
-- that membership on the attack, like war_id, so an attack can belong to a war
-- and an event, and both can read their attacks through the same kind of index.
-- Events never overlap each other (readTrackerOverlap), so one column suffices.
-- The rule matches the tracker_attacks view's event branch (EVENT_ATTACK_MATCH_SQL).
ALTER TABLE attacks ADD COLUMN event_id INTEGER;

UPDATE attacks SET event_id = w.id
FROM wars w
WHERE w.war_type = 'event'
  AND attacks.started >= w.practical_start_time
  AND (w.practical_finish_time IS NULL OR COALESCE(attacks.ended, attacks.started) <= w.practical_finish_time)
  AND (attacks.attacker_faction_id = 8803 OR attacks.defender_faction_id = 8803);

-- Only event attacks enter these indexes.
CREATE INDEX idx_attacks_event_attacker_started ON attacks (event_id, attacker_id, started)
WHERE event_id IS NOT NULL;
CREATE INDEX idx_attacks_event_defender_started ON attacks (event_id, defender_id, started)
WHERE event_id IS NOT NULL;

-- Ingestion sets event_id inline; this corrects only inserts that did not.
CREATE TRIGGER attack_event_id_insert AFTER INSERT ON attacks
WHEN NEW.event_id IS NOT (
  SELECT w.id FROM wars w
  WHERE w.war_type = 'event'
    AND NEW.started >= w.practical_start_time
    AND (w.practical_finish_time IS NULL OR COALESCE(NEW.ended, NEW.started) <= w.practical_finish_time)
    AND (NEW.attacker_faction_id = 8803 OR NEW.defender_faction_id = 8803)
  ORDER BY w.id LIMIT 1
)
BEGIN
  UPDATE attacks SET event_id = (
    SELECT w.id FROM wars w
    WHERE w.war_type = 'event'
      AND NEW.started >= w.practical_start_time
      AND (w.practical_finish_time IS NULL OR COALESCE(NEW.ended, NEW.started) <= w.practical_finish_time)
      AND (NEW.attacker_faction_id = 8803 OR NEW.defender_faction_id = 8803)
    ORDER BY w.id LIMIT 1
  ) WHERE id = NEW.id;
END;

-- Completion updates fill in ended, which can move an attack past a finish time.
CREATE TRIGGER attack_event_id_update AFTER UPDATE OF started, ended, attacker_faction_id, defender_faction_id ON attacks
WHEN NEW.event_id IS NOT (
  SELECT w.id FROM wars w
  WHERE w.war_type = 'event'
    AND NEW.started >= w.practical_start_time
    AND (w.practical_finish_time IS NULL OR COALESCE(NEW.ended, NEW.started) <= w.practical_finish_time)
    AND (NEW.attacker_faction_id = 8803 OR NEW.defender_faction_id = 8803)
  ORDER BY w.id LIMIT 1
)
BEGIN
  UPDATE attacks SET event_id = (
    SELECT w.id FROM wars w
    WHERE w.war_type = 'event'
      AND NEW.started >= w.practical_start_time
      AND (w.practical_finish_time IS NULL OR COALESCE(NEW.ended, NEW.started) <= w.practical_finish_time)
      AND (NEW.attacker_faction_id = 8803 OR NEW.defender_faction_id = 8803)
    ORDER BY w.id LIMIT 1
  ) WHERE id = NEW.id;
END;

CREATE TRIGGER attack_event_id_war_insert AFTER INSERT ON wars
WHEN NEW.war_type = 'event'
BEGIN
  UPDATE attacks SET event_id = NEW.id
  WHERE started >= NEW.practical_start_time
    AND (NEW.practical_finish_time IS NULL OR COALESCE(ended, started) <= NEW.practical_finish_time)
    AND (attacker_faction_id = 8803 OR defender_faction_id = 8803)
    AND event_id IS NOT NEW.id;
END;

-- Window edits and type changes touch only attacks whose membership changes.
CREATE TRIGGER attack_event_id_war_update AFTER UPDATE OF war_type, practical_start_time, practical_finish_time ON wars
WHEN (OLD.war_type = 'event' OR NEW.war_type = 'event')
  AND (OLD.war_type IS NOT NEW.war_type
    OR OLD.practical_start_time IS NOT NEW.practical_start_time
    OR OLD.practical_finish_time IS NOT NEW.practical_finish_time)
BEGIN
  UPDATE attacks SET event_id = NULL
  WHERE event_id = NEW.id
    AND NOT COALESCE(NEW.war_type = 'event'
      AND started >= NEW.practical_start_time
      AND (NEW.practical_finish_time IS NULL OR COALESCE(ended, started) <= NEW.practical_finish_time)
      AND (attacker_faction_id = 8803 OR defender_faction_id = 8803), 0);
  UPDATE attacks SET event_id = NEW.id
  WHERE NEW.war_type = 'event'
    AND started >= NEW.practical_start_time
    AND (NEW.practical_finish_time IS NULL OR COALESCE(ended, started) <= NEW.practical_finish_time)
    AND (attacker_faction_id = 8803 OR defender_faction_id = 8803)
    AND event_id IS NOT NEW.id;
END;

CREATE TRIGGER attack_event_id_war_delete AFTER DELETE ON wars
WHEN OLD.war_type = 'event'
BEGIN
  UPDATE attacks SET event_id = NULL WHERE event_id = OLD.id;
END;
