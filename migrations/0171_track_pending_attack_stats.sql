-- Rebuilds and incremental statistics acknowledge attacks in the same
-- transaction as their totals. Keep ingest_run_id available for diagnostics.
ALTER TABLE attacks ADD COLUMN stats_pending INTEGER NOT NULL DEFAULT 1 CHECK (stats_pending IN (0, 1));
