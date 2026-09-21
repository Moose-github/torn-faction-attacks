CREATE TABLE chain_watch_announcements (
  watch_id TEXT NOT NULL REFERENCES chain_watch_schedules(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('intro', 'summary')),
  payloads_json TEXT,
  message_ids_json TEXT NOT NULL DEFAULT '[]',
  sent_at INTEGER,
  sync_token TEXT,
  sync_until INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(watch_id, kind)
);
CREATE INDEX chain_watch_announcements_pending ON chain_watch_announcements(kind, sync_until) WHERE sent_at IS NULL;

-- Existing rosters keep their message order. Do not announce old finished watches.
INSERT INTO chain_watch_announcements(watch_id, kind, sent_at)
  SELECT id, 'intro', unixepoch() FROM chain_watch_schedules;
INSERT INTO chain_watch_announcements(watch_id, kind, sent_at)
  SELECT id, 'summary', CASE WHEN is_open = 0 OR finish_at <= unixepoch() THEN unixepoch() ELSE NULL END
  FROM chain_watch_schedules;

CREATE TRIGGER chain_watch_queue_announcements AFTER INSERT ON chain_watch_schedules
BEGIN
  INSERT INTO chain_watch_announcements(watch_id, kind) VALUES (NEW.id, 'intro'), (NEW.id, 'summary');
END;
