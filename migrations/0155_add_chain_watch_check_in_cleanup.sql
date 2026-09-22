ALTER TABLE chain_watch_check_ins ADD COLUMN reminder_deleted_at INTEGER;
ALTER TABLE chain_watch_check_ins ADD COLUMN escalation_deleted_at INTEGER;

CREATE INDEX chain_watch_check_ins_reminder_cleanup ON chain_watch_check_ins(guild_id, cancelled_at, end_at)
  WHERE reminder_message_id IS NOT NULL AND reminder_deleted_at IS NULL;
CREATE INDEX chain_watch_check_ins_escalation_cleanup ON chain_watch_check_ins(guild_id, cancelled_at)
  WHERE escalation_message_id IS NOT NULL AND escalation_deleted_at IS NULL AND cancelled_at IS NOT NULL;

-- Refresh existing eligible messages with their cleanup countdown.
UPDATE chain_watch_check_ins SET dirty = dirty + 1
  WHERE confirmed_at IS NOT NULL OR cancelled_at IS NOT NULL;
