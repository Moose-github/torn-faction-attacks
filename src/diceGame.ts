import { Env } from "./types";
import { json, nowSeconds, parseLimit } from "./utils";

const STARTING_XANAX_BALANCE = 250;
const MAX_BET_AMOUNT = 1_000_000;

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
  "The dice considered a win, then remembered policy.",
  "The dice roll across the table and into house custody.",
  "The dice declare your xanax emotionally unprepared.",
  "The dice say: no refunds, only probability theater.",
  "The house edge updates during the roll. Very agile.",
  "Almost a win, except for the part where it is not.",
  "The dice were balanced until accounting got involved.",
];

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

  const body = (await request.json().catch(() => ({}))) as { bet_amount?: unknown };
  const betAmount = Number(body.bet_amount);

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

  const existing = await ensureDiceProfile(env, user);
  const lossAmount = riggedLossAmount(betAmount, existing.rolls);
  const verdict = diceVerdict(existing.rolls, lossAmount);
  const rollFaces = diceFaces(betAmount, lossAmount);
  const now = nowSeconds();

  await env.DB.prepare(
    `
    INSERT INTO dice_game_losses (
      torn_user_id,
      member_name,
      xanax_balance,
      total_lost,
      rolls,
      largest_loss,
      last_bet_amount,
      last_loss_amount,
      last_verdict,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(torn_user_id) DO UPDATE SET
      member_name = COALESCE(excluded.member_name, dice_game_losses.member_name),
      xanax_balance = dice_game_losses.xanax_balance - excluded.last_loss_amount,
      total_lost = dice_game_losses.total_lost + excluded.last_loss_amount,
      rolls = dice_game_losses.rolls + 1,
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
      STARTING_XANAX_BALANCE - lossAmount,
      lossAmount,
      lossAmount,
      betAmount,
      lossAmount,
      verdict,
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
      loss_amount: lossAmount,
      verdict,
      roll_faces: rollFaces,
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
      total_gained = total_gained + ?,
      updated_at = ?
    WHERE torn_user_id = ?
    `,
  )
    .bind(user.member_name, amount, amount, now, user.torn_user_id)
    .run();

  const [profile, leaderboard] = await Promise.all([
    getDiceProfile(env, user.torn_user_id),
    listDiceLeaderboard(env, 10),
  ]);

  return json({
    ok: true,
    result: {
      amount,
      message: `The table accepts ${amount} xanax with no questions asked.`,
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

function riggedLossAmount(betAmount: number, rolls: number): number {
  const insultingFee = Math.max(1, Math.ceil(betAmount * 0.13));
  const loyaltyPenalty = rolls % 4 === 3 ? Math.ceil(betAmount * 0.5) : 0;
  const paperworkFee = rolls >= 6 ? rolls : 0;
  return betAmount + insultingFee + loyaltyPenalty + paperworkFee;
}

function diceVerdict(rolls: number, lossAmount: number): string {
  const verdict = VERDICTS[rolls % VERDICTS.length];
  return `${verdict} -${lossAmount} xanax.`;
}

function diceFaces(betAmount: number, lossAmount: number): [number, number, number] {
  return [
    1 + ((betAmount * 7) % 6),
    1 + ((lossAmount * 5) % 6),
    1 + ((betAmount + lossAmount) % 6),
  ];
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("Authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() || null;
}
