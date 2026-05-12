CREATE TABLE dice_game_losses (
  torn_user_id INTEGER PRIMARY KEY,
  member_name TEXT,
  xanax_balance INTEGER NOT NULL DEFAULT 250,
  total_gained INTEGER NOT NULL DEFAULT 0,
  total_lost INTEGER NOT NULL DEFAULT 0,
  rolls INTEGER NOT NULL DEFAULT 0,
  largest_loss INTEGER NOT NULL DEFAULT 0,
  last_bet_amount INTEGER,
  last_loss_amount INTEGER,
  last_verdict TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_dice_game_losses_total_lost
  ON dice_game_losses(total_lost DESC, rolls DESC);
