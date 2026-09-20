import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { watchAlertDatabase } from "../scripts/watch-alert-test-database.mjs";
import { WATCH_HOUR, watchUtc } from "../shared/chainWatchSchedule";
import { changeWatchSlots, createWatch, setWatchFinish } from "./chainWatchSchedule";
import { completeDeferredWatchInteraction, deferredWatchResponse, handleWatchInteraction, runWatchScheduleCron } from "./chainWatchScheduleDiscord";
import { runWatchCheckIns, WATCH_CHECK_IN_PREFIX } from "./chainWatchCheckIns";
import { DISCORD_ALERT_KEYS } from "./discordAlerts";
import type { DiscordInteraction } from "./discordInteractions";

const start = Date.UTC(2030, 0, 1, 23) / 1000;
const due = start - 180;
const alertKey = DISCORD_ALERT_KEYS.chainWatchMissedCheckIn;
let db: ReturnType<typeof watchAlertDatabase>;
let watchId: string;
const fetchMock = vi.fn();
const posts = () => fetchMock.mock.calls.filter(call => call[1].method === "POST");
const payload = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string);
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
    expect((await confirm()).data?.content).toContain("You’re checked in");
    expect(state()?.confirmed_at).toBe(due + 30);
    advance(due + 45);
    await confirm();
    expect(state()?.confirmed_at).toBe(due + 30);
    await tick(start - 60);
    expect(posts()).toHaveLength(1);
    const edit = payload(fetchMock.mock.calls.at(-1)!);
    expect(edit.embeds).toEqual([{
      description: "Test @\u200beveryone watch - **Chain watch check-in**\nWatcher: Alice - Ready ✅\nShift: 23:00 - 00:00 UTC",
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
    expect(response.data?.content).not.toContain("You’re checked in");
    expect(state()?.confirmed_at).toBeNull();
  });

  it("routes the one-minute escalation through its admin route and mentions, then resolves a late check-in", async () => {
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
    expect(payload(posts()[1]).embeds[0].title).toBe("Chain watch missed check-in");
    expect(payload(posts()[1]).embeds[0].description).toContain("/guild/sheet-channel/message-1");
    db.sqlite.exec("UPDATE discord_notification_channels SET thread_id = 'new-route'");
    advance(start + 30);
    expect((await confirm()).data?.content).toContain("You’re checked in");
    expect(fetchMock.mock.calls.at(-1)![0]).toContain("/backup-thread/messages/");
    expect(payload(fetchMock.mock.calls.at(-1)!).embeds[0].description).toContain("Resolved");
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
  });

  it("uses the default admin route when this alert has no override", async () => {
    db.sqlite.exec("UPDATE discord_notification_channels SET alert_key = 'default'");
    await tick(due);
    await tick(start - 60);
    expect(posts()[1][0]).toContain("/backup-thread/messages");
  });

  it("gives two minutes to respond when delivery is late and reuses its nonce on retry", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockRejectedValueOnce(new Error("Connection lost"));
    await tick(due);
    expect(state()?.reminder_sent_at).toBeNull();
    await tick(due + 60);
    expect(payload(posts()[0]).nonce).toBe(payload(posts()[1]).nonce);
    await tick(start - 60);
    expect(posts()).toHaveLength(2);
    await tick(start);
    expect(posts()).toHaveLength(3);
    expect(state()?.escalation_kind).toBe("missed");
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
    expect(payload(alert).embeds[0].title).toBe("Chain watch check-in delivery problem");
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

  it("resolves an alert if confirmation arrives while its request is in flight", async () => {
    await tick(due);
    fetchMock.mockImplementation(async (_url: string, options: RequestInit) => {
      if (options.method === "POST") {
        expect((await confirm()).data?.content).toContain("You’re checked in");
      }
      return Response.json({ id: "backup-message" });
    });
    await tick(start - 60);
    expect(payload(fetchMock.mock.calls.at(-1)!).embeds[0].description).toContain("Resolved");
  });

  it("keeps confirmation even if its public message edit fails, and retries the edit", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await tick(due);
    fetchMock.mockRejectedValueOnce(new Error("Connection lost"));
    expect((await confirm()).data?.content).toContain("You’re checked in");
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
    expect((await handleWatchInteraction(old, db.env)).data?.content).not.toContain("You’re checked in");
    await tick(due + 30);
    expect(posts()).toHaveLength(2);
    expect(interaction().data?.custom_id).not.toBe(old.data?.custom_id);
    expect((await confirm()).data?.content).toContain("You’re checked in");
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
    expect((await handleWatchInteraction(old, db.env)).data?.content).not.toContain("You’re checked in");
    await tick(start + WATCH_HOUR - 120);
    const active = db.sqlite.prepare("SELECT * FROM chain_watch_check_ins WHERE start_at = ? AND cancelled_at IS NULL").get(start + WATCH_HOUR)!;
    expect(active.id).not.toBe(nextRow.id);
    expect((await handleWatchInteraction(interaction("111111", active), db.env)).data?.content).toContain("You’re checked in");
  });

  it("rejects a check-in immediately when a continuing shift is shortened", async () => {
    await assign(1, [start + WATCH_HOUR]);
    await tick(due);
    const old = interaction();
    advance(start + WATCH_HOUR);
    await assign(2, [start + WATCH_HOUR]);
    expect((await handleWatchInteraction(old, db.env)).data?.content).not.toContain("You’re checked in");
    expect(state()?.end_at).toBe(start + WATCH_HOUR);
  });

  it.each(["cancelled", "finished", "ended"])("does not escalate or accept a check-in after the shift is %s", async reason => {
    await tick(due);
    const old = interaction();
    if (reason === "cancelled") await setWatchFinish(db.env, watchId, watchUtc(start));
    if (reason === "finished") db.sqlite.exec("UPDATE chain_watch_schedules SET is_open = 0");
    advance(reason === "ended" ? start + WATCH_HOUR : start - 60);
    expect((await handleWatchInteraction(old, db.env)).data?.content).not.toContain("You’re checked in");
    await runWatchCheckIns(db.env, due);
    expect(posts()).toHaveLength(1);
  });

  it("allows a deferred check-in without the private sign-up session coordinator", async () => {
    await tick(due);
    const click = interaction();
    expect(deferredWatchResponse(click)).toEqual({ type: 5, data: { flags: 64 } });
    await completeDeferredWatchInteraction(click, db.env);
    expect(state()?.confirmed_at).toBe(due);
    const reply = fetchMock.mock.calls.find(call => String(call[0]).includes("/webhooks/app/token/messages/@original"))!;
    expect(payload(reply).content).toContain("You’re checked in");
  });

  it("runs reminders from the existing schedule cron even if board publication fails", async () => {
    fetchMock.mockImplementation(async (_url: string, options: RequestInit) => {
      const body = JSON.parse(options.body as string);
      if (body.embeds?.[0]?.title !== "Chain watch check-in") return Response.json({ message: "Unavailable" }, { status: 503 });
      return Response.json({ id: "reminder" });
    });
    advance(due);
    await expect(runWatchScheduleCron(db.env, due)).rejects.toThrow();
    expect(state()?.reminder_sent_at).toBe(due);
  });
});
