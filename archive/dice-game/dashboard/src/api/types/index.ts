export type DiceGameProfile = {
  torn_user_id: number;
  member_name: string | null;
  xanax_balance: number;
  total_gained: number;
  total_lost: number;
  rolls: number;
  consecutive_losses: number;
  streak_loss_total: number;
  pity_after_losses: number;
  last_roll_won: number;
  largest_loss: number;
  last_bet_amount: number | null;
  last_loss_amount: number | null;
  last_verdict: string | null;
  updated_at: number;
};

export type DiceGameLeaderboardRow = {
  rank: number;
  torn_user_id: number;
  member_name: string | null;
  total_gained: number;
  xanax_balance: number;
  total_lost: number;
  rolls: number;
  largest_loss: number;
  last_verdict: string | null;
  updated_at: number;
};

export type DiceGameResponse = {
  ok: boolean;
  profile: DiceGameProfile;
  leaderboard: DiceGameLeaderboardRow[];
};

export type DiceGameRollResponse = DiceGameResponse & {
  result: {
    bet_amount: number;
    bet_number: number;
    is_win: boolean;
    win_amount: number;
    loss_amount: number;
    haunted_number_trap: boolean;
    haunted_original_number: number | null;
    tax_triggered: boolean;
    tax_too_poor: boolean;
    tax_percent: number;
    tax_amount: number;
    verdict: string;
    roll_faces: [number, number, number];
    double_win_blocked: boolean;
    pity_checked: boolean;
    pity_win: boolean;
    pity_required_losses: number;
    pity_streak_losses: number;
    pity_payout: number;
  };
};

export type DiceGameSendXanaxResponse = DiceGameResponse & {
  result: {
    amount: number;
    message: string;
  };
};
