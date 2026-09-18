import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WATCH_DAY, WATCH_HOUR, nextWatchHour, watchUtc } from "../shared/chainWatchSchedule";
import { changeWatchSlots, createWatch, parseWatchTime, readWatch, reconcileWatch, setWatchFinish } from "./chainWatchSchedule";
import { canManageWatchOnDiscord, handleWatchInteraction, syncWatchBoards, watchBoardPayload } from "./chainWatchScheduleDiscord";
import { discordApplicationCommands } from "./discordCommands";
import { handleDiscordInteractions, handleVerifiedDiscordInteraction, type DiscordInteraction, type DiscordInteractionResponse } from "./discordInteractions";
import { watchDatabase } from "../scripts/watch-test-database.mjs";
import { selectId, watchSessions } from "../scripts/watch-session-test-helpers";

const now = Date.UTC(2030, 0, 1, 12, 20) / 1000;
const start = nextWatchHour(now);
let db: ReturnType<typeof watchDatabase>;
let sessions: ReturnType<typeof watchSessions>;
const options = { name: "Test watch", guildId: "guild", channelId: "channel", discordUserId: "111" };
const utc = (value: number) => watchUtc(value);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now * 1000);
  db = watchDatabase(now);
  sessions = watchSessions(db.env);
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json({ id: "private-111" })));
});
afterEach(() => { db.sqlite.close(); vi.useRealTimers(); vi.unstubAllGlobals(); });

async function create(hours?: number) {
  return createWatch(db.env, { ...options, finish: hours ? utc(start + hours * WATCH_HOUR) : undefined }, now);
}
async function assign(id: string, starts: number[], actor = 1, admin = false, target: number | null = actor) {
  return changeWatchSlots(db.env, { watchId: id, starts, actorId: actor, targetId: target, admin });
}
function advance(value: number) { db.setNow(value); vi.setSystemTime(value * 1000); }

describe("chain watch scheduling", () => {
  it("requires real UTC calendar dates and whole hours", () => {
    expect(parseWatchTime("2030-01-01 13:00")).toBe(start);
    expect(parseWatchTime("2030-01-01T13:00:00Z")).toBe(start);
    expect(parseWatchTime("01-01-30 13:00")).toBe(start);
    expect(parseWatchTime("17-09-30 18:00 UTC")).toBe(Date.UTC(2030, 8, 17, 18) / 1000);
    expect(watchUtc(Date.UTC(2030, 8, 17, 18) / 1000)).toBe("17-09-30 18:00 UTC");
    for (const input of ["2030-02-31 12:00", "2030-01-01 13:30", "2030-01-01 24:00", "2030-01-01T13:00+01:00", "31-02-30 12:00", "12-31-30 18:00", "17-09-30 18:30", "13:30", "24", "24:00", "18.5", "-1", "18:01", 123]) {
      expect(() => parseWatchTime(input)).toThrow();
    }
    expect(nextWatchHour(start)).toBe(start + WATCH_HOUR);
  });

  it("resolves short hours strictly after the reference, including day and year boundaries", () => {
    for (const input of ["13", "13:00", " 13:00 "]) expect(parseWatchTime(input, undefined, now)).toBe(start);
    expect(parseWatchTime("12", undefined, now)).toBe(start - WATCH_HOUR + WATCH_DAY);
    expect(parseWatchTime("13:00", undefined, start)).toBe(start + WATCH_DAY);
    expect(parseWatchTime("0", undefined, now)).toBe(Date.UTC(2030, 0, 2) / 1000);
    expect(parseWatchTime("00:00", undefined, Date.UTC(2030, 11, 31, 23, 59) / 1000)).toBe(Date.UTC(2031, 0, 1) / 1000);
  });

  it.each([
    { from: "23", until: "02:00", expectedStart: "2030-01-01 23:00", expectedFinish: "2030-01-02 02:00", hours: 3 },
    { from: "18:00", until: "18", expectedStart: "2030-01-01 18:00", expectedFinish: "2030-01-02 18:00", hours: 24 },
    { from: undefined, until: "13", expectedStart: "2030-01-01 13:00", expectedFinish: "2030-01-02 13:00", hours: 24 },
    { from: "05-01-30 23:00", until: "02", expectedStart: "2030-01-05 23:00", expectedFinish: "2030-01-06 02:00", hours: 3 },
  ])("resolves create start $from and finish $until in the right order", async ({ from, until, expectedStart, expectedFinish, hours }) => {
    const watch = await createWatch(db.env, { ...options, start: from, finish: until }, now);
    expect(watch.start_at).toBe(parseWatchTime(expectedStart));
    expect(watch.finish_at).toBe(parseWatchTime(expectedFinish));
    expect((await readWatch(db.env)).slots).toHaveLength(hours);
  });

  it("resolves setfinish from now even for a watch scheduled further ahead", async () => {
    const watch = await createWatch(db.env, { ...options, start: "2030-01-05 23:00" }, now);
    expect(await setWatchFinish(db.env, watch.id, "02", now)).toBe(parseWatchTime("2030-01-02 02:00"));
    expect((await readWatch(db.env)).slots.every((slot) => slot.cancelled === 1)).toBe(true);
  });

  it("rejects outdated explicit dates without rolling them forward", async () => {
    await expect(createWatch(db.env, { ...options, start: "2030-01-01 12:00" }, now)).rejects.toThrow("future");
    await expect(createWatch(db.env, { ...options, start: "23", finish: "2030-01-01 02:00" }, now)).rejects.toThrow("after the start");
    const watch = await create();
    await expect(setWatchFinish(db.env, watch.id, "2030-01-01 12:00", now)).rejects.toThrow("future");
  });

  it("creates a partial day and tomorrow after noon, then publishes each next day exactly at noon once", async () => {
    const watch = await create();
    expect(watch.start_at).toBe(start);
    const midnight = Date.UTC(2030, 0, 2) / 1000;
    expect((await readWatch(db.env)).slots).toHaveLength(35);
    await reconcileWatch(db.env, midnight + 12 * WATCH_HOUR - 1);
    expect((await readWatch(db.env)).sheets).toHaveLength(2);
    await Promise.all([reconcileWatch(db.env, midnight + 12 * WATCH_HOUR), reconcileWatch(db.env, midnight + 12 * WATCH_HOUR)]);
    let data = await readWatch(db.env);
    expect(data.slots).toHaveLength(59);
    expect(data.sheets.map((sheet) => [sheet.start_at, sheet.end_at])).toEqual([
      [start, midnight], [midnight, midnight + WATCH_DAY], [midnight + WATCH_DAY, midnight + 2 * WATCH_DAY],
    ]);
    expect(data.sheets[1].start_at).toBe(data.sheets[0].end_at);
    await reconcileWatch(db.env, midnight + 36 * WATCH_HOUR);
    data = await readWatch(db.env);
    expect(data.slots).toHaveLength(83);
    expect(new Set(data.slots.map((slot) => slot.start_at)).size).toBe(83);
  });

  it("publishes only the first day before noon", async () => {
    const morning = Date.UTC(2030, 0, 1, 5, 20) / 1000;
    advance(morning);
    const watch = await createWatch(db.env, options, morning);
    expect(watch.start_at).toBe(Date.UTC(2030, 0, 1, 6) / 1000);
    expect((await readWatch(db.env)).slots).toHaveLength(18);
    await reconcileWatch(db.env, Date.UTC(2030, 0, 1, 11, 59, 59) / 1000);
    expect((await readWatch(db.env)).sheets).toHaveLength(1);
    await reconcileWatch(db.env, Date.UTC(2030, 0, 1, 12) / 1000);
    expect((await readWatch(db.env)).slots).toHaveLength(42);
  });

  it("starts a future watch with a partial first day, then makes full days from midnight", async () => {
    const future = Date.UTC(2030, 0, 5, 19) / 1000;
    await createWatch(db.env, { ...options, start: utc(future) }, now);
    expect((await readWatch(db.env)).slots).toHaveLength(5);
    await reconcileWatch(db.env, future - 7 * WATCH_HOUR - 1);
    expect((await readWatch(db.env)).sheets).toHaveLength(1);
    await reconcileWatch(db.env, future - 7 * WATCH_HOUR);
    const data = await readWatch(db.env);
    expect(data.slots).toHaveLength(29);
    expect(data.sheets[0].end_at).toBe(future + 5 * WATCH_HOUR);
    expect(data.sheets[1].start_at).toBe(future + 5 * WATCH_HOUR);
  });

  it("does not roll a future watch early and makes fixed finishes nonrecurring", async () => {
    const future = start + 7 * WATCH_DAY;
    await createWatch(db.env, { ...options, start: utc(future), finish: utc(future + 30 * WATCH_HOUR) }, now);
    let data = await readWatch(db.env);
    expect(data.slots).toHaveLength(30);
    expect(data.sheets).toHaveLength(2);
    await reconcileWatch(db.env, future + 29 * WATCH_HOUR);
    data = await readWatch(db.env);
    expect(data.slots).toHaveLength(30);
  });

  it.each([1, 2])("converts %s legacy sheets atomically, preserving assignments, history, confirmations and message IDs", async (count) => {
    const legacyStart = start + 7 * WATCH_DAY + 5 * WATCH_HOUR;
    const legacyEnd = legacyStart + count * WATCH_DAY;
    const id = "legacy-watch";
    await db.env.DB.prepare(`INSERT INTO chain_watch_schedules(id, name, start_at, guild_id, channel_id, created_by_discord_id)
      VALUES (?, 'Legacy test', ?, 'guild', 'channel', '111')`).bind(id, legacyStart).run();
    for (let day = 0; day < count; day++) {
      const from = legacyStart + day * WATCH_DAY;
      await db.env.DB.prepare(`INSERT INTO chain_watch_sheets(id, watch_id, start_at, end_at, discord_message_id)
        VALUES (?, ?, ?, ?, ?)`).bind(`${id}:${from}`, id, from, from + WATCH_DAY, `message-${day}`).run();
      await db.env.DB.batch(Array.from({ length: 24 }, (_, hour) => db.env.DB.prepare(`INSERT INTO chain_watch_slots
        (watch_id, sheet_id, start_at, assigned_to, assignment_actor, admin_override, cancelled, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, `${id}:${from}`, from + hour * WATCH_HOUR,
          hour === 2 ? 1 : null, hour === 2 ? 1 : null, hour === 2 ? 1 : 0, hour === 4 ? 1 : 0, now)));
    }
    await db.env.DB.prepare(`INSERT INTO chain_watch_pending_selections(id, discord_user_id, guild_id, watch_id, action, starts_json, expires_at)
      VALUES ('pending', '111', 'guild', ?, 'claim', ?, ?)`).bind(id, JSON.stringify([legacyEnd - WATCH_HOUR]), legacyEnd).run();
    const snapshot = () => db.env.DB.prepare(`SELECT start_at, assigned_to, assignment_actor, admin_override, cancelled, updated_at
      FROM chain_watch_slots WHERE watch_id = ? AND start_at < ? ORDER BY start_at`).bind(id, legacyEnd).all();
    const before = (await snapshot()).results;
    advance(legacyStart + 2 * WATCH_HOUR);
    await reconcileWatch(db.env, legacyStart + 2 * WATCH_HOUR);
    let data = await readWatch(db.env);
    expect((await snapshot()).results).toEqual(before);
    expect(data.sheets).toHaveLength(count + 1);
    expect(data.slots).toHaveLength(6 + count * 24);
    expect(data.sheets.map((sheet) => sheet.discord_message_id)).toEqual([...Array.from({ length: count }, (_, index) => `message-${index}`), null]);
    expect(data.sheets[0].id).toBe(`${id}:${legacyStart}`);
    expect(data.sheets[0].end_at).toBe(legacyStart + 6 * WATCH_HOUR);
    for (const slot of data.slots) {
      const sheet = data.sheets.find((candidate) => candidate.id === slot.sheet_id)!;
      expect(slot.start_at).toBeGreaterThanOrEqual(sheet.start_at);
      expect(slot.start_at).toBeLessThan(sheet.end_at);
      expect(Math.floor(slot.start_at / WATCH_DAY)).toBe(Math.floor(sheet.start_at / WATCH_DAY));
    }
    expect((await db.env.DB.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
    expect(await db.env.DB.prepare("SELECT id FROM chain_watch_pending_selections WHERE id = 'pending'").first()).toMatchObject({ id: "pending" });
    const firstConversion = data;
    await reconcileWatch(db.env, legacyStart + 2 * WATCH_HOUR);
    data = await readWatch(db.env);
    expect(data).toEqual(firstConversion);
  });

  it("enforces the single-watch restriction for concurrent creates, scheduled watches and pending finishes", async () => {
    const results = await Promise.allSettled([create(), create()]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const watch = (await readWatch(db.env)).watch!;
    await setWatchFinish(db.env, watch.id, utc(start + WATCH_HOUR), now);
    await expect(create()).rejects.toThrow("already exists");
    advance(start + WATCH_HOUR);
    const second = await createWatch(db.env, options, start + WATCH_HOUR);
    expect(second.id).not.toBe(watch.id);
  });

  it("shortens a published successor while preserving earlier assignments and cancelling from the boundary", async () => {
    const watch = await create();
    await reconcileWatch(db.env, start + 12 * WATCH_HOUR);
    await assign(watch.id, [start + 23 * WATCH_HOUR, start + 24 * WATCH_HOUR]);
    await setWatchFinish(db.env, watch.id, utc(start + WATCH_DAY), now);
    await reconcileWatch(db.env, start + 23 * WATCH_HOUR);
    const data = await readWatch(db.env);
    expect(data.slots[23]).toMatchObject({ assigned_to: 1, cancelled: 0 });
    expect(data.slots[24]).toMatchObject({ assigned_to: 1, cancelled: 1 });
    expect(data.slots).toHaveLength(35);
    await expect(assign(watch.id, [start + WATCH_DAY], 2, true)).rejects.toThrow("cancelled");
  });

  it("defaults finish to the next hour, locks completed watches, and can cancel a future watch", async () => {
    const watch = await create();
    expect(await setWatchFinish(db.env, watch.id, undefined, now)).toBe(start);
    expect((await readWatch(db.env)).slots.every((slot) => slot.cancelled === 1)).toBe(true);
    await expect(setWatchFinish(db.env, watch.id, utc(now - 1200), now)).rejects.toThrow("future");
    advance(start);
    await reconcileWatch(db.env, start);
    await expect(setWatchFinish(db.env, watch.id, utc(start + WATCH_DAY), start)).rejects.toThrow("already finished");
  });

  it("extends an unfinished fixed watch, reopening cancelled slots without restoring assignments", async () => {
    const watch = await create();
    await assign(watch.id, [start + 3 * WATCH_HOUR]);
    await setWatchFinish(db.env, watch.id, utc(start + 2 * WATCH_HOUR), now);
    await setWatchFinish(db.env, watch.id, utc(start + 30 * WATCH_HOUR), now);
    const data = await readWatch(db.env);
    expect(data.slots.filter((slot) => !slot.cancelled)).toHaveLength(30);
    expect(data.slots[3]).toMatchObject({ assigned_to: null, cancelled: 0 });
  });

  it("removes a finish, preserves active sign-ups, and resumes daily generation", async () => {
    const watch = await create(2);
    await assign(watch.id, [start]);
    expect(await setWatchFinish(db.env, watch.id, " ongoing ", now)).toBeNull();
    let data = await readWatch(db.env);
    expect(data.watch).toMatchObject({ id: watch.id, finish_at: null, is_open: 1 });
    expect(data.slots).toHaveLength(35);
    expect(data.slots[0]).toMatchObject({ assigned_to: 1, cancelled: 0 });
    const nextNoon = data.sheets[1].start_at + 12 * WATCH_HOUR;
    advance(nextNoon);
    await reconcileWatch(db.env, nextNoon);
    data = await readWatch(db.env);
    expect(data.sheets).toHaveLength(3);
    expect(data.slots).toHaveLength(59);
    expect(data.slots[0].assigned_to).toBe(1);
    await expect(create()).rejects.toThrow("already exists");
  });

  it("reopens cancelled future days when due and never restores their cancelled sign-ups", async () => {
    const watch = await create(4 * 24);
    const tomorrow = Date.UTC(2030, 0, 2) / 1000;
    const later = tomorrow + WATCH_DAY;
    await assign(watch.id, [start, tomorrow, later]);
    await setWatchFinish(db.env, watch.id, utc(start + 2 * WATCH_HOUR), now);
    const beforeCount = (await readWatch(db.env)).slots.length;
    await setWatchFinish(db.env, watch.id, "ONGOING", now);
    let data = await readWatch(db.env);
    expect(data.slots).toHaveLength(beforeCount);
    expect(data.slots.find(slot => slot.start_at === start)).toMatchObject({ assigned_to: 1, cancelled: 0 });
    expect(data.slots.find(slot => slot.start_at === tomorrow)).toMatchObject({ assigned_to: null, cancelled: 0 });
    expect(data.slots.find(slot => slot.start_at === later)).toMatchObject({ assigned_to: 1, cancelled: 1 });
    expect(data.slots.filter(slot => !slot.cancelled)).toHaveLength(35);
    const notices = data.sheets.filter(sheet => watchBoardPayload(db.env, data, sheet).embeds[0].footer?.text === "Next day published at 12:00 UTC");
    expect(notices.map(sheet => sheet.start_at)).toEqual([tomorrow]);
    await assign(watch.id, [tomorrow]);
    await setWatchFinish(db.env, watch.id, "ongoing", now);
    expect((await readWatch(db.env)).slots.find(slot => slot.start_at === tomorrow)?.assigned_to).toBe(1);
    const nextNoon = tomorrow + 12 * WATCH_HOUR;
    advance(nextNoon - 1);
    await reconcileWatch(db.env, nextNoon - 1);
    expect((await readWatch(db.env)).slots.find(slot => slot.start_at === later)?.cancelled).toBe(1);
    advance(nextNoon);
    await reconcileWatch(db.env, nextNoon);
    data = await readWatch(db.env);
    expect(data.slots.find(slot => slot.start_at === later)).toMatchObject({ assigned_to: null, cancelled: 0 });
    expect(data.slots.filter(slot => !slot.cancelled)).toHaveLength(59);
    expect(data.slots.find(slot => slot.start_at === later + WATCH_DAY)?.cancelled).toBe(1);
    const snapshot = data.slots;
    await reconcileWatch(db.env, nextNoon);
    expect((await readWatch(db.env)).slots).toEqual(snapshot);
    await setWatchFinish(db.env, watch.id, utc(later + WATCH_HOUR), nextNoon);
    await reconcileWatch(db.env, later + 12 * WATCH_HOUR);
    expect((await readWatch(db.env)).slots.find(slot => slot.start_at === later + WATCH_DAY)?.cancelled).toBe(1);
  });

  it("keeps cancelled historical slots intact when returning to ongoing", async () => {
    const watch = await create();
    await assign(watch.id, [start]);
    await setWatchFinish(db.env, watch.id, utc(start + 3 * WATCH_HOUR), now);
    await db.env.DB.prepare("UPDATE chain_watch_slots SET cancelled = 1 WHERE watch_id = ? AND start_at = ?").bind(watch.id, start).run();
    advance(start + WATCH_HOUR);
    await setWatchFinish(db.env, watch.id, "ongoing", start + WATCH_HOUR);
    expect((await readWatch(db.env)).slots[0]).toMatchObject({ cancelled: 1, assigned_to: 1 });
  });

  it.each([false, true])("does not resume a finished watch even before cron closes it (cron: %s)", async (runCron) => {
    const watch = await create(2);
    const end = start + 2 * WATCH_HOUR;
    advance(end);
    if (runCron) await reconcileWatch(db.env, end);
    await expect(setWatchFinish(db.env, watch.id, "ongoing", end)).rejects.toThrow("already finished");
    expect((await readWatch(db.env)).watch?.finish_at).toBe(end);
  });

  it("resuming a future watch initially restores only its first day", async () => {
    const future = start + 7 * WATCH_DAY;
    const watch = await createWatch(db.env, { ...options, start: utc(future), finish: utc(future + 2 * WATCH_DAY) }, now);
    await setWatchFinish(db.env, watch.id, utc(future + WATCH_HOUR), now);
    await setWatchFinish(db.env, watch.id, "ongoing", now);
    const data = await readWatch(db.env);
    expect(data.slots.filter(slot => !slot.cancelled)).toHaveLength(11);
    expect(data.slots[11].cancelled).toBe(1);
  });
});

describe("chain watch assignment integrity", () => {
  it("allows only one winner when players claim simultaneously and protects ownership", async () => {
    const watch = await create();
    const results = await Promise.allSettled([assign(watch.id, [start], 1), assign(watch.id, [start], 2)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const owner = (await readWatch(db.env)).slots[0].assigned_to!;
    await expect(assign(watch.id, [start], owner === 1 ? 2 : 1, false, null)).rejects.toThrow("another player");
    await assign(watch.id, [start], owner, false, null);
    expect((await readWatch(db.env)).slots[0].assigned_to).toBeNull();
  });

  it("rejects three consecutive slots in any order, including bridging a gap and crossing sheets", async () => {
    const watch = await create(48);
    const boundary = Date.UTC(2030, 0, 2) / 1000;
    await assign(watch.id, [boundary - WATCH_HOUR, boundary + WATCH_HOUR]);
    await expect(assign(watch.id, [boundary])).rejects.toThrow("one hour off");
    await assign(watch.id, [boundary + 2 * WATCH_HOUR]);
    await expect(assign(watch.id, [boundary + 3 * WATCH_HOUR])).rejects.toThrow("one hour off");
    await assign(watch.id, [boundary + 4 * WATCH_HOUR]);
  });

  it("rolls back every slot in an invalid multiple-slot claim", async () => {
    const watch = await create();
    await expect(assign(watch.id, [start, start + WATCH_HOUR, start + 2 * WATCH_HOUR])).rejects.toThrow("one hour off");
    expect((await readWatch(db.env)).slots.every((slot) => slot.assigned_to === null)).toBe(true);
    await assign(watch.id, [start + 2 * WATCH_HOUR], 2);
    await expect(assign(watch.id, [start, start + 2 * WATCH_HOUR], 1)).rejects.toThrow("another player");
    expect((await readWatch(db.env)).slots[0].assigned_to).toBeNull();
  });

  it("locks slots at the exact start and allows explicit page-admin overrides only", async () => {
    const watch = await create();
    await assign(watch.id, [start]);
    advance(start);
    await expect(assign(watch.id, [start], 1, false, null)).rejects.toThrow("already started");
    await assign(watch.id, [start], 2, true);
    await assign(watch.id, [start + WATCH_HOUR, start + 2 * WATCH_HOUR], 2, true);
    const data = await readWatch(db.env);
    expect(data.slots.slice(0, 3).map((slot) => slot.assigned_to)).toEqual([2, 2, 2]);
    await expect(assign(watch.id, [start + 3 * WATCH_HOUR], 2)).rejects.toThrow("one hour off");
  });

  it("does not allow assignments to former members or non-existent slots", async () => {
    const watch = await create();
    await expect(assign(watch.id, [start], 3, true)).rejects.toThrow("current faction");
    await expect(assign(watch.id, [start + 100 * WATCH_HOUR])).rejects.toThrow("does not exist");
  });
});

function interaction(custom_id: string, user = "111", values?: string[]): DiscordInteraction {
  return sessions.interaction(custom_id, user, values);
}

function autocomplete(command: string, field: string, value = "", chosenStart?: string): DiscordInteraction {
  return {
    type: 4, guild_id: "guild", member: { user: { id: "111" }, permissions: "0" },
    data: { name: "chain-watch", options: [{ type: 1, name: command, options: [
      ...(chosenStart === undefined ? [] : [{ type: 3, name: "start", value: chosenStart }]),
      { type: 3, name: field, value, focused: true },
    ] }] },
  };
}

describe("chain watch time autocomplete", () => {
  it("offers 24 chronological UTC hours with today/tomorrow labels before a name is filled in", async () => {
    const response = await handleVerifiedDiscordInteraction(autocomplete("create", "start"), db.env);
    expect(response.type).toBe(8);
    expect(response.data?.choices).toHaveLength(24);
    expect(response.data?.choices?.[0]).toEqual({ name: "13:00 UTC — today", value: "01-01-30 13:00" });
    expect(response.data?.choices?.[23]).toEqual({ name: "12:00 UTC — tomorrow", value: "02-01-30 12:00" });
    expect(response.data?.choices?.map((choice) => parseWatchTime(choice.value))).toEqual(Array.from({ length: 24 }, (_, index) => start + index * WATCH_HOUR));
    expect((await readWatch(db.env)).watch).toBeNull();
  });

  it.each([
    { query: "20", name: "20:00 UTC — today", value: "01-01-30 20:00" },
    { query: "8", name: "08:00 UTC — tomorrow", value: "02-01-30 08:00" },
    { query: "08:00", name: "08:00 UTC — tomorrow", value: "02-01-30 08:00" },
    { query: "2030-01-06 02:00", name: "02:00 UTC — 06-01-30", value: "06-01-30 02:00" },
    { query: "06-01-30 02:00", name: "02:00 UTC — 06-01-30", value: "06-01-30 02:00" },
    { query: "02-01-30 08", name: "08:00 UTC — tomorrow", value: "02-01-30 08:00" },
  ])("filters $query without confusing hours with the year", async ({ query, name, value }) => {
    const response = await handleVerifiedDiscordInteraction(autocomplete("create", "start", query), db.env);
    expect(response.data?.choices).toEqual([{ name, value }]);
  });

  it("offers finish times after the chosen start and uses the next hour when start is omitted", async () => {
    const overnight = await handleVerifiedDiscordInteraction(autocomplete("create", "finish", "", "23"), db.env);
    expect(overnight.data?.choices).toHaveLength(24);
    expect(overnight.data?.choices?.[0]).toEqual({ name: "00:00 UTC — tomorrow", value: "02-01-30 00:00" });
    expect(overnight.data?.choices?.[23]).toEqual({ name: "23:00 UTC — tomorrow", value: "02-01-30 23:00" });
    const sameHour = await handleVerifiedDiscordInteraction(autocomplete("create", "finish", "18", "18"), db.env);
    expect(sameHour.data?.choices).toEqual([{ name: "18:00 UTC — tomorrow", value: "02-01-30 18:00" }]);
    const defaultStart = await handleVerifiedDiscordInteraction(autocomplete("create", "finish"), db.env);
    expect(defaultStart.data?.choices?.[0].value).toBe("01-01-30 14:00");
    const future = await handleVerifiedDiscordInteraction(autocomplete("create", "finish", "02", "2030-01-05 23:00"), db.env);
    expect(future.data?.choices).toEqual([{ name: "02:00 UTC — 06-01-30", value: "06-01-30 02:00" }]);
  });

  it("offers setfinish times after now rather than the watch start", async () => {
    await createWatch(db.env, { ...options, start: "2030-01-05 23:00" }, now);
    const response = await handleVerifiedDiscordInteraction(autocomplete("setfinish", "finish", "02"), db.env);
    expect(response.data?.choices).toEqual([{ name: "02:00 UTC — tomorrow", value: "02-01-30 02:00" }]);
  });

  it("offers ongoing plus 24 UTC hours only for setfinish", async () => {
    const ongoing = { name: "No finish — continue daily sheets", value: "ongoing" };
    const choices = (await handleVerifiedDiscordInteraction(autocomplete("setfinish", "finish"), db.env)).data!.choices!;
    expect(choices).toHaveLength(25);
    expect(choices[0]).toEqual(ongoing);
    expect(choices.slice(1).map(choice => parseWatchTime(choice.value))).toEqual(Array.from({ length: 24 }, (_, index) => start + index * WATCH_HOUR));
    for (const query of ["on", "ONGOING", "no finish", "daily"]) {
      expect((await handleVerifiedDiscordInteraction(autocomplete("setfinish", "finish", query), db.env)).data?.choices).toEqual([ongoing]);
    }
    expect((await handleVerifiedDiscordInteraction(autocomplete("setfinish", "finish", "18"), db.env)).data?.choices).toEqual([{ name: "18:00 UTC — today", value: "01-01-30 18:00" }]);
    expect((await handleVerifiedDiscordInteraction(autocomplete("create", "finish", "ongoing"), db.env)).data?.choices).toEqual([]);
  });

  it("returns an empty choice list for invalid inputs, invalid starts, unsupported options and other servers", async () => {
    for (const request of [
      autocomplete("create", "start", "24"), autocomplete("create", "start", "18:30"),
      autocomplete("create", "start", "2030-01-01 12:00"), autocomplete("create", "start", "2030-02-31 12:00"),
      autocomplete("create", "start", "31-02-30 12:00"),
      autocomplete("create", "finish", "", "2030-"), autocomplete("create", "finish", "", "2030-01-01 12:00"),
      autocomplete("create", "name"), autocomplete("setfinish", "start"), autocomplete("other", "finish"),
      { ...autocomplete("create", "start"), guild_id: "another-server" },
    ]) expect(await handleVerifiedDiscordInteraction(request, db.env)).toEqual({ type: 8, data: { choices: [] } });
  });
});

describe("Discord chain watch", () => {
  it("temporarily exposes both commands without relaxing page or signup permissions", async () => {
    const command = discordApplicationCommands().find((item) => item.name === "chain-watch")!;
    expect(command.default_member_permissions).toBeUndefined();
    expect(command.dm_permission).toBe(false);
    expect(command.options?.map((item) => item.name)).toEqual(["create", "setfinish"]);
    expect(command.options?.[0].options?.[0]).toMatchObject({ name: "name", required: true });
    expect(command.options?.[0].options?.slice(1)).toEqual([
      expect.objectContaining({ name: "start", autocomplete: true }),
      expect.objectContaining({ name: "finish", autocomplete: true }),
    ]);
    expect(command.options?.[1].options?.[0]).toMatchObject({ name: "finish", required: true, autocomplete: true });
    expect(canManageWatchOnDiscord("0")).toBe(true);
    expect(canManageWatchOnDiscord("32", false)).toBe(false);
    expect(canManageWatchOnDiscord("8", false)).toBe(true);
    expect(canManageWatchOnDiscord("invalid", false)).toBe(false);
    const response = await handleWatchInteraction({ type: 2, guild_id: "guild", channel_id: "channel", member: { user: { id: "unlinked" }, permissions: "0" }, data: { name: "chain-watch", options: [{ name: "create", type: 1, options: [{ name: "name", type: 3, value: "Public test" }] }] } }, db.env);
    expect(response.data?.content).toContain("Created");
    const finish = await handleWatchInteraction({ type: 2, guild_id: "guild", member: { user: { id: "unlinked" }, permissions: "0" }, data: { name: "chain-watch", options: [{ name: "setfinish", type: 1, options: [{ type: 3, name: "finish", value: "14" }] }] } }, db.env);
    expect(finish.data?.content).toContain("will finish");
  });

  it("rejects omitted Discord finishes and confirms an explicit ongoing choice", async () => {
    const watch = await create(2);
    for (const value of [undefined, "", "   "]) {
      const response = await handleWatchInteraction({ type: 2, guild_id: "guild", member: { user: { id: "111" }, permissions: "0" }, data: {
        name: "chain-watch", options: [{ name: "setfinish", type: 1, options: value === undefined ? [] : [{ name: "finish", type: 3, value }] }],
      } }, db.env);
      expect(response.data?.content).toContain("Choose a finish time or ongoing");
      expect((await readWatch(db.env)).watch?.finish_at).toBe(start + 2 * WATCH_HOUR);
    }
    const ongoing = await handleWatchInteraction({ type: 2, guild_id: "guild", member: { user: { id: "111" }, permissions: "0" }, data: {
      name: "chain-watch", options: [{ name: "setfinish", type: 1, options: [{ name: "finish", type: 3, value: "ongoing" }] }],
    } }, db.env);
    expect(ongoing.data?.content).toContain("now has no finish time");
    expect((await readWatch(db.env)).watch).toMatchObject({ id: watch.id, finish_at: null });
  });

  it("shows full resolved dates when creating a watch with short times", async () => {
    const response = await handleWatchInteraction({ type: 2, guild_id: "guild", channel_id: "channel", member: { user: { id: "111" } }, data: { name: "chain-watch", options: [{ name: "create", type: 1, options: [
      { name: "name", type: 3, value: "Overnight" }, { name: "start", type: 3, value: "23" }, { name: "finish", type: 3, value: "02" },
    ] }] } }, db.env);
    expect(response.data?.content).toContain("Start: 01-01-30 23:00 UTC");
    expect(response.data?.content).toContain("Finish: 02-01-30 02:00 UTC");
  });

  it("uses private choices and confirmation, binds confirmations to the player, and rejects stale choices", async () => {
    const watch = await create();
    const data = await readWatch(db.env);
    const sheet = data.sheets[0];
    const open = await sessions.handle(interaction(`cws:open:claim:${sheet.id}`));
    expect(open.data?.flags).toBe(64);
    expect(open.data?.components?.[0].components[0]).toMatchObject({ max_values: 11, options: expect.arrayContaining([
      { label: "23:00 - 24:00", value: String(start + 10 * WATCH_HOUR), default: false },
    ]) });
    const nextSheet = await sessions.handle(interaction(`cws:open:claim:${data.sheets[1].id}`));
    expect(nextSheet.data?.content).toContain("Choose slots to claim for **02-01-30** (UTC).");
    expect(nextSheet.data?.components?.[0].components[0]).toMatchObject({ options: expect.arrayContaining([
      { label: "00:00 - 01:00", value: String(start + 11 * WATCH_HOUR), default: false },
    ]) });
    const reopened = await sessions.handle(interaction(`cws:open:claim:${sheet.id}`));
    const pick = await sessions.handle(interaction(selectId(reopened), "111", [String(start)]));
    const confirm = pick.data!.components![1].components[0] as { custom_id: string };
    const stolen = await sessions.handle(interaction(confirm.custom_id, "222"));
    expect(stolen.data?.content).toContain("expired");
    await assign(watch.id, [start], 2);
    const stale = await sessions.handle(interaction(confirm.custom_id));
    expect(stale.type).toBe(7);
    expect(stale.data?.components).toEqual([]);
    expect(stale.data?.content).toContain("another player");
    expect((await readWatch(db.env)).slots[0].assigned_to).toBe(2);
  });

  it("does not grant Discord administrators time or break overrides", async () => {
    const watch = await create();
    advance(start - 60);
    const sheet = (await readWatch(db.env)).sheets[0];
    const open = await sessions.handle(interaction(`cws:open:claim:${sheet.id}`));
    const pick = await sessions.handle(interaction(selectId(open), "111", [String(start)]));
    const confirm = pick.data!.components![1].components[0] as { custom_id: string };
    advance(start);
    const response = await sessions.handle(interaction(confirm.custom_id));
    expect(response.data?.content).toContain("already started");
    const wrongGuild = await handleWatchInteraction({ ...interaction(`cws:open:claim:${sheet.id}`), guild_id: "elsewhere" }, db.env);
    expect(wrongGuild.data?.content).toContain("faction Discord server");
    expect((await readWatch(db.env, watch.id)).slots[0].assigned_to).toBeNull();
  });

  it("creates a roster once, edits it after changes, and retries failures without losing assignments", async () => {
    const watch = await create(11);
    db.env.DISCORD_BOT_TOKEN = "test-token";
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "message" }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    await syncWatchBoards(db.env, now);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1].method).toBe("POST");
    await syncWatchBoards(db.env, now);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await assign(watch.id, [start]);
    fetcher.mockResolvedValueOnce(new Response("Unavailable", { status: 503 }));
    await expect(syncWatchBoards(db.env, now)).rejects.toThrow();
    expect((await readWatch(db.env)).slots[0].assigned_to).toBe(1);
    fetcher.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    await syncWatchBoards(db.env, now);
    expect(fetcher.mock.calls[2][1].method).toBe("PATCH");
    const data = await readWatch(db.env);
    const payload = watchBoardPayload(db.env, data, data.sheets[0]);
    expect(payload.allowed_mentions.parse).toEqual([]);
    expect(payload.embeds[0].description).toMatch(/^### Test watch · 01-01-30 \(UTC\)\n1\/11 filled\n\n\*\*13:00 - 14:00\*\* · /);
    expect(payload.embeds[0].footer?.text).toBe("Watch finishes 02-01-30 00:00 UTC");
    expect(payload.embeds[0].description.length).toBeLessThan(4096);
    for (const button of payload.components[0].components) if ("custom_id" in button) expect(button.custom_id!.length).toBeLessThanOrEqual(100);
    fetcher.mockImplementation(async () => new Response("{}", { status: 200 }));
    const finalSlotStart = data.slots.at(-1)!.start_at;
    advance(finalSlotStart - 1);
    await syncWatchBoards(db.env, finalSlotStart - 1);
    expect(JSON.parse(fetcher.mock.calls.at(-1)![1].body).components[0].components).toHaveLength(3);
    expect(JSON.parse(fetcher.mock.calls.at(-1)![1].body).embeds[0].description).toContain("🟢 **22:00 - 23:00** · Available · On watch");
    advance(finalSlotStart);
    await syncWatchBoards(db.env, finalSlotStart);
    expect(fetcher.mock.calls.at(-1)![1].method).toBe("PATCH");
    expect(JSON.parse(fetcher.mock.calls.at(-1)![1].body).components).toEqual([]);
    const finalDescription = JSON.parse(fetcher.mock.calls.at(-1)![1].body).embeds[0].description;
    expect(finalDescription).toContain("🟢 **23:00 - 24:00** · Available · On watch");
    expect(finalDescription).not.toContain("🟢 **22:00 - 23:00**");
  });

  it.each(["ongoing", utc(start + WATCH_DAY)])("hides cancelled Discord days without changing history, then republishes with finish %s", async (finish) => {
    const watch = await create();
    await assign(watch.id, [start + WATCH_HOUR, start + 11 * WATCH_HOUR]);
    db.env.DISCORD_BOT_TOKEN = "test-token";
    let messageNumber = 0;
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => init.method === "POST"
      ? Response.json({ id: `message-${++messageNumber}` }) : new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetcher);
    await syncWatchBoards(db.env, now);
    await setWatchFinish(db.env, watch.id, utc(start + 3 * WATCH_HOUR), now);
    const before = await readWatch(db.env);
    const history = (await db.env.DB.prepare("SELECT * FROM chain_watch_slots ORDER BY start_at").all()).results;
    fetcher.mockClear();

    await syncWatchBoards(db.env, now);
    expect(fetcher.mock.calls.map(call => call[1].method)).toEqual(["PATCH", "DELETE"]);
    expect(fetcher.mock.calls[1][0]).toBe("https://discord.com/api/v10/channels/channel/messages/message-2");
    const payload = JSON.parse(fetcher.mock.calls[0][1].body as string);
    expect(payload.embeds[0].description).toContain("1/3 filled");
    expect(payload.embeds[0].description).toContain("**15:00 - 16:00**");
    expect(payload.embeds[0].description).not.toContain("**16:00 - 17:00**");
    expect(payload.embeds[0].description).not.toContain("Cancelled");
    const after = await readWatch(db.env);
    expect(after.watch).toEqual(before.watch);
    expect(after.slots).toEqual(before.slots);
    expect(after.slots).toHaveLength(35);
    expect(after.slots[11]).toMatchObject({ assigned_to: 1, cancelled: 1 });
    expect((await db.env.DB.prepare("SELECT * FROM chain_watch_slots ORDER BY start_at").all()).results).toEqual(history);
    expect(after.sheets).toEqual(before.sheets.map((sheet, index) => index ? { ...sheet, discord_message_id: null } : sheet));
    expect(await db.env.DB.prepare("SELECT dirty, last_payload FROM chain_watch_sheets WHERE id = ?").bind(after.sheets[1].id).first())
      .toEqual({ dirty: 0, last_payload: null });
    await syncWatchBoards(db.env, now);
    expect(fetcher).toHaveBeenCalledTimes(2);

    // Extending the still-open watch republishes a removed day automatically.
    await setWatchFinish(db.env, watch.id, finish, now);
    fetcher.mockClear();
    await syncWatchBoards(db.env, now);
    expect(fetcher.mock.calls.map(call => call[1].method)).toEqual(["PATCH", "POST"]);
    expect((await readWatch(db.env)).sheets[1].discord_message_id).toBe("message-3");
  });

  it.each([204, 404, 503])("handles fully cancelled message deletion with HTTP %s and preserves retry state", async (status) => {
    const watch = await create(2);
    await assign(watch.id, [start]);
    db.env.DISCORD_BOT_TOKEN = "test-token";
    const fetcher = vi.fn(async () => Response.json({ id: "message" }));
    vi.stubGlobal("fetch", fetcher);
    await syncWatchBoards(db.env, now);
    await setWatchFinish(db.env, watch.id, undefined, now);
    const before = await readWatch(db.env);
    fetcher.mockClear();
    fetcher.mockResolvedValueOnce(new Response(status === 204 ? null : "{}", { status }));
    if (status === 503) {
      await expect(syncWatchBoards(db.env, now)).rejects.toThrow("503");
      expect((await readWatch(db.env)).sheets[0].discord_message_id).toBe("message");
      const retry = await db.env.DB.prepare("SELECT dirty, last_payload, sync_token FROM chain_watch_sheets").first<{ dirty: number; last_payload: string; sync_token: string | null }>();
      expect(retry!.dirty).toBeGreaterThan(0);
      expect(retry!.last_payload).toBeTruthy();
      expect(retry!.sync_token).toBeNull();
      fetcher.mockResolvedValueOnce(new Response(null, { status: 204 }));
    }
    await syncWatchBoards(db.env, now);
    expect((fetcher.mock.calls as unknown as Array<[string, RequestInit]>).every(call => call[1].method === "DELETE")).toBe(true);
    const after = await readWatch(db.env);
    expect(after.slots).toEqual(before.slots);
    expect(after.sheets).toEqual([{ ...before.sheets[0], discord_message_id: null }]);
    const calls = fetcher.mock.calls.length;
    await syncWatchBoards(db.env, now);
    expect(fetcher).toHaveBeenCalledTimes(calls);
  });

  it("does not publish an entirely cancelled sheet", async () => {
    const watch = await create();
    await setWatchFinish(db.env, watch.id, undefined, now);
    db.env.DISCORD_BOT_TOKEN = "test-token";
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await syncWatchBoards(db.env, now);
    expect(fetcher).not.toHaveBeenCalled();
    const data = await readWatch(db.env);
    expect(data.sheets).toHaveLength(2);
    expect(data.slots).toHaveLength(35);
    expect(data.slots.every(slot => slot.cancelled === 1)).toBe(true);
  });

  it("recreates a removed day when finish is extended during its Discord deletion", async () => {
    const watch = await create(2);
    db.env.DISCORD_BOT_TOKEN = "test-token";
    const fetcher = vi.fn(async () => Response.json({ id: "original" }));
    vi.stubGlobal("fetch", fetcher);
    await syncWatchBoards(db.env, now);
    await setWatchFinish(db.env, watch.id, undefined, now);
    fetcher.mockImplementationOnce(async () => {
      await setWatchFinish(db.env, watch.id, utc(start + 2 * WATCH_HOUR), now);
      return new Response(null, { status: 204 });
    });
    await syncWatchBoards(db.env, now);
    expect(await db.env.DB.prepare("SELECT discord_message_id, dirty FROM chain_watch_sheets").first()).toMatchObject({ discord_message_id: null, dirty: expect.any(Number) });
    fetcher.mockResolvedValueOnce(Response.json({ id: "replacement" }));
    await syncWatchBoards(db.env, now);
    expect((await readWatch(db.env)).sheets[0].discord_message_id).toBe("replacement");
    expect((fetcher.mock.calls as unknown as Array<[string, RequestInit]>).map(call => call[1].method)).toEqual(["POST", "DELETE", "POST"]);
  });

  it.each([0, 2])("keeps the publication notice only on the newest message after %s missed days", async (missedDays) => {
    await create();
    db.env.DISCORD_BOT_TOKEN = "test-token";
    let messageNumber = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(JSON.stringify({ id: `message-${++messageNumber}` }), { status: 200 })));
    await syncWatchBoards(db.env, now);
    const before = await readWatch(db.env);
    const previousNewest = before.sheets.at(-1)!;
    const published = async () => (await db.env.DB.prepare(`SELECT id, dirty, last_payload FROM chain_watch_sheets
      WHERE discord_message_id IS NOT NULL ORDER BY start_at`).all()).results as Array<{ id: string; dirty: number; last_payload: string }>;
    const hasNotice = (row: { last_payload: string }) => JSON.parse(row.last_payload).embeds[0].footer?.text === "Next day published at 12:00 UTC";
    expect((await published()).filter(hasNotice).map((row) => row.id)).toEqual([previousNewest.id]);

    const nextPublication = previousNewest.start_at + missedDays * WATCH_DAY + 12 * WATCH_HOUR;
    advance(nextPublication);
    await reconcileWatch(db.env, nextPublication);
    await syncWatchBoards(db.env, nextPublication);
    const after = await readWatch(db.env);
    const messages = await published();
    expect(messages).toHaveLength(after.sheets.length);
    expect(messages.every((row) => row.dirty === 0)).toBe(true);
    expect(messages.filter(hasNotice).map((row) => row.id)).toEqual([after.sheets.at(-1)!.id]);
    expect(JSON.parse(messages.find((row) => row.id === previousNewest.id)!.last_payload).embeds[0].footer).toBeUndefined();
    const savedMessages = messages;
    await reconcileWatch(db.env, nextPublication);
    expect(await published()).toEqual(savedMessages);
  });

  it.each(["claim", "leave"])("keeps the %s dropdown, confirmation and saved result in one private message", async (action) => {
    const watch = await create();
    if (action === "leave") await assign(watch.id, [start, start + WATCH_HOUR]);
    const sheet = (await readWatch(db.env)).sheets[0];
    const fetcher = vi.fn().mockImplementation(async () => Response.json({ id: "private-111" }));
    vi.stubGlobal("fetch", fetcher);
    const keys = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]) as CryptoKeyPair;
    const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const publicKey = hex(await crypto.subtle.exportKey("raw", keys.publicKey) as ArrayBuffer);
    const dispatch = async (customId: string, values?: string[]) => {
      const token = `token-${fetcher.mock.calls.length}`;
      const body = JSON.stringify({ ...interaction(customId, "111", values), application_id: "application", token });
      const timestamp = String(now);
      const signature = hex(await crypto.subtle.sign("Ed25519", keys.privateKey, new TextEncoder().encode(timestamp + body)));
      const pending: Promise<unknown>[] = [];
      const response = await handleDiscordInteractions(new Request("https://worker.test/api/discord/interactions", {
        method: "POST", body, headers: { "X-Signature-Ed25519": signature, "X-Signature-Timestamp": timestamp },
      }), { ...db.env, DISCORD_PUBLIC_KEY: publicKey }, { waitUntil(promise: Promise<unknown>) { pending.push(promise); } } as ExecutionContext);
      const acknowledgement = await response!.json();
      await Promise.all(pending);
      const call = fetcher.mock.calls.at(-1) as unknown as [string, RequestInit];
      expect(call[0]).toBe(`https://discord.com/api/v10/webhooks/application/${token}/messages/@original`);
      expect(call[1].method).toBe("PATCH");
      return { acknowledgement, message: JSON.parse(call[1].body as string) as NonNullable<DiscordInteractionResponse["data"]> };
    };

    const open = await dispatch(`cws:open:${action}:${sheet.id}`);
    expect(open.acknowledgement).toEqual({ type: 5, data: { flags: 64 } });
    const heading = `${action === "claim" ? "Choose slots to claim" : "Choose your slots to leave"} for **01-01-30** (UTC).`;
    expect(open.message.content).toContain(heading);
    expect(open.message.components).toHaveLength(2);
    expect(open.message.components?.[0].components[0]).toMatchObject({ type: 3 });
    expect(open.message.components?.[1].components[0]).toMatchObject({ type: 2, disabled: true });

    const pickerId = selectId({ type: 4, data: open.message });
    const pick = await dispatch(pickerId, [String(start)]);
    expect(pick.acknowledgement).toEqual({ type: 6 });
    expect(pick.message.content).toContain(heading);
    expect(pick.message.content).toContain("Selected:\n13:00 - 14:00");
    expect(pick.message.components).toHaveLength(2);
    expect(pick.message.components?.[0].components[0]).toMatchObject({ options: expect.arrayContaining([{ label: "13:00 - 14:00", value: String(start), default: true }]) });
    expect(pick.message.components?.[1].components[0]).toMatchObject({ disabled: false });
    expect((await readWatch(db.env)).slots[0].assigned_to).toBe(action === "claim" ? null : 1);

    const changed = await dispatch(pickerId, [String(start + WATCH_HOUR)]);
    expect(changed.acknowledgement).toEqual({ type: 6 });
    expect(changed.message.content).toContain(heading);
    expect(changed.message.components?.[0].components[0]).toMatchObject({ options: expect.arrayContaining([
      { label: "13:00 - 14:00", value: String(start), default: false },
      { label: "14:00 - 15:00", value: String(start + WATCH_HOUR), default: true },
    ]) });
    const confirm = changed.message.components![1].components[0] as { custom_id: string };
    const saved = await dispatch(confirm.custom_id);
    expect(saved.acknowledgement).toEqual({ type: 6 });
    expect(saved.message.content).toContain(action === "claim" ? "Signed up for 1 slot" : "Left 1 slot");
    expect(saved.message.components).toEqual([]);
    expect((await readWatch(db.env)).slots.slice(0, 2).map((slot) => slot.assigned_to)).toEqual(action === "claim" ? [null, 1] : [1, null]);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("keeps the selector editable and disables confirmation when a selection breaks the two-hour rule", async () => {
    await create();
    const sheet = (await readWatch(db.env)).sheets[0];
    const open = await sessions.handle(interaction(`cws:open:claim:${sheet.id}`));
    const invalid = await sessions.handle(interaction(selectId(open), "111", [start, start + WATCH_HOUR, start + 2 * WATCH_HOUR].map(String)));
    expect(invalid.type).toBe(7);
    expect(invalid.data?.content).toContain("one hour off");
    expect(invalid.data?.content).toContain("Choose slots to claim for **01-01-30** (UTC).");
    expect(invalid.data?.components?.[0].components[0]).toMatchObject({ type: 3 });
    expect(invalid.data?.components?.[1].components[0]).toMatchObject({ disabled: true });
    const valid = await sessions.handle(interaction(selectId(open), "111", [String(start)]));
    expect(valid.type).toBe(7);
    expect(valid.data?.components?.[1].components[0]).toMatchObject({ disabled: false });
    const confirm = valid.data!.components![1].components[0] as { custom_id: string };
    const saved = await sessions.handle(interaction(confirm.custom_id));
    expect(saved.type).toBe(7);
    expect(saved.data?.components).toEqual([]);
    expect((await readWatch(db.env)).slots[0].assigned_to).toBe(1);
  });
});
