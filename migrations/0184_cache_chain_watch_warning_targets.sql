-- Targets found by a cycle's 60-second warning lookup, as a JSON array whose first
-- two entries were shown on that card. The critical warning posts with the others
-- instead of waiting for a second lookup during its last 30 seconds.
ALTER TABLE chain_watch_warning_cycles ADD COLUMN target_ids TEXT;
