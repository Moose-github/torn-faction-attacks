import type { ChainWatchSchedule, ChainWatchSheet, ChainWatchSlot, ChainWatchScheduleResponse } from "../shared/chainWatchSchedule";
import { nextWatchHour, WATCH_DAY, WATCH_HOUR } from "../shared/chainWatchSchedule";
import type { Env } from "./types";
import { nowSeconds } from "./utils";

export class WatchError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export function parseWatchTime(value: unknown, fallback?: number): number {
  if (value === undefined || value === null || value === "") {
    if (fallback !== undefined) return fallback;
    throw new WatchError("Enter a UTC date and whole hour: YYYY-MM-DD HH:00.");
  }
  if (typeof value !== "string") throw new WatchError("Use YYYY-MM-DD HH:00 in UTC.");
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):00(?::00)?(?:Z| UTC)?$/.exec(value.trim());
  if (!match) throw new WatchError("Times must be whole hours in UTC: YYYY-MM-DD HH:00.");
  const canonical = `${match[1]}T${match[2]}:00:00.000Z`;
  const ms = Date.parse(canonical);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== canonical) throw new WatchError("That UTC date or hour is invalid.");
  return ms / 1000;
}

export function watchFailure(error: unknown): WatchError {
  if (error instanceof WatchError) return error;
  const text = String(error);
  const messages: Record<string, string> = {
    WATCH_SLOT_CANCELLED: "That slot has been cancelled. Refresh the sheet.",
    WATCH_SLOT_STARTED: "Players cannot change slots that have already started.",
    WATCH_SLOT_TAKEN: "A slot belongs to another player. Refresh and choose again.",
    WATCH_NOT_MEMBER: "Only current faction members can take slots.",
    WATCH_BREAK_REQUIRED: "Take at least one hour off after two consecutive slots, including across sheets.",
    "chain_watch_schedules.is_open": "A watch already exists. Finish it before creating another.",
  };
  for (const [key, message] of Object.entries(messages)) if (text.includes(key)) return new WatchError(message, 409);
  throw error;
}

export async function currentWatch(env: Env): Promise<ChainWatchSchedule | null> {
  return env.DB.prepare("SELECT * FROM chain_watch_schedules WHERE is_open = 1 LIMIT 1").first<ChainWatchSchedule>();
}

// Read the current finish inside every SQL statement, so a concurrent setfinish
// cannot be undone by a cron tick working from an older copy of the schedule.
function generateWatchStatements(env: Env, id: string, now: number): D1PreparedStatement[] {
  const source = `SELECT *, COALESCE(finish_at, start_at + ${WATCH_DAY} * MAX(1, 1 + CAST((? - start_at + ${12 * WATCH_HOUR}) / ${WATCH_DAY} AS INTEGER))) AS horizon
    FROM chain_watch_schedules WHERE id = ? AND is_open = 1`;
  return [
    env.DB.prepare(`WITH RECURSIVE w AS (${source}), hours(t) AS (
      SELECT COALESCE((SELECT MAX(start_at) + ${WATCH_DAY} FROM chain_watch_sheets WHERE watch_id = w.id), w.start_at)
        FROM w WHERE COALESCE((SELECT MAX(start_at) + ${WATCH_DAY} FROM chain_watch_sheets WHERE watch_id = w.id), w.start_at) < horizon
      UNION ALL SELECT t + ${WATCH_DAY} FROM hours, w WHERE t + ${WATCH_DAY} < horizon
    ) INSERT OR IGNORE INTO chain_watch_sheets(id, watch_id, start_at, end_at)
      SELECT w.id || ':' || t, w.id, t, t + ${WATCH_DAY} FROM w, hours`).bind(now, id),
    env.DB.prepare(`WITH RECURSIVE w AS (${source}), hours(t) AS (
      SELECT COALESCE((SELECT MAX(start_at) + ${WATCH_HOUR} FROM chain_watch_slots WHERE watch_id = w.id), w.start_at)
        FROM w WHERE COALESCE((SELECT MAX(start_at) + ${WATCH_HOUR} FROM chain_watch_slots WHERE watch_id = w.id), w.start_at) < horizon
      UNION ALL SELECT t + ${WATCH_HOUR} FROM hours, w WHERE t + ${WATCH_HOUR} < horizon
    ) INSERT OR IGNORE INTO chain_watch_slots(watch_id, sheet_id, start_at)
      SELECT w.id, w.id || ':' || (w.start_at + CAST((t - w.start_at) / ${WATCH_DAY} AS INTEGER) * ${WATCH_DAY}), t FROM w, hours`).bind(now, id),
  ];
}

export async function reconcileWatch(env: Env, now = nowSeconds()): Promise<void> {
  await env.DB.prepare("UPDATE chain_watch_schedules SET is_open = 0 WHERE is_open = 1 AND finish_at <= ?").bind(now).run();
  const watch = await currentWatch(env);
  if (watch) await env.DB.batch(generateWatchStatements(env, watch.id, now));
  await env.DB.prepare("DELETE FROM chain_watch_pending_selections WHERE expires_at <= ?").bind(now).run();
}

export async function createWatch(env: Env, input: {
  name: unknown; start?: unknown; finish?: unknown; guildId: string; channelId: string; discordUserId: string;
}, now = nowSeconds()): Promise<ChainWatchSchedule> {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name || name.length > 80 || /[\r\n\x00-\x1f]/.test(name)) throw new WatchError("Give the watch a name of 1–80 characters on one line.");
  const start = parseWatchTime(input.start, nextWatchHour(now));
  if (start <= now) throw new WatchError("Start must be a whole hour in the future.");
  const finish = input.finish === undefined || input.finish === null || input.finish === "" ? null : parseWatchTime(input.finish);
  if (finish !== null && finish <= start) throw new WatchError("Finish must be after the start.");
  const id = crypto.randomUUID();
  try {
    await env.DB.batch([
      env.DB.prepare("UPDATE chain_watch_schedules SET is_open = 0 WHERE is_open = 1 AND finish_at <= ?").bind(now),
      env.DB.prepare(`INSERT INTO chain_watch_schedules(id, name, start_at, finish_at, guild_id, channel_id, created_by_discord_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(id, name, start, finish, input.guildId, input.channelId, input.discordUserId),
      ...generateWatchStatements(env, id, now),
    ]);
  } catch (error) { throw watchFailure(error); }
  return (await currentWatch(env))!;
}

export async function setWatchFinish(env: Env, id: string, value: unknown, now = nowSeconds()): Promise<number> {
  const finish = parseWatchTime(value, nextWatchHour(now));
  if (finish <= now) throw new WatchError("Finish must be a whole hour in the future.");
  const result = await env.DB.batch([
    env.DB.prepare("UPDATE chain_watch_schedules SET finish_at = ? WHERE id = ? AND is_open = 1 AND (finish_at IS NULL OR finish_at > ?)").bind(finish, id, now),
    // Cancellations preserve the assignment as history; an extension does not
    // silently reinstate a cancelled player's commitment.
    env.DB.prepare(`UPDATE chain_watch_slots SET cancelled = 1 WHERE watch_id = ? AND start_at >= ?
      AND EXISTS (SELECT 1 FROM chain_watch_schedules WHERE id = ? AND is_open = 1 AND finish_at = ?)`).bind(id, finish, id, finish),
    env.DB.prepare(`UPDATE chain_watch_slots SET cancelled = 0, assigned_to = NULL, admin_override = 1, updated_at = unixepoch()
      WHERE watch_id = ? AND cancelled = 1 AND start_at < ?
      AND EXISTS (SELECT 1 FROM chain_watch_schedules WHERE id = ? AND is_open = 1 AND finish_at = ? AND finish_at > ?)`)
      .bind(id, finish, id, finish, now),
    ...generateWatchStatements(env, id, now),
    env.DB.prepare(`UPDATE chain_watch_sheets SET dirty = dirty + 1 WHERE watch_id = ?`).bind(id),
  ]);
  if (!result[0].meta.changes) throw new WatchError("That watch has already finished. Refresh the page.", 409);
  return finish;
}

export async function readWatch(env: Env, id?: string | null): Promise<ChainWatchScheduleResponse> {
  const now = nowSeconds();
  const watch = id
    ? await env.DB.prepare("SELECT * FROM chain_watch_schedules WHERE id = ?").bind(id).first<ChainWatchSchedule>()
    : await env.DB.prepare("SELECT * FROM chain_watch_schedules ORDER BY is_open DESC, created_at DESC, rowid DESC LIMIT 1").first<ChainWatchSchedule>();
  if (id && !watch) throw new WatchError("Watch not found.", 404);
  if (!watch) return { ok: true, now, watch: null, sheets: [], slots: [], members: [] };
  const [sheets, slots, members] = await env.DB.batch([
    env.DB.prepare("SELECT id, watch_id, start_at, end_at, discord_message_id FROM chain_watch_sheets WHERE watch_id = ? ORDER BY start_at").bind(watch.id),
    env.DB.prepare(`SELECT s.watch_id, s.sheet_id, s.start_at, s.assigned_to, s.cancelled, m.name AS member_name
      FROM chain_watch_slots s LEFT JOIN home_faction_members m ON m.member_id = s.assigned_to WHERE s.watch_id = ? ORDER BY s.start_at`).bind(watch.id),
    env.DB.prepare("SELECT member_id, name FROM home_faction_members WHERE is_current = 1 ORDER BY name COLLATE NOCASE"),
  ]);
  return { ok: true, now, watch, sheets: sheets.results as ChainWatchSheet[], slots: slots.results as ChainWatchSlot[], members: members.results as ChainWatchScheduleResponse["members"] };
}

export async function changeWatchSlots(env: Env, input: {
  watchId: string; starts: unknown; actorId: number; targetId: number | null; admin: boolean;
}): Promise<void> {
  if (!Array.isArray(input.starts) || input.starts.length < 1 || input.starts.length > 24 ||
      input.starts.some((s) => !Number.isSafeInteger(s) || s % WATCH_HOUR !== 0)) throw new WatchError("Choose between 1 and 24 valid hourly slots.");
  const starts = [...new Set(input.starts as number[])];
  const placeholders = starts.map(() => "?").join(",");
  const found = await env.DB.prepare(`SELECT COUNT(*) AS count FROM chain_watch_slots WHERE watch_id = ? AND start_at IN (${placeholders})`).bind(input.watchId, ...starts).first<{ count: number }>();
  if (found?.count !== starts.length) throw new WatchError("A selected slot does not exist. Refresh the sheet.", 404);
  if (input.targetId !== null && (!Number.isSafeInteger(input.targetId) || input.targetId <= 0)) throw new WatchError("Choose a valid faction member.");
  try {
    await env.DB.batch(starts.map((start) => env.DB.prepare(`UPDATE chain_watch_slots
      SET assigned_to = ?, assignment_actor = ?, admin_override = ?, updated_at = unixepoch()
      WHERE watch_id = ? AND start_at = ?`).bind(input.targetId, input.actorId, input.admin ? 1 : 0, input.watchId, start)));
  } catch (error) { throw watchFailure(error); }
}

export async function watchDiscordMember(env: Env, discordId: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT l.torn_user_id FROM discord_member_links l
    JOIN home_faction_members m ON m.member_id = l.torn_user_id AND m.is_current = 1
    WHERE l.discord_user_id = ? LIMIT 1`).bind(discordId).first<{ torn_user_id: number }>();
  if (!row) throw new WatchError("No current faction member is linked to your Discord account. Check your Torn Discord link and website Settings.", 403);
  return row.torn_user_id;
}
