import { Env } from "./types";
import { json, nowSeconds, parseLimit } from "./utils";

const STARTING_XANAX_BALANCE = 250;
const MAX_BET_AMOUNT = 1_000_000;
const PITY_LOSS_THRESHOLDS = [8, 12, 17] as const;

type DiceUser = {
  torn_user_id: number;
  member_name: string | null;
};

type DiceProfileRow = {
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
  last_natural_win: number;
  largest_loss: number;
  last_bet_amount: number | null;
  last_loss_amount: number | null;
  last_verdict: string | null;
  updated_at: number;
};

type DiceLeaderboardRow = {
  rank: number;
  torn_user_id: number;
  member_name: string | null;
  total_gained: number;
  total_lost: number;
  rolls: number;
  largest_loss: number;
  xanax_balance: number;
  last_verdict: string | null;
  updated_at: number;
};

const VERDICTS = [
  "The dice land badly. Strange how often that happens.",
  "Bold strategy: losing immediately.",
  "The dice roll across the table and off the edge.",
  "The dice declare your xanax emotionally unprepared.",
  "The dice say: no refunds.",
  "The moose council rejects your score.",
  "Almost a win, except for the part where it is not.",
  "The dice were balanced until accounting got involved.",
  "You lose.",
  "Better luck next time.",
  "Hahahahaha",
];

const WIN_VERDICTS = [
  "The dice accidentally allow a win. Someone check the table.",
  "A win slips through the cracks. Accounting has been notified.",
  "The dice land clean. You must have cheated.",
  "You win. This result is under internal review.",
  "You won.",
  "Congratulations",
  "A win! Scientists are baffled.",

];

type RollDecision = {
  isWin: boolean;
  naturalWin: boolean;
  winAmount: number;
  lossAmount: number;
  hauntedNumberTrap: boolean;
  hauntedOriginalNumber: number | null;
  taxTriggered: boolean;
  taxTooPoor: boolean;
  taxPercent: number;
  taxAmount: number;
  verdict: string;
  doubleWinBlocked: boolean;
  pityChecked: boolean;
  pityWin: boolean;
  pityRequiredLosses: number;
  pityStreakLosses: number;
  pityPayout: number;
  nextConsecutiveLosses: number;
  nextStreakLossTotal: number;
  nextPityAfterLosses: number;
};

type TaxDecision = {
  triggered: boolean;
  tooPoor: boolean;
  percent: number;
  amount: number;
};

export async function getDiceGameState(request: Request, env: Env, url: URL): Promise<Response> {
  const user = await readDiceUser(request, env);
  if (!user) {
    return json({ ok: false, error: "Unauthorized", code: "UNAUTHORIZED" }, 401);
  }

  const limit = parseLimit(url.searchParams.get("limit"), 10, 25);
  const [profile, leaderboard] = await Promise.all([
    ensureDiceProfile(env, user),
    listDiceLeaderboard(env, limit),
  ]);

  return json({
    ok: true,
    profile,
    leaderboard,
  });
}

export async function rollDiceGame(request: Request, env: Env): Promise<Response> {
  const user = await readDiceUser(request, env);
  if (!user) {
    return json({ ok: false, error: "Unauthorized", code: "UNAUTHORIZED" }, 401);
  }

  const body = (await request.json().catch(() => ({}))) as {
    bet_amount?: unknown;
    bet_number?: unknown;
    haunted_original_number?: unknown;
  };
  const betAmount = Number(body.bet_amount);
  const betNumber = Number(body.bet_number);
  const hauntedOriginalNumber = Number(body.haunted_original_number);

  if (!Number.isInteger(betAmount) || betAmount <= 0 || betAmount > MAX_BET_AMOUNT) {
    return json(
      {
        ok: false,
        error: `Bet amount must be a whole number between 1 and ${MAX_BET_AMOUNT} xanax`,
        code: "INVALID_BET_AMOUNT",
      },
      400,
    );
  }

  if (!Number.isInteger(betNumber) || betNumber < 1 || betNumber > 6) {
    return json(
      {
        ok: false,
        error: "Bet number must be a whole number between 1 and 6",
        code: "INVALID_BET_NUMBER",
      },
      400,
    );
  }

  const trappedOriginalNumber = Number.isInteger(hauntedOriginalNumber)
    && hauntedOriginalNumber >= 1
    && hauntedOriginalNumber <= 6
    && hauntedOriginalNumber !== betNumber
    ? hauntedOriginalNumber
    : null;

  const existing = await ensureDiceProfile(env, user);
  const decision = decideRoll(existing, betAmount, trappedOriginalNumber);
  const rollFaces = diceFaces(
    betAmount,
    decision.lossAmount,
    betNumber,
    decision.isWin,
    decision.hauntedOriginalNumber,
  );
  const totalLossAmount = decision.lossAmount + decision.taxAmount;
  const now = nowSeconds();

  await env.DB.prepare(
    `
    INSERT INTO dice_game_losses (
      torn_user_id,
      member_name,
      xanax_balance,
      total_gained,
      total_lost,
      rolls,
      consecutive_losses,
      streak_loss_total,
      pity_after_losses,
      last_roll_won,
      last_natural_win,
      largest_loss,
      last_bet_amount,
      last_loss_amount,
      last_verdict,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(torn_user_id) DO UPDATE SET
      member_name = COALESCE(excluded.member_name, dice_game_losses.member_name),
      xanax_balance = dice_game_losses.xanax_balance + excluded.total_gained - excluded.last_loss_amount,
      total_gained = dice_game_losses.total_gained + excluded.total_gained,
      total_lost = dice_game_losses.total_lost + excluded.last_loss_amount,
      rolls = dice_game_losses.rolls + 1,
      consecutive_losses = excluded.consecutive_losses,
      streak_loss_total = excluded.streak_loss_total,
      pity_after_losses = excluded.pity_after_losses,
      last_roll_won = excluded.last_roll_won,
      last_natural_win = excluded.last_natural_win,
      largest_loss = MAX(dice_game_losses.largest_loss, excluded.last_loss_amount),
      last_bet_amount = excluded.last_bet_amount,
      last_loss_amount = excluded.last_loss_amount,
      last_verdict = excluded.last_verdict,
      updated_at = excluded.updated_at
    `,
  )
    .bind(
      user.torn_user_id,
      user.member_name,
      STARTING_XANAX_BALANCE + decision.winAmount - totalLossAmount,
      decision.winAmount,
      totalLossAmount,
      decision.nextConsecutiveLosses,
      decision.nextStreakLossTotal,
      decision.nextPityAfterLosses,
      decision.isWin ? 1 : 0,
      decision.naturalWin ? 1 : 0,
      totalLossAmount,
      betAmount,
      totalLossAmount,
      decision.verdict,
      now,
      now,
    )
    .run();

  const [profile, leaderboard] = await Promise.all([
    getDiceProfile(env, user.torn_user_id),
    listDiceLeaderboard(env, 10),
  ]);

  return json({
    ok: true,
    result: {
      bet_amount: betAmount,
      bet_number: betNumber,
      is_win: decision.isWin,
      win_amount: decision.winAmount,
      loss_amount: decision.lossAmount,
      haunted_number_trap: decision.hauntedNumberTrap,
      haunted_original_number: decision.hauntedOriginalNumber,
      tax_triggered: decision.taxTriggered,
      tax_too_poor: decision.taxTooPoor,
      tax_percent: decision.taxPercent,
      tax_amount: decision.taxAmount,
      verdict: decision.verdict,
      roll_faces: rollFaces,
      double_win_blocked: decision.doubleWinBlocked,
      pity_checked: decision.pityChecked,
      pity_win: decision.pityWin,
      pity_required_losses: decision.pityRequiredLosses,
      pity_streak_losses: decision.pityStreakLosses,
      pity_payout: decision.pityPayout,
    },
    profile,
    leaderboard,
  });
}

export async function sendXanaxToDiceGame(request: Request, env: Env): Promise<Response> {
  const user = await readDiceUser(request, env);
  if (!user) {
    return json({ ok: false, error: "Unauthorized", code: "UNAUTHORIZED" }, 401);
  }

  const body = (await request.json().catch(() => ({}))) as { amount?: unknown };
  const amount = Math.trunc(Number(body.amount) || 0);
  const now = nowSeconds();

  await ensureDiceProfile(env, user);
  await env.DB.prepare(
    `
    UPDATE dice_game_losses
    SET
      member_name = COALESCE(?, member_name),
      xanax_balance = xanax_balance + ?,
      updated_at = ?
    WHERE torn_user_id = ?
    `,
  )
    .bind(user.member_name, amount, now, user.torn_user_id)
    .run();

  const [profile, leaderboard] = await Promise.all([
    getDiceProfile(env, user.torn_user_id),
    listDiceLeaderboard(env, 10),
  ]);

  return json({
    ok: true,
    result: {
      amount,
      message: `${amount} xanax added to your balance.`,
    },
    profile,
    leaderboard,
  });
}

async function readDiceUser(request: Request, env: Env): Promise<DiceUser | null> {
  const token = bearerToken(request);
  if (!token) {
    return null;
  }

  const row = (await env.DB.prepare(
    `
    SELECT
      s.torn_user_id,
      h.name AS member_name
    FROM auth_sessions s
    LEFT JOIN home_faction_members h
      ON h.member_id = s.torn_user_id
    WHERE s.token = ?
      AND s.expires_at > ?
    LIMIT 1
    `,
  )
    .bind(token, nowSeconds())
    .first()) as DiceUser | null;

  return row;
}

async function ensureDiceProfile(env: Env, user: DiceUser): Promise<DiceProfileRow> {
  const now = nowSeconds();
  await env.DB.prepare(
    `
    INSERT INTO dice_game_losses (torn_user_id, member_name, created_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(torn_user_id) DO UPDATE SET
      member_name = COALESCE(excluded.member_name, dice_game_losses.member_name)
    `,
  )
    .bind(user.torn_user_id, user.member_name, now, now)
    .run();

  return getDiceProfile(env, user.torn_user_id);
}

async function getDiceProfile(env: Env, tornUserId: number): Promise<DiceProfileRow> {
  const row = (await env.DB.prepare(
    `
    SELECT
      torn_user_id,
      member_name,
      xanax_balance,
      total_gained,
      total_lost,
      rolls,
      consecutive_losses,
      streak_loss_total,
      pity_after_losses,
      last_roll_won,
      last_natural_win,
      largest_loss,
      last_bet_amount,
      last_loss_amount,
      last_verdict,
      updated_at
    FROM dice_game_losses
    WHERE torn_user_id = ?
    LIMIT 1
    `,
  )
    .bind(tornUserId)
    .first()) as DiceProfileRow | null;

  if (!row) {
    throw new Error("Dice game profile was not created");
  }

  return row;
}

async function listDiceLeaderboard(env: Env, limit: number): Promise<DiceLeaderboardRow[]> {
  const rows = await env.DB.prepare(
    `
    SELECT
      torn_user_id,
      member_name,
      xanax_balance,
      total_gained,
      total_lost,
      rolls,
      largest_loss,
      last_verdict,
      updated_at
    FROM dice_game_losses
    WHERE total_lost != 0 OR total_gained != 0
    ORDER BY total_lost DESC, rolls DESC, updated_at ASC
    LIMIT ?
    `,
  )
    .bind(limit)
    .all();

  return (rows.results ?? []).map((row, index) => ({
    ...(row as Omit<DiceLeaderboardRow, "rank">),
    rank: index + 1,
  }));
}

function lossAmountForRoll(betAmount: number, rollNumber: number): number {
  if (!feeGagTriggers(rollNumber)) {
    return betAmount;
  }

  const insultingFee = Math.max(1, Math.ceil(betAmount * 0.13));
  const loyaltyPenalty = Math.ceil(betAmount * 0.5);
  const paperworkFee = Math.max(1, Math.ceil(rollNumber / 2));
  return betAmount + insultingFee + loyaltyPenalty + paperworkFee;
}

function decideRoll(existing: DiceProfileRow, betAmount: number, trappedOriginalNumber: number | null): RollDecision {
  const rollNumber = existing.rolls + 1;
  const pityRequiredLosses = normalizedPityAfterLosses(existing.pity_after_losses);
  const hauntedNumberTrap = trappedOriginalNumber !== null;
  const rawWin = !hauntedNumberTrap && rollWins(existing.last_natural_win === 1);
  const doubleWinBlocked = !hauntedNumberTrap && existing.last_roll_won === 1 && rawWin;
  const naturalWin = !hauntedNumberTrap && rawWin && !doubleWinBlocked;
  const pityChecked = !hauntedNumberTrap && !naturalWin && !doubleWinBlocked && existing.consecutive_losses >= pityRequiredLosses;
  const pityPayout = betAmount;
  const pityWin = pityChecked && pityPayout < existing.streak_loss_total;
  const isWin = !hauntedNumberTrap && (naturalWin || pityWin);
  const winAmount = isWin ? betAmount : 0;
  const lossAmount = isWin ? 0 : lossAmountForRoll(betAmount, rollNumber);
  const tax = taxForRoll(existing.xanax_balance + winAmount - lossAmount);
  const nextConsecutiveLosses = isWin ? 0 : existing.consecutive_losses + 1;
  const nextStreakLossTotal = isWin ? 0 : existing.streak_loss_total + lossAmount;
  const nextPityAfterLosses = isWin ? randomPityAfterLosses() : pityRequiredLosses;
  const verdict = isWin
    ? diceWinVerdict(existing.rolls, winAmount)
    : diceLossVerdict(existing.rolls, betAmount);

  return {
    isWin,
    naturalWin,
    winAmount,
    lossAmount,
    hauntedNumberTrap,
    hauntedOriginalNumber: trappedOriginalNumber,
    taxTriggered: tax.triggered,
    taxTooPoor: tax.tooPoor,
    taxPercent: tax.percent,
    taxAmount: tax.amount,
    verdict,
    doubleWinBlocked,
    pityChecked,
    pityWin,
    pityRequiredLosses,
    pityStreakLosses: existing.streak_loss_total,
    pityPayout,
    nextConsecutiveLosses,
    nextStreakLossTotal,
    nextPityAfterLosses,
  };
}

function diceLossVerdict(rolls: number, lossAmount: number): string {
  const verdict = VERDICTS[rolls % VERDICTS.length];
  return `${verdict} -${lossAmount} xanax.`;
}

function diceWinVerdict(rolls: number, winAmount: number): string {
  const verdict = WIN_VERDICTS[rolls % WIN_VERDICTS.length];
  return `${verdict} +${winAmount} xanax.`;
}

function diceFaces(
  betAmount: number,
  lossAmount: number,
  betNumber: number,
  isWin: boolean,
  forcedFinalFace: number | null = null,
): [number, number, number] {
  const finalFace = forcedFinalFace ?? (isWin ? betNumber : losingFaceForBet(betNumber, betAmount, lossAmount));
  return [
    1 + ((betAmount * 7) % 6),
    betNumber,
    finalFace,
  ];
}

function losingFaceForBet(betNumber: number, betAmount: number, lossAmount: number): number {
  const offset = 1 + ((betAmount + lossAmount) % 5);
  return ((betNumber - 1 + offset) % 6) + 1;
}

function normalizedPityAfterLosses(value: number): number {
  return PITY_LOSS_THRESHOLDS.includes(value as (typeof PITY_LOSS_THRESHOLDS)[number])
    ? value
    : randomPityAfterLosses();
}

function randomPityAfterLosses(): number {
  return PITY_LOSS_THRESHOLDS[randomUint32() % PITY_LOSS_THRESHOLDS.length] ?? 12;
}

function feeGagTriggers(rollNumber: number): boolean {
  return rollNumber % 10 === 5;
}

function taxForRoll(balanceAfterRoll: number): TaxDecision {
  if (randomUint32() % 50 !== 0) {
    return {
      triggered: false,
      tooPoor: false,
      percent: 0,
      amount: 0,
    };
  }

  if (balanceAfterRoll < 100) {
    return {
      triggered: true,
      tooPoor: true,
      percent: 0,
      amount: 0,
    };
  }

  const percent = 1 + (randomUint32() % 10);
  return {
    triggered: true,
    tooPoor: false,
    percent,
    amount: Math.max(1, Math.ceil((balanceAfterRoll * percent) / 100)),
  };
}

function rollWins(afterNaturalWin: boolean): boolean {
  return randomUint32() % (afterNaturalWin ? 4 : 10) === 0;
}

function randomUint32(): number {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] ?? 0;
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("Authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() || null;
}
