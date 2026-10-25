-- Expired personal stats days are retried a few at a time, oldest first. A day
-- that can never resolve (for example the first day of a donator lapse) would
-- otherwise take one of those slots every run forever, so count the attempts.
ALTER TABLE member_personal_stats_recent ADD COLUMN expired_attempts INTEGER NOT NULL DEFAULT 0;
