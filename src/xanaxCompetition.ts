import { HOME_FACTION_ID } from "./constants";
import { Env } from "./types";
import { corsHeaders, d1Changes, json, nowSeconds } from "./utils";
import { renderXanaxCompetitionReminderPng } from "./xanaxCompetitionImageRenderer";

const SETTINGS_ID = 1;
const DEFAULT_BASE_PRIZE = 10_000_000;
const XANAX_TARGET = 100;
const LEADERBOARD_LIMIT = 10;

type CompetitionSettingsRow = {
  id: number;
  enabled: number;
  base_prize: number;
  rollover_count: number;
  last_rollover_month_key: string | null;
  updated_at: number;
};

type CompetitionClaimRow = {
  id: number;
  month_key: string;
  member_id: number;
  member_name: string | null;
  xantaken: number;
  prize_paid: number;
  claimed_by_torn_user_id: number | null;
  claimed_at: number;
};

type ProgressQueryRow = {
  member_id: number;
  member_name: string | null;
  start_xantaken: number | null;
  end_xantaken: number | null;
  latest_snapshot_date: string | null;
};

export type XanaxCompetitionProgress = {
  rank: number;
  member_id: number;
  member_name: string | null;
  monthly_xanax: number;
  remaining: number;
  eligible: boolean;
  latest_snapshot_date: string | null;
};

export async function getXanaxCompetition(
  env: Env,
  currentUserId: number | null = null,
): Promise<Response> {
  const state = await buildCompetitionState(env, {
    currentUserId,
    includeClaims: false,
  });
  return json(state);
}

export async function getAdminXanaxCompetition(env: Env): Promise<Response> {
  const state = await buildCompetitionState(env, {
    currentUserId: null,
    includeClaims: true,
  });
  return json(state);
}

export async function previewXanaxCompetitionImage(env: Env): Promise<Response> {
  const settings = serializeSettings(await ensureCompetitionSettings(env), currentMonthKey());
  const png = await renderXanaxCompetitionReminderPng({
    monthKey: settings.month_key,
    currentPrize: settings.current_prize,
  });

  return new Response(png, {
    headers: {
      ...corsHeaders,
      "Content-Type": "image/png",
      "Content-Disposition": `inline; filename="xanax-competition-${settings.month_key}.png"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function updateAdminXanaxCompetition(
  request: Request,
  env: Env,
  adminUserId: number | null,
): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  return body.member_id === undefined
    ? updateXanaxCompetitionSettings(body, env)
    : recordXanaxCompetitionClaim(body, env, adminUserId);
}

export async function reconcileXanaxCompetitionRollover(
  env: Env,
): Promise<{ writeStatements: number; changedRows: number; details: Record<string, unknown> }> {
  const settings = await ensureCompetitionSettings(env);
  if (settings.enabled !== 1) {
    return {
      writeStatements: 0,
      changedRows: 0,
      details: { skipped: true, reason: "competition disabled" },
    };
  }

  const previousMonth = previousMonthKey(currentMonthKey());
  if (settings.last_rollover_month_key && settings.last_rollover_month_key >= previousMonth) {
    return {
      writeStatements: 0,
      changedRows: 0,
      details: {
        skipped: true,
        reason: "rollover already reconciled",
        previous_month: previousMonth,
      },
    };
  }

  const months = enumerateMonthKeysAfter(settings.last_rollover_month_key, previousMonth);
  if (months.length === 0) {
    return {
      writeStatements: 0,
      changedRows: 0,
      details: { skipped: true, reason: "no completed months to reconcile" },
    };
  }

  let addedRollovers = 0;
  for (const monthKey of months) {
    if (!(await readClaimForMonth(env, monthKey))) {
      addedRollovers += 1;
    }
  }

  const result = await env.DB.prepare(
    `
    UPDATE xanax_competition_settings
    SET rollover_count = rollover_count + ?,
        last_rollover_month_key = ?,
        updated_at = ?
    WHERE id = ?
    `,
  )
    .bind(addedRollovers, previousMonth, nowSeconds(), SETTINGS_ID)
    .run();

  return {
    writeStatements: 1,
    changedRows: d1Changes(result),
    details: {
      reconciled_months: months,
      added_rollovers: addedRollovers,
      previous_month: previousMonth,
    },
  };
}

async function buildCompetitionState(
  env: Env,
  options: { currentUserId: number | null; includeClaims: boolean },
) {
  const settings = await ensureCompetitionSettings(env);
  const monthKey = currentMonthKey();
  const leaderboard = await readCompetitionProgress(env, monthKey);
  const currentUserProgress =
    options.currentUserId === null
      ? null
      : leaderboard.find((row) => row.member_id === options.currentUserId) ?? null;
  const claims = options.includeClaims ? await readRecentClaims(env) : undefined;

  return {
    ok: true,
    settings: serializeSettings(settings, monthKey),
    current_user_progress: currentUserProgress,
    leaderboard: options.includeClaims ? leaderboard : leaderboard.slice(0, LEADERBOARD_LIMIT),
    latest_snapshot_date: latestProgressSnapshotDate(leaderboard),
    updated_at: settings.updated_at,
    ...(claims ? { claims } : {}),
  };
}

async function updateXanaxCompetitionSettings(
  body: Record<string, unknown>,
  env: Env,
): Promise<Response> {
  const current = await ensureCompetitionSettings(env);
  const enabled = body.enabled === undefined ? current.enabled === 1 : Boolean(body.enabled);
  const basePrize = parseNonNegativeInteger(body.base_prize, current.base_prize);
  const rolloverCount = parseNonNegativeInteger(body.rollover_count, current.rollover_count);

  if (basePrize <= 0) {
    return json({ ok: false, error: "Base prize must be greater than zero", code: "INVALID_BASE_PRIZE" }, 400);
  }

  await env.DB.prepare(
    `
    UPDATE xanax_competition_settings
    SET enabled = ?,
        base_prize = ?,
        rollover_count = ?,
        updated_at = ?
    WHERE id = ?
    `,
  )
    .bind(enabled ? 1 : 0, basePrize, rolloverCount, nowSeconds(), SETTINGS_ID)
    .run();

  return getAdminXanaxCompetition(env);
}

async function recordXanaxCompetitionClaim(
  body: Record<string, unknown>,
  env: Env,
  adminUserId: number | null,
): Promise<Response> {
  const memberId = Number(body.member_id);
  if (!Number.isInteger(memberId) || memberId <= 0) {
    return json({ ok: false, error: "A valid member_id is required", code: "INVALID_MEMBER_ID" }, 400);
  }

  const monthKey = parseMonthKey(body.month_key) ?? currentMonthKey();
  const progress = await readCompetitionProgress(env, monthKey);
  const memberProgress = progress.find((row) => row.member_id === memberId);
  if (!memberProgress) {
    return json({ ok: false, error: "Member progress was not found for that month", code: "MEMBER_NOT_FOUND" }, 404);
  }
  if (!memberProgress.eligible) {
    return json({ ok: false, error: "Member has not reached 100 Xanax for that month", code: "TARGET_NOT_REACHED" }, 400);
  }

  const settings = await ensureCompetitionSettings(env);
  const prizePaid = parseNonNegativeInteger(
    body.prize_paid,
    settings.base_prize * (settings.rollover_count + 1),
  );
  if (prizePaid <= 0) {
    return json({ ok: false, error: "Prize paid must be greater than zero", code: "INVALID_PRIZE_PAID" }, 400);
  }

  const claimedAt = nowSeconds();
  try {
    await env.DB.batch([
      env.DB.prepare(
        `
        INSERT INTO xanax_competition_claims (
          month_key,
          member_id,
          member_name,
          xantaken,
          prize_paid,
          claimed_by_torn_user_id,
          claimed_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
      ).bind(
        monthKey,
        memberProgress.member_id,
        memberProgress.member_name,
        memberProgress.monthly_xanax,
        prizePaid,
        adminUserId,
        claimedAt,
      ),
      env.DB.prepare(
        `
        UPDATE xanax_competition_settings
        SET rollover_count = 0,
            last_rollover_month_key = CASE
              WHEN last_rollover_month_key IS NULL OR last_rollover_month_key < ? THEN ?
              ELSE last_rollover_month_key
            END,
            updated_at = ?
        WHERE id = ?
        `,
      ).bind(monthKey, monthKey, claimedAt, SETTINGS_ID),
    ]);
  } catch {
    return json(
      {
        ok: false,
        error: "A claim has already been recorded for that month",
        code: "CLAIM_ALREADY_RECORDED",
      },
      409,
    );
  }

  return getAdminXanaxCompetition(env);
}

async function ensureCompetitionSettings(env: Env): Promise<CompetitionSettingsRow> {
  const existing = await readCompetitionSettings(env);
  if (existing) {
    return existing;
  }

  const now = nowSeconds();
  await env.DB.prepare(
    `
    INSERT INTO xanax_competition_settings (
      id,
      enabled,
      base_prize,
      rollover_count,
      last_rollover_month_key,
      updated_at
    )
    VALUES (?, 1, ?, 0, ?, ?)
    ON CONFLICT(id) DO NOTHING
    `,
  )
    .bind(SETTINGS_ID, DEFAULT_BASE_PRIZE, previousMonthKey(currentMonthKey()), now)
    .run();

  return (await readCompetitionSettings(env)) ?? {
    id: SETTINGS_ID,
    enabled: 1,
    base_prize: DEFAULT_BASE_PRIZE,
    rollover_count: 0,
    last_rollover_month_key: previousMonthKey(currentMonthKey()),
    updated_at: now,
  };
}

async function readCompetitionSettings(env: Env): Promise<CompetitionSettingsRow | null> {
  return (await env.DB.prepare(
    `
    SELECT id, enabled, base_prize, rollover_count, last_rollover_month_key, updated_at
    FROM xanax_competition_settings
    WHERE id = ?
    LIMIT 1
    `,
  )
    .bind(SETTINGS_ID)
    .first()) as CompetitionSettingsRow | null;
}

async function readCompetitionProgress(
  env: Env,
  monthKey: string,
): Promise<XanaxCompetitionProgress[]> {
  const startDate = `${monthKey}-01`;
  const nextStartDate = nextMonthStartDate(monthKey);
  const rows = ((await env.DB.prepare(
    `
    SELECT
      members.member_id,
      members.name AS member_name,
      baseline.xantaken AS start_xantaken,
      latest.xantaken AS end_xantaken,
      latest.snapshot_date AS latest_snapshot_date
    FROM home_faction_members members
    LEFT JOIN member_lifestyle_stat_snapshots latest
      ON latest.member_id = members.member_id
     AND latest.snapshot_date = (
        SELECT MAX(snapshot_date)
        FROM member_lifestyle_stat_snapshots
        WHERE member_id = members.member_id
          AND snapshot_date >= ?
          AND snapshot_date < ?
          AND personal_ready = 1
      )
    LEFT JOIN member_lifestyle_stat_snapshots baseline
      ON baseline.member_id = members.member_id
     AND baseline.snapshot_date = COALESCE(
        (
          SELECT MAX(snapshot_date)
          FROM member_lifestyle_stat_snapshots
          WHERE member_id = members.member_id
            AND snapshot_date <= ?
            AND personal_ready = 1
        ),
        (
          SELECT MIN(snapshot_date)
          FROM member_lifestyle_stat_snapshots
          WHERE member_id = members.member_id
            AND snapshot_date >= ?
            AND snapshot_date < ?
            AND personal_ready = 1
        )
      )
    WHERE members.faction_id = ?
      AND members.is_current = 1
      AND members.report_exempt = 0
    `,
  )
    .bind(startDate, nextStartDate, startDate, startDate, nextStartDate, HOME_FACTION_ID)
    .all()).results ?? []) as ProgressQueryRow[];

  return rows
    .map((row) => {
      const monthlyXanax = row.end_xantaken === null
        ? 0
        : Math.max(0, Number(row.end_xantaken) - Number(row.start_xantaken ?? row.end_xantaken));
      return {
        rank: 0,
        member_id: Number(row.member_id),
        member_name: row.member_name,
        monthly_xanax: monthlyXanax,
        remaining: Math.max(0, XANAX_TARGET - monthlyXanax),
        eligible: monthlyXanax >= XANAX_TARGET,
        latest_snapshot_date: row.latest_snapshot_date,
      };
    })
    .sort((left, right) => {
      if (right.monthly_xanax !== left.monthly_xanax) {
        return right.monthly_xanax - left.monthly_xanax;
      }
      return (left.member_name ?? `#${left.member_id}`).localeCompare(right.member_name ?? `#${right.member_id}`);
    })
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

async function readRecentClaims(env: Env): Promise<CompetitionClaimRow[]> {
  const rows = await env.DB.prepare(
    `
    SELECT id, month_key, member_id, member_name, xantaken, prize_paid, claimed_by_torn_user_id, claimed_at
    FROM xanax_competition_claims
    ORDER BY claimed_at DESC, id DESC
    LIMIT 12
    `,
  ).all<CompetitionClaimRow>();

  return rows.results ?? [];
}

async function readClaimForMonth(env: Env, monthKey: string): Promise<CompetitionClaimRow | null> {
  return (await env.DB.prepare(
    `
    SELECT id, month_key, member_id, member_name, xantaken, prize_paid, claimed_by_torn_user_id, claimed_at
    FROM xanax_competition_claims
    WHERE month_key = ?
    LIMIT 1
    `,
  )
    .bind(monthKey)
    .first()) as CompetitionClaimRow | null;
}

function serializeSettings(settings: CompetitionSettingsRow, monthKey: string) {
  return {
    enabled: settings.enabled === 1,
    base_prize: settings.base_prize,
    rollover_count: settings.rollover_count,
    current_prize: settings.base_prize * (settings.rollover_count + 1),
    month_key: monthKey,
  };
}

function latestProgressSnapshotDate(rows: XanaxCompetitionProgress[]): string | null {
  return rows.reduce<string | null>((latest, row) => {
    if (!row.latest_snapshot_date) {
      return latest;
    }
    return latest === null || row.latest_snapshot_date > latest ? row.latest_snapshot_date : latest;
  }, null);
}

function parseNonNegativeInteger(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseMonthKey(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}$/.test(value)) {
    return null;
  }
  return Number.isNaN(Date.parse(`${value}-01T00:00:00.000Z`)) ? null : value;
}

function currentMonthKey(): string {
  return new Date().toISOString().slice(0, 7);
}

function previousMonthKey(monthKey: string): string {
  const date = new Date(`${monthKey}-01T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() - 1);
  return date.toISOString().slice(0, 7);
}

function nextMonthStartDate(monthKey: string): string {
  const date = new Date(`${monthKey}-01T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString().slice(0, 10);
}

function nextMonthKey(monthKey: string): string {
  const date = new Date(`${monthKey}-01T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString().slice(0, 7);
}

function enumerateMonthKeysAfter(lastMonthKey: string | null, endMonthKey: string): string[] {
  const months: string[] = [];
  let cursor = lastMonthKey ? nextMonthKey(lastMonthKey) : endMonthKey;
  while (cursor <= endMonthKey) {
    months.push(cursor);
    cursor = nextMonthKey(cursor);
  }
  return months;
}
