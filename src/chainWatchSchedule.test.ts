import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WATCH_DAY, WATCH_HOUR, nextWatchHour, watchUtc } from "../shared/chainWatchSchedule";
import { changeWatchSlots, createWatch, parseWatchTime, readWatch, reconcileWatch, setWatchFinish } from "./chainWatchSchedule";
import { canManageWatchOnDiscord, handleWatchInteraction, syncWatchBoards, watchBoardPayload } from "./chainWatchScheduleDiscord";
import { discordApplicationCommands } from "./discordCommands";
import { handleVerifiedDiscordInteraction, type DiscordInteraction } from "./discordInteractions";
import { watchDatabase } from "../scripts/watch-test-database.mjs";

const now = Date.UTC(2030, 0, 1, 12, 20) / 1000;
const start = nextWatchHour(now);
let db: ReturnType<typeof watchDatabase>;
const options = { name: "Test watch", guildId: "guild", channelId: "channel", discordUserId: "111" };
const utc = (value: number) => watchUtc(value);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now * 1000);
  db = watchDatabase(now);
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
    for (const input of ["2030-02-31 12:00", "2030-01-01 13:30", "2030-01-01 24:00", "2030-01-01T13:00+01:00", "13:00", 123]) {
      expect(() => parseWatchTime(input)).toThrow();
    }
    expect(nextWatchHour(start)).toBe(start + WATCH_HOUR);
  });

  it("creates 24 hours at the next hour, then publishes the successor exactly 12h before expiry once", async () => {
    const watch = await create();
    expect(watch.start_at).toBe(start);
    expect((await readWatch(db.env)).slots).toHaveLength(24);
    await reconcileWatch(db.env, start + 12 * WATCH_HOUR - 1);
    expect((await readWatch(db.env)).sheets).toHaveLength(1);
    await Promise.all([reconcileWatch(db.env, start + 12 * WATCH_HOUR), reconcileWatch(db.env, start + 12 * WATCH_HOUR)]);
    let data = await readWatch(db.env);
    expect(data.slots).toHaveLength(48);
    expect(data.sheets[1].start_at).toBe(data.sheets[0].end_at);
    await reconcileWatch(db.env, start + 36 * WATCH_HOUR);
    data = await readWatch(db.env);
    expect(data.slots).toHaveLength(72);
    expect(new Set(data.slots.map((slot) => slot.start_at)).size).toBe(72);
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
    expect(data.slots).toHaveLength(48);
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
    expect(data.slots).toHaveLength(30);
    expect(data.slots[3]).toMatchObject({ assigned_to: null, cancelled: 0 });
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
    const boundary = start + 23 * WATCH_HOUR;
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
  return { type: 3, guild_id: "guild", channel_id: "channel", member: { user: { id: user }, permissions: "8" }, data: { custom_id, values } };
}

describe("Discord chain watch", () => {
  it("temporarily exposes both commands without relaxing page or signup permissions", async () => {
    const command = discordApplicationCommands().find((item) => item.name === "chain-watch")!;
    expect(command.default_member_permissions).toBeUndefined();
    expect(command.dm_permission).toBe(false);
    expect(command.options?.map((item) => item.name)).toEqual(["create", "setfinish"]);
    expect(command.options?.[0].options?.[0]).toMatchObject({ name: "name", required: true });
    expect(canManageWatchOnDiscord("0")).toBe(true);
    expect(canManageWatchOnDiscord("32", false)).toBe(false);
    expect(canManageWatchOnDiscord("8", false)).toBe(true);
    expect(canManageWatchOnDiscord("invalid", false)).toBe(false);
    const response = await handleWatchInteraction({ type: 2, guild_id: "guild", channel_id: "channel", member: { user: { id: "unlinked" }, permissions: "0" }, data: { name: "chain-watch", options: [{ name: "create", type: 1, options: [{ name: "name", type: 3, value: "Public test" }] }] } }, db.env);
    expect(response.data?.content).toContain("Created");
    const finish = await handleWatchInteraction({ type: 2, guild_id: "guild", member: { user: { id: "unlinked" }, permissions: "0" }, data: { name: "chain-watch", options: [{ name: "setfinish", type: 1 }] } }, db.env);
    expect(finish.data?.content).toContain("will finish");
  });

  it("uses private choices and confirmation, binds confirmations to the player, and rejects stale choices", async () => {
    const watch = await create();
    const data = await readWatch(db.env);
    const sheet = data.sheets[0];
    const open = await handleVerifiedDiscordInteraction(interaction(`cws:open:claim:${sheet.id}`), db.env);
    expect(open.data?.flags).toBe(64);
    expect(open.data?.components?.[0].components[0]).toMatchObject({ max_values: 24 });
    const pick = await handleWatchInteraction(interaction(`cws:pick:claim:${sheet.id}`, "111", [String(start)]), db.env);
    const confirm = pick.data!.components![0].components[0] as { custom_id: string };
    const stolen = await handleWatchInteraction(interaction(confirm.custom_id, "222"), db.env);
    expect(stolen.data?.content).toContain("expired");
    await assign(watch.id, [start], 2);
    const stale = await handleWatchInteraction(interaction(confirm.custom_id), db.env);
    expect(stale.data?.content).toContain("another player");
    expect((await readWatch(db.env)).slots[0].assigned_to).toBe(2);
  });

  it("does not grant Discord administrators time or break overrides", async () => {
    const watch = await create();
    advance(start - 60);
    const sheet = (await readWatch(db.env)).sheets[0];
    const pick = await handleWatchInteraction(interaction(`cws:pick:claim:${sheet.id}`, "111", [String(start)]), db.env);
    const confirm = pick.data!.components![0].components[0] as { custom_id: string };
    advance(start);
    const response = await handleWatchInteraction(interaction(confirm.custom_id), db.env);
    expect(response.data?.content).toContain("already started");
    const wrongGuild = await handleWatchInteraction({ ...interaction(`cws:open:claim:${sheet.id}`), guild_id: "elsewhere" }, db.env);
    expect(wrongGuild.data?.content).toContain("faction Discord server");
    expect((await readWatch(db.env, watch.id)).slots[0].assigned_to).toBeNull();
  });

  it("creates a roster once, edits it after changes, and retries failures without losing assignments", async () => {
    const watch = await create();
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
    expect(payload.embeds[0].description).toContain("UTC");
    expect(payload.embeds[0].description.length).toBeLessThan(4096);
    for (const button of payload.components[0].components) if ("custom_id" in button) expect(button.custom_id!.length).toBeLessThanOrEqual(100);
  });
});
