ALTER TABLE trade_watchlists ADD COLUMN created_by_torn_user_id INTEGER;
ALTER TABLE trade_watchlists ADD COLUMN created_by_name TEXT;

CREATE INDEX IF NOT EXISTS idx_trade_watchlists_created_by
  ON trade_watchlists(created_by_torn_user_id, updated_at DESC);
