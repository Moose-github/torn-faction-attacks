-- Notifications now disappear after resolution or shift end, not just cancellation.
DROP INDEX chain_watch_check_ins_escalation_cleanup;
CREATE INDEX chain_watch_check_ins_escalation_cleanup ON chain_watch_check_ins(guild_id, end_at)
  WHERE escalation_message_id IS NOT NULL AND escalation_deleted_at IS NULL;

-- Convert existing cards/alerts on the next processing pass, including cards
-- whose takeover button was previously displayed on the separate alert.
UPDATE chain_watch_check_ins SET dirty = dirty + 1
  WHERE (reminder_message_id IS NOT NULL AND reminder_deleted_at IS NULL)
    OR (escalation_message_id IS NOT NULL AND escalation_deleted_at IS NULL);
