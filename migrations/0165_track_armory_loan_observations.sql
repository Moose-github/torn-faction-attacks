-- Existing loans begin tracking on the next successful inventory fetch.
-- Do not infer checkout dates from the saved snapshot or migration time.
ALTER TABLE faction_armory_inventory ADD COLUMN loan_first_seen_at INTEGER;
