ALTER TABLE dice_game_losses
  ADD COLUMN consecutive_losses INTEGER NOT NULL DEFAULT 0;

ALTER TABLE dice_game_losses
  ADD COLUMN streak_loss_total INTEGER NOT NULL DEFAULT 0;

ALTER TABLE dice_game_losses
  ADD COLUMN pity_after_losses INTEGER NOT NULL DEFAULT 0;

ALTER TABLE dice_game_losses
  ADD COLUMN last_roll_won INTEGER NOT NULL DEFAULT 0;
