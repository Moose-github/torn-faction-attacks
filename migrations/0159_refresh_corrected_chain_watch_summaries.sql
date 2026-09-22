ALTER TABLE chain_watch_announcements ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chain_watch_announcements ADD COLUMN published_revision INTEGER NOT NULL DEFAULT -1;
ALTER TABLE chain_watch_announcements ADD COLUMN payload_revision INTEGER;
ALTER TABLE chain_watch_announcements ADD COLUMN next_page INTEGER NOT NULL DEFAULT 0;

-- Preserve partial delivery IDs. Reconcile stored summary snapshots once, while
-- leaving historical watches that never had a Discord summary unpublished.
UPDATE chain_watch_announcements SET
  published_revision = CASE WHEN sent_at IS NOT NULL THEN 0 ELSE -1 END,
  payload_revision = CASE WHEN payloads_json IS NOT NULL THEN 0 ELSE NULL END,
  next_page = json_array_length(message_ids_json),
  revision = CASE WHEN kind = 'summary' AND (json_array_length(message_ids_json) > 0
    OR (sent_at IS NULL AND payloads_json IS NOT NULL)) THEN 1 ELSE 0 END;

CREATE INDEX chain_watch_summaries_pending ON chain_watch_announcements(kind, sync_until)
  WHERE kind = 'summary' AND published_revision < revision;

CREATE TRIGGER chain_watch_summary_assignment_changed AFTER UPDATE OF assigned_to, cancelled ON chain_watch_slots
WHEN NEW.assigned_to IS NOT OLD.assigned_to OR NEW.cancelled != OLD.cancelled
BEGIN
  UPDATE chain_watch_announcements SET revision = revision + 1
    WHERE watch_id = NEW.watch_id AND kind = 'summary'
      AND (sent_at IS NULL OR json_array_length(message_ids_json) > 0);
END;

CREATE TRIGGER chain_watch_summary_schedule_changed AFTER UPDATE OF name, finish_at, is_open ON chain_watch_schedules
WHEN NEW.name IS NOT OLD.name OR NEW.finish_at IS NOT OLD.finish_at OR NEW.is_open != OLD.is_open
BEGIN
  UPDATE chain_watch_announcements SET revision = revision + 1
    WHERE watch_id = NEW.id AND kind = 'summary'
      AND (sent_at IS NULL OR json_array_length(message_ids_json) > 0);
END;
