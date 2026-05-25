UPDATE trade_watchlists
SET item_source = 'weav3r_verified',
    updated_at = unixepoch()
WHERE item_source = 'weav3r';
