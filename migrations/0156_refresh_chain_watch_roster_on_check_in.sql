-- Confirmation and invalidation must queue every sheet touched by the shift,
-- including the following UTC day, in the same transaction as the status change.
CREATE TRIGGER chain_watch_check_in_roster_changed
AFTER UPDATE OF confirmed_at, cancelled_at ON chain_watch_check_ins
WHEN OLD.confirmed_at IS NOT NEW.confirmed_at OR OLD.cancelled_at IS NOT NEW.cancelled_at
BEGIN
  UPDATE chain_watch_sheets SET dirty = dirty + 1
    WHERE watch_id = NEW.watch_id AND start_at < MAX(OLD.end_at, NEW.end_at) AND end_at > NEW.start_at;
END;

-- Existing open rosters need the new coverage labels even within the same hour.
UPDATE chain_watch_sheets SET dirty = dirty + 1
  WHERE watch_id IN (SELECT id FROM chain_watch_schedules WHERE is_open = 1);
