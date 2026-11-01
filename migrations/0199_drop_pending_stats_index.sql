-- war_stats_dirty replaced the stats_pending flag, and no deployed code reads or
-- acknowledges it since 0198. New attacks no longer add an entry here. The
-- column stays: dropping it would rewrite every attack row.
DROP INDEX idx_attacks_pending_stats;
