-- Rename the internal non-Torn war type from "other" to "event".
UPDATE wars
SET war_type = 'event'
WHERE war_type = 'other';
