import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { watchAlertDatabase } from "../scripts/watch-alert-test-database.mjs";
import { WATCH_HOUR, watchUtc } from "../shared/chainWatchSchedule";
import { changeWatchSlots, createWatch, setWatchFinish } from "./chainWatchSchedule";
import { runWatchScheduleCron, runWatchUnfilledSlotAlerts } from "./chainWatchScheduleDiscord";
import { DISCORD_ALERT_KEYS } from "./discordAlerts";

const start = Date.UTC(2030, 0, 1, 13) / 1000;
const due = start - WATCH_HOUR;
const alertKey = DISCORD_ALERT_KEYS.chainWatchUnfilledSlot;
let db: ReturnType<typeof watchAlertDatabase>;
let watchId: string;
const post = vi.fn();

function advance(now: number) { db.setNow(now); vi.setSystemTime(now * 1000); }
async function tick(now: number) { advance(now); await runWatchUnfilledSlotAlerts(db.env, now); }
async function assign(targetId: number | null) {
  await changeWatchSlots(db.env, { watchId, starts: [start], actorId: 1, targetId, admin: true });
}
function state() {
  return db.sqlite.prepare("SELECT unfilled_alert_sent_at, unfilled_alert_token, unfilled_alert_until FROM chain_watch_slots WHERE watch_id = ? AND start_at = ?").get(watchId, start);
}
function setRoute(key: string = alertKey, guild = "guild", channel = "alert-channel", thread: string | null = null) {
  db.sqlite.prepare(`INSERT INTO discord_notification_channels (guild_id, alert_key, channel_id, thread_id)
    VALUES (?, ?, ?, ?)`).run(guild, key, channel, thread);
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  db = watchAlertDatabase(due - WATCH_HOUR);
  advance(due - WATCH_HOUR);
  db.env.DISCORD_BOT_TOKEN = "fixture-token";
  db.env.DASHBOARD_BASE_URL = "https://dashboard.test";
  post.mockReset().mockImplementation(async () => Response.json({ id: "alert-message" }));
  vi.stubGlobal("fetch", post);
  watchId = (await createWatch(db.env, {
    name: "Test @everyone watch", start: watchUtc(start), finish: watchUtc(start + WATCH_HOUR),
    guildId: "guild", channelId: "roster-channel", discordUserId: "111",
  })).id;
  db.sqlite.prepare("UPDATE chain_watch_sheets SET discord_message_id = 'sheet-message' WHERE watch_id = ?").run(watchId);
  setRoute();
});
afterEach(() => { db.sqlite.close(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("unfilled chain watch slot alerts", () => {
  it("warns at one hour, before monitoring starts, with the slot and sign-up link", async () => {
    await tick(due - 1);
    expect(post).not.toHaveBeenCalled();
    await tick(due);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toBe("https://discord.com/api/v10/channels/alert-channel/messages");
    const payload = JSON.parse(post.mock.calls[0][1].body);
    expect(payload.embeds).toHaveLength(1);
    expect(payload.embeds[0]).toMatchObject({ title: "⚠️ Chain watch unfilled slot", color: 0xff0000 });
    const description = payload.embeds[0].description;
    expect(description).toContain("has no watcher assigned");
    expect(description).toContain("Slot: 13:00 - 14:00 UTC");
    expect(description).toContain(`<t:${start}:R>`);
    expect(description).toContain("[Open chain watch sheet](https://discord.com/channels/guild/roster-channel/sheet-message)");
    expect(description).not.toContain("https://dashboard.test");
    expect(description).not.toContain("@everyone");
    expect(payload.allowed_mentions).toEqual({ parse: [], users: [], roles: [] });
    expect(payload).toMatchObject({ nonce: expect.any(String), enforce_nonce: true });
    expect(state()).toMatchObject({ unfilled_alert_sent_at: due, unfilled_alert_token: null, unfilled_alert_until: 0 });
    await tick(due + 60);
    await assign(1);
    await assign(null);
    await tick(due + 120);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("links to the roster channel when the sheet has not been published", async () => {
    db.sqlite.exec("UPDATE chain_watch_sheets SET discord_message_id = NULL");
    await tick(due);
    expect(JSON.parse(post.mock.calls[0][1].body).embeds[0].description)
      .toContain("[Open chain watch channel](https://discord.com/channels/guild/roster-channel)");
  });

  it("links a midnight slot to its own daily sheet", async () => {
    const midnight = Date.UTC(2030, 0, 2) / 1000;
    await setWatchFinish(db.env, watchId, watchUtc(midnight + WATCH_HOUR));
    db.sqlite.prepare("UPDATE chain_watch_sheets SET discord_message_id = 'next-day-sheet' WHERE watch_id = ? AND start_at = ?").run(watchId, midnight);
    await tick(midnight - WATCH_HOUR);
    const description = JSON.parse(post.mock.calls[0][1].body).embeds[0].description;
    expect(description).toContain("https://discord.com/channels/guild/roster-channel/next-day-sheet");
    expect(description).not.toContain("/sheet-message");
  });

  it("publishes the sheet before sending its first warning", async () => {
    db.sqlite.exec("UPDATE chain_watch_sheets SET discord_message_id = NULL");
    post.mockImplementation(async (url: string) => Response.json({
      id: url.includes("roster-channel") ? "new-sheet-message" : "alert-message",
    }));
    advance(due);
    await runWatchScheduleCron(db.env, due);
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[0][0]).toContain("/roster-channel/messages");
    const payload = JSON.parse(post.mock.calls[1][1].body);
    expect(payload.embeds[0].description).toContain("https://discord.com/channels/guild/roster-channel/new-sheet-message");
  });

  it("warns if an assigned slot becomes empty within the final hour", async () => {
    await assign(1);
    await tick(due);
    expect(post).not.toHaveBeenCalled();
    await assign(null);
    await tick(due + 30 * 60);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it.each([start, start + 60])("does not warn about a slot that has started at %s", async (now) => {
    await tick(now);
    expect(post).not.toHaveBeenCalled();
  });

  it.each(["cancelled", "closed", "finish boundary", "different guild"])("skips a %s slot", async (reason) => {
    if (reason === "cancelled") db.sqlite.prepare("UPDATE chain_watch_slots SET cancelled = 1").run();
    if (reason === "closed") db.sqlite.prepare("UPDATE chain_watch_schedules SET is_open = 0").run();
    if (reason === "finish boundary") await setWatchFinish(db.env, watchId, watchUtc(start));
    if (reason === "different guild") db.sqlite.prepare("UPDATE chain_watch_schedules SET guild_id = 'other'").run();
    await tick(due);
    expect(post).not.toHaveBeenCalled();
  });

  it("uses its independent toggle, and catches up when enabled before start", async () => {
    db.sqlite.prepare("INSERT INTO alert_settings (alert_key, enabled, configurable) VALUES (?, 0, 1)").run(alertKey);
    await tick(due);
    expect(post).not.toHaveBeenCalled();
    expect(state()?.unfilled_alert_sent_at).toBeNull();
    db.sqlite.prepare("UPDATE alert_settings SET enabled = 1 WHERE alert_key = ?").run(alertKey);
    db.sqlite.prepare("INSERT INTO alert_settings (alert_key, enabled, configurable) VALUES ('chain_watch', 0, 1)").run();
    await tick(due + 60);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("waits for a configured route and uses only this guild's default thread", async () => {
    db.sqlite.exec("DELETE FROM discord_notification_channels");
    setRoute(alertKey, "other", "wrong-channel");
    await tick(due);
    expect(post).not.toHaveBeenCalled();
    expect(state()?.unfilled_alert_sent_at).toBeNull();
    setRoute("default", "guild", "default-channel", "default-thread");
    await tick(due + 60);
    expect(post.mock.calls[0][0]).toBe("https://discord.com/api/v10/channels/default-thread/messages");
  });

  it("uses configured mentions and optional member subscriptions for this alert only", async () => {
    db.sqlite.prepare("UPDATE discord_member_links SET discord_user_id = '123456' WHERE torn_user_id = 1").run();
    db.sqlite.prepare("INSERT INTO discord_member_alert_subscriptions (torn_user_id, alert_key, enabled) VALUES (1, ?, 1)").run(alertKey);
    db.sqlite.prepare("INSERT INTO discord_admin_alert_subscriptions (alert_key, subscription_type, discord_id) VALUES (?, 'role', '654321')").run(alertKey);
    db.sqlite.prepare("INSERT INTO discord_admin_alert_subscriptions (alert_key, subscription_type, discord_id) VALUES ('chain_watch_warning', 'role', '999999')").run();
    await tick(due);
    const payload = JSON.parse(post.mock.calls[0][1].body);
    expect(payload.content).toContain("<@123456> <@&654321>");
    expect(payload.allowed_mentions).toEqual({ parse: [], users: ["123456"], roles: ["654321"] });
  });

  it("claims a slot atomically when cron runs overlap", async () => {
    advance(due);
    await Promise.all([runWatchUnfilledSlotAlerts(db.env, due), runWatchUnfilledSlotAlerts(db.env, due)]);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it.each(["network", "rate limit", "missing ID"])("retries a %s failure with the same nonce", async (failure) => {
    if (failure === "network") post.mockRejectedValueOnce(new Error("Connection lost"));
    if (failure === "rate limit") post.mockResolvedValueOnce(Response.json({ message: "Slow down" }, { status: 429 }));
    if (failure === "missing ID") post.mockResolvedValueOnce(Response.json({}));
    await expect(tick(due)).rejects.toThrow();
    expect(state()).toMatchObject({ unfilled_alert_sent_at: null, unfilled_alert_until: 0 });
    await tick(due + 60);
    expect(post).toHaveBeenCalledTimes(2);
    expect(JSON.parse(post.mock.calls[0][1].body).nonce).toBe(JSON.parse(post.mock.calls[1][1].body).nonce);
    expect(state()?.unfilled_alert_sent_at).toBe(due + 60);
  });

  it("recovers an expired lease after an interrupted worker", async () => {
    db.sqlite.prepare("UPDATE chain_watch_slots SET unfilled_alert_token = 'old', unfilled_alert_until = ?").run(due + 120);
    await tick(due);
    expect(post).not.toHaveBeenCalled();
    await tick(due + 120);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it.each(["assigned", "cancelled", "started"])("rechecks a slot that becomes %s while reading alert settings", async (reason) => {
    const original = db.env.DB.prepare.bind(db.env.DB);
    vi.spyOn(db.env.DB, "prepare").mockImplementation((sql: string) => {
      if (sql.includes("UPDATE chain_watch_slots SET unfilled_alert_token = ?")) {
        if (reason === "assigned") db.sqlite.exec("UPDATE chain_watch_slots SET assigned_to = 1, admin_override = 1");
        if (reason === "cancelled") db.sqlite.exec("UPDATE chain_watch_slots SET cancelled = 1");
        // Advance before the send-time check by intercepting the preceding mentions read below.
      }
      if (reason === "started" && sql.includes("FROM discord_member_alert_subscriptions")) advance(start);
      return original(sql);
    });
    await tick(due);
    expect(post).not.toHaveBeenCalled();
  });

  it("runs the alert from cron even if roster delivery fails", async () => {
    post.mockImplementation(async (url: string) => url.includes("roster-channel")
      ? Response.json({ message: "Unavailable" }, { status: 503 })
      : Response.json({ id: "alert-message" }));
    advance(due);
    await expect(runWatchScheduleCron(db.env, due)).rejects.toThrow("503");
    expect(state()?.unfilled_alert_sent_at).toBe(due);
  });

  it("uses actual time to skip a stale scheduled tick after the slot starts", async () => {
    advance(start);
    await runWatchScheduleCron(db.env, due);
    expect(post.mock.calls.every((call) => !String(call[0]).includes("alert-channel"))).toBe(true);
  });
});
