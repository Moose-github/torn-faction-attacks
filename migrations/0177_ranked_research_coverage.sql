-- Preserve collection completeness before freeze removes pending war links.
ALTER TABLE ranked_research_runs ADD COLUMN collection_json TEXT;
