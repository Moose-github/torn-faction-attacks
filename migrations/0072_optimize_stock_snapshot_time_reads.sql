CREATE INDEX IF NOT EXISTS idx_stock_price_snapshots_observed_stock
  ON stock_price_snapshots(observed_at ASC, stock_id ASC);
