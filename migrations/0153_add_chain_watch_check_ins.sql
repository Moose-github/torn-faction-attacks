ALTER TABLE chain_watch_slots ADD COLUMN check_in_revision INTEGER NOT NULL DEFAULT 0;

CREATE TABLE chain_watch_check_ins (
  id TEXT PRIMARY KEY,
  watch_id TEXT NOT NULL REFERENCES chain_watch_schedules(id),
  start_at INTEGER NOT NULL,
  end_at INTEGER NOT NULL,
  assignment_revision INTEGER NOT NULL,
  assigned_to INTEGER NOT NULL,
  discord_user_id TEXT,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  watch_name TEXT NOT NULL,
  member_name TEXT NOT NULL,
  reminder_message_id TEXT,
  reminder_sent_at INTEGER,
  confirmed_at INTEGER,
  escalation_message_id TEXT,
  escalation_channel_id TEXT,
  escalation_sent_at INTEGER,
  escalation_kind TEXT,
  reminder_error TEXT,
  cancelled_at INTEGER,
  closed_at INTEGER,
  dirty INTEGER NOT NULL DEFAULT 1,
  lease_token TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE(watch_id, start_at, assignment_revision),
  FOREIGN KEY(watch_id, start_at) REFERENCES chain_watch_slots(watch_id, start_at)
);
CREATE INDEX chain_watch_check_ins_pending ON chain_watch_check_ins(closed_at, cancelled_at, dirty);

CREATE TRIGGER chain_watch_invalidate_check_in AFTER UPDATE OF assigned_to, cancelled ON chain_watch_slots
WHEN OLD.assigned_to IS NOT NEW.assigned_to OR OLD.cancelled != NEW.cancelled
BEGIN
  -- A merge/split also changes the identity of the following shift. Bump its
  -- revision so a merge followed by an undo cannot revive an old button.
  UPDATE chain_watch_slots SET check_in_revision = check_in_revision + 1
    WHERE watch_id = NEW.watch_id AND (start_at = NEW.start_at OR
      (start_at = NEW.start_at + 3600 AND
        CASE WHEN assigned_to = OLD.assigned_to AND OLD.cancelled = 0 THEN 1 ELSE 0 END !=
        CASE WHEN assigned_to = NEW.assigned_to AND NEW.cancelled = 0 THEN 1 ELSE 0 END));
  UPDATE chain_watch_check_ins SET cancelled_at = unixepoch(), dirty = dirty + 1
    WHERE watch_id = NEW.watch_id AND cancelled_at IS NULL AND closed_at IS NULL
      AND assignment_revision != (SELECT check_in_revision FROM chain_watch_slots s
        WHERE s.watch_id = chain_watch_check_ins.watch_id AND s.start_at = chain_watch_check_ins.start_at);
  -- Shortening a multi-hour shift must take effect before the next cron tick.
  UPDATE chain_watch_check_ins SET end_at = NEW.start_at, dirty = dirty + 1
    WHERE watch_id = NEW.watch_id AND start_at < NEW.start_at AND end_at > NEW.start_at
      AND assigned_to = OLD.assigned_to AND cancelled_at IS NULL AND closed_at IS NULL;
END;
