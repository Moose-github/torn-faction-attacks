-- Migration number: 0009
-- Use official_start_time and official_end_time as the canonical Torn war window.

ALTER TABLE wars DROP COLUMN torn_report_start;
ALTER TABLE wars DROP COLUMN torn_report_end;
