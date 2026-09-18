-- Remember an explicit return to an ongoing watch. Cancelled future days reopen
-- when their normal publication time arrives, without changing older history.
ALTER TABLE chain_watch_schedules ADD COLUMN resume_cancelled_after INTEGER;
