-- Pending confirmations are bound to the member and exact remaining shift.
-- Completed rows also retain the takeover history for the public messages.
ALTER TABLE chain_watch_check_ins ADD COLUMN takeover_button_shown INTEGER NOT NULL DEFAULT 0;

CREATE TABLE chain_watch_takeovers (
  id TEXT PRIMARY KEY,
  check_in_id TEXT NOT NULL REFERENCES chain_watch_check_ins(id),
  member_id INTEGER NOT NULL,
  member_name TEXT NOT NULL,
  discord_user_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  start_at INTEGER NOT NULL,
  end_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  confirmed_at INTEGER,
  CHECK (start_at % 3600 = 0 AND end_at % 3600 = 0 AND end_at > start_at)
);
CREATE UNIQUE INDEX chain_watch_takeovers_completed ON chain_watch_takeovers(check_in_id) WHERE confirmed_at IS NOT NULL;
CREATE INDEX chain_watch_takeovers_expiry ON chain_watch_takeovers(expires_at) WHERE confirmed_at IS NULL;

-- A takeover can merge into an unchanged adjacent hour on another daily sheet.
-- Its seeded confirmation must refresh that sheet as well as the reassigned one.
CREATE TRIGGER chain_watch_check_in_roster_created AFTER INSERT ON chain_watch_check_ins
WHEN NEW.confirmed_at IS NOT NULL
BEGIN
  UPDATE chain_watch_sheets SET dirty = dirty + 1
    WHERE watch_id = NEW.watch_id AND start_at < NEW.end_at AND end_at > NEW.start_at;
END;

-- The conditional confirmation UPDATE and every assignment below are one
-- atomic statement. Any failed guard rolls back the confirmation as well.
CREATE TRIGGER chain_watch_complete_takeover AFTER UPDATE OF confirmed_at ON chain_watch_takeovers
WHEN OLD.confirmed_at IS NULL AND NEW.confirmed_at IS NOT NULL
BEGIN
  UPDATE chain_watch_slots
    SET assigned_to = NEW.member_id, assignment_actor = NEW.member_id,
      admin_override = 1, updated_at = unixepoch()
    WHERE watch_id = (SELECT watch_id FROM chain_watch_check_ins WHERE id = NEW.check_in_id)
      AND start_at >= NEW.start_at AND start_at < NEW.end_at;

  -- Taking an occupied/started slot is permitted here, but the normal break
  -- rule still applies, including adjacent assignments across midnight.
  SELECT RAISE(ABORT, 'WATCH_BREAK_REQUIRED') WHERE EXISTS (
    SELECT 1 FROM chain_watch_slots a
    JOIN chain_watch_slots b ON b.watch_id = a.watch_id AND b.start_at = a.start_at + 3600
    JOIN chain_watch_slots c ON c.watch_id = a.watch_id AND c.start_at = a.start_at + 7200
    WHERE a.watch_id = (SELECT watch_id FROM chain_watch_check_ins WHERE id = NEW.check_in_id)
      AND a.assigned_to = NEW.member_id AND b.assigned_to = NEW.member_id AND c.assigned_to = NEW.member_id
      AND a.cancelled = 0 AND b.cancelled = 0 AND c.cancelled = 0
      AND a.start_at < NEW.end_at AND c.start_at >= NEW.start_at
  );

  UPDATE chain_watch_check_ins SET cancelled_at = COALESCE(cancelled_at, unixepoch()), dirty = dirty + 1
    WHERE id = NEW.check_in_id;

  -- Seed a confirmed check-in for the replacement's resulting contiguous block.
  -- This prevents cron from sending them another reminder or missed alert.
  INSERT INTO chain_watch_check_ins
    (id, watch_id, start_at, end_at, assignment_revision, assigned_to, discord_user_id,
      guild_id, channel_id, watch_name, member_name, confirmed_at, created_at)
    SELECT 'takeover:' || NEW.id, original.watch_id, s.start_at,
      (SELECT MAX(t.start_at) + 3600 FROM chain_watch_slots t
        WHERE t.watch_id = original.watch_id AND t.assigned_to = NEW.member_id AND t.cancelled = 0
          AND t.start_at BETWEEN NEW.start_at - 3600 AND NEW.end_at),
      s.check_in_revision, NEW.member_id, NEW.discord_user_id,
      original.guild_id, original.channel_id, original.watch_name, NEW.member_name, NEW.confirmed_at, NEW.confirmed_at
    FROM chain_watch_check_ins original JOIN chain_watch_slots s ON s.watch_id = original.watch_id
    WHERE original.id = NEW.check_in_id AND s.start_at = (
      SELECT MIN(t.start_at) FROM chain_watch_slots t
        WHERE t.watch_id = original.watch_id AND t.assigned_to = NEW.member_id AND t.cancelled = 0
          AND t.start_at BETWEEN NEW.start_at - 3600 AND NEW.end_at)
    ON CONFLICT(watch_id, start_at, assignment_revision) DO UPDATE SET
      end_at = excluded.end_at, confirmed_at = COALESCE(chain_watch_check_ins.confirmed_at, excluded.confirmed_at),
      closed_at = NULL, cancelled_at = NULL, dirty = chain_watch_check_ins.dirty + 1;
END;
