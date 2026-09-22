import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chainWatchDatabase } from "../scripts/chain-watch-test-database.mjs";
import { createWatch, setWatchFinish } from "./chainWatchSchedule";
import { watchUtc } from "../shared/chainWatchSchedule";
import { HOME_FACTION_ID } from "./constants";
import { getChainWatchLive, handleChainWatchAlarm, readChainWatchState, readLatestQualifyingChainHit, refreshActiveChainWatchFromStoredAttacks, runChainWatchCron } from "./chainWatch";
import { readChainWatchDemand } from "./chainWatchDemand";
import { getChainWatchForWar, setChainWatchEnabledForWar } from "./chainWatchWar";
import { fetchTrackedTornJson } from "./external/torn";
import { upsertDiscordAlertMessage } from "./discordAlertDelivery";
import { readDiscordAlertMentions } from "./discordMentions";
import { isDiscordAlertEnabled } from "./discordAlertSettings";

vi.mock("./external/torn", () => ({ fetchTrackedTornJson: vi.fn() }));
vi.mock("./tornKeyPool", () => ({ withTornKeyPool: (_env: unknown, options: { run: (key: unknown) => Promise<unknown> }) => options.run({ key: "test", keySource: "test" }) }));
vi.mock("./discordAlertSettings", () => ({ isDiscordAlertEnabled: vi.fn().mockResolvedValue(true) }));
vi.mock("./discordAlertDelivery", () => ({ upsertDiscordAlertMessage: vi.fn().mockResolvedValue("message") }));
vi.mock("./discordMentions", async (importOriginal) => ({
  ...await importOriginal<typeof import("./discordMentions")>(),
  readDiscordAlertMentions: vi.fn(),
}));

const start = Date.UTC(2030, 0, 1, 13) / 1000;
let db: ReturnType<typeof chainWatchDatabase>;
const alarm = { syncFaction: vi.fn().mockResolvedValue(undefined) };
const getByName = vi.fn(() => alarm);
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.clearAllMocks();
  vi.mocked(upsertDiscordAlertMessage).mockResolvedValue("message");
  vi.mocked(isDiscordAlertEnabled).mockResolvedValue(true);
  vi.mocked(readDiscordAlertMentions).mockResolvedValue({ messageSuffix: "", allowedMentions: undefined });
  db = chainWatchDatabase(start - 60);
  advance(start - 60);
  db.env.CHAIN_WATCH_ALARMS = { getByName } as unknown as DurableObjectNamespace;
  vi.mocked(fetchTrackedTornJson).mockResolvedValue({ chain: { current: 0, timeout: 0 } });
});
afterEach(() => { db.sqlite.close(); vi.useRealTimers(); vi.restoreAllMocks(); });
function advance(now: number) { db.setNow(now); vi.setSystemTime(now * 1000); }
async function watch(finish?: number) {
  return createWatch(db.env, { name: "Independent watch", start: watchUtc(start), finish: finish ? watchUtc(finish) : undefined,
    guildId: "guild", channelId: "channel", discordUserId: "111" }, start - 60);
}
async function war(id = 1, enabled = 1) {
  await db.env.DB.prepare(`INSERT INTO wars (id, name, status, practical_start_time, chain_watch_enabled)
    VALUES (?, ?, 'active', ?, ?)`).bind(id, `War ${id}`, start, enabled).run();
  await db.env.DB.prepare(`INSERT INTO sync_state (name, last_started, active_war_id, war_state)
    VALUES ('attacks', 0, ?, 'current') ON CONFLICT(name) DO UPDATE SET active_war_id = excluded.active_war_id, war_state = 'current'`).bind(id).run();
}
async function hit(id: number, at: number, options: { warId?: number; chain?: number; result?: string; home?: number; target?: number; ended?: number | null } = {}) {
  await db.env.DB.prepare(`INSERT INTO attacks (id, started, ended, attacker_faction_id, defender_faction_id,
    attacker_name, defender_name, result, chain, war_id) VALUES (?, ?, ?, ?, ?, 'Alice', 'Target', ?, ?, ?)`)
    .bind(id, at, options.ended === undefined ? at : options.ended, options.home ?? HOME_FACTION_ID,
      options.target ?? 999, options.result ?? "Hospitalized", options.chain ?? 150, options.warId ?? null).run();
}
async function tick(now = start) { advance(now); await runChainWatchCron(db.env, now * 1000); }

describe("independent faction chain monitor", () => {
  it("starts exactly at the watch start with no war, using the existing attack feed", async () => {
    await watch();
    await hit(1, start - 20);
    await tick(start - 1);
    expect(await readChainWatchState(db.env)).toBeNull();
    expect(fetchTrackedTornJson).not.toHaveBeenCalled();
    await tick();
    expect(await readChainWatchState(db.env)).toMatchObject({ faction_id: HOME_FACTION_ID, enabled: 1,
      source: "stored", current_chain: 150, last_hit_id: 1, timeout_at: start + 280 });
    expect(getByName).toHaveBeenCalledWith(`chain-watch:faction:${HOME_FACTION_ID}`);
    expect(alarm.syncFaction).toHaveBeenLastCalledWith(HOME_FACTION_ID);
    expect((await readChainWatchState(db.env))?.scheduled_alarm_at).toBe(start + 220);
    expect(fetchTrackedTornJson).not.toHaveBeenCalled();
  });

  it("retains war-only monitoring as an optional consumer", async () => {
    await war(); await hit(1, start - 10); await tick();
    expect(await readChainWatchDemand(db.env)).toEqual({ active: true, watch_id: null, war_id: 1 });
    expect(await readChainWatchState(db.env)).toMatchObject({ enabled: 1, current_chain: 150 });
    await setChainWatchEnabledForWar(db.env, 1, false);
    expect(await readChainWatchState(db.env)).toMatchObject({ enabled: 0, scheduled_alarm_at: null });
  });

  it("uses actual time when a delayed cron arrives after the watch has finished", async () => {
    await watch(start + 3600); await hit(1, start); await tick();
    advance(start + 3601);
    await runChainWatchCron(db.env, (start + 3599) * 1000);
    expect((await readChainWatchState(db.env))?.enabled).toBe(0);
  });

  it("reads across all war assignments, using completion time and ignoring future, failed and friendly hits", async () => {
    await war();
    await war(2);
    await hit(1, start - 80, { warId: 1 });
    await hit(2, start - 40, { warId: 2 });
    await hit(3, start - 30);
    await hit(4, start - 70, { warId: 1, ended: start - 10 });
    await hit(5, start - 5, { result: "Lost" });
    await hit(6, start - 4, { target: HOME_FACTION_ID });
    await hit(7, start - 3, { home: 999 });
    await hit(8, start + 1);
    expect(await readLatestQualifyingChainHit(db.env, start)).toMatchObject({ id: 4 });
    await hit(9, start - 1, { ended: null });
    expect(await readLatestQualifyingChainHit(db.env, start)).toMatchObject({ id: 9 });
  });

  it("shares state between a war and watch, and disabling the war leaves the watch running", async () => {
    await watch(); await war(); await hit(1, start - 10); await tick();
    const before = await readChainWatchState(db.env);
    await setChainWatchEnabledForWar(db.env, 1, false);
    expect(await readChainWatchDemand(db.env)).toMatchObject({ active: true, war_id: null });
    expect(await readChainWatchState(db.env)).toMatchObject({ enabled: 1, discord_message_id: before?.discord_message_id,
      scheduled_alarm_at: before?.scheduled_alarm_at });
    expect((await readChainWatchState(db.env))?.scheduled_alarm_at).not.toBeNull();
    const response = await getChainWatchForWar(new URL("https://worker.test/api/wars/War%201/chain-watch"), db.env);
    expect(await response.json()).toMatchObject({ state: { war_id: 1, enabled: 0, current_chain: 150 }, computed: { active: false } });
  });

  it("continues after a war ends and continues for a war after the watch finishes", async () => {
    await watch(start + 3600); await war(); await hit(1, start - 10); await tick();
    await db.env.DB.prepare("UPDATE wars SET status = 'ended', official_end_time = ? WHERE id = 1").bind(start + 10).run();
    await tick(start + 10);
    expect((await readChainWatchState(db.env))?.enabled).toBe(1);
    await war(2);
    await hit(2, start + 3590);
    await tick(start + 3600);
    expect(await readChainWatchDemand(db.env)).toEqual({ active: true, watch_id: null, war_id: 2 });
    expect((await readChainWatchState(db.env))?.enabled).toBe(1);
  });

  it("stops at the actual finish even before roster reconciliation closes the watch", async () => {
    await watch(start + 3600); await hit(1, start - 10); await tick();
    await tick(start + 3600);
    expect(await readChainWatchState(db.env)).toMatchObject({ enabled: 0, scheduled_alarm_at: null, scheduled_alarm_stage: null });
    expect(alarm.syncFaction).toHaveBeenLastCalledWith(HOME_FACTION_ID);
    expect(upsertDiscordAlertMessage).toHaveBeenLastCalledWith(db.env, "chain_watch", "message", "Chain Watch stopped.", expect.anything(), expect.anything());
    expect(fetchTrackedTornJson).not.toHaveBeenCalled();
  });

  it("honours an extended or ongoing finish without resetting the live chain", async () => {
    const schedule = await watch(start + 3600); await hit(1, start - 10); await tick();
    await setWatchFinish(db.env, schedule.id, "ongoing", start);
    await hit(2, start + 3590); await tick(start + 3600);
    expect(await readChainWatchState(db.env)).toMatchObject({ enabled: 1, last_hit_id: 2, discord_message_id: "message" });
  });

  it("uses newly ingested unassigned attacks to reset the same alarm without fetching Torn", async () => {
    await watch(); await hit(1, start - 10); await tick();
    await hit(2, start + 20, { chain: 151 }); advance(start + 21);
    await refreshActiveChainWatchFromStoredAttacks(db.env, start + 21);
    expect(await readChainWatchState(db.env)).toMatchObject({ last_hit_id: 2, current_chain: 151, timeout_at: start + 320 });
    expect(alarm.syncFaction).toHaveBeenLastCalledWith(HOME_FACTION_ID);
    expect((await readChainWatchState(db.env))?.scheduled_alarm_at).toBe(start + 260);
    expect(fetchTrackedTornJson).not.toHaveBeenCalled();
  });

  it("confirms and delivers both warning stages and a drop without a war", async () => {
    const schedule = await watch(); await hit(1, start); await tick();
    vi.mocked(fetchTrackedTornJson).mockResolvedValue({ chain: { current: 150, timeout: 60 } });
    advance(start + 240); await handleChainWatchAlarm(db.env, HOME_FACTION_ID);
    expect((await readChainWatchState(db.env))?.warning_60_sent_at).toBe(start + 240);
    vi.mocked(fetchTrackedTornJson).mockResolvedValue({ chain: { current: 150, timeout: 30 } });
    advance(start + 270); await handleChainWatchAlarm(db.env, HOME_FACTION_ID);
    expect((await readChainWatchState(db.env))?.warning_30_sent_at).toBe(start + 270);
    vi.mocked(fetchTrackedTornJson).mockResolvedValue({ chain: { current: 0, timeout: 0 } });
    advance(start + 300); await handleChainWatchAlarm(db.env, HOME_FACTION_ID);
    expect(await readChainWatchState(db.env)).toMatchObject({ source: "dropped", drop_sent_at: start + 300 });
    expect(await readChainWatchDemand(db.env)).toMatchObject({ active: true, watch_id: schedule.id });
    await hit(2, start + 310, { chain: 1 }); await tick(start + 310);
    expect(await readChainWatchState(db.env)).toMatchObject({ enabled: 1, current_chain: 1, drop_sent_at: null });
  });

  it("does not deliver an alarm after watch finish, or start for a future/ended war", async () => {
    await war();
    await db.env.DB.prepare("UPDATE wars SET practical_start_time = ?").bind(start + 100).run();
    await tick(); expect((await readChainWatchDemand(db.env)).active).toBe(false);
    await db.env.DB.prepare("UPDATE wars SET practical_start_time = ?, official_end_time = ?").bind(start - 1, start).run();
    await tick(); expect((await readChainWatchDemand(db.env)).active).toBe(false);
    await watch(start + 3600); await hit(1, start); await tick();
    vi.mocked(upsertDiscordAlertMessage).mockClear();
    advance(start + 3600); await handleChainWatchAlarm(db.env, HOME_FACTION_ID);
    expect(fetchTrackedTornJson).not.toHaveBeenCalled();
    expect(vi.mocked(upsertDiscordAlertMessage).mock.calls.every((call) => !call[3].includes("WARNING"))).toBe(true);
  });

  it.each([
    [240, 60, "chain_watch_warning", "warning_60_sent_at", "warning_60"],
    [270, 30, "chain_watch_critical", "warning_30_sent_at", "warning_30"],
    [300, 0, "chain_watch_drop", "drop_sent_at", "drop"],
  ] as const)("keeps a failed %s-second stage pending until Discord delivery succeeds", async (offset, remaining, key, column, stage) => {
    await watch(); await hit(1, start); await tick();
    for (const [earlierOffset, earlierRemaining] of [[240, 60], [270, 30]]) {
      if (earlierOffset >= offset) continue;
      vi.mocked(fetchTrackedTornJson).mockResolvedValue({ chain: { current: 150, timeout: earlierRemaining } });
      advance(start + earlierOffset);
      await handleChainWatchAlarm(db.env, HOME_FACTION_ID);
    }
    vi.mocked(fetchTrackedTornJson).mockResolvedValue({ chain: { current: remaining ? 150 : 0, timeout: remaining } });
    vi.mocked(upsertDiscordAlertMessage).mockImplementation(async (_env, alertKey) => {
      if (alertKey === key) throw new Error("Discord HTTP 503");
      return "message";
    });
    advance(start + offset);
    await expect(handleChainWatchAlarm(db.env, HOME_FACTION_ID)).rejects.toThrow("Discord HTTP 503");
    expect(await readChainWatchState(db.env)).toMatchObject({
      [column]: null, scheduled_alarm_stage: stage, last_error: "Discord HTTP 503",
    });

    vi.mocked(upsertDiscordAlertMessage).mockResolvedValue("recovered-message");
    vi.mocked(fetchTrackedTornJson).mockResolvedValue({ chain: { current: remaining ? 150 : 0, timeout: Math.max(0, remaining - 1) } });
    advance(start + offset + 1);
    await handleChainWatchAlarm(db.env, HOME_FACTION_ID);
    expect(await readChainWatchState(db.env)).toMatchObject({ [column]: start + offset + 1, last_error: null });
  });

  it("exposes read-only faction status without a war or extra Torn request", async () => {
    await watch(); await hit(1, start); await tick();
    expect(await (await getChainWatchLive(db.env)).json()).toMatchObject({ faction_id: HOME_FACTION_ID,
      state: { current_chain: 150 }, computed: { active: true, remaining_seconds: 300 }, demand: { war_id: null } });
    expect(fetchTrackedTornJson).not.toHaveBeenCalled();
  });
});

describe("versioned chain timers", () => {
  it.each([
    [240, 60, "chain_watch_warning"], [270, 30, "chain_watch_critical"], [300, 0, "chain_watch_drop"],
  ] as const)("preserves the new timer when an attack arrives during %s-second alert delivery", async (offset, remaining, key) => {
    await watch(); await hit(1, start); await tick();
    const originalVersion = (await readChainWatchState(db.env))!.timer_version;
    for (const [at, timeout] of [[240, 60], [270, 30]]) {
      if (at >= offset) continue;
      vi.mocked(fetchTrackedTornJson).mockResolvedValue({ chain: { current: 150, timeout } });
      advance(start + at); await handleChainWatchAlarm(db.env, HOME_FACTION_ID);
    }
    vi.mocked(fetchTrackedTornJson).mockResolvedValue({ chain: { current: remaining ? 150 : 0, timeout: remaining } });
    vi.mocked(upsertDiscordAlertMessage).mockImplementation(async (_env, alertKey) => {
      if (alertKey === key) {
        await hit(2, start + offset, { chain: 151 });
        await refreshActiveChainWatchFromStoredAttacks(db.env, start + offset);
      }
      return "message";
    });
    advance(start + offset); await handleChainWatchAlarm(db.env, HOME_FACTION_ID);
    expect(await readChainWatchState(db.env)).toMatchObject({
      current_chain: 151, reset_at: start + offset, timeout_at: start + offset + 300,
      warning_60_sent_at: null, warning_30_sent_at: null, drop_sent_at: null,
      scheduled_alarm_stage: "warning_60", scheduled_alarm_at: start + offset + 240,
    });
    expect((await readChainWatchState(db.env))!.timer_version).toBeGreaterThan(originalVersion);
    vi.mocked(upsertDiscordAlertMessage).mockResolvedValue("next-warning");
    vi.mocked(fetchTrackedTornJson).mockResolvedValue({ chain: { current: 151, timeout: 60 } });
    advance(start + offset + 240); await handleChainWatchAlarm(db.env, HOME_FACTION_ID);
    expect((await readChainWatchState(db.env))!.warning_60_sent_at).toBe(start + offset + 240);
  });

  it.each(["stale live result", "failed live result"])("discards a %s after ingestion resets the timer", async result => {
    await watch(); await hit(1, start); await tick();
    vi.mocked(upsertDiscordAlertMessage).mockClear();
    vi.mocked(fetchTrackedTornJson).mockImplementationOnce(async () => {
      await hit(2, start + 240, { chain: 151 });
      await refreshActiveChainWatchFromStoredAttacks(db.env, start + 240);
      if (result === "failed live result") throw new Error("Old request failed");
      return { chain: { current: 149, timeout: 30 } };
    });
    advance(start + 240); await handleChainWatchAlarm(db.env, HOME_FACTION_ID);
    expect(await readChainWatchState(db.env)).toMatchObject({
      source: "stored", current_chain: 151, timeout_at: start + 540, last_error: null,
      warning_60_sent_at: null, scheduled_alarm_at: start + 480,
    });
    expect(vi.mocked(upsertDiscordAlertMessage).mock.calls.some(call => call[1] === "chain_watch_warning")).toBe(false);
  });

  it("rejects an older cron observation and scheduling decision after a newer hit", async () => {
    await watch(); await hit(1, start); await tick();
    vi.mocked(fetchTrackedTornJson).mockImplementationOnce(async () => {
      await hit(2, start + 301, { chain: 151 });
      advance(start + 302);
      await refreshActiveChainWatchFromStoredAttacks(db.env, start + 302);
      return { chain: { current: 0, timeout: 0 } };
    });
    await tick(start + 300);
    expect(await readChainWatchState(db.env)).toMatchObject({
      current_chain: 151, last_hit_id: 2, last_checked_at: start + 302,
      timeout_at: start + 601, scheduled_alarm_stage: "warning_60", scheduled_alarm_at: start + 541,
    });
  });
});

describe("assigned watcher alert mentions", () => {
  const aliceId = "111111111111111111";
  const bobId = "222222222222222222";
  beforeEach(() => {
    db.sqlite.exec(`UPDATE discord_member_links SET discord_user_id = '${aliceId}' WHERE torn_user_id = 1;
      UPDATE discord_member_links SET discord_user_id = '${bobId}' WHERE torn_user_id = 2;`);
  });
  async function assign(watchId: string, at = start, memberId = 1) {
    await db.env.DB.prepare("UPDATE chain_watch_slots SET assigned_to = ?, admin_override = 1 WHERE watch_id = ? AND start_at = ?")
      .bind(memberId, watchId, at).run();
  }
  async function fire(at: number, remaining: number) {
    advance(at);
    vi.mocked(fetchTrackedTornJson).mockResolvedValue({ chain: { current: remaining ? 150 : 0, timeout: remaining } });
    await handleChainWatchAlarm(db.env, HOME_FACTION_ID);
    return vi.mocked(upsertDiscordAlertMessage).mock.calls.at(-1)!;
  }

  it("posts each alert with the watcher and subscribers while retaining the separate live status message", async () => {
    const schedule = await watch(); await assign(schedule.id); await hit(1, start); await tick();
    const normal = vi.mocked(upsertDiscordAlertMessage).mock.calls.at(-1)!;
    expect(normal[3]).not.toContain(`<@${aliceId}>`);
    expect(normal[4]).toEqual({ users: [], roles: [] });
    vi.mocked(upsertDiscordAlertMessage).mockClear();
    vi.mocked(upsertDiscordAlertMessage).mockImplementation(async (_env, _key, existingId) => existingId ?? "new-alert");
    const configured = { messageSuffix: "<@999999> <@&888888>", allowedMentions: { users: ["999999"], roles: ["888888"] } };
    vi.mocked(readDiscordAlertMentions).mockImplementation(async (_env, key) => key === "chain_watch" ? { messageSuffix: "", allowedMentions: undefined } : configured);
    for (const [offset, remaining, key, color] of [
      [240, 60, "chain_watch_warning", 0xffa500],
      [270, 30, "chain_watch_critical", 0xff0000],
      [300, 0, "chain_watch_drop", 0x3498db],
    ] as const) {
      const call = await fire(start + offset, remaining);
      expect(readDiscordAlertMentions).toHaveBeenLastCalledWith(db.env, key);
      expect(call.slice(0, 3)).toEqual([db.env, key, null]);
      expect(call[3]).toMatch(new RegExp(`<@999999> <@&888888> <@${aliceId}>$`));
      expect(call[4]).toEqual({ users: ["999999", aliceId], roles: ["888888"] });
      expect(call[5]).toEqual({ cardColor: color });
      expect((await readChainWatchState(db.env))?.discord_message_id).toBe("message");
    }
    expect(configured.allowedMentions.users).toEqual(["999999"]);
    await hit(2, start + 310, { chain: 1 }); await tick(start + 310);
    const refreshed = vi.mocked(upsertDiscordAlertMessage).mock.calls.at(-1)!;
    expect(refreshed[2]).toBe("message");
    expect(refreshed[4]).toEqual({ users: [], roles: [] });
    expect(vi.mocked(upsertDiscordAlertMessage).mock.calls.filter((call) => call[2] === null)).toHaveLength(3);
  });

  it("preserves role and broadcast pings when appending the assigned watcher", async () => {
    const schedule = await watch(); await assign(schedule.id); await hit(1, start); await tick();
    vi.mocked(readDiscordAlertMentions).mockResolvedValue({ messageSuffix: "<@&888888> @here", allowedMentions: { roles: ["888888"], everyone: true } });
    const call = await fire(start + 240, 60);
    expect(call[3]).toContain(`<@&888888> @here <@${aliceId}>`);
    expect(call[4]).toEqual({ roles: ["888888"], everyone: true, users: [aliceId] });
  });

  it("mentions an already subscribed watcher only once", async () => {
    const schedule = await watch(); await assign(schedule.id); await hit(1, start); await tick();
    vi.mocked(readDiscordAlertMentions).mockResolvedValue({ messageSuffix: `<@${aliceId}> <@&888888>`,
      allowedMentions: { users: [aliceId], roles: ["888888"] } });
    const call = await fire(start + 240, 60);
    expect(call[3].split(`<@${aliceId}>`)).toHaveLength(2);
    expect(call[4]).toEqual({ users: [aliceId], roles: ["888888"] });
  });

  it("uses the current watcher at an exact handover and honours subsequent admin reassignment", async () => {
    const schedule = await watch(); await assign(schedule.id); await assign(schedule.id, start + 3600, 2);
    await hit(1, start + 3330); await tick(start + 3330);
    expect((await fire(start + 3570, 60))[4]).toEqual({ users: [aliceId], roles: [] });
    const critical = await fire(start + 3600, 30);
    expect(critical[4]).toEqual({ users: [bobId], roles: [] });
    expect(critical[3]).not.toContain(`<@${aliceId}>`);
    await assign(schedule.id, start + 3600, 1);
    expect((await fire(start + 3630, 0))[4]).toEqual({ users: [aliceId], roles: [] });
  });

  it.each(["unassigned", "cancelled", "unlinked", "former member", "invalid Discord ID"])("keeps normal alerts when the slot is %s", async (reason) => {
    const schedule = await watch();
    if (reason !== "unassigned") await assign(schedule.id);
    if (reason === "cancelled") db.sqlite.exec("UPDATE chain_watch_slots SET cancelled = 1");
    if (reason === "unlinked") db.sqlite.exec("DELETE FROM discord_member_links WHERE torn_user_id = 1");
    if (reason === "former member") db.sqlite.exec("UPDATE home_faction_members SET is_current = 0 WHERE member_id = 1");
    if (reason === "invalid Discord ID") db.sqlite.exec("UPDATE discord_member_links SET discord_user_id = '@everyone' WHERE torn_user_id = 1");
    await hit(1, start); await tick();
    vi.mocked(readDiscordAlertMentions).mockResolvedValue({ messageSuffix: "<@&888888>", allowedMentions: { roles: ["888888"] } });
    const call = await fire(start + 240, 60);
    expect(call[3]).toContain("WARNING");
    expect(call[3].endsWith("\n<@&888888>")).toBe(true);
    expect(call[4]).toEqual({ roles: ["888888"] });
  });

  it.each(["future", "finished"])("does not add a watcher from a %s watch to war alerts", async (status) => {
    const watchStart = status === "future" ? start + 3600 : start;
    const schedule = await createWatch(db.env, { name: "Watch", start: watchUtc(watchStart), finish: watchUtc(watchStart + 3600),
      guildId: "guild", channelId: "channel", discordUserId: "111" }, start - 60);
    await assign(schedule.id, watchStart); await war();
    const hitAt = status === "future" ? start : start + 3600;
    await hit(1, hitAt); await tick(hitAt);
    const call = await fire(hitAt + 240, 60);
    expect(call[3]).toContain("WARNING");
    expect(call[4]).toEqual({ users: [], roles: [] });
  });

  it("continues the ordinary alert if the assignment lookup fails", async () => {
    const schedule = await watch(); await assign(schedule.id); await hit(1, start); await tick();
    const prepare = db.env.DB.prepare.bind(db.env.DB);
    vi.spyOn(db.env.DB, "prepare").mockImplementation((sql) => {
      if (sql.includes("SELECT links.discord_user_id FROM chain_watch_slots")) throw new Error("lookup unavailable");
      return prepare(sql);
    });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const call = await fire(start + 240, 60);
    expect(call[3]).toContain("WARNING");
    expect(call[4]).toEqual({ users: [], roles: [] });
    expect(warning).toHaveBeenCalledWith("Chain Watch assignment lookup failed:", "lookup unavailable");
  });

  it("suppresses all Discord messages while continuing every alarm stage when message toggles are off", async () => {
    const schedule = await watch(); await assign(schedule.id); await hit(1, start);
    vi.mocked(isDiscordAlertEnabled).mockResolvedValue(false);
    await tick();
    await fire(start + 240, 60);
    expect(await readChainWatchState(db.env)).toMatchObject({ enabled: 1, current_chain: 150, warning_60_sent_at: start + 240, scheduled_alarm_stage: "warning_30" });
    await fire(start + 270, 30);
    expect(await readChainWatchState(db.env)).toMatchObject({ warning_30_sent_at: start + 270, scheduled_alarm_stage: "drop" });
    await fire(start + 300, 0);
    expect(await readChainWatchState(db.env)).toMatchObject({ enabled: 1, source: "dropped", drop_sent_at: start + 300 });
    expect(await readChainWatchDemand(db.env)).toMatchObject({ active: true, watch_id: schedule.id });
    await hit(2, start + 310, { chain: 151 }); await tick(start + 310);
    expect(await readChainWatchState(db.env)).toMatchObject({ enabled: 1, current_chain: 151, drop_sent_at: null, scheduled_alarm_stage: "warning_60" });
    expect(upsertDiscordAlertMessage).not.toHaveBeenCalled();
  });

  it.each(["chain_watch_warning", "chain_watch_critical", "chain_watch_drop"])("muting %s leaves other Discord messages and events active", async (mutedKey) => {
    await watch(); await hit(1, start);
    vi.mocked(isDiscordAlertEnabled).mockImplementation(async (_env, key) => key !== mutedKey);
    await tick();
    for (const [offset, remaining] of [[240, 60], [270, 30], [300, 0]]) await fire(start + offset, remaining);
    const deliveredKeys = vi.mocked(upsertDiscordAlertMessage).mock.calls.map((call) => call[1]);
    expect(deliveredKeys).toContain("chain_watch");
    expect(deliveredKeys).not.toContain(mutedKey);
    for (const key of ["chain_watch_warning", "chain_watch_critical", "chain_watch_drop"].filter((key) => key !== mutedKey)) {
      expect(deliveredKeys).toContain(key);
    }
    expect(await readChainWatchState(db.env)).toMatchObject({ enabled: 1, warning_60_sent_at: start + 240, warning_30_sent_at: start + 270, drop_sent_at: start + 300 });
  });

  it("delivers stage alerts through their own routes when the persistent status message is off", async () => {
    await watch(); await hit(1, start);
    vi.mocked(isDiscordAlertEnabled).mockImplementation(async (_env, key) => key !== "chain_watch");
    await tick();
    expect(upsertDiscordAlertMessage).not.toHaveBeenCalled();
    for (const [offset, remaining] of [[240, 60], [270, 30], [300, 0]]) await fire(start + offset, remaining);
    expect(vi.mocked(upsertDiscordAlertMessage).mock.calls.map((call) => call[1])).toEqual([
      "chain_watch_warning", "chain_watch_critical", "chain_watch_drop",
    ]);
    expect((await readChainWatchState(db.env))?.discord_message_id).toBeNull();
  });
});

describe("faction monitor migration", () => {
  it("preserves current warning markers and message ownership, without a war foreign key", async () => {
    db.sqlite.close(); db = chainWatchDatabase(start, false); advance(start); await war();
    await db.env.DB.prepare(`INSERT INTO chain_watch_state (war_id, current_chain, warning_60_sent_at,
      discord_message_id, scheduled_alarm_stage, scheduled_alarm_at) VALUES (1, 150, ?, 'existing', 'warning_30', ?)`)
      .bind(start - 10, start + 20).run();
    db.applyMigration();
    expect(await readChainWatchState(db.env)).toMatchObject({ faction_id: HOME_FACTION_ID, current_chain: 150,
      warning_60_sent_at: start - 10, discord_message_id: "existing", scheduled_alarm_stage: "warning_30" });
    await db.env.DB.prepare("DELETE FROM wars WHERE id = 1").run();
    expect((await readChainWatchState(db.env))?.discord_message_id).toBe("existing");
    expect((await db.env.DB.prepare("PRAGMA foreign_key_list(faction_chain_watch_state)").all()).results).toEqual([]);
  });
});
