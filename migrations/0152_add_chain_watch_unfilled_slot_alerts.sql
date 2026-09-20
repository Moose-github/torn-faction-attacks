ALTER TABLE chain_watch_slots ADD COLUMN unfilled_alert_sent_at INTEGER;
ALTER TABLE chain_watch_slots ADD COLUMN unfilled_alert_token TEXT;
ALTER TABLE chain_watch_slots ADD COLUMN unfilled_alert_until INTEGER NOT NULL DEFAULT 0;

CREATE INDEX chain_watch_slots_unfilled_alert_due ON chain_watch_slots(start_at)
  WHERE cancelled = 0 AND assigned_to IS NULL AND unfilled_alert_sent_at IS NULL;
