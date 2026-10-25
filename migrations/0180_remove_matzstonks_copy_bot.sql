-- The MatzStonks copy-movement paper bot has been removed from the code.
-- It never recorded a movement event or a trade; only its per-minute equity
-- snapshots and account row remain. Apply after the stock and main workers
-- running the removal are deployed, or the old stock worker recreates the account.
DELETE FROM stock_paper_equity_snapshots WHERE account_id = 'stock-paper-matzstonks-live';
DELETE FROM stock_paper_trades WHERE account_id = 'stock-paper-matzstonks-live';
DELETE FROM stock_paper_positions WHERE account_id = 'stock-paper-matzstonks-live';
DELETE FROM stock_paper_accounts WHERE id = 'stock-paper-matzstonks-live';

DROP INDEX IF EXISTS idx_stock_copy_movement_events_status_time;
DROP TABLE IF EXISTS stock_copy_movement_events;
