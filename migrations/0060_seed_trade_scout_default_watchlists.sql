INSERT OR IGNORE INTO trade_watchlists (
  name,
  item_ids_json,
  item_source,
  min_profit,
  min_roi_percent,
  min_quantity,
  market_fee_percent,
  created_at,
  updated_at
)
VALUES
  (
    'Plushies - quick flips',
    '[258,260,261,263,264,266,268,269,273,274]',
    'weav3r_verified',
    25000,
    0,
    1,
    5,
    unixepoch(),
    unixepoch()
  ),
  (
    'Plushies - high margin',
    '[258,260,261,263,264,266,268,269,273,274]',
    'weav3r_verified',
    50000,
    5,
    1,
    5,
    unixepoch(),
    unixepoch()
  ),
  (
    'Plushies - bulk flips',
    '[258,260,261,263,264,266,268,269,273,274]',
    'weav3r_verified',
    100000,
    0,
    3,
    5,
    unixepoch(),
    unixepoch()
  ),
  (
    'Energy cans - market flips',
    '[530,532,533,553,554,555,985,986,987]',
    'weav3r_verified',
    50000,
    1,
    1,
    5,
    unixepoch(),
    unixepoch()
  ),
  (
    'Alcohol - nerve bottles',
    '[180,181,426,531,541,542,550,551,552,816,873,984]',
    'weav3r_verified',
    5000,
    0,
    1,
    5,
    unixepoch(),
    unixepoch()
  );
