import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { watchCheckInMessagesMigration } from "../scripts/watch-test-database.mjs";
import { watchAlertDatabase } from "../scripts/watch-alert-test-database.mjs";
import { WATCH_HOUR, watchUtc, watchSlotStatus } from "../shared/chainWatchSchedule";
import { changeWatchSlots, createWatch, readWatch, setWatchFinish } from "./chainWatchSchedule";
import { completeDeferredWatchInteraction, deferredWatchResponse, handleWatchInteraction, runWatchScheduleCron, syncWatchBoards, watchBoardPayload } from "./chainWatchScheduleDiscord";
import { handleWatchCheckInAlarm, runWatchCheckIns, WATCH_CHECK_IN_PREFIX, WATCH_TAKE_OVER_PREFIX } from "./chainWatchCheckIns";
import { DISCORD_ALERT_KEYS } from "./discordAlerts";
import type { DiscordInteraction } from "./discordInteractions";

const start = Date.UTC(2030, 0, 1, 23) / 1000;
const due = start - 180;
const alertKey = DISCORD_ALERT_KEYS.chainWatchMissedCheckIn;
let db: ReturnType<typeof watchAlertDatabase>;
let watchId: string;
const fetchMock = vi.fn();
const posts = () => fetchMock.mock.calls.filter(call => call[1].method === "POST");
const deletes = () => fetchMock.mock.calls.filter(call => call[1].method === "DELETE");
const payload = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string);
const cardEdit = (row = state()!) => payload(fetchMock.mock.calls.findLast(call =>
  call[1].method === "PATCH" && String(call[0]).endsWith(`/messages/${row.reminder_message_id}`))!);
function advance(now: number) { db.setNow(now); vi.setSystemTime(now * 1000); }
async function tick(now: number) { advance(now); await runWatchCheckIns(db.env, now); }
function state() { return db.sqlite.prepare("SELECT * FROM chain_watch_check_ins WHERE cancelled_at IS NULL ORDER BY created_at DESC LIMIT 1").get(); }
async function assign(targetId: number | null, starts = [start]) {
  await changeWatchSlots(db.env, { watchId, starts, actorId: 1, targetId, admin: true });
}
function interaction(user = "111111", row = state()!): DiscordInteraction {
  return { type: 3, application_id: "app", token: "token", guild_id: "guild", channel_id: "sheet-channel",
    member: { user: { id: user } }, message: { id: String(row.reminder_message_id) },
    data: { custom_id: `${WATCH_CHECK_IN_PREFIX}${row.id}` } };
}
async function confirm(user?: string) { return handleWatchInteraction(interaction(user), db.env); }
function takeoverClick(user = "222222", row = state()!): DiscordInteraction {
  return { ...interaction(user, row), data: { custom_id: `${WATCH_TAKE_OVER_PREFIX}${row.id}` } };
}
async function prepareTakeover(user = "222222", row = state()!) {
  const click = takeoverClick(user, row);
  const response = await handleWatchInteraction(click, db.env);
  expect(response).toMatchObject({ type: 4, data: { flags: 64 } });
  const button = response.data!.components![0] as { components: Array<{ custom_id: string }> };
  return { ...click, message: { id: "private-confirmation" }, data: { custom_id: button.components[0].custom_id } };
}
function completedTakeovers() { return db.sqlite.prepare("SELECT * FROM chain_watch_takeovers WHERE confirmed_at IS NOT NULL").all(); }
function slots() { return db.sqlite.prepare("SELECT * FROM chain_watch_slots ORDER BY start_at").all(); }

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  db = watchAlertDatabase(due - WATCH_HOUR);
  advance(due - WATCH_HOUR);
  db.env.DISCORD_BOT_TOKEN = "fixture-token";
  db.sqlite.exec("UPDATE discord_member_links SET discord_user_id = discord_user_id || discord_user_id");
  db.sqlite.prepare("INSERT INTO discord_notification_channels (guild_id, alert_key, channel_id, thread_id) VALUES ('guild', ?, 'backup-channel', 'backup-thread')").run(alertKey);
  fetchMock.mockReset().mockImplementation(async () => Response.json({ id: `message-${fetchMock.mock.calls.length}` }));
  vi.stubGlobal("fetch", fetchMock);
  watchId = (await createWatch(db.env, { name: "Test @everyone watch", start: watchUtc(start),
    finish: watchUtc(start + 2 * WATCH_HOUR), guildId: "guild", channelId: "sheet-channel", discordUserId: "111111" })).id;
  await assign(1);
});
afterEach(() => { db.sqlite.close(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("check-in coverage on shared rosters", () => {
  const confirmations = async () => (await readWatch(db.env, watchId)).slots.map(slot => slot.check_in_confirmed_at);

  it("refreshes both daily rosters immediately after an overnight check-in, then follows hour boundaries", async () => {
    await assign(1, [start + WATCH_HOUR]);
    await tick(due);
    await syncWatchBoards(db.env);
    const data = await readWatch(db.env, watchId);
    expect(await confirmations()).toEqual([null, null]);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM chain_watch_sheets WHERE dirty != 0").get()?.n).toBe(0);
    fetchMock.mockClear();
    await completeDeferredWatchInteraction(interaction(), db.env);
    expect(await confirmations()).toEqual([due, due]);
    const boardEdits = fetchMock.mock.calls.filter(call => data.sheets.some(sheet => String(call[0]).endsWith(`/messages/${sheet.discord_message_id}`)));
    expect(boardEdits).toHaveLength(2);
    for (const edit of boardEdits) {
      expect(edit[1].method).toBe("PATCH");
      expect(payload(edit).embeds[0].description).toContain("Alice · Ready ✅");
      expect(payload(edit).embeds[0].description).not.toContain("On watch");
      expect(payload(edit).allowed_mentions).toEqual({ parse: [] });
    }
    for (const currentStart of [start, start + WATCH_HOUR]) {
      advance(currentStart);
      const currentData = await readWatch(db.env, watchId);
      const descriptions = currentData.sheets.map(sheet => watchBoardPayload(db.env, currentData, sheet).embeds[0].description);
      expect(descriptions.join("\n").match(/🟢/g)).toHaveLength(1);
      expect(descriptions[currentStart === start ? 0 : 1]).toContain("Alice · On watch");
    }
  });

  it("shows an unconfirmed assignment in amber, then removes readiness immediately after A to B to A reassignment", async () => {
    await assign(1, [start + WATCH_HOUR]);
    await tick(due);
    advance(start);
    let data = await readWatch(db.env, watchId);
    expect(watchBoardPayload(db.env, data, data.sheets[0]).embeds[0].description)
      .toContain("🟠 **23:00 - 24:00** · Alice · Not checked in");
    await confirm();
    await syncWatchBoards(db.env);
    await assign(2);
    expect(await confirmations()).toEqual([null, null]);
    // Invalidation queues the second day's board even though its own slot did
    // not change, and it is outside the current hour's automatic refresh window.
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM chain_watch_sheets WHERE dirty > 0").get()?.n).toBe(2);
    await assign(1);
    expect(await confirmations()).toEqual([null, null]);
    data = await readWatch(db.env, watchId);
    expect(watchBoardPayload(db.env, data, data.sheets[0]).embeds[0].description).not.toContain("🟢");
  });

  it("keeps the unchanged first hour ready when the following hour is reassigned", async () => {
    await assign(1, [start + WATCH_HOUR]);
    await tick(due);
    await confirm();
    await assign(2, [start + WATCH_HOUR]);
    expect(await confirmations()).toEqual([due, null]);
    await assign(null, [start]);
    expect(await confirmations()).toEqual([null, null]);
  });

  it("does not revive a future confirmation when shifts merge and split before cron", async () => {
    await assign(2);
    await assign(1, [start + WATCH_HOUR]);
    await tick(start + WATCH_HOUR - 180);
    const upcoming = db.sqlite.prepare("SELECT * FROM chain_watch_check_ins WHERE start_at = ? AND cancelled_at IS NULL").get(start + WATCH_HOUR)!;
    expect(await handleWatchInteraction(interaction("111111", upcoming), db.env)).toEqual({ type: 6 });
    expect(await confirmations()).toEqual([null, start + WATCH_HOUR - 180]);
    await assign(1);
    await assign(2);
    expect(await confirmations()).toEqual([null, null]);
  });

  it("shares readiness with a newly appended consecutive hour before cron reconciles the reminder", async () => {
    await tick(due);
    await confirm();
    await assign(1, [start + WATCH_HOUR]);
    expect(await confirmations()).toEqual([due, due]);
  });

  it("retains confirmation after reminder cleanup without extending a closed check-in to a new hour", async () => {
    await tick(due);
    await confirm();
    await tick(start + WATCH_HOUR + 300);
    expect(state()?.reminder_deleted_at).not.toBeNull();
    await assign(1, [start + WATCH_HOUR]);
    expect(await confirmations()).toEqual([due, null]);
    const data = await readWatch(db.env, watchId);
    expect(watchSlotStatus(data.slots[0], data.now).label).toBe("Ended");
    expect(watchSlotStatus(data.slots[1], data.now).label).toBe("Not checked in");
  });

  it("retries a failed roster edit without losing the check-in", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await tick(due);
    await syncWatchBoards(db.env);
    const data = await readWatch(db.env, watchId);
    const boardId = data.sheets[0].discord_message_id;
    fetchMock.mockImplementation(async (url: string) => String(url).endsWith(`/messages/${boardId}`)
      ? Response.json({ message: "Unavailable" }, { status: 503 }) : Response.json({ id: "message" }));
    await completeDeferredWatchInteraction(interaction(), db.env);
    expect(await confirmations()).toEqual([due, null]);
    expect(Number(db.sqlite.prepare("SELECT dirty FROM chain_watch_sheets WHERE id = ?").get(data.sheets[0].id)?.dirty)).toBeGreaterThan(0);
    fetchMock.mockReset().mockResolvedValue(Response.json({ id: "message" }));
    await syncWatchBoards(db.env);
    expect(payload(fetchMock.mock.calls[0]).embeds[0].description).toContain("Alice · Ready ✅");
    expect(db.sqlite.prepare("SELECT dirty FROM chain_watch_sheets WHERE id = ?").get(data.sheets[0].id)?.dirty).toBe(0);
  });
});

describe("chain watch handover check-ins", () => {
  it("posts three minutes before a future watch starts in the sheet channel, pinging only the incoming watcher", async () => {
    await tick(due - 1);
    expect(posts()).toHaveLength(0);
    await tick(due);
    expect(posts()).toHaveLength(1);
    expect(posts()[0][0]).toBe("https://discord.com/api/v10/channels/sheet-channel/messages");
    const body = payload(posts()[0]);
    expect(body.content).toBe("<@111111>");
    expect(body.allowed_mentions).toEqual({ parse: [], users: ["111111"], roles: [] });
    expect(body.embeds[0].description).toContain("01-01-30 23:00 UTC – 02-01-30 00:00 UTC");
    expect(body.embeds[0].description).not.toContain("@everyone");
    expect(body.components[0].components[0]).toMatchObject({ label: "I’m ready", custom_id: `${WATCH_CHECK_IN_PREFIX}${state()?.id}` });
    expect(body).toMatchObject({ nonce: expect.any(String), enforce_nonce: true });
    await tick(due + 60);
    expect(posts()).toHaveLength(1);
  });

  it("accepts the assigned watcher once and prevents escalation", async () => {
    await tick(due);
    advance(due + 30);
    expect(await confirm()).toEqual({ type: 6 });
    expect(state()?.confirmed_at).toBe(due + 30);
    advance(due + 45);
    await confirm();
    expect(state()?.confirmed_at).toBe(due + 30);
    await tick(start - 60);
    expect(posts()).toHaveLength(1);
    const edit = payload(fetchMock.mock.calls.at(-1)!);
    expect(edit.embeds).toEqual([{
      description: `Test @\u200beveryone watch - **Chain watch check-in**\nWatcher: Alice - Ready ✅\nShift: 23:00 - 00:00 UTC\nMessage cleanup: <t:${start + WATCH_HOUR + 300}:R>`,
      color: 0x16a34a,
    }]);
    expect(edit.components).toEqual([]);
    expect(edit.allowed_mentions).toEqual({ parse: [], users: [], roles: [] });
    expect(edit.content).toBe("");
  });

  it.each(["another watcher", "other guild", "other channel", "other message", "former member"])("rejects confirmation from %s", async reason => {
    await tick(due);
    const click = interaction();
    if (reason === "another watcher") click.member!.user!.id = "222222";
    if (reason === "other guild") click.guild_id = "other";
    if (reason === "other channel") click.channel_id = "other";
    if (reason === "other message") click.message!.id = "other";
    if (reason === "former member") db.sqlite.exec("UPDATE home_faction_members SET is_current = 0 WHERE member_id = 1");
    const response = await handleWatchInteraction(click, db.env);
    expect(response).toMatchObject({ type: 4, data: { flags: 64 } });
    expect(state()?.confirmed_at).toBeNull();
  });

  it("routes a short one-minute notification with mentions, evolves the card, then deletes the notification on check-in", async () => {
    db.sqlite.prepare("INSERT INTO discord_admin_alert_subscriptions (alert_key, subscription_type, discord_id) VALUES (?, 'role', '654321')").run(alertKey);
    db.sqlite.prepare("INSERT INTO discord_member_alert_subscriptions (torn_user_id, alert_key, enabled) VALUES (2, ?, 1)").run(alertKey);
    await tick(due);
    await tick(start - 61);
    expect(posts()).toHaveLength(1);
    await tick(start - 60);
    expect(posts()).toHaveLength(2);
    expect(posts()[1][0]).toBe("https://discord.com/api/v10/channels/backup-thread/messages");
    expect(payload(posts()[1]).allowed_mentions).toEqual({ parse: [], users: ["222222"], roles: ["654321"] });
    expect(payload(posts()[1]).content).toContain("<@222222> <@&654321>");
    expect(payload(posts()[1]).embeds).toEqual([]);
    expect(payload(posts()[1]).components).toEqual([]);
    expect(payload(posts()[1]).content).toContain("**Alice** hasn’t checked in");
    expect(payload(posts()[1]).content).toContain("[Open check-in](<https://discord.com/channels/guild/sheet-channel/message-1>)");
    expect(cardEdit().embeds[0]).toMatchObject({ title: "⚠️ Chain watch missed check-in", color: 0xffa500 });
    expect(cardEdit().embeds[0].description).toContain(`Takeover available <t:${start - 30}:R>`);
    expect(cardEdit().components[0].components.map((button: { label: string }) => button.label)).toEqual(["I’m ready"]);
    const original = state()!;
    db.sqlite.exec("UPDATE discord_notification_channels SET thread_id = 'new-route'");
    advance(start + 30);
    expect(await confirm()).toEqual({ type: 6 });
    expect(deletes().map(call => call[0])).toEqual([`https://discord.com/api/v10/channels/backup-thread/messages/${original.escalation_message_id}`]);
    expect(state()?.escalation_deleted_at).toBe(start + 30);
    expect(cardEdit().embeds[0]).toMatchObject({ color: 0x16a34a });
    expect(cardEdit().embeds[0].description).toContain("Ready ✅");
    expect(cardEdit().components).toEqual([]);
    await tick(start + 60);
    expect(posts()).toHaveLength(2);
  });

  it("sends the escalation with no role mentions by default", async () => {
    await tick(due);
    await tick(start - 60);
    expect(payload(posts()[1]).allowed_mentions).toEqual({ parse: [], users: [], roles: [] });
  });

  it.each(["disabled", "no route"])("still sends the reminder when escalation is %s", async reason => {
    if (reason === "disabled") db.sqlite.prepare("INSERT INTO alert_settings (alert_key, enabled, configurable) VALUES (?, 0, 1)").run(alertKey);
    else db.sqlite.exec("DELETE FROM discord_notification_channels");
    await tick(due);
    await tick(start - 60);
    expect(posts()).toHaveLength(1);
    expect(state()?.escalation_sent_at).toBeNull();
    expect(cardEdit().embeds[0]).toMatchObject({ title: "⚠️ Chain watch missed check-in", color: 0xffa500 });
    advance(start - 30);
    await handleWatchCheckInAlarm(db.env, state()!.id as string);
    expect(cardEdit().components[0].components.map((button: { label: string }) => button.label)).toEqual(["I’m ready", "Take over"]);
    expect((await handleWatchInteraction(await prepareTakeover(), db.env)).data?.content).toContain("You’ve taken over");
    expect(posts()).toHaveLength(1);
  });

  it("uses the default admin route when this alert has no override", async () => {
    db.sqlite.exec("UPDATE discord_notification_channels SET alert_key = 'default'");
    await tick(due);
    await tick(start - 60);
    expect(posts()[1][0]).toContain("/backup-thread/messages");
  });

  it("keeps the one-minute warning deadline when reminder delivery is late and reuses its nonce", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockRejectedValueOnce(new Error("Connection lost"));
    await tick(due);
    expect(state()?.reminder_sent_at).toBeNull();
    await tick(due + 60);
    expect(payload(posts()[0]).nonce).toBe(payload(posts()[1]).nonce);
    await tick(start - 60);
    expect(posts()).toHaveLength(3);
    expect(state()?.escalation_sent_at).toBe(start - 60);
    await tick(start);
    expect(posts()).toHaveLength(3);
    expect(state()?.escalation_kind).toBe("missed");
  });

  it("arms and runs all three shift deadlines without another cron tick", async () => {
    const scheduleCheckIn = vi.fn(async () => {});
    vi.spyOn(db.env.CHAIN_WATCH_ALARMS, "getByName")
      .mockReturnValue({ scheduleCheckIn, cancel: vi.fn() } as unknown as DurableObjectStub);
    await tick(start - 3600);
    const id = state()!.id as string;
    expect(posts()).toHaveLength(0);
    expect(scheduleCheckIn).toHaveBeenLastCalledWith(id, due);
    advance(due);
    expect(await handleWatchCheckInAlarm(db.env, id)).toBe(start - 60);
    expect(posts()).toHaveLength(1);
    advance(start - 60);
    expect(await handleWatchCheckInAlarm(db.env, id)).toBe(start - 30);
    expect(posts()).toHaveLength(2);
    expect(payload(posts()[1]).components).toEqual([]);
    advance(start - 30);
    expect(await handleWatchCheckInAlarm(db.env, id)).toBeNull();
    expect(state()?.takeover_button_shown).toBe(1);
  });

  it("does not shift the warning or takeover deadlines after a five-second reminder send", async () => {
    await tick(start - 3600);
    const id = state()!.id as string;
    fetchMock.mockImplementationOnce(async () => { advance(due + 5); return Response.json({ id: "slow-reminder" }); });
    advance(due);
    expect(await handleWatchCheckInAlarm(db.env, id)).toBe(start - 60);
    expect(state()?.reminder_sent_at).toBe(due + 5);
    advance(start - 60);
    expect(await handleWatchCheckInAlarm(db.env, id)).toBe(start - 30);
    expect(state()?.escalation_sent_at).toBe(start - 60);
  });

  it("invalidates a prearmed reminder when its watcher is replaced", async () => {
    await tick(start - 3600);
    const id = state()!.id as string;
    await assign(2);
    advance(due);
    expect(await handleWatchCheckInAlarm(db.env, id)).toBeNull();
    expect(posts()).toHaveLength(0);
    await tick(due);
    expect(payload(posts()[0]).content).toBe("<@222222>");
  });

  it("bounds retries for missing reminders while preserving the delivery-problem deadline", async () => {
    db.sqlite.exec("DELETE FROM discord_member_links WHERE torn_user_id = 1");
    await tick(start - 3600);
    const id = state()!.id as string;
    advance(due);
    expect(await handleWatchCheckInAlarm(db.env, id)).toBe(due + 30);
    advance(start - 60);
    expect(await handleWatchCheckInAlarm(db.env, id)).toBe(start - 30);
    expect(state()?.escalation_kind).toBe("delivery_failed");
    expect(payload(posts()[0]).components).toEqual([]);
  });

  it.each(["missing link", "failed send"])("reports a delivery problem, not a no-show, for a %s", async reason => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    if (reason === "missing link") db.sqlite.exec("DELETE FROM discord_member_links WHERE torn_user_id = 1");
    else fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("sheet-channel")) throw new Error("No permission");
      return Response.json({ id: "backup-message" });
    });
    await tick(due);
    await tick(start - 60);
    expect(state()?.reminder_sent_at).toBeNull();
    expect(state()?.escalation_kind).toBe("delivery_failed");
    const alert = posts().find(call => String(call[0]).includes("backup-thread"))!;
    expect(payload(alert).content).toContain("Chain watch check-in delivery problem");
    expect(payload(alert).content).toContain("[Open watch channel](<https://discord.com/channels/guild/sheet-channel>)");
    expect(payload(alert).embeds).toEqual([]);
    expect(payload(alert).components).toEqual([]);
  });

  it("posts only once when cron ticks overlap", async () => {
    advance(due);
    await Promise.all([runWatchCheckIns(db.env, due), runWatchCheckIns(db.env, due)]);
    expect(posts()).toHaveLength(1);
  });

  it("retries a failed escalation with the same nonce without resending the reminder", async () => {
    await tick(due);
    fetchMock.mockRejectedValueOnce(new Error("Connection lost"));
    await expect(tick(start - 60)).rejects.toThrow("Connection lost");
    expect(state()?.escalation_sent_at).toBeNull();
    expect(cardEdit().embeds[0]).toMatchObject({ title: "⚠️ Chain watch missed check-in", color: 0xffa500 });
    await tick(start);
    expect(posts()).toHaveLength(3);
    expect(payload(posts()[1]).nonce).toBe(payload(posts()[2]).nonce);
    expect(state()?.escalation_sent_at).toBe(start);
  });

  it("rechecks confirmation after reading admin settings, before posting an escalation", async () => {
    await tick(due);
    const prepare = db.env.DB.prepare.bind(db.env.DB);
    vi.spyOn(db.env.DB, "prepare").mockImplementation(sql => {
      if (sql.includes("FROM discord_member_alert_subscriptions")) {
        db.sqlite.prepare("UPDATE chain_watch_check_ins SET confirmed_at = ?, dirty = dirty + 1").run(start - 60);
      }
      return prepare(sql);
    });
    await tick(start - 60);
    expect(posts()).toHaveLength(1);
    expect(payload(fetchMock.mock.calls.at(-1)!).embeds[0].description).toContain("Ready ✅");
  });

  it("deletes a notification if confirmation arrives while its request is in flight", async () => {
    await tick(due);
    fetchMock.mockImplementation(async (_url: string, options: RequestInit) => {
      if (options.method === "POST") {
        expect(await confirm()).toEqual({ type: 6 });
      }
      return Response.json({ id: "backup-message" });
    });
    await tick(start - 60);
    expect(cardEdit().embeds[0].description).toContain("Ready ✅");
    expect(deletes().map(call => call[0])).toEqual(["https://discord.com/api/v10/channels/backup-thread/messages/backup-message"]);
    expect(state()?.escalation_deleted_at).toBe(start - 60);
  });

  it("keeps confirmation even if its public message edit fails, and retries the edit", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await tick(due);
    fetchMock.mockRejectedValueOnce(new Error("Connection lost"));
    expect(await confirm()).toEqual({ type: 6 });
    expect(state()?.dirty).toBeGreaterThan(0);
    await tick(start - 60);
    expect(state()?.dirty).toBe(0);
    expect(posts()).toHaveLength(1);
    expect(payload(fetchMock.mock.calls.at(-1)!).embeds[0].description).toContain("Ready ✅");
  });

  it("invalidates old buttons even after A → B → A between ticks", async () => {
    await tick(due);
    const old = interaction();
    await assign(2);
    await assign(1);
    expect(await handleWatchInteraction(old, db.env)).toMatchObject({ type: 4, data: { flags: 64 } });
    await tick(due + 30);
    expect(posts()).toHaveLength(2);
    expect(interaction().data?.custom_id).not.toBe(old.data?.custom_id);
    expect(await confirm()).toEqual({ type: 6 });
  });

  it("pings a replacement watcher and closes the previous prompt", async () => {
    await tick(due);
    const oldId = state()?.reminder_message_id;
    await assign(2);
    await tick(due + 60);
    expect(payload(posts()[1]).content).toBe("<@222222>");
    const oldEdit = fetchMock.mock.calls.filter(call => String(call[0]).endsWith(`/messages/${oldId}`)).at(-1)!;
    expect(payload(oldEdit).components).toEqual([]);
    expect(payload(oldEdit).embeds[0].description).toContain("assignment changed");
  });

  it("uses one check-in for contiguous hours across daily sheets", async () => {
    await assign(1, [start + WATCH_HOUR]);
    await tick(due);
    expect(state()?.end_at).toBe(start + 2 * WATCH_HOUR);
    await confirm();
    await tick(start + WATCH_HOUR - 180);
    expect(posts()).toHaveLength(1);
    expect(payload(posts()[0]).embeds[0].description).toContain("02-01-30 01:00 UTC");
  });

  it("does not revive a cancelled prompt when blocks merge then split", async () => {
    await assign(2);
    await assign(1, [start + WATCH_HOUR]);
    await tick(start + WATCH_HOUR - 180);
    const nextRow = db.sqlite.prepare("SELECT * FROM chain_watch_check_ins WHERE start_at = ?").get(start + WATCH_HOUR)!;
    const old = interaction("111111", nextRow);
    await assign(1);
    await assign(2);
    expect(await handleWatchInteraction(old, db.env)).toMatchObject({ type: 4, data: { flags: 64 } });
    await tick(start + WATCH_HOUR - 120);
    const active = db.sqlite.prepare("SELECT * FROM chain_watch_check_ins WHERE start_at = ? AND cancelled_at IS NULL").get(start + WATCH_HOUR)!;
    expect(active.id).not.toBe(nextRow.id);
    expect(await handleWatchInteraction(interaction("111111", active), db.env)).toEqual({ type: 6 });
  });

  it("rejects a check-in immediately when a continuing shift is shortened", async () => {
    await assign(1, [start + WATCH_HOUR]);
    await tick(due);
    const old = interaction();
    advance(start + WATCH_HOUR);
    await assign(2, [start + WATCH_HOUR]);
    expect(await handleWatchInteraction(old, db.env)).toMatchObject({ type: 4, data: { flags: 64 } });
    expect(state()?.end_at).toBe(start + WATCH_HOUR);
  });

  it.each(["cancelled", "finished", "ended"])("does not escalate or accept a check-in after the shift is %s", async reason => {
    await tick(due);
    const old = interaction();
    if (reason === "cancelled") await setWatchFinish(db.env, watchId, watchUtc(start));
    if (reason === "finished") db.sqlite.exec("UPDATE chain_watch_schedules SET is_open = 0");
    advance(reason === "ended" ? start + WATCH_HOUR : start - 60);
    expect(await handleWatchInteraction(old, db.env)).toMatchObject({ type: 4, data: { flags: 64 } });
    await runWatchCheckIns(db.env, due);
    expect(posts()).toHaveLength(1);
  });

  it("silently acknowledges a deferred check-in and updates the public reminder", async () => {
    await tick(due);
    const click = interaction();
    fetchMock.mockClear();
    expect(deferredWatchResponse(click)).toEqual({ type: 6 });
    await completeDeferredWatchInteraction(click, db.env);
    expect(state()?.confirmed_at).toBe(due);
    expect(fetchMock.mock.calls.filter(call => String(call[0]).includes("/webhooks/"))).toHaveLength(0);
    const edit = fetchMock.mock.calls.find(call => String(call[0]).endsWith(`/channels/sheet-channel/messages/${click.message!.id}`))!;
    expect(edit[1].method).toBe("PATCH");
    expect(payload(edit).embeds[0].description).toContain("Watcher: Alice - Ready ✅");
    expect(payload(edit).components).toEqual([]);
  });

  it.each(["wrong watcher", "stale button", "database failure"])("sends a private follow-up for a deferred check-in with %s", async reason => {
    await tick(due);
    const click = interaction();
    if (reason === "wrong watcher") click.member!.user!.id = "222222";
    if (reason === "stale button") await assign(2);
    if (reason === "database failure") {
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(db.env.DB, "prepare").mockImplementationOnce(() => { throw new Error("Database unavailable"); });
    }
    fetchMock.mockClear();
    expect(deferredWatchResponse(click)).toEqual({ type: 6 });
    await completeDeferredWatchInteraction(click, db.env);
    expect(db.sqlite.prepare("SELECT confirmed_at FROM chain_watch_check_ins WHERE id = ?")
      .get(click.data!.custom_id!.slice(WATCH_CHECK_IN_PREFIX.length))?.confirmed_at).toBeNull();
    const replies = fetchMock.mock.calls.filter(call => String(call[0]).includes("/webhooks/"));
    expect(replies).toHaveLength(1);
    expect(replies[0][0]).toBe("https://discord.com/api/v10/webhooks/app/token");
    expect(replies[0][1].method).toBe("POST");
    expect(payload(replies[0])).toMatchObject({
      content: reason === "database failure" ? "Chain watch is temporarily unavailable. Try again shortly." :
        "Only the currently assigned watcher can check in using their current reminder. This assignment may have changed or ended.",
      flags: 64,
      allowed_mentions: { parse: [] },
    });
    expect(fetchMock.mock.calls.some(call => String(call[0]).endsWith(`/channels/sheet-channel/messages/${click.message!.id}`))).toBe(false);
  });

  it("runs reminders from the existing schedule cron even if board publication fails", async () => {
    db.sqlite.exec("UPDATE chain_watch_announcements SET sent_at = unixepoch() WHERE kind = 'intro'");
    fetchMock.mockImplementation(async (_url: string, options: RequestInit) => {
      const body = JSON.parse(options.body as string);
      if (body.embeds?.[0]?.title !== "Chain watch check-in") return Response.json({ message: "Unavailable" }, { status: 503 });
      return Response.json({ id: "reminder" });
    });
    advance(due);
    await expect(runWatchScheduleCron(db.env, due)).rejects.toThrow();
    expect(state()?.reminder_sent_at).toBe(due);
  });

  it("deletes a Ready reminder five minutes after shift end and retains its history", async () => {
    await tick(due);
    expect(payload(posts()[0]).embeds[0].description).not.toContain("Message cleanup:");
    await confirm();
    const original = state()!;
    const cleanupAt = start + WATCH_HOUR + 300;
    await tick(cleanupAt - 1);
    expect(fetchMock.mock.calls.some(call => call[1].method === "DELETE")).toBe(false);
    fetchMock.mockClear();
    await tick(cleanupAt);
    const deletes = fetchMock.mock.calls.filter(call => call[1].method === "DELETE");
    expect(deletes).toHaveLength(1);
    expect(deletes[0][0]).toBe(`https://discord.com/api/v10/channels/sheet-channel/messages/${original.reminder_message_id}`);
    expect(state()).toMatchObject({ reminder_deleted_at: cleanupAt, confirmed_at: due, reminder_message_id: original.reminder_message_id });
    expect(fetchMock.mock.calls.some(call => call[1].method === "PATCH")).toBe(false);
    await tick(cleanupAt + 60);
    expect(fetchMock.mock.calls.filter(call => call[1].method === "DELETE")).toHaveLength(1);
  });

  it("updates the Ready countdown when a contiguous shift is extended", async () => {
    await tick(due);
    await confirm();
    await assign(1, [start + WATCH_HOUR]);
    await tick(due + 30);
    expect(payload(fetchMock.mock.calls.at(-1)!).embeds[0].description).toContain(`Message cleanup: <t:${start + 2 * WATCH_HOUR + 300}:R>`);
    await tick(start + WATCH_HOUR + 300);
    expect(fetchMock.mock.calls.some(call => call[1].method === "DELETE")).toBe(false);
  });

  it("moves the Ready countdown earlier when its second hour is reassigned", async () => {
    await assign(1, [start + WATCH_HOUR]);
    await tick(due);
    await confirm();
    await assign(2, [start + WATCH_HOUR]);
    await tick(due + 30);
    expect(payload(fetchMock.mock.calls.at(-1)!).embeds[0].description).toContain(`Message cleanup: <t:${start + WATCH_HOUR + 300}:R>`);
  });

  it("deletes the notification on reassignment and keeps the old card for its cancellation countdown", async () => {
    await tick(due);
    await tick(start - 60);
    const original = state()!;
    advance(start - 30);
    await assign(2);
    await tick(start - 30);
    const cleanupAt = start - 30 + 300;
    expect(cardEdit(original).embeds[0].description).toContain(`Message cleanup: <t:${cleanupAt}:R>`);
    expect(cardEdit(original).components).toEqual([]);
    expect(deletes().map(call => call[0])).toEqual([
      `https://discord.com/api/v10/channels/backup-thread/messages/${original.escalation_message_id}`,
    ]);
    await tick(cleanupAt - 1);
    expect(deletes().some(call => String(call[0]).endsWith(`/messages/${original.reminder_message_id}`))).toBe(false);
    await tick(cleanupAt);
    expect(fetchMock.mock.calls.filter(call => call[1].method === "DELETE").map(call => call[0])).toEqual([
      `https://discord.com/api/v10/channels/backup-thread/messages/${original.escalation_message_id}`,
      `https://discord.com/api/v10/channels/sheet-channel/messages/${original.reminder_message_id}`,
    ]);
    expect(db.sqlite.prepare("SELECT reminder_deleted_at, escalation_deleted_at FROM chain_watch_check_ins WHERE id = ?").get(String(original.id)))
      .toEqual({ reminder_deleted_at: cleanupAt, escalation_deleted_at: start - 30 });
    expect(state()?.assigned_to).toBe(2);
    expect(state()?.reminder_deleted_at).toBeNull();
  });

  it("uses the cancellation time for an already-confirmed reassignment", async () => {
    await tick(due);
    await confirm();
    const original = state()!;
    advance(due + 30);
    await assign(2);
    await tick(due + 30);
    const edit = fetchMock.mock.calls.filter(call => call[1].method === "PATCH" && String(call[0]).endsWith(`/messages/${original.reminder_message_id}`)).at(-1)!;
    expect(payload(edit).embeds[0].description).toContain(`Message cleanup: <t:${due + 330}:R>`);
    await tick(due + 330);
    expect(db.sqlite.prepare("SELECT reminder_deleted_at FROM chain_watch_check_ins WHERE id = ?").get(String(original.id))?.reminder_deleted_at).toBe(due + 330);
  });

  it("deletes a notification only once and keeps the Ready card until its normal cleanup", async () => {
    await tick(due);
    await tick(start - 60);
    await confirm();
    const original = state()!;
    expect(state()?.escalation_deleted_at).toBe(start - 60);
    expect(state()?.reminder_deleted_at).toBeNull();
    const cleanupAt = start + WATCH_HOUR + 300;
    await tick(cleanupAt);
    expect(fetchMock.mock.calls.filter(call => call[1].method === "DELETE").map(call => call[0])).toEqual([
      `https://discord.com/api/v10/channels/backup-thread/messages/${original.escalation_message_id}`,
      `https://discord.com/api/v10/channels/sheet-channel/messages/${original.reminder_message_id}`,
    ]);
    expect(state()?.escalation_deleted_at).toBe(start - 60);
    const deletion = fetchMock.mock.calls.findIndex(call => call[1].method === "DELETE");
    expect(fetchMock.mock.calls.slice(deletion + 1).some(call =>
      call[1].method === "PATCH" && String(call[0]).endsWith(`/messages/${original.escalation_message_id}`))).toBe(false);
  });

  it("deletes the notification at shift end even when the watcher never confirmed", async () => {
    await tick(due);
    await tick(start - 60);
    const original = state()!;
    await tick(start + WATCH_HOUR - 1);
    expect(deletes()).toHaveLength(0);
    await tick(start + WATCH_HOUR);
    expect(deletes().map(call => call[0])).toEqual([`https://discord.com/api/v10/channels/backup-thread/messages/${original.escalation_message_id}`]);
    expect(cardEdit().embeds[0]).toMatchObject({ color: 0x64748b });
    expect(cardEdit().embeds[0].description).toContain("This shift has ended.");
    expect(cardEdit().components).toEqual([]);
    expect(state()).toMatchObject({ reminder_deleted_at: null, escalation_deleted_at: start + WATCH_HOUR });
  });

  it.each([204, 404, 503])("handles reminder cleanup HTTP %s, retrying only failures", async status => {
    await tick(due);
    await confirm();
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => init.method === "DELETE"
      ? new Response(status === 204 ? null : "{}", { status }) : Response.json({ id: "message" }));
    const cleanupAt = start + WATCH_HOUR + 300;
    if (status === 503) {
      await expect(tick(cleanupAt)).rejects.toThrow("503");
      expect(state()?.reminder_deleted_at).toBeNull();
      fetchMock.mockImplementation(async (_url: string, init: RequestInit) => init.method === "DELETE" ? new Response(null, { status: 204 }) : Response.json({ id: "message" }));
      await tick(cleanupAt + 60);
      expect(state()?.reminder_deleted_at).toBe(cleanupAt + 60);
    } else {
      await tick(cleanupAt);
      expect(state()?.reminder_deleted_at).toBe(cleanupAt);
    }
    const deletes = fetchMock.mock.calls.filter(call => call[1].method === "DELETE").length;
    await tick(cleanupAt + 120);
    expect(fetchMock.mock.calls.filter(call => call[1].method === "DELETE")).toHaveLength(deletes);
  });

  it("resumes partial cancellation cleanup without deleting its alert twice", async () => {
    await tick(due);
    await tick(start - 60);
    const original = state()!;
    await assign(null);
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      if (init.method === "DELETE" && url.includes("sheet-channel")) return Response.json({}, { status: 503 });
      return Response.json({ id: "message" });
    });
    const cleanupAt = start - 60 + 300;
    await expect(tick(cleanupAt)).rejects.toThrow("503");
    const row = () => db.sqlite.prepare("SELECT reminder_deleted_at, escalation_deleted_at FROM chain_watch_check_ins WHERE id = ?").get(String(original.id));
    expect(row()).toEqual({ reminder_deleted_at: null, escalation_deleted_at: cleanupAt });
    fetchMock.mockClear().mockImplementation(async () => Response.json({ id: "message" }));
    await tick(cleanupAt + 60);
    expect(fetchMock.mock.calls.filter(call => call[1].method === "DELETE").map(call => call[0])).toEqual([
      `https://discord.com/api/v10/channels/sheet-channel/messages/${original.reminder_message_id}`,
    ]);
    expect(row()?.reminder_deleted_at).toBe(cleanupAt + 60);
  });

  it("does not delete twice when cleanup ticks overlap", async () => {
    await tick(due);
    await confirm();
    advance(start + WATCH_HOUR + 300);
    await Promise.all([runWatchCheckIns(db.env), runWatchCheckIns(db.env)]);
    expect(fetchMock.mock.calls.filter(call => call[1].method === "DELETE")).toHaveLength(1);
  });

  it.each([204, 404, 503])("handles notification cleanup HTTP %s without losing readiness or re-pinging", async status => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await tick(due);
    await tick(start - 60);
    const original = state()!;
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => init.method === "DELETE"
      ? new Response(status === 204 ? null : "{}", { status }) : Response.json({ id: "message" }));
    advance(start - 45);
    expect(await confirm()).toEqual({ type: 6 });
    expect(cardEdit().embeds[0].description).toContain("Ready ✅");
    expect(cardEdit().components).toEqual([]);
    expect(state()?.confirmed_at).toBe(start - 45);
    if (status === 503) {
      expect(state()?.escalation_deleted_at).toBeNull();
      // Exercise the separate cleanup queue after the row leaves active work.
      db.sqlite.exec("UPDATE chain_watch_check_ins SET closed_at = end_at, dirty = 0");
      fetchMock.mockImplementation(async () => Response.json({ id: "message" }));
      await tick(start + WATCH_HOUR);
      expect(state()?.escalation_deleted_at).toBe(start + WATCH_HOUR);
    } else {
      expect(state()?.escalation_deleted_at).toBe(start - 45);
    }
    const attempts = deletes().length;
    await tick(start + WATCH_HOUR + 60);
    expect(deletes()).toHaveLength(attempts);
    expect(posts()).toHaveLength(2);
    const afterDelete = fetchMock.mock.calls.findIndex(call => call[1].method === "DELETE");
    expect(fetchMock.mock.calls.slice(afterDelete + 1).some(call => call[1].method === "PATCH" &&
      String(call[0]).endsWith(`/messages/${original.escalation_message_id}`))).toBe(false);
  });

  it("cleans up a delivery-problem notification when its shift ends without a reminder", async () => {
    db.sqlite.exec("DELETE FROM discord_member_links WHERE torn_user_id = 1");
    await tick(start - 60);
    const original = state()!;
    expect(original.reminder_message_id).toBeNull();
    await tick(start + WATCH_HOUR);
    expect(deletes().map(call => call[0])).toEqual([`https://discord.com/api/v10/channels/backup-thread/messages/${original.escalation_message_id}`]);
    expect(state()?.escalation_deleted_at).toBe(start + WATCH_HOUR);
  });
});

describe("chain watch takeover availability", () => {
  async function warning() { await tick(due); await tick(start - 60); return state()!; }

  it("warns at one minute, schedules a separate alarm, and edits the same message at 30 seconds", async () => {
    const scheduleCheckIn = vi.fn(async () => {});
    const cancel = vi.fn(async () => {});
    const namespace = vi.spyOn(db.env.CHAIN_WATCH_ALARMS, "getByName")
      .mockReturnValue({ scheduleCheckIn, cancel } as unknown as DurableObjectStub);
    const original = await warning();
    expect(namespace).toHaveBeenCalledWith(`chain-watch-check-in:${original.id}`);
    expect(scheduleCheckIn).toHaveBeenLastCalledWith(original.id, start - 30);
    expect(cardEdit().embeds[0].description).toContain(`Takeover available <t:${start - 30}:R>`);
    expect(payload(posts()[1]).components).toEqual([]);
    expect((await handleWatchInteraction(takeoverClick(), db.env)).data?.components).toEqual([]);
    advance(start - 31);
    expect(await handleWatchCheckInAlarm(db.env, original.id as string)).toBe(start - 30);
    expect((await handleWatchInteraction(takeoverClick(), db.env)).data?.components).toEqual([]);
    advance(start - 30);
    expect(await handleWatchCheckInAlarm(db.env, original.id as string)).toBeNull();
    const edit = fetchMock.mock.calls.findLast(call => String(call[0]).endsWith(`/messages/${original.reminder_message_id}`))!;
    expect(edit[1].method).toBe("PATCH");
    expect(payload(edit).embeds[0].description).toContain("Cover is now available.");
    expect(payload(edit).components[0].components).toEqual([
      { type: 2, style: 3, label: "I’m ready", custom_id: `${WATCH_CHECK_IN_PREFIX}${original.id}` },
      { type: 2, style: 1, label: "Take over", custom_id: `${WATCH_TAKE_OVER_PREFIX}${original.id}` },
    ]);
    expect(payload(edit).allowed_mentions).toEqual({ parse: [], users: [], roles: [] });
    expect(posts()).toHaveLength(2);
    expect(state()?.takeover_button_shown).toBe(1);
    expect((await handleWatchInteraction(takeoverClick(), db.env)).data?.content).toContain("Take over from");
    const requests = fetchMock.mock.calls.length;
    await handleWatchCheckInAlarm(db.env, original.id as string);
    expect(fetchMock.mock.calls).toHaveLength(requests);
  });

  it("rejects even a pending confirmation before the takeover deadline", async () => {
    const original = await warning();
    db.sqlite.prepare(`INSERT INTO chain_watch_takeovers
      (id, check_in_id, member_id, member_name, discord_user_id, guild_id, channel_id, start_at, end_at, expires_at)
      VALUES ('early', ?, 2, 'Bob', '222222', 'guild', 'sheet-channel', ?, ?, ?)`)
      .run(original.id as string, start, start + WATCH_HOUR, start + 60);
    const response = await handleWatchInteraction({ ...takeoverClick(), data: { custom_id: "cws:takeover-confirm:early" } }, db.env);
    expect(response.data?.content).toContain("no longer available");
    expect(slots()[0].assigned_to).toBe(1);
    expect(completedTakeovers()).toHaveLength(0);
  });

  it("resolves during the wait and never exposes a takeover after the original watcher checks in", async () => {
    const original = await warning();
    advance(start - 45);
    await confirm();
    const resolved = payload(fetchMock.mock.calls.at(-1)!);
    expect(resolved.embeds[0].color).toBe(0x16a34a);
    expect(resolved.embeds[0].description).toContain("Ready ✅");
    expect(resolved.components).toEqual([]);
    const requests = fetchMock.mock.calls.length;
    advance(start - 30);
    expect(await handleWatchCheckInAlarm(db.env, original.id as string)).toBeNull();
    expect(fetchMock.mock.calls).toHaveLength(requests);
    expect((await handleWatchInteraction(takeoverClick("222222", original), db.env)).data?.components).toEqual([]);
  });

  it.each(["reassigned", "finished", "ended"])("does not expose a takeover when the shift is %s before the alarm", async reason => {
    const original = await warning();
    if (reason === "reassigned") await assign(2);
    if (reason === "finished") db.sqlite.exec("UPDATE chain_watch_schedules SET is_open = 0");
    advance(reason === "ended" ? start + WATCH_HOUR : start - 30);
    expect(await handleWatchCheckInAlarm(db.env, original.id as string)).toBeNull();
    const alertEdits = fetchMock.mock.calls.filter(call => call[1].method === "PATCH" && String(call[0]).endsWith(`/messages/${original.escalation_message_id}`));
    expect(alertEdits.every(call => payload(call).components.length === 0)).toBe(true);
  });

  it("retries a busy check-in instead of losing the 30-second update", async () => {
    const original = await warning();
    advance(start - 30);
    db.sqlite.prepare("UPDATE chain_watch_check_ins SET lease_until = ? WHERE id = ?").run(start - 29, original.id as string);
    expect(await handleWatchCheckInAlarm(db.env, original.id as string)).toBe(start - 29);
    expect(state()?.takeover_button_shown).toBe(0);
    advance(start - 29);
    expect(await handleWatchCheckInAlarm(db.env, original.id as string)).toBeNull();
    expect(state()?.takeover_button_shown).toBe(1);
  });

  it("retries failed button edits without another warning or ping", async () => {
    const original = await warning();
    advance(start - 30);
    fetchMock.mockRejectedValueOnce(new Error("Connection lost"));
    await expect(handleWatchCheckInAlarm(db.env, original.id as string)).rejects.toThrow("Connection lost");
    expect(state()?.takeover_button_shown).toBe(0);
    expect(state()?.dirty).toBeGreaterThan(0);
    await handleWatchCheckInAlarm(db.env, original.id as string);
    expect(state()?.takeover_button_shown).toBe(1);
    expect(posts()).toHaveLength(2);
  });

  it("does not mark the button shown if a waiting-message edit crosses the deadline", async () => {
    await tick(due);
    fetchMock.mockImplementation(async (_url: string, options: RequestInit) => {
      if (options.method === "PATCH") advance(start - 29);
      return Response.json({ id: "warning" });
    });
    await tick(start - 60);
    const original = state()!;
    expect(original.takeover_button_shown).toBe(0);
    await handleWatchCheckInAlarm(db.env, original.id as string);
    expect(state()?.takeover_button_shown).toBe(1);
    expect(cardEdit().components[0].components.map((button: { label: string }) => button.label)).toEqual(["I’m ready", "Take over"]);
  });

  it("includes takeover immediately when the warning itself is delivered after the deadline", async () => {
    await tick(due);
    await tick(start - 20);
    expect(cardEdit().components[0].components.map((button: { label: string }) => button.label)).toEqual(["I’m ready", "Take over"]);
    expect(cardEdit().embeds[0].description).toContain("Cover is now available.");
    expect(payload(posts()[1]).components).toEqual([]);
    expect(state()?.takeover_button_shown).toBe(1);
  });

  it("recovers the button on cron if the alarm was missed", async () => {
    await warning();
    await tick(start);
    expect(state()?.takeover_button_shown).toBe(1);
    expect(cardEdit().components[0].components.map((button: { label: string }) => button.label)).toEqual(["I’m ready", "Take over"]);
    expect(posts()).toHaveLength(2);
  });

  it("allows the original watcher to check in after takeover opens, using the same card", async () => {
    const original = await warning();
    await tick(start - 30);
    expect(cardEdit().components[0].components).toHaveLength(2);
    expect(await confirm()).toEqual({ type: 6 });
    expect(cardEdit().embeds[0].color).toBe(0x16a34a);
    expect(cardEdit().components).toEqual([]);
    expect(state()?.reminder_message_id).toBe(original.reminder_message_id);
    expect(state()?.escalation_deleted_at).toBe(start - 30);
    expect((await handleWatchInteraction(takeoverClick(), db.env)).data?.components).toEqual([]);
  });

  it("rejects takeover clicks on the short notification instead of the check-in card", async () => {
    const original = await warning();
    advance(start - 30);
    const click = { ...takeoverClick(), channel_id: String(original.escalation_channel_id),
      message: { id: String(original.escalation_message_id) } };
    expect((await handleWatchInteraction(click, db.env)).data?.content).toContain("no longer available");
    expect(completedTakeovers()).toHaveLength(0);
  });

  it("updates the notification link when a delayed reminder is finally delivered", async () => {
    db.sqlite.exec("DELETE FROM discord_member_links WHERE torn_user_id = 1");
    await tick(start - 60);
    expect(payload(posts()[0]).content).toContain("could not be delivered");
    db.sqlite.exec("INSERT INTO discord_member_links VALUES (1, '111111')");
    await tick(start - 30);
    const row = state()!;
    expect(cardEdit().components[0].components).toHaveLength(2);
    const notification = payload(fetchMock.mock.calls.findLast(call => call[1].method === "PATCH" &&
      String(call[0]).endsWith(`/messages/${row.escalation_message_id}`))!);
    expect(notification.content).toContain(`/guild/sheet-channel/${row.reminder_message_id}`);
    expect(notification.allowed_mentions).toEqual({ parse: [], users: [], roles: [] });
    expect(posts()).toHaveLength(2);
  });

  it("stops button retries for a deleted card and updates the notification's fallback link", async () => {
    const original = await warning();
    fetchMock.mockImplementation(async (url: string) => url.endsWith(`/messages/${original.reminder_message_id}`)
      ? Response.json({}, { status: 404 }) : Response.json({ id: "message" }));
    advance(start - 30);
    expect(await handleWatchCheckInAlarm(db.env, original.id as string)).toBeNull();
    expect(state()?.reminder_deleted_at).toBe(start - 30);
    expect(state()?.takeover_button_shown).toBe(0);
    expect(payload(fetchMock.mock.calls.at(-1)!).content).toContain("[Open watch channel](<https://discord.com/channels/guild/sheet-channel>)");
    expect((await confirm()).type).toBe(4);
    expect((await handleWatchInteraction(takeoverClick(), db.env)).data?.content).toContain("no longer available");
  });

  it("converts existing full alerts and moves their takeover buttons onto the original cards", async () => {
    const original = await warning();
    db.sqlite.exec("UPDATE chain_watch_check_ins SET dirty = 0, takeover_button_shown = 1");
    db.sqlite.exec(watchCheckInMessagesMigration);
    expect(state()?.dirty).toBeGreaterThan(0);
    await tick(start - 30);
    expect(state()?.reminder_message_id).toBe(original.reminder_message_id);
    expect(cardEdit().components[0].components.map((button: { label: string }) => button.label)).toEqual(["I’m ready", "Take over"]);
    const notification = payload(fetchMock.mock.calls.findLast(call => call[1].method === "PATCH" &&
      String(call[0]).endsWith(`/messages/${original.escalation_message_id}`))!);
    expect(notification.embeds).toEqual([]);
    expect(notification.components).toEqual([]);
    expect(notification.content).toContain("[Open check-in]");
    expect(posts()).toHaveLength(2);
  });
});

describe("chain watch takeovers", () => {
  async function missed() { await tick(due); await tick(start - 60); advance(start - 30); return state()!; }

  it("checks in the replacement on the same card, deletes the notification, and does not send another reminder", async () => {
    const original = await missed();
    const confirmation = await prepareTakeover();
    expect(slots()[0].assigned_to).toBe(1);
    expect(completedTakeovers()).toHaveLength(0);
    const response = await handleWatchInteraction(confirmation, db.env);
    expect(response).toMatchObject({ type: 7, data: { components: [] } });
    expect(response.data?.content).toContain("taken over");
    expect(slots()[0].assigned_to).toBe(2);
    expect(completedTakeovers()).toMatchObject([{ member_id: 2, check_in_id: original.id, confirmed_at: start - 30 }]);
    expect(state()).toMatchObject({ assigned_to: 2, confirmed_at: start - 30 });
    const edits = fetchMock.mock.calls.filter(call => call[1].method === "PATCH");
    const reminder = payload(edits.findLast(call => String(call[0]).endsWith(`/messages/${original.reminder_message_id}`))!);
    expect(reminder.embeds[0].description).toContain("Watcher: ~~Alice~~ → Bob - Ready ✅");
    expect(reminder.components).toEqual([]);
    expect(reminder.content).toBe("");
    expect(reminder.embeds[0]).toMatchObject({ color: 0x16a34a });
    expect(reminder.embeds[0].description).toContain("Shift: 23:00 - 00:00 UTC");
    expect(reminder.allowed_mentions).toEqual({ parse: [], users: [], roles: [] });
    expect(deletes().map(call => call[0])).toEqual([`https://discord.com/api/v10/channels/backup-thread/messages/${original.escalation_message_id}`]);
    expect((await handleWatchInteraction(interaction("111111", original), db.env)).type).toBe(4);
    await tick(start + 60);
    expect(posts()).toHaveLength(2);
    expect(state()?.assigned_to).toBe(2);
  });

  it("shows the exact commitment in the private confirmation", async () => {
    await assign(1, [start + WATCH_HOUR]);
    const original = await missed();
    const response = await handleWatchInteraction(takeoverClick("222222", original), db.env);
    expect(response.data?.content).toContain("01-01-30 23:00 UTC – 02-01-30 01:00 UTC");
    expect(response.data?.content).toContain("checks you in immediately");
    expect(response.data?.components?.[0]).toMatchObject({ components: [{ label: "Confirm takeover" }] });
  });

  it("covers the remaining block across midnight and keeps completed hours assigned to the original watcher", async () => {
    await assign(1, [start + WATCH_HOUR]);
    const original = await missed();
    advance(start + WATCH_HOUR + 10);
    const confirmation = await prepareTakeover("222222", original);
    await handleWatchInteraction(confirmation, db.env);
    expect(slots().map(row => row.assigned_to)).toEqual([1, 2]);
    expect(completedTakeovers()[0]).toMatchObject({ start_at: start + WATCH_HOUR, end_at: start + 2 * WATCH_HOUR });
    expect(state()).toMatchObject({ start_at: start + WATCH_HOUR, end_at: start + 2 * WATCH_HOUR, assigned_to: 2, confirmed_at: start + WATCH_HOUR + 10 });
    expect(cardEdit(original).embeds[0].description).toContain("Shift: 00:00 - 01:00 UTC");
    await tick(start + WATCH_HOUR + 60);
    expect(posts()).toHaveLength(2);
  });

  it("lets only one of two competing replacements take the shift", async () => {
    const original = await missed();
    db.sqlite.exec("INSERT INTO home_faction_members VALUES (4, 'Charlie', 1); INSERT INTO discord_member_links VALUES (4, '444444')");
    const bob = await prepareTakeover("222222", original);
    const charlie = await prepareTakeover("444444", original);
    const results = await Promise.all([handleWatchInteraction(bob, db.env), handleWatchInteraction(charlie, db.env)]);
    expect(results.filter(result => result.data?.content?.startsWith("You’ve taken over"))).toHaveLength(1);
    expect(completedTakeovers()).toHaveLength(1);
    expect(slots()[0].assigned_to).toBe(completedTakeovers()[0].member_id);
  });

  it.each(["original", "replacement"])("accepts only one concurrent check-in/takeover with the %s request started first", async first => {
    const original = await missed();
    const confirmation = await prepareTakeover();
    const ready = interaction("111111", original);
    const clicks = first === "original" ? [ready, confirmation] : [confirmation, ready];
    const responses = await Promise.all(clicks.map(click => handleWatchInteraction(click, db.env)));
    expect(responses.filter(response => response.type === 6 || response.data?.content?.startsWith("You’ve taken over"))).toHaveLength(1);
    expect(slots()[0].assigned_to).toBe(completedTakeovers().length ? 2 : 1);
    expect(state()?.confirmed_at).toBe(start - 30);
  });

  it.each(["wrong guild", "wrong channel", "wrong message", "unlinked", "former member", "original watcher"])("does not offer a takeover confirmation for %s", async reason => {
    const original = await missed();
    const click = takeoverClick("222222", original);
    if (reason === "wrong guild") click.guild_id = "other";
    if (reason === "wrong channel") click.channel_id = "other";
    if (reason === "wrong message") click.message!.id = "other";
    if (reason === "unlinked") click.member!.user!.id = "999999";
    if (reason === "former member") click.member!.user!.id = "333333";
    if (reason === "original watcher") click.member!.user!.id = "111111";
    const response = await handleWatchInteraction(click, db.env);
    expect(response).toMatchObject({ type: 4, data: { flags: 64, components: [] } });
    expect(slots()[0].assigned_to).toBe(1);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM chain_watch_takeovers").get()?.n).toBe(0);
  });

  it.each(["wrong user", "wrong guild", "wrong channel", "former member", "changed link", "expired", "hour changed", "reassigned", "cancelled", "ended", "checked in"])("rejects a pending takeover after %s", async reason => {
    await assign(1, [start + WATCH_HOUR]);
    const original = await missed();
    const confirmation = await prepareTakeover();
    if (reason === "wrong user") confirmation.member!.user!.id = "111111";
    if (reason === "wrong guild") confirmation.guild_id = "other";
    if (reason === "wrong channel") confirmation.channel_id = "other";
    if (reason === "former member") db.sqlite.exec("UPDATE home_faction_members SET is_current = 0 WHERE member_id = 2");
    if (reason === "changed link") db.sqlite.exec("UPDATE discord_member_links SET discord_user_id = '999999' WHERE torn_user_id = 2");
    if (reason === "expired") advance(start + 270);
    if (reason === "hour changed") {
      advance(start + WATCH_HOUR - 10);
      const lateConfirmation = await prepareTakeover("222222", original);
      confirmation.data = lateConfirmation.data;
      advance(start + WATCH_HOUR);
    }
    if (reason === "reassigned") { await assign(2); await assign(1); }
    if (reason === "cancelled") await setWatchFinish(db.env, watchId, watchUtc(start));
    if (reason === "ended") advance(start + 2 * WATCH_HOUR);
    if (reason === "checked in") await confirm();
    const response = await handleWatchInteraction(confirmation, db.env);
    expect(response).toMatchObject({ type: 7, data: { components: [] } });
    expect(response.data?.content).not.toContain("You’ve taken over");
    expect(slots().every(row => row.assigned_to === 1)).toBe(true);
    expect(completedTakeovers()).toHaveLength(0);
  });

  it("rolls back the whole takeover when it would break the two-hour limit", async () => {
    await setWatchFinish(db.env, watchId, watchUtc(start + 3 * WATCH_HOUR));
    await assign(1, [start + WATCH_HOUR]);
    await assign(2, [start + 2 * WATCH_HOUR]);
    const original = await missed();
    const response = await handleWatchInteraction(await prepareTakeover(), db.env);
    expect(response.data?.content).toContain("one hour off");
    expect(completedTakeovers()).toHaveLength(0);
    expect(slots().map(row => row.assigned_to)).toEqual([1, 1, 2]);
    expect(db.sqlite.prepare("SELECT * FROM chain_watch_check_ins WHERE id = ?").get(original.id as string))
      .toMatchObject({ cancelled_at: null, confirmed_at: null, end_at: start + 2 * WATCH_HOUR });
  });

  it("checks in a block merged with the replacement's following slot", async () => {
    await assign(2, [start + WATCH_HOUR]);
    await missed();
    await syncWatchBoards(db.env);
    const sentBefore = posts().length;
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM chain_watch_sheets WHERE dirty > 0").get()?.n).toBe(0);
    await handleWatchInteraction(await prepareTakeover(), db.env);
    expect(state()).toMatchObject({ assigned_to: 2, start_at: start, end_at: start + 2 * WATCH_HOUR, confirmed_at: start - 30 });
    expect((await readWatch(db.env, watchId)).slots.map(slot => slot.check_in_confirmed_at)).toEqual([start - 30, start - 30]);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM chain_watch_sheets WHERE dirty > 0").get()?.n).toBe(2);
    await syncWatchBoards(db.env);
    await tick(start + WATCH_HOUR - 60);
    expect(posts()).toHaveLength(sentBefore);
  });

  it("cleans up the replaced messages without losing takeover history or replacement readiness", async () => {
    const original = await missed();
    await handleWatchInteraction(await prepareTakeover(), db.env);
    const cleanupAt = start - 30 + 300;
    expect(cardEdit(original).embeds[0].description).toContain(`Message cleanup: <t:${cleanupAt}:R>`);
    expect(deletes()).toHaveLength(1);
    await tick(cleanupAt);
    const removed = fetchMock.mock.calls.filter(call => call[1].method === "DELETE");
    expect(removed.map(call => call[0])).toEqual([
      `https://discord.com/api/v10/channels/backup-thread/messages/${original.escalation_message_id}`,
      `https://discord.com/api/v10/channels/sheet-channel/messages/${original.reminder_message_id}`,
    ]);
    expect(completedTakeovers()).toHaveLength(1);
    const current = (await readWatch(db.env, watchId)).slots[0];
    expect(current).toMatchObject({ assigned_to: 2, check_in_confirmed_at: start - 30 });
    expect(watchSlotStatus(current, cleanupAt).label).toBe("On watch");
    expect(posts()).toHaveLength(2);
  });

  it("merges into an already checked-in preceding slot without reviving a reminder", async () => {
    await assign(2);
    await assign(1, [start + WATCH_HOUR]);
    await tick(due);
    await confirm("222222");
    await tick(start + WATCH_HOUR - 180);
    await tick(start + WATCH_HOUR - 60);
    advance(start + WATCH_HOUR - 30);
    const original = state()!;
    expect(original.assigned_to).toBe(1);
    await handleWatchInteraction(await prepareTakeover("222222", original), db.env);
    expect(state()).toMatchObject({ assigned_to: 2, start_at: start, end_at: start + 2 * WATCH_HOUR, confirmed_at: due });
    await tick(start + WATCH_HOUR + 60);
    expect(posts()).toHaveLength(3);
  });

  it("does not repeat a takeover when the confirmation is clicked twice", async () => {
    await missed();
    const confirmation = await prepareTakeover();
    await handleWatchInteraction(confirmation, db.env);
    const snapshot = slots();
    advance(start + 20);
    const response = await handleWatchInteraction(confirmation, db.env);
    expect(response.data?.content).toContain("no longer available");
    expect(slots()).toEqual(snapshot);
    expect(completedTakeovers()).toHaveLength(1);
  });

  it("retains the takeover when Discord edits fail and retries the resolved messages", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const original = await missed();
    const confirmation = await prepareTakeover();
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      if (init.method === "PATCH") throw new Error("Connection lost");
      return Response.json({ id: "message" });
    });
    expect((await handleWatchInteraction(confirmation, db.env)).data?.content).toContain("You’ve taken over");
    expect(slots()[0].assigned_to).toBe(2);
    expect(db.sqlite.prepare("SELECT dirty FROM chain_watch_check_ins WHERE id = ?").get(original.id as string)?.dirty).toBeGreaterThan(0);
    fetchMock.mockImplementation(async () => Response.json({ id: "message" }));
    await tick(start + 60);
    expect(cardEdit(original).embeds[0].description).toContain("~~Alice~~ → Bob");
    expect(posts()).toHaveLength(2);
  });

  it("defers takeover confirmation separately from the public check-in card and refreshes the roster", async () => {
    const original = await missed();
    const click = takeoverClick("222222", original);
    expect(deferredWatchResponse(click)).toEqual({ type: 5, data: { flags: 64 } });
    await completeDeferredWatchInteraction(click, db.env);
    const privateReply = fetchMock.mock.calls.findLast(call => String(call[0]).includes("/webhooks/app/token/messages/@original"))!;
    expect(payload(privateReply).content).toContain("Take over from");
    const confirmation = { ...click, message: { id: "private-confirmation" },
      data: { custom_id: payload(privateReply).components[0].components[0].custom_id } };
    expect(deferredWatchResponse(confirmation)).toEqual({ type: 6 });
    await completeDeferredWatchInteraction(confirmation, db.env);
    const completed = fetchMock.mock.calls.findLast(call => String(call[0]).includes("/webhooks/app/token/messages/@original"))!;
    expect(payload(completed).content).toContain("You’ve taken over");
    expect(payload(completed).components).toEqual([]);
    expect(slots()[0].assigned_to).toBe(2);
    expect(db.sqlite.prepare("SELECT dirty FROM chain_watch_sheets WHERE id = ?").get(slots()[0].sheet_id as string)?.dirty).toBe(0);
  });
});
