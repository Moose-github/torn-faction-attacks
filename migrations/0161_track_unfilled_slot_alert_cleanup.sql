ALTER TABLE chain_watch_slots ADD COLUMN unfilled_alert_message_id TEXT;
ALTER TABLE chain_watch_slots ADD COLUMN unfilled_alert_channel_id TEXT;
ALTER TABLE chain_watch_slots ADD COLUMN unfilled_alert_deleted_at INTEGER;

CREATE INDEX chain_watch_slots_unfilled_alert_cleanup ON chain_watch_slots(start_at)
  WHERE unfilled_alert_message_id IS NOT NULL AND unfilled_alert_deleted_at IS NULL;

-- Existing alerts have no saved Discord message ID. Keep their sent markers
-- intact so deployment does not repost them or ping subscribers again.
