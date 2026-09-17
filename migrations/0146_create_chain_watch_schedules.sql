CREATE TABLE chain_watch_schedules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  start_at INTEGER NOT NULL CHECK (start_at % 3600 = 0),
  finish_at INTEGER CHECK (finish_at % 3600 = 0),
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  is_open INTEGER NOT NULL DEFAULT 1 CHECK (is_open IN (0, 1)),
  created_by_discord_id TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX chain_watch_one_unfinished ON chain_watch_schedules(is_open) WHERE is_open = 1;

CREATE TABLE chain_watch_sheets (
  id TEXT PRIMARY KEY,
  watch_id TEXT NOT NULL REFERENCES chain_watch_schedules(id),
  start_at INTEGER NOT NULL,
  end_at INTEGER NOT NULL,
  discord_message_id TEXT,
  dirty INTEGER NOT NULL DEFAULT 1,
  render_hour INTEGER NOT NULL DEFAULT 0,
  last_payload TEXT,
  sync_token TEXT,
  sync_until INTEGER NOT NULL DEFAULT 0,
  UNIQUE(watch_id, start_at)
);

CREATE TABLE chain_watch_slots (
  watch_id TEXT NOT NULL REFERENCES chain_watch_schedules(id),
  sheet_id TEXT NOT NULL REFERENCES chain_watch_sheets(id),
  start_at INTEGER NOT NULL CHECK (start_at % 3600 = 0),
  assigned_to INTEGER,
  cancelled INTEGER NOT NULL DEFAULT 0 CHECK (cancelled IN (0, 1)),
  assignment_actor INTEGER,
  admin_override INTEGER NOT NULL DEFAULT 0 CHECK (admin_override IN (0, 1)),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY(watch_id, start_at)
);
CREATE INDEX chain_watch_slots_sheet ON chain_watch_slots(sheet_id, start_at);

CREATE TABLE chain_watch_pending_selections (
  id TEXT PRIMARY KEY,
  discord_user_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  watch_id TEXT NOT NULL REFERENCES chain_watch_schedules(id),
  action TEXT NOT NULL CHECK (action IN ('claim', 'leave')),
  starts_json TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- These checks run inside the same transaction as the assignment, including
-- multi-slot selections. A failure rolls back the entire D1 batch.
CREATE TRIGGER chain_watch_guard_assignment BEFORE UPDATE OF assigned_to ON chain_watch_slots
BEGIN
  SELECT CASE WHEN NEW.cancelled = 1 OR EXISTS (
    SELECT 1 FROM chain_watch_schedules w WHERE w.id = NEW.watch_id
      AND w.finish_at IS NOT NULL AND NEW.start_at >= w.finish_at
  ) THEN RAISE(ABORT, 'WATCH_SLOT_CANCELLED') END;
  SELECT CASE WHEN NEW.admin_override = 0 AND NEW.start_at <= unixepoch()
    THEN RAISE(ABORT, 'WATCH_SLOT_STARTED') END;
  SELECT CASE WHEN NEW.admin_override = 0 AND (
    NEW.assignment_actor IS NULL OR
    (OLD.assigned_to IS NOT NULL AND OLD.assigned_to != NEW.assignment_actor) OR
    (NEW.assigned_to IS NOT NULL AND NEW.assigned_to != NEW.assignment_actor)
  ) THEN RAISE(ABORT, 'WATCH_SLOT_TAKEN') END;
  SELECT CASE WHEN NEW.assigned_to IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM home_faction_members WHERE member_id = NEW.assigned_to AND is_current = 1
  ) THEN RAISE(ABORT, 'WATCH_NOT_MEMBER') END;
  SELECT CASE WHEN NEW.admin_override = 0 AND NEW.assigned_to IS NOT NULL AND EXISTS (
    SELECT 1 FROM chain_watch_slots a JOIN chain_watch_slots b
      ON b.watch_id = a.watch_id AND b.assigned_to = a.assigned_to
      AND b.start_at = a.start_at + CASE WHEN a.start_at = NEW.start_at - 3600 THEN 7200 ELSE 3600 END
    WHERE a.watch_id = NEW.watch_id AND a.assigned_to = NEW.assigned_to
      AND a.cancelled = 0 AND b.cancelled = 0
      AND a.start_at IN (NEW.start_at - 7200, NEW.start_at - 3600, NEW.start_at + 3600)
  ) THEN RAISE(ABORT, 'WATCH_BREAK_REQUIRED') END;
END;

CREATE TRIGGER chain_watch_assignment_changed AFTER UPDATE OF assigned_to ON chain_watch_slots
BEGIN
  UPDATE chain_watch_sheets SET dirty = dirty + 1 WHERE id = NEW.sheet_id;
END;
