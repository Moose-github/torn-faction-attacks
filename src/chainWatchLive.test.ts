import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chainWatchDatabase } from "../scripts/chain-watch-test-database.mjs";
import { createWatch, setWatchFinish } from "./chainWatchSchedule";
import { watchUtc } from "../shared/chainWatchSchedule";
import { HOME_FACTION_ID } from "./constants";
import { CHAIN_WATCH_DROP_RETRY_SECONDS, getChainWatchLive, handleChainWatchAlarm, readChainWatchState, readLatestQualifyingChainHit, reconcileChainWatchActivity, refreshActiveChainWatchFromStoredAttacks, refreshChainWatch, runChainWatchCron } from "./chainWatch";
import { readChainWatchDemand } from "./chainWatchDemand";
import { setManualChainProtection } from "./chainWatch";
import { getChainWatchForWar, setChainWatchEnabledForWar } from "./chainWatchWar";
import { fetchTrackedTornJson } from "./external/torn";
import { upsertDiscordAlertMessage } from "./discordAlertDelivery";
import { readDiscordAlertMentions } from "./discordMentions";
import { isDiscordAlertEnabled } from "./discordAlertSettings";
import { deleteWatchDiscordMessage, editWatchDiscordMessage } from "./chainWatchDiscordDelivery";
import type { Env } from "./types";
import type { DiscordAlertKey } from "./discordAlerts";
import type { DiscordAllowedMentions } from "./discord";

vi.mock("./external/torn", () => ({ fetchTrackedTornJson: vi.fn() }));
vi.mock("./tornKeyPool", () => ({ withTornKeyPool: (_env: unknown, options: { run: (key: unknown) => Promise<unknown> }) => options.run({ key: "test", keySource: "test" }) }));
vi.mock("./discordAlertSettings", () => ({ isDiscordAlertEnabled: vi.fn().mockResolvedValue(true) }));
vi.mock("./discordAlertDelivery", () => ({ upsertDiscordAlertMessage: vi.fn().mockResolvedValue("message") }));
vi.mock("./chainWatchWarningTargets", async importOriginal => ({
  ...await importOriginal<typeof import("./chainWatchWarningTargets")>(),
  enrichChainWatchWarningTargets: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./chainWatchDiscordDelivery", async importOriginal => ({
  ...await importOriginal<typeof import("./chainWatchDiscordDelivery")>(),
  // Keep the existing alert transport spy for the monitor's concurrency tests;
  // the real transport/channel capture is exercised in its own delivery tests.
  deliverChainWatchWarningAlert: async (env: Env, options: { message: string }, color: number, key: DiscordAlertKey) => {
    if (!await isDiscordAlertEnabled(env, key)) return { status: "skipped", reason: "disabled" };
    try {
      const id = await upsertDiscordAlertMessage(env, key, null, options.message,
        (options as { allowedMentions?: DiscordAllowedMentions }).allowedMentions, { cardColor: color });
      return id ? { status: "success", value: { messageId: id, channelId: `${key}-channel` } }
        : { status: "skipped", reason: "no_route" };
    } catch (error) { return { status: "failed", error }; }
  },
  editWatchDiscordMessage: vi.fn().mockResolvedValue({ status: "success", value: undefined }),
  deleteWatchDiscordMessage: vi.fn().mockResolvedValue({ status: "success", value: undefined }),
}));
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
  vi.mocked(editWatchDiscordMessage).mockReset().mockResolvedValue({ status: "success", value: undefined });
  vi.mocked(deleteWatchDiscordMessage).mockReset().mockResolvedValue({ status: "success", value: undefined });
  vi.mocked(upsertDiscordAlertMessage).mockResolvedValue("message");
  vi.mocked(isDiscordAlertEnabled).mockResolvedValue(true);
  vi.mocked(readDiscordAlertMentions).mockResolvedValue({ messageSuffix: "", allowedMentions: undefined });
  db = chainWatchDatabase(start - 60);
  advance(start - 60);
  db.env.CHAIN_WATCH_ALARMS = { getByName } as unknown as DurableObjectNamespace;
  vi.mocked(fetchTrackedTornJson).mockReset().mockResolvedValue({ chain: { current: 0, timeout: 0 } });
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

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function beforeObservationSave(beforeSave: (values: unknown[]) => Promise<void>) {
  const prepare = db.env.DB.prepare.bind(db.env.DB);
  return vi.spyOn(db.env.DB, "prepare").mockImplementation(sql => {
    const statement = prepare(sql);
    if (!sql.includes("ON CONFLICT(faction_id) DO UPDATE SET")) return statement;
    const bind = statement.bind.bind(statement);
    vi.spyOn(statement, "bind").mockImplementation((...values) => {
      const bound = bind(...values);
      const first = bound.first.bind(bound);
      vi.spyOn(bound, "first").mockImplementation(async () => {
        await beforeSave(values);
        return first();
      });
      return bound;
    });
    return statement;
  });
}

describe("inactive chain monitoring", () => {
  const saved = () => db.sqlite.prepare(`SELECT enabled, timer_version, inactive_alarm_synced_version
    FROM faction_chain_watch_state WHERE faction_id = ?`).get(HOME_FACTION_ID);
  // The snapshot is already read when the stop is prepared, so this write wins the race.
  const beforeStopUpdate = (concurrentWrite: string) => {
    const prepare = db.env.DB.prepare.bind(db.env.DB);
    let pending = true;
    vi.spyOn(db.env.DB, "prepare").mockImplementation(sql => {
      if (pending && sql.includes("SET enabled = 0, timer_version = timer_version + 1")) {
        pending = false;
        db.sqlite.exec(concurrentWrite);
      }
      return prepare(sql);
    });
  };

  it("retries a stop that lost to an observation instead of acting on ended demand", async () => {
    await hit(1, start - 20); advance(start);
    vi.mocked(fetchTrackedTornJson).mockResolvedValue({ chain: { current: 150, timeout: 280 } });
    await setManualChainProtection(db.env, true);
    expect((await readChainWatchState(db.env))!.scheduled_alarm_stage).toBe("warning_60");
    db.sqlite.prepare("UPDATE faction_chain_watch_state SET manual_enabled = 0 WHERE faction_id = ?").run(HOME_FACTION_ID);
    const version = (await readChainWatchState(db.env))!.timer_version;
    vi.mocked(fetchTrackedTornJson).mockResolvedValue({ chain: { current: 150, timeout: 60 } });
    advance(start + 220);
    beforeStopUpdate("UPDATE faction_chain_watch_state SET timer_version = timer_version + 1");
    await handleChainWatchAlarm(db.env, HOME_FACTION_ID);
    const state = await readChainWatchState(db.env);
    expect(state).toMatchObject({ warning_60_sent_at: null, scheduled_alarm_at: null });
    expect(saved()).toMatchObject({ enabled: 0, timer_version: version + 2, inactive_alarm_synced_version: version + 2 });
  });

  it("stays active when a stop lost to restored demand", async () => {
    await hit(1, start - 20); advance(start);
    await setManualChainProtection(db.env, true);
    db.sqlite.prepare("UPDATE faction_chain_watch_state SET manual_enabled = 0 WHERE faction_id = ?").run(HOME_FACTION_ID);
    const version = (await readChainWatchState(db.env))!.timer_version;
    alarm.syncFaction.mockClear();
    beforeStopUpdate("UPDATE faction_chain_watch_state SET manual_enabled = 1, timer_version = timer_version + 1");
    expect(await reconcileChainWatchActivity(db.env, start)).toBe(true);
    expect(saved()).toMatchObject({ enabled: 1, timer_version: version + 1 });
    expect(alarm.syncFaction).not.toHaveBeenCalled();
  });

  it("bootstraps once, then checks demand with one read and no RPCs or writes", async () => {
    await tick();
    expect(alarm.syncFaction).toHaveBeenCalledTimes(1);
    expect(saved()).toMatchObject({ enabled: 0, timer_version: 0, inactive_alarm_synced_version: 0 });
    const queries = vi.spyOn(db.env.DB, "prepare");
    const before = db.sqlite.prepare("SELECT total_changes() AS n").get()!.n;
    alarm.syncFaction.mockClear();
    for (let minute = 1; minute <= 15; minute++) await tick(start + minute * 60);
    expect(queries).toHaveBeenCalledTimes(15);
    expect(db.sqlite.prepare("SELECT total_changes() AS n").get()!.n).toBe(before);
    expect(alarm.syncFaction).not.toHaveBeenCalled();
    expect(fetchTrackedTornJson).not.toHaveBeenCalled();
    expect(upsertDiscordAlertMessage).not.toHaveBeenCalled();
    const plan = db.sqlite.prepare(`EXPLAIN QUERY PLAN ${queries.mock.calls[0][0]}`)
      .all(HOME_FACTION_ID, "attacks", start) as Array<{ detail: string }>;
    expect(plan.some(row => /SEARCH s USING INTEGER PRIMARY KEY/.test(row.detail))).toBe(true);
    expect(plan.some(row => /SEARCH chain_watch_schedules USING INDEX/.test(row.detail))).toBe(true);
    expect(plan.some(row => /SEARCH chain_watch_warning_cycles USING INDEX/.test(row.detail))).toBe(true);
  });

  it("reconciles an existing inactive monitor once after upgrade", async () => {
    await tick();
    db.sqlite.exec("UPDATE faction_chain_watch_state SET inactive_alarm_synced_version = NULL");
    alarm.syncFaction.mockClear();
    await tick(start + 60);
    await tick(start + 120);
    expect(alarm.syncFaction).toHaveBeenCalledTimes(1);
    expect(saved()).toMatchObject({ inactive_alarm_synced_version: 0 });
  });

  it("retries failed shutdown synchronization even though monitoring is already disabled", async () => {
    await hit(1, start - 20); advance(start);
    await setManualChainProtection(db.env, true);
    alarm.syncFaction.mockRejectedValueOnce(new Error("RPC unavailable"));
    await expect(setManualChainProtection(db.env, false)).rejects.toThrow("RPC unavailable");
    expect(saved()).toMatchObject({ enabled: 0, inactive_alarm_synced_version: null });
    alarm.syncFaction.mockClear();
    await tick(start + 60);
    expect(saved()!.inactive_alarm_synced_version).toBe(saved()!.timer_version);
    await tick(start + 120);
    expect(alarm.syncFaction).toHaveBeenCalledTimes(1);
  });

  it("does not acknowledge a concurrent restart or its subsequent shutdown with an old RPC", async () => {
    const entered = gate(), complete = gate();
    alarm.syncFaction.mockImplementationOnce(async () => { entered.resolve(); await complete.promise; });
    const stopping = tick();
    await entered.promise;
    await hit(1, start - 20);
    await setManualChainProtection(db.env, true);
    const activeVersion = saved()!.timer_version;
    complete.resolve();
    await stopping;
    expect(saved()).toMatchObject({ enabled: 1, timer_version: activeVersion, inactive_alarm_synced_version: null });
    expect((await readChainWatchState(db.env))!.scheduled_alarm_at).toBeGreaterThan(start);
    alarm.syncFaction.mockClear();
    await setManualChainProtection(db.env, false);
    expect(alarm.syncFaction).toHaveBeenCalledTimes(1);
    expect(saved()!.inactive_alarm_synced_version).toBe(saved()!.timer_version);
    expect(saved()!.timer_version).not.toBe(activeVersion);
  });

  it("retries pending warning cleanup without repeatedly cancelling the alarm", async () => {
    await tick();
    db.sqlite.prepare(`INSERT INTO chain_watch_warning_cycles
      (faction_id, reset_at, timeout_at, chain_length, warning_message_id, warning_channel_id, outcome_text)
      VALUES (?, ?, ?, 150, 'warning', 'channel', 'Chain saved by Alice')`)
      .run(HOME_FACTION_ID, start - 300, start);
    vi.mocked(editWatchDiscordMessage).mockResolvedValueOnce({ status: "failed", error: new Error("Discord unavailable") });
    alarm.syncFaction.mockClear();
    await tick(start + 60);
    expect(db.sqlite.prepare("SELECT last_error FROM chain_watch_warning_cycles").get()!.last_error).toBe("Discord unavailable");
    await tick(start + 120);
    expect(editWatchDiscordMessage).toHaveBeenCalledTimes(2);
    expect(db.sqlite.prepare("SELECT edited_message_id, last_error FROM chain_watch_warning_cycles").get())
      .toEqual({ edited_message_id: "warning", last_error: null });
    const queries = vi.spyOn(db.env.DB, "prepare");
    await tick(start + 180);
    expect(queries).toHaveBeenCalledTimes(1);
    expect(alarm.syncFaction).not.toHaveBeenCalled();
  });
});

describe("warnings outrank other chain monitor work", () => {
  const warningKeys = () => vi.mocked(upsertDiscordAlertMessage).mock.calls.map(call => call[1]);
  // A hit 20 seconds before the start: warning_60 is due at start + 220.
  async function armedMonitor() {
    await hit(1, start - 20); advance(start);
    vi.mocked(fetchTrackedTornJson).mockResolvedValue({ chain: { current: 150, timeout: 280 } });
    await setManualChainProtection(db.env, true);
    expect((await readChainWatchState(db.env))!.scheduled_alarm_stage).toBe("warning_60");
    vi.mocked(upsertDiscordAlertMessage).mockClear();
    vi.mocked(fetchTrackedTornJson).mockClear().mockResolvedValue({ chain: { current: 150, timeout: 60 } });
    advance(start + 220);
  }
  const expectWarningSentAndCriticalArmed = async () => {
    expect(warningKeys()).toContain("chain_watch_warning");
    expect(await readChainWatchState(db.env)).toMatchObject({ warning_60_sent_at: start + 220,
      scheduled_alarm_stage: "warning_30", scheduled_alarm_at: start + 250 });
  };

  it.each([["warning_60", 220, 60, 6], ["warning_30", 250, 30, 7]] as const)("keeps %s to a minimal set of queries before posting", async (stage, offset, remaining, limit) => {
    await armedMonitor();
    if (stage === "warning_30") await handleChainWatchAlarm(db.env, HOME_FACTION_ID);
    advance(start + offset);
    vi.mocked(fetchTrackedTornJson).mockResolvedValue({ chain: { current: 150, timeout: remaining } });
    const statements: string[] = [];
    let beforePost = -1;
    const prepare = db.env.DB.prepare.bind(db.env.DB);
    vi.spyOn(db.env.DB, "prepare").mockImplementation(sql => { statements.push(sql); return prepare(sql); });
    vi.mocked(upsertDiscordAlertMessage).mockClear().mockImplementationOnce(async () => {
      beforePost = statements.length;
      return "message";
    });
    await handleChainWatchAlarm(db.env, HOME_FACTION_ID);
    expect(warningKeys()[0]).toBe(stage === "warning_60" ? "chain_watch_warning" : "chain_watch_critical");
    const sent = statements.slice(0, beforePost);
    expect(sent.length).toBeLessThanOrEqual(limit);
    // The only full state read before posting is the guard against a hit during the live check.
    expect(sent.filter(sql => sql.includes("SELECT * FROM faction_chain_watch_state"))).toHaveLength(1);
    expect(sent.some(sql => sql.includes("SET enabled = 1"))).toBe(false);
    expect(sent.some(sql => sql.includes("DO NOTHING"))).toBe(false);
  });

  it("does not warn from reused state when a hit lands during the live check", async () => {
    await armedMonitor();
    vi.mocked(fetchTrackedTornJson).mockImplementationOnce(async () => {
      db.sqlite.prepare(`UPDATE faction_chain_watch_state SET timer_version = timer_version + 1,
        current_chain = 151, reset_at = ?, timeout_at = ?, scheduled_alarm_stage = NULL, scheduled_alarm_at = NULL
        WHERE faction_id = ?`).run(start + 215, start + 515, HOME_FACTION_ID);
      return { chain: { current: 151, timeout: 295 } };
    });
    await handleChainWatchAlarm(db.env, HOME_FACTION_ID);
    expect(warningKeys()).not.toContain("chain_watch_warning");
    expect(await readChainWatchState(db.env)).toMatchObject({ current_chain: 151, warning_60_sent_at: null,
      scheduled_alarm_stage: "warning_60", scheduled_alarm_at: start + 455 });
  });

  it("does not warn from reused state when the monitor stops during the live check", async () => {
    await armedMonitor();
    vi.mocked(fetchTrackedTornJson).mockImplementationOnce(async () => {
      db.sqlite.prepare(`UPDATE faction_chain_watch_state SET enabled = 0, timer_version = timer_version + 1,
        scheduled_alarm_stage = NULL, scheduled_alarm_at = NULL WHERE faction_id = ?`).run(HOME_FACTION_ID);
      return { chain: { current: 150, timeout: 60 } };
    });
    await handleChainWatchAlarm(db.env, HOME_FACTION_ID);
    expect(warningKeys()).not.toContain("chain_watch_warning");
    expect((await readChainWatchState(db.env))!.enabled).toBe(0);
  });

  it("does not warn from reused state when another alarm run already sent it", async () => {
    await armedMonitor();
    vi.mocked(fetchTrackedTornJson).mockImplementationOnce(async () => {
      db.sqlite.prepare("UPDATE faction_chain_watch_state SET warning_60_sent_at = ? WHERE faction_id = ?").run(start + 220, HOME_FACTION_ID);
      return { chain: { current: 150, timeout: 60 } };
    });
    await handleChainWatchAlarm(db.env, HOME_FACTION_ID);
    expect(warningKeys()).not.toContain("chain_watch_warning");
  });

  it("sends a warning and arms the critical while Discord cleanup is hung", async () => {
    await armedMonitor();
    db.sqlite.prepare(`INSERT INTO chain_watch_warning_cycles
      (faction_id, reset_at, timeout_at, chain_length, warning_message_id, warning_channel_id, outcome_text)
      VALUES (?, ?, ?, 120, 'old-warning', 'channel', 'Chain saved by Alice')`)
      .run(HOME_FACTION_ID, start - 1000, start - 700);
    const release = gate();
    vi.mocked(editWatchDiscordMessage).mockImplementation(async () => {
      await release.promise;
      return { status: "success", value: undefined };
    });
    const background: Promise<void>[] = [];
    await handleChainWatchAlarm(db.env, HOME_FACTION_ID, task => { background.push(task); });
    await expectWarningSentAndCriticalArmed();
    release.resolve();
    await Promise.all(background);
    expect(db.sqlite.prepare("SELECT edited_message_id FROM chain_watch_warning_cycles").get())
      .toEqual({ edited_message_id: "old-warning" });
  });

  it("sends a warning without waiting for a status edit after a live timer correction", async () => {
    await armedMonitor();
    vi.mocked(fetchTrackedTornJson).mockResolvedValue({ chain: { current: 150, timeout: 50 } });
    const release = gate();
    vi.mocked(upsertDiscordAlertMessage).mockImplementation(async (_env, key) => {
      if (key === "chain_watch") await release.promise;
      return "message";
    });
    const background: Promise<void>[] = [];
    await handleChainWatchAlarm(db.env, HOME_FACTION_ID, task => { background.push(task); });
    expect(warningKeys()).toContain("chain_watch_warning");
    expect((await readChainWatchState(db.env))!.warning_60_sent_at).toBe(start + 220);
    release.resolve();
    await Promise.all(background);
    expect(warningKeys()).toContain("chain_watch");
  });

  it("warns from the known timer when the live Torn check hangs past its deadline", async () => {
    await armedMonitor();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"], now: (start + 220) * 1000 });
    vi.mocked(fetchTrackedTornJson).mockImplementation(() => new Promise(() => {}));
    const alarmDone = handleChainWatchAlarm(db.env, HOME_FACTION_ID);
    await vi.waitFor(() => expect(fetchTrackedTornJson).toHaveBeenCalled());
    expect(warningKeys()).not.toContain("chain_watch_warning");
    await vi.advanceTimersByTimeAsync(3_000);
    await alarmDone;
    await expectWarningSentAndCriticalArmed();
  });

  it("calls Torn once for a due warning when no stored hit backs the timer", async () => {
    advance(start);
    vi.mocked(fetchTrackedTornJson).mockResolvedValue({ chain: { current: 150, timeout: 280 } });
    await setManualChainProtection(db.env, true);
    expect((await readChainWatchState(db.env))!.scheduled_alarm_stage).toBe("warning_60");
    vi.mocked(fetchTrackedTornJson).mockClear().mockResolvedValue({ chain: { current: 150, timeout: 60 } });
    advance(start + 220);
    await handleChainWatchAlarm(db.env, HOME_FACTION_ID);
    expect(fetchTrackedTornJson).toHaveBeenCalledTimes(1);
    expect((await readChainWatchState(db.env))!.warning_60_sent_at).toBe(start + 220);
  });

  it("still checks Torn when a late alarm's timer has expired, so a saved chain rearms at once", async () => {
    advance(start);
    vi.mocked(fetchTrackedTornJson).mockResolvedValue({ chain: { current: 150, timeout: 280 } });
    await setManualChainProtection(db.env, true);
    expect((await readChainWatchState(db.env))!.scheduled_alarm_stage).toBe("warning_60");
    vi.mocked(fetchTrackedTornJson).mockClear().mockResolvedValue({ chain: { current: 151, timeout: 250 } });
    advance(start + 290);
    await handleChainWatchAlarm(db.env, HOME_FACTION_ID);
    expect(fetchTrackedTornJson).toHaveBeenCalledTimes(1);
    expect(await readChainWatchState(db.env)).toMatchObject({ current_chain: 151, timeout_at: start + 540,
      scheduled_alarm_stage: "warning_60", scheduled_alarm_at: start + 480 });
  });

  it("still updates the status card when arming the alarm fails, and reports the failure", async () => {
    await watch();
    await hit(1, start - 20);
    alarm.syncFaction.mockRejectedValueOnce(new Error("RPC unavailable"));
    await expect(tick()).rejects.toThrow("RPC unavailable");
    const call = vi.mocked(upsertDiscordAlertMessage).mock.calls.find(([, key]) => key === "chain_watch")!;
    expect(call[5]).toMatchObject({ nonce: expect.any(String) });
    expect((await readChainWatchState(db.env))!.discord_message_id).toBe("message");
  });

  it("arms the warning alarm before a hung status edit on the minute cron", async () => {
    await watch();
    await hit(1, start - 20);
    const reached = gate(), release = gate();
    vi.mocked(upsertDiscordAlertMessage).mockImplementationOnce(async () => {
      reached.resolve();
      await release.promise;
      return "message";
    });
    const cron = tick();
    await reached.promise;
    expect((await readChainWatchState(db.env))!.scheduled_alarm_stage).toBe("warning_60");
    expect(alarm.syncFaction).toHaveBeenCalled();
    release.resolve();
    await cron;
  });
});

describe("independent faction chain monitor", () => {
  it("defaults manual protection off, and starts and stops it without a war or watch", async () => {
    expect(await readChainWatchDemand(db.env)).toMatchObject({ active: false, manual_enabled: false });
    await hit(1, start - 20, { chain: 1512 }); advance(start);
    await setManualChainProtection(db.env, true);
    expect(await readChainWatchDemand(db.env)).toEqual({ active: true, manual_enabled: true, watch_id: null, war_id: null });
    expect(await readChainWatchState(db.env)).toMatchObject({ enabled: 1, current_chain: 1512, scheduled_alarm_at: start + 220 });
    await tick(start + 1);
    expect((await readChainWatchDemand(db.env)).manual_enabled).toBe(true);
    await setManualChainProtection(db.env, false);
    expect(await readChainWatchState(db.env)).toMatchObject({ enabled: 0, scheduled_alarm_at: null });
  });

  it.each(["war", "event", "watch"])("turning manual protection off preserves %s protection", async source => {
    if (source === "watch") await watch();
    else {
      await war();
      if (source === "event") {
        db.sqlite.exec("UPDATE wars SET war_type = 'event'; UPDATE sync_state SET active_war_id = NULL, war_state = 'none'");
      }
    }
    await hit(1, start - 20); advance(start);
    await setManualChainProtection(db.env, true);
    await setManualChainProtection(db.env, false);
    expect(await readChainWatchDemand(db.env)).toMatchObject({ active: true, manual_enabled: false });
    expect(await readChainWatchState(db.env)).toMatchObject({ enabled: 1, scheduled_alarm_at: start + 220 });
  });

  it("retains manual protection when the war and schedule end", async () => {
    await watch(start + 3600); await war(); await hit(1, start - 20); advance(start);
    await setManualChainProtection(db.env, true);
    await setChainWatchEnabledForWar(db.env, 1, false);
    await hit(2, start + 3590); await tick(start + 3600);
    expect(await readChainWatchDemand(db.env)).toEqual({ active: true, manual_enabled: true, watch_id: null, war_id: null });
    expect(await readChainWatchState(db.env)).toMatchObject({ enabled: 1, last_hit_id: 2 });
  });

  it("waits for a new chain and retains the existing warning threshold with manual protection", async () => {
    advance(start); await setManualChainProtection(db.env, true);
    expect(await readChainWatchState(db.env)).toMatchObject({ enabled: 1, current_chain: 0, scheduled_alarm_at: null });
    await hit(1, start + 10, { chain: 100 }); await tick(start + 10);
    expect((await readChainWatchState(db.env))?.scheduled_alarm_stage).not.toBe("warning_60");
    await hit(2, start + 20, { chain: 101 }); await tick(start + 20);
    vi.mocked(fetchTrackedTornJson).mockResolvedValue({ chain: { current: 101, timeout: 60 } });
    advance(start + 260); await handleChainWatchAlarm(db.env, HOME_FACTION_ID);
    expect((await readChainWatchState(db.env))?.warning_60_sent_at).toBe(start + 260);
    vi.mocked(fetchTrackedTornJson).mockResolvedValue({ chain: { current: 0, timeout: 0 } });
    advance(start + 320); await handleChainWatchAlarm(db.env, HOME_FACTION_ID);
    await hit(3, start + 330, { chain: 1 }); await tick(start + 330);
    expect(await readChainWatchState(db.env)).toMatchObject({ enabled: 1, current_chain: 1, drop_sent_at: null });
    expect((await readChainWatchDemand(db.env)).manual_enabled).toBe(true);
  });

  it("starts exactly at the watch start with no war, using the existing attack feed", async () => {
    await watch();
    await hit(1, start - 20);
    await tick(start - 1);
    expect(await readChainWatchState(db.env)).toMatchObject({ enabled: 0, current_chain: null, scheduled_alarm_at: null });
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
    expect(await readChainWatchDemand(db.env)).toEqual({ active: true, manual_enabled: false, watch_id: null, war_id: 1 });
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

  it("uses the highest chain count when attacks finish in the same second", async () => {
    await hit(1, start, { chain: 9132 });
    await hit(2, start, { chain: 9131 });
    expect(await readLatestQualifyingChainHit(db.env, start)).toMatchObject({ id: 1, chain: 9132 });
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
    expect(await readChainWatchDemand(db.env)).toEqual({ active: true, manual_enabled: false, watch_id: null, war_id: 2 });
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
    vi.mocked(upsertDiscordAlertMessage).mockImplementation(async (_env, alertKey, _id, message) => {
      if (alertKey === key || (key === "chain_watch_drop" && message.includes("DROPPED"))) throw new Error("Discord HTTP 503");
      return "message";
    });
    advance(start + offset);
    await expect(handleChainWatchAlarm(db.env, HOME_FACTION_ID)).rejects.toThrow("Discord HTTP 503");
    expect(await readChainWatchState(db.env)).toMatchObject({
      [column]: null, scheduled_alarm_stage: stage, last_error: "Discord HTTP 503", discord_message_id: "message",
    });

    vi.mocked(upsertDiscordAlertMessage).mockResolvedValue("recovered-message");
    vi.mocked(fetchTrackedTornJson).mockResolvedValue({ chain: { current: remaining ? 150 : 0, timeout: Math.max(0, remaining - 1) } });
    advance(start + offset + 1);
    await handleChainWatchAlarm(db.env, HOME_FACTION_ID);
    expect(await readChainWatchState(db.env)).toMatchObject({ [column]: start + offset + 1, last_error: null });
  });

  it("backs off a failed drop confirmation instead of re-firing at once, then drops after Torn recovers", async () => {
    await watch(); await hit(1, start); await tick();
    for (const [offset, remaining] of [[240, 60], [270, 30]]) {
      vi.mocked(fetchTrackedTornJson).mockResolvedValue({ chain: { current: 150, timeout: remaining } });
      advance(start + offset); await handleChainWatchAlarm(db.env, HOME_FACTION_ID);
    }
    vi.mocked(fetchTrackedTornJson).mockRejectedValue(new Error("Torn unavailable"));
    advance(start + 300); await handleChainWatchAlarm(db.env, HOME_FACTION_ID);
    expect(await readChainWatchState(db.env)).toMatchObject({
      scheduled_alarm_stage: "drop", scheduled_alarm_at: start + 300 + CHAIN_WATCH_DROP_RETRY_SECONDS,
      last_error: "Torn unavailable", drop_sent_at: null, discord_message_id: "message",
    });

    vi.mocked(fetchTrackedTornJson).mockResolvedValue({ chain: { current: 0, timeout: 0 } });
    advance(start + 300 + CHAIN_WATCH_DROP_RETRY_SECONDS); await handleChainWatchAlarm(db.env, HOME_FACTION_ID);
    expect(await readChainWatchState(db.env)).toMatchObject({
      source: "dropped", drop_sent_at: start + 300 + CHAIN_WATCH_DROP_RETRY_SECONDS,
      last_error: null, discord_message_id: null, scheduled_alarm_stage: null,
    });
    expect(vi.mocked(upsertDiscordAlertMessage).mock.calls.at(-1)![3]).toContain("Chain Watch DROPPED\nChain 150");
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
    { source: "stored", firstCommit: "older" }, { source: "stored", firstCommit: "newer" },
    { source: "cron", firstCommit: "older" }, { source: "cron", firstCommit: "newer" },
  ])("keeps the newest hit when $source refreshes overlap and $firstCommit commits first", async ({ source, firstCommit }) => {
    await watch(); await hit(1, start); await tick();
    const olderReached = gate(), newerReached = gate(), releaseOlder = gate(), releaseNewer = gate();
    const saveTimes: unknown[] = [];
    beforeObservationSave(async values => {
      saveTimes.push(values[10]);
      if (saveTimes.length === 1) { olderReached.resolve(); await releaseOlder.promise; }
      else if (saveTimes.length === 2) { newerReached.resolve(); await releaseNewer.promise; }
    });
    const refresh = source === "stored" ? refreshActiveChainWatchFromStoredAttacks : refreshChainWatch;
    await hit(2, start + 10, { chain: 151 }); advance(start + 11);
    const older = refresh(db.env, start + 11);
    await olderReached.promise;
    await hit(3, start + 20, { chain: 152 }); advance(start + 21);
    const newer = refresh(db.env, start + 21);
    await newerReached.promise;
    try {
      if (firstCommit === "older") {
        releaseOlder.resolve(); await older;
        releaseNewer.resolve(); await newer;
      } else {
        releaseNewer.resolve(); await newer;
        releaseOlder.resolve(); await older;
      }
    } finally { releaseOlder.resolve(); releaseNewer.resolve(); }
    expect(saveTimes).toEqual([start + 11, start + 21, start + 21]);
    expect(await readChainWatchState(db.env)).toMatchObject({
      current_chain: 152, last_hit_id: 3, last_checked_at: start + 21,
      timeout_at: start + 320, scheduled_alarm_stage: "warning_60", scheduled_alarm_at: start + 260,
    });
    expect(fetchTrackedTornJson).not.toHaveBeenCalled();
  });

  it("fetches a fresh live observation after a conflicting save", async () => {
    await watch(); await hit(1, start); await tick();
    vi.mocked(fetchTrackedTornJson).mockImplementationOnce(async () => {
      advance(start + 301);
      await refreshChainWatch(db.env, start + 301);
      return { chain: { current: 149, timeout: 10 } };
    }).mockResolvedValueOnce({ chain: { current: 151, timeout: 250 } })
      .mockResolvedValueOnce({ chain: { current: 152, timeout: 280 } });
    await tick(start + 300);
    expect(fetchTrackedTornJson).toHaveBeenCalledTimes(3);
    expect(await readChainWatchState(db.env)).toMatchObject({
      current_chain: 152, last_checked_at: start + 301, timeout_at: start + 581, scheduled_alarm_at: start + 521,
    });
  });

  it.each([false, true])("discards an in-flight observation when the monitor stops (restart: %s)", async restart => {
    await war(); await hit(1, start); await tick();
    vi.mocked(fetchTrackedTornJson).mockImplementationOnce(async () => {
      await setChainWatchEnabledForWar(db.env, 1, false);
      if (restart) await setChainWatchEnabledForWar(db.env, 1, true);
      return { chain: { current: 149, timeout: 10 } };
    }).mockResolvedValueOnce({ chain: { current: 152, timeout: 280 } });
    await tick(start + 300);
    expect(fetchTrackedTornJson).toHaveBeenCalledTimes(restart ? 2 : 1);
    expect(await readChainWatchState(db.env)).toMatchObject(restart ? {
      enabled: 1, current_chain: 152, timeout_at: start + 580, scheduled_alarm_at: start + 520,
    } : { enabled: 0, current_chain: 150, scheduled_alarm_at: null });
  });

  it.each(["stored", "cron", "warning"])("stops after three conflicting %s save attempts", async source => {
    await watch(); await hit(1, start); await tick();
    const before = await readChainWatchState(db.env);
    let attempts = 0;
    if (source === "warning") {
      // The refresh preceding live confirmation succeeds; each live save conflicts.
      vi.mocked(fetchTrackedTornJson).mockImplementation(async () => {
        attempts++;
        await db.env.DB.prepare("UPDATE faction_chain_watch_state SET timer_version = timer_version + 1 WHERE faction_id = ?")
          .bind(HOME_FACTION_ID).run();
        return { chain: { current: 151, timeout: 30 } };
      });
      advance(start + 240);
    } else {
      beforeObservationSave(async () => {
        attempts++;
        await db.env.DB.prepare("UPDATE faction_chain_watch_state SET timer_version = timer_version + 1 WHERE faction_id = ?")
          .bind(HOME_FACTION_ID).run();
      });
      await hit(2, start + 10, { chain: 151 }); advance(start + 11);
    }
    vi.mocked(upsertDiscordAlertMessage).mockClear();
    const refresh = source === "stored" ? refreshActiveChainWatchFromStoredAttacks(db.env, start + 11)
      : source === "cron" ? refreshChainWatch(db.env, start + 11) : handleChainWatchAlarm(db.env, HOME_FACTION_ID);
    await expect(refresh).rejects.toThrow("all 3 observation attempts. Retry the refresh");
    expect(attempts).toBe(3);
    expect(await readChainWatchState(db.env)).toMatchObject({
      current_chain: before!.current_chain, timeout_at: before!.timeout_at,
      scheduled_alarm_at: before!.scheduled_alarm_at, warning_60_sent_at: null,
    });
    expect(upsertDiscordAlertMessage).not.toHaveBeenCalled();
  });

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
    vi.mocked(upsertDiscordAlertMessage).mockImplementation(async (_env, alertKey, _id, message) => {
      if (alertKey === key || (key === "chain_watch_drop" && message.includes("DROPPED"))) {
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
    if (key === "chain_watch_drop") {
      expect(vi.mocked(upsertDiscordAlertMessage).mock.calls.at(-1)![3]).toContain("chain 151 is active");
      expect((await readChainWatchState(db.env))?.discord_message_id).toBe("message");
    }
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

describe("chain watch threshold event history", () => {
  const events = () => db.sqlite.prepare("SELECT * FROM chain_watch_threshold_events ORDER BY observed_at, stage DESC").all();
  async function assign(watchId: string, at = start, memberId = 1) {
    await db.env.DB.prepare("UPDATE chain_watch_slots SET assigned_to = ?, admin_override = 1 WHERE watch_id = ? AND start_at = ?")
      .bind(memberId, watchId, at).run();
  }
  async function fire(at: number, remaining: number, chain = 150) {
    advance(at);
    vi.mocked(fetchTrackedTornJson).mockResolvedValue({ chain: { current: chain, timeout: remaining } });
    const background: Promise<void>[] = [];
    try { await handleChainWatchAlarm(db.env, HOME_FACTION_ID, task => { background.push(task); }); }
    finally { await Promise.all(background); }
  }

  function beforeThresholdWrite(beforeWrite: () => Promise<void>) {
    const prepare = db.env.DB.prepare.bind(db.env.DB);
    vi.spyOn(db.env.DB, "prepare").mockImplementation(sql => {
      const statement = prepare(sql);
      if (!sql.includes("INSERT INTO chain_watch_threshold_events")) return statement;
      const bind = statement.bind.bind(statement);
      vi.spyOn(statement, "bind").mockImplementation((...values) => {
        const bound = bind(...values);
        const run = bound.run.bind(bound);
        vi.spyOn(bound, "run").mockImplementation(async () => {
          await beforeWrite();
          return run();
        });
        return bound;
      });
      return statement;
    });
  }

  it("sends and schedules both alerts while a history write is blocked, retaining the original watcher", async () => {
    const schedule = await watch(); await assign(schedule.id); await assign(schedule.id, start + 3600, 2);
    await hit(1, start + 3330); await tick(start + 3330);
    vi.mocked(upsertDiscordAlertMessage).mockClear();
    const writing = gate(), release = gate();
    let writes = 0;
    beforeThresholdWrite(async () => {
      if (++writes !== 1) return;
      expect(vi.mocked(upsertDiscordAlertMessage).mock.calls.some(call => call[1] === "chain_watch_warning")).toBe(true);
      expect(db.sqlite.prepare("SELECT scheduled_alarm_stage FROM faction_chain_watch_state").get()?.scheduled_alarm_stage).toBe("warning_30");
      writing.resolve(); await release.promise;
    });
    const background: Promise<void>[] = [];
    advance(start + 3570);
    vi.mocked(fetchTrackedTornJson).mockResolvedValue({ chain: { current: 150, timeout: 60 } });
    let alarmFinished = false;
    const handling = handleChainWatchAlarm(db.env, HOME_FACTION_ID, task => { background.push(task); })
      .then(() => { alarmFinished = true; });
    try {
      await writing.promise;
      await vi.waitFor(() => expect(alarmFinished).toBe(true));
      expect(events()).toEqual([]);
      // The critical and its history complete before the warning history does.
      await fire(start + 3600, 30);
      expect(vi.mocked(upsertDiscordAlertMessage).mock.calls.filter(call => /chain_watch_(warning|critical)/.test(call[1]))).toHaveLength(2);
      expect((await readChainWatchState(db.env))?.scheduled_alarm_stage).toBe("drop");
      await assign(schedule.id, start, 2);
      await hit(2, start + 3601, { chain: 151 }); await tick(start + 3601);
    } finally {
      release.resolve();
      await handling; await Promise.all(background);
    }
    expect(events().map(event => [event.stage, event.slot_start_at, event.assigned_to, event.observed_at]))
      .toEqual([["warning_60", start, 1, start + 3570], ["warning_30", start + 3600, 2, start + 3600]]);
  });

  it.each([false, true])("keeps history write failures separate from alerts (persistent: %s)", async persistent => {
    const schedule = await watch(); await assign(schedule.id); await hit(1, start); await tick();
    vi.mocked(upsertDiscordAlertMessage).mockClear();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    let writes = 0;
    beforeThresholdWrite(async () => {
      writes++;
      if (persistent || writes === 1) throw new Error("History database unavailable");
    });
    await fire(start + 240, 60);
    expect(writes).toBe(persistent ? 3 : 2);
    expect(events()).toHaveLength(persistent ? 0 : 1);
    expect(vi.mocked(upsertDiscordAlertMessage).mock.calls.filter(call => call[1] === "chain_watch_warning")).toHaveLength(1);
    expect(await readChainWatchState(db.env)).toMatchObject({ last_error: null, warning_60_sent_at: start + 240, scheduled_alarm_stage: "warning_30" });
    if (persistent) expect(warning).toHaveBeenCalledWith("Chain Watch threshold recording failed after 3 attempts");
  });

  it("records two warnings and one critical as three immutable events for the assigned watcher", async () => {
    const schedule = await watch(); await assign(schedule.id); await hit(1, start); await tick();
    await fire(start + 240, 60);
    await fire(start + 270, 30);
    await hit(2, start + 280, { chain: 151 }); await tick(start + 280);
    await fire(start + 520, 60, 151);
    const recorded = events();
    expect(recorded).toHaveLength(3);
    expect(recorded.map(event => event.stage)).toEqual(["warning_60", "warning_30", "warning_60"]);
    expect(recorded.map(event => event.reset_at)).toEqual([start, start, start + 280]);
    expect(recorded[0]).toMatchObject({ faction_id: HOME_FACTION_ID, watch_id: schedule.id,
      slot_start_at: start, assigned_to: 1, assignment_revision: expect.any(Number),
      observed_at: start + 240, timeout_at: start + 300, chain_length: 150 });
    expect(recorded.every(event => event.assigned_to === 1)).toBe(true);
    await assign(schedule.id, start, 2);
    await tick(start + 521);
    expect(events()).toEqual(recorded);
  });

  it("records both levels despite failed warning delivery, without counting retries again", async () => {
    const schedule = await watch(); await assign(schedule.id); await hit(1, start); await tick();
    vi.mocked(upsertDiscordAlertMessage).mockRejectedValue(new Error("Discord HTTP 403"));
    await expect(fire(start + 240, 60)).rejects.toThrow("403");
    expect(events()).toHaveLength(1);
    await expect(fire(start + 241, 59)).rejects.toThrow("403");
    await expect(fire(start + 270, 30)).rejects.toThrow("403");
    const recorded = events();
    expect(recorded.map(event => event.stage)).toEqual(["warning_60", "warning_30"]);
    expect(recorded.map(event => event.observed_at)).toEqual([start + 240, start + 270]);
    vi.mocked(upsertDiscordAlertMessage).mockResolvedValue("recovered");
    await fire(start + 271, 29);
    await fire(start + 272, 28);
    expect(events()).toEqual(recorded);
  });

  it.each(["muted", "unrouted"])("records events when Discord is %s", async reason => {
    const schedule = await watch(); await assign(schedule.id); await hit(1, start); await tick();
    if (reason === "muted") vi.mocked(isDiscordAlertEnabled).mockResolvedValue(false);
    else vi.mocked(upsertDiscordAlertMessage).mockResolvedValue(null);
    await fire(start + 240, 60);
    await fire(start + 270, 30);
    expect(events().map(event => event.stage)).toEqual(["warning_60", "warning_30"]);
    expect(events().every(event => event.assigned_to === 1)).toBe(true);
  });

  it("attributes a warning and critical on opposite sides of a handover to their respective watchers", async () => {
    const schedule = await watch(); await assign(schedule.id); await assign(schedule.id, start + 3600, 2);
    await hit(1, start + 3330); await tick(start + 3330);
    await fire(start + 3570, 60);
    await fire(start + 3600, 30);
    expect(events().map(event => [event.stage, event.slot_start_at, event.assigned_to]))
      .toEqual([["warning_60", start, 1], ["warning_30", start + 3600, 2]]);
  });

  it("records both reached levels on a late first confirmation", async () => {
    const schedule = await watch(); await assign(schedule.id); await hit(1, start); await tick();
    await fire(start + 280, 20);
    expect(events().map(event => [event.stage, event.observed_at]))
      .toEqual([["warning_60", start + 280], ["warning_30", start + 280]]);
  });

  it("does not duplicate events when alarm invocations overlap", async () => {
    const schedule = await watch(); await assign(schedule.id); await hit(1, start); await tick();
    await Promise.all([fire(start + 240, 60), fire(start + 240, 60)]);
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({ stage: "warning_60", assigned_to: 1 });
  });

  it.each(["unassigned", "cancelled", "unlinked", "no watch"])("keeps truthful attribution with %s", async reason => {
    let watchId: string | null = null;
    if (reason === "no watch") await war();
    else {
      watchId = (await watch()).id;
      if (reason !== "unassigned") await assign(watchId);
      if (reason === "cancelled") db.sqlite.exec("UPDATE chain_watch_slots SET cancelled = 1");
      if (reason === "unlinked") db.sqlite.exec("DELETE FROM discord_member_links");
    }
    await hit(1, start); await tick(); await fire(start + 240, 60);
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({
      watch_id: reason === "cancelled" ? null : watchId,
      slot_start_at: reason === "cancelled" || reason === "no watch" ? null : start,
      assigned_to: reason === "unlinked" ? 1 : null,
    });
  });

  it.each(["failed", "missing timeout"])("does not record a threshold from a %s live confirmation", async reason => {
    const schedule = await watch(); await assign(schedule.id); await hit(1, start); await tick();
    if (reason === "failed") vi.mocked(fetchTrackedTornJson).mockRejectedValue(new Error("Torn unavailable"));
    else vi.mocked(fetchTrackedTornJson).mockResolvedValue({ chain: { current: 150 } });
    const background: Promise<void>[] = [];
    advance(start + 240);
    await handleChainWatchAlarm(db.env, HOME_FACTION_ID, task => { background.push(task); });
    await Promise.all(background);
    expect(events()).toEqual([]);
  });

  it.each([{ remaining: 0, chain: 0 }, { remaining: 300, chain: 151 }, { remaining: 60, chain: 100 }])(
    "does not invent events for a dropped, saved or ineligible chain ($chain/$remaining)", async ({ remaining, chain }) => {
      const schedule = await watch(); await assign(schedule.id); await hit(1, start); await tick();
      await fire(start + 240, remaining, chain);
      expect(events()).toEqual([]);
    },
  );
});

describe("per-chain persistent status messages", () => {
  it.each([
    { source: "cron", timeout: 22 }, { source: "alarm", timeout: 22 },
    { source: "cron", timeout: 0 }, { source: "alarm", timeout: 0 },
  ])("ignores the incident's backwards live count during a $source refresh (timeout $timeout)", async ({ source, timeout }) => {
    await watch();
    vi.mocked(fetchTrackedTornJson).mockResolvedValue({ chain: { current: 9114, timeout: 35 } });
    await tick(start + 265);
    const before = (await readChainWatchState(db.env))!;
    vi.mocked(upsertDiscordAlertMessage).mockClear();
    vi.mocked(fetchTrackedTornJson).mockResolvedValue({ chain: { current: 9113, timeout } });
    advance(start + 274);
    if (source === "cron") await tick(start + 274);
    else await handleChainWatchAlarm(db.env, HOME_FACTION_ID);
    expect(await readChainWatchState(db.env)).toMatchObject({
      current_chain: 9114, timeout_at: start + 300, timer_version: before.timer_version,
      discord_message_id: before.discord_message_id, drop_sent_at: null, source: "stale",
      // A backwards count delays nothing: the next warning stage stays due now.
      scheduled_alarm_at: start + 274,
    });
    // The alarm still warns from the known 9114 timer; nothing is dropped or restarted.
    const calls = vi.mocked(upsertDiscordAlertMessage).mock.calls;
    expect(calls.map(call => call[1])).toEqual(source === "alarm" ? ["chain_watch_warning"] : []);
    if (source === "alarm") expect(calls[0][3]).toContain("Chain 9114");
    // Threshold history is only recorded from a successful confirmation.
    expect(db.sqlite.prepare("SELECT * FROM chain_watch_threshold_events").all()).toEqual([]);
  });

  it.each(["cron", "stored"])("preserves a newer live timer across repeated delayed %s observations", async source => {
    await watch();
    vi.mocked(fetchTrackedTornJson).mockResolvedValue({ chain: { current: 9114, timeout: 300 } });
    await tick();
    const before = (await readChainWatchState(db.env))!;
    await hit(1, start - 20, { chain: 9113 });
    vi.mocked(upsertDiscordAlertMessage).mockClear();
    for (const offset of [1, 2, 3]) {
      advance(start + offset);
      if (source === "cron") await tick(start + offset);
      else await refreshActiveChainWatchFromStoredAttacks(db.env, start + offset);
    }
    expect(await readChainWatchState(db.env)).toMatchObject({
      current_chain: 9114, timeout_at: start + 300, timer_version: before.timer_version,
      discord_message_id: before.discord_message_id, drop_sent_at: null,
    });
    expect(upsertDiscordAlertMessage).not.toHaveBeenCalled();
    // A current observation can still advance this chain normally.
    await hit(2, start + 4, { chain: 9115 }); await tick(start + 4);
    expect(await readChainWatchState(db.env)).toMatchObject({
      current_chain: 9115, timeout_at: start + 304, discord_message_id: before.discord_message_id, last_error: null,
    });
  });

  it("does not treat an old lower count as a restart just because the previous deadline has passed", async () => {
    await watch();
    vi.mocked(fetchTrackedTornJson).mockResolvedValue({ chain: { current: 9114, timeout: 35 } });
    await tick(start + 265);
    vi.mocked(upsertDiscordAlertMessage).mockClear();
    vi.mocked(fetchTrackedTornJson).mockResolvedValue({ chain: { current: 9113, timeout: 10 } });
    await tick(start + 310);
    expect(await readChainWatchState(db.env)).toMatchObject({
      current_chain: 9114, timeout_at: start + 300, discord_message_id: "message", drop_sent_at: null,
      source: "stale", last_error: expect.any(String),
    });
    expect(upsertDiscordAlertMessage).not.toHaveBeenCalled();
  });

  it("warns from the known timer when live confirmation regresses, without recording history", async () => {
    await watch(); await hit(1, start, { chain: 9114 }); await tick();
    advance(start + 240);
    vi.mocked(fetchTrackedTornJson).mockResolvedValue({ chain: { current: 9113, timeout: 50 } });
    vi.mocked(upsertDiscordAlertMessage).mockClear();
    await handleChainWatchAlarm(db.env, HOME_FACTION_ID);
    const calls = vi.mocked(upsertDiscordAlertMessage).mock.calls;
    expect(calls.map(call => call[1])).toEqual(["chain_watch_warning"]);
    expect(calls[0][3]).toContain("Chain 9114");
    expect(await readChainWatchState(db.env)).toMatchObject({
      current_chain: 9114, timeout_at: start + 300, warning_60_sent_at: start + 240, last_error: null,
      scheduled_alarm_stage: "warning_30", scheduled_alarm_at: start + 270, discord_message_id: "message",
    });
    expect(db.sqlite.prepare("SELECT * FROM chain_watch_threshold_events").all()).toEqual([]);
    expect(calls.some(call => call[3].includes("DROPPED"))).toBe(false);
  });

  it("sends both warnings through a Torn outage but waits for confirmation before a drop", async () => {
    await watch(); await hit(1, start); await tick();
    vi.mocked(upsertDiscordAlertMessage).mockClear();
    vi.mocked(fetchTrackedTornJson).mockRejectedValue(new Error("Torn unavailable"));
    for (const offset of [240, 270, 300]) { advance(start + offset); await handleChainWatchAlarm(db.env, HOME_FACTION_ID); }
    expect(vi.mocked(upsertDiscordAlertMessage).mock.calls.map(call => call[1]).filter(key => key !== "chain_watch"))
      .toEqual(["chain_watch_warning", "chain_watch_critical"]);
    expect(vi.mocked(upsertDiscordAlertMessage).mock.calls.some(call => call[3].includes("DROPPED"))).toBe(false);
    expect(await readChainWatchState(db.env)).toMatchObject({
      warning_60_sent_at: start + 240, warning_30_sent_at: start + 270, drop_sent_at: null,
      scheduled_alarm_stage: "drop", scheduled_alarm_at: start + 300 + CHAIN_WATCH_DROP_RETRY_SECONDS,
    });
    vi.mocked(fetchTrackedTornJson).mockResolvedValue({ chain: { current: 0, timeout: 0 } });
    advance(start + 315); await handleChainWatchAlarm(db.env, HOME_FACTION_ID);
    expect(vi.mocked(upsertDiscordAlertMessage).mock.calls.at(-1)![3]).toContain("Chain Watch DROPPED");
    expect(await readChainWatchState(db.env)).toMatchObject({ drop_sent_at: start + 315 });
  });

  it.each([
    ["saved (timer moved later)", { current: 151, timeout: 300 }],
    ["ended", { current: 0, timeout: 0 }],
  ])("still cancels a warning when Torn shows the chain %s", async (_reason, chain) => {
    await watch(); await hit(1, start); await tick();
    vi.mocked(upsertDiscordAlertMessage).mockClear();
    vi.mocked(fetchTrackedTornJson).mockResolvedValue({ chain });
    advance(start + 240); await handleChainWatchAlarm(db.env, HOME_FACTION_ID);
    expect(vi.mocked(upsertDiscordAlertMessage).mock.calls.map(call => call[1])).not.toContain("chain_watch_warning");
    expect((await readChainWatchState(db.env))?.warning_60_sent_at).toBeNull();
  });

  it.each([{}, { chain: {} }, { chain: { current: "invalid", timeout: 0 } }, { chain: { current: 9114 } },
    { chain: { current: 9114, timeout: false } }, { chain: { current: 9114, timeout: -1 } }])(
    "does not confirm a drop from an incomplete live response %j", async response => {
      await watch(); await hit(1, start, { chain: 9114 }); await tick();
      vi.mocked(upsertDiscordAlertMessage).mockClear();
      vi.mocked(fetchTrackedTornJson).mockResolvedValue(response);
      await tick(start + 300);
      expect(await readChainWatchState(db.env)).toMatchObject({
        current_chain: 9114, discord_message_id: "message", drop_sent_at: null, source: "stale", last_error: expect.any(String),
      });
      expect(upsertDiscordAlertMessage).not.toHaveBeenCalled();
    },
  );

  it("keeps live-only chain details when Torn fails and finalizes them after confirmation recovers", async () => {
    await watch();
    vi.mocked(fetchTrackedTornJson).mockResolvedValueOnce({ chain: { current: 150, timeout: 300 } });
    await tick();
    vi.mocked(upsertDiscordAlertMessage).mockClear();
    vi.mocked(fetchTrackedTornJson).mockRejectedValueOnce(new Error("Torn unavailable"));
    await tick(start + 300);
    expect(await readChainWatchState(db.env)).toMatchObject({
      discord_message_id: "message", current_chain: 150, timeout_at: start + 300, drop_sent_at: null,
    });
    expect(upsertDiscordAlertMessage).not.toHaveBeenCalled();
    await tick(start + 301);
    expect(vi.mocked(upsertDiscordAlertMessage).mock.calls.at(-1)![3]).toContain("Chain Watch DROPPED\nChain 150");
    expect((await readChainWatchState(db.env))?.discord_message_id).toBeNull();
  });

  it("does not edit a newer chain as dropped when an older observation finds a lower hit count", async () => {
    await watch(); await hit(1, start, { chain: 150 }); await tick();
    await hit(2, start + 20, { chain: 151 }); await tick(start + 20);
    vi.mocked(upsertDiscordAlertMessage).mockClear();
    await refreshChainWatch(db.env, start + 10);
    expect(vi.mocked(upsertDiscordAlertMessage).mock.calls.some(call => call[3].includes("DROPPED"))).toBe(false);
    expect(await readChainWatchState(db.env)).toMatchObject({ discord_message_id: "message", current_chain: 151, drop_sent_at: null });
  });

  it.each(["cron", "warning", "replacement"])("retains the old ID and chain details after a failed %s drop edit", async source => {
    await watch(); await hit(1, start, { chain: 500 }); await tick();
    if (source === "replacement") await hit(2, start + 310, { chain: 101 });
    const at = start + (source === "warning" ? 240 : 310);
    advance(at);
    vi.mocked(upsertDiscordAlertMessage).mockClear().mockRejectedValueOnce(new Error("Discord HTTP 503"));
    const refresh = () => source === "warning" ? handleChainWatchAlarm(db.env, HOME_FACTION_ID)
      : source === "replacement" ? refreshActiveChainWatchFromStoredAttacks(db.env, at) : refreshChainWatch(db.env, at);
    await expect(refresh()).rejects.toThrow("Discord HTTP 503");
    expect(await readChainWatchState(db.env)).toMatchObject({
      discord_message_id: "message", current_chain: 500, last_hit_id: 1, drop_sent_at: null,
    });
    expect(upsertDiscordAlertMessage).toHaveBeenCalledTimes(1);

    // Even if the next chain has already started, finish the old message first.
    await hit(3, at + 1, { chain: 102 }); advance(at + 1);
    vi.mocked(upsertDiscordAlertMessage).mockImplementation(async (_env, _key, id) => id ?? "next-chain");
    await refreshActiveChainWatchFromStoredAttacks(db.env, at + 1);
    const calls = vi.mocked(upsertDiscordAlertMessage).mock.calls;
    expect(calls.map(call => call[2])).toEqual(["message", "message", null]);
    expect(calls[1][3]).toContain("Chain Watch DROPPED\nChain 500\nLast hit: Alice v Target");
    expect(calls[2][3]).toContain("chain 102 is active");
    expect(await readChainWatchState(db.env)).toMatchObject({ discord_message_id: "next-chain", current_chain: 102, drop_sent_at: null });
  });

  it("keeps the message ID while the drop edit is in flight and clears it only after success", async () => {
    await watch(); await hit(1, start); await tick();
    const reached = gate(), release = gate();
    vi.mocked(upsertDiscordAlertMessage).mockImplementationOnce(async () => {
      reached.resolve(); await release.promise; return "message";
    });
    const dropping = tick(start + 300);
    await reached.promise;
    try {
      expect(await readChainWatchState(db.env)).toMatchObject({ discord_message_id: "message", drop_sent_at: null });
    } finally { release.resolve(); }
    await dropping;
    expect(await readChainWatchState(db.env)).toMatchObject({ discord_message_id: null, drop_sent_at: start + 300 });
  });

  it("retains the message when its route is unavailable and retries after the route returns", async () => {
    await watch(); await hit(1, start); await tick();
    vi.mocked(upsertDiscordAlertMessage).mockResolvedValueOnce(null);
    await expect(tick(start + 300)).rejects.toThrow("no status message route");
    expect(await readChainWatchState(db.env)).toMatchObject({ discord_message_id: "message", drop_sent_at: null });
    await tick(start + 301);
    expect(await readChainWatchState(db.env)).toMatchObject({ discord_message_id: null, drop_sent_at: start + 301 });
  });

  it("waits for eligibility, reuses the message within a chain, and sends a new one after a drop", async () => {
    await watch(); await tick();
    await hit(1, start + 10, { chain: 100 }); await tick(start + 10);
    expect(upsertDiscordAlertMessage).not.toHaveBeenCalled();

    vi.mocked(upsertDiscordAlertMessage).mockImplementation(async (_env, _key, existingId) => existingId ?? "first-chain");
    await hit(2, start + 20, { chain: 101 }); await tick(start + 20);
    await hit(3, start + 30, { chain: 102 }); await tick(start + 30);
    expect(vi.mocked(upsertDiscordAlertMessage).mock.calls.map(call => call[2])).toEqual([null, "first-chain"]);

    // A cron can observe the drop even if no warning alarm was delivered.
    await tick(start + 330);
    expect((await readChainWatchState(db.env))?.discord_message_id).toBeNull();
    expect(vi.mocked(upsertDiscordAlertMessage).mock.calls.at(-1)!.slice(1, 4)).toEqual([
      "chain_watch", "first-chain", expect.stringContaining("Chain Watch DROPPED\nChain 102"),
    ]);
    await tick(start + 340);
    await hit(4, start + 350, { chain: 1 }); await tick(start + 350);
    expect(upsertDiscordAlertMessage).toHaveBeenCalledTimes(3);

    vi.mocked(upsertDiscordAlertMessage).mockImplementation(async (_env, _key, existingId) => existingId ?? "second-chain");
    await hit(5, start + 360, { chain: 101 }); await tick(start + 360);
    await hit(6, start + 370, { chain: 102 }); await tick(start + 370);
    expect(vi.mocked(upsertDiscordAlertMessage).mock.calls.map(call => call[2])).toEqual([null, "first-chain", "first-chain", null, "second-chain"]);
    expect((await readChainWatchState(db.env))?.discord_message_id).toBe("second-chain");
  });

  it("updates the old message before releasing it when live warning confirmation finds a drop", async () => {
    await watch(); await hit(1, start); await tick();
    vi.mocked(upsertDiscordAlertMessage).mockClear();
    advance(start + 240); await handleChainWatchAlarm(db.env, HOME_FACTION_ID);
    expect(await readChainWatchState(db.env)).toMatchObject({ source: "dropped", discord_message_id: null });
    expect(vi.mocked(upsertDiscordAlertMessage).mock.calls.map(call => call.slice(1, 4))).toEqual([
      ["chain_watch", "message", expect.stringContaining("Chain Watch DROPPED\nChain 150")],
    ]);
  });

  it("starts a new message when a lower eligible count reveals a missed drop", async () => {
    await watch(); await hit(1, start, { chain: 500 }); await tick();
    vi.mocked(upsertDiscordAlertMessage).mockClear().mockResolvedValue("replacement-chain");
    await hit(2, start + 310, { chain: 101 }); advance(start + 310);
    await refreshActiveChainWatchFromStoredAttacks(db.env, start + 310);
    expect(vi.mocked(upsertDiscordAlertMessage).mock.calls.map(call => call[2])).toEqual(["message", null]);
    expect(vi.mocked(upsertDiscordAlertMessage).mock.calls[0][3]).toContain("Chain Watch DROPPED\nChain 500");
    expect((await readChainWatchState(db.env))?.discord_message_id).toBe("replacement-chain");
  });

  it("accepts a live replacement count when its new hit follows the previous chain's deadline", async () => {
    await watch(); await hit(1, start, { chain: 500 }); await tick();
    vi.mocked(upsertDiscordAlertMessage).mockClear().mockImplementation(async (_env, _key, id) => id ?? "replacement-chain");
    vi.mocked(fetchTrackedTornJson).mockResolvedValue({ chain: { current: 101, timeout: 300 } });
    await tick(start + 310);
    expect(vi.mocked(upsertDiscordAlertMessage).mock.calls.map(call => call[2])).toEqual(["message", null]);
    expect(await readChainWatchState(db.env)).toMatchObject({
      current_chain: 101, timeout_at: start + 610, discord_message_id: "replacement-chain", last_error: null,
    });
  });

  it("keeps the same message when a failed live check is followed by a continuing chain", async () => {
    await watch(); await hit(1, start); await tick();
    vi.mocked(upsertDiscordAlertMessage).mockClear();
    vi.mocked(fetchTrackedTornJson).mockRejectedValueOnce(new Error("Torn unavailable"));
    await tick(start + 300);
    expect((await readChainWatchState(db.env))?.discord_message_id).toBe("message");
    expect(upsertDiscordAlertMessage).not.toHaveBeenCalled();
    vi.mocked(fetchTrackedTornJson).mockResolvedValueOnce({ chain: { current: 151, timeout: 250 } });
    await tick(start + 310);
    expect(vi.mocked(upsertDiscordAlertMessage).mock.calls.map(call => call[2])).toEqual(["message"]);
  });

  it("does not restore an ID when status delivery completes after a drop", async () => {
    await watch(); await hit(1, start);
    vi.mocked(upsertDiscordAlertMessage).mockImplementationOnce(async () => {
      await tick(start + 300);
      return "late-message";
    });
    await tick();
    expect((await readChainWatchState(db.env))?.discord_message_id).toBeNull();
  });
});

describe("warning message cleanup", () => {
  async function warnings(critical = true) {
    vi.mocked(upsertDiscordAlertMessage).mockImplementation(async (_env, key, id) => id ??
      (key === "chain_watch_warning" ? "warning-1" : key === "chain_watch_critical" ? "critical-1" : "status-1"));
    await watch(); await hit(1, start, { chain: 543 }); await tick();
    vi.mocked(fetchTrackedTornJson).mockResolvedValue({ chain: { current: 543, timeout: 60 } });
    advance(start + 240); await handleChainWatchAlarm(db.env, HOME_FACTION_ID);
    if (critical) {
      vi.mocked(fetchTrackedTornJson).mockResolvedValue({ chain: { current: 543, timeout: 30 } });
      advance(start + 270); await handleChainWatchAlarm(db.env, HOME_FACTION_ID);
    }
    vi.mocked(fetchTrackedTornJson).mockResolvedValue({ chain: { current: 0, timeout: 0 } });
  }
  async function savingHit(at = start + 279) {
    await hit(2, at, { chain: 544 });
    await db.env.DB.prepare("UPDATE attacks SET attacker_name = 'M00SE' WHERE id = 2").run();
  }
  function editedSummary() {
    return vi.mocked(editWatchDiscordMessage).mock.calls.at(-1)![3];
  }

  it("removes the warning as soon as the 30-second critical is delivered, before any outcome", async () => {
    await warnings(false);
    expect(deleteWatchDiscordMessage).not.toHaveBeenCalled();
    vi.mocked(fetchTrackedTornJson).mockResolvedValue({ chain: { current: 543, timeout: 30 } });
    advance(start + 270); await handleChainWatchAlarm(db.env, HOME_FACTION_ID);
    expect(deleteWatchDiscordMessage).toHaveBeenCalledExactlyOnceWith(db.env, "chain_watch_warning-channel", "warning-1");
    expect(editWatchDiscordMessage).not.toHaveBeenCalled();
    expect(await db.env.DB.prepare("SELECT * FROM chain_watch_warning_cycles").first())
      .toMatchObject({ warning_deleted_at: start + 270, outcome_text: null, critical_message_id: "critical-1" });
  });

  it("does not edit the ordinary status card ahead of the 30-second critical check", async () => {
    await warnings(false);
    vi.mocked(upsertDiscordAlertMessage).mockClear();
    vi.mocked(fetchTrackedTornJson).mockResolvedValue({ chain: { current: 543, timeout: 30 } });
    advance(start + 270); await handleChainWatchAlarm(db.env, HOME_FACTION_ID);
    expect(vi.mocked(upsertDiscordAlertMessage).mock.calls.map(call => call[1])).toEqual(["chain_watch_critical"]);
    expect(deleteWatchDiscordMessage).toHaveBeenCalledTimes(1);
  });

  it("clears a saved warning before a slow ordinary status edit, without waiting for attack ingestion", async () => {
    await warnings(false);
    const reached = gate(), release = gate();
    vi.mocked(upsertDiscordAlertMessage).mockClear().mockImplementationOnce(async (_env, key, id) => {
      expect(key).toBe("chain_watch");
      reached.resolve(); await release.promise; return id;
    });
    // Reproduce the observed incident: saved with 43s left, 30s check at +275,
    // while the attack feed still contains only the old hit.
    vi.mocked(fetchTrackedTornJson).mockResolvedValue({ chain: { current: 544, timeout: 282 } });
    advance(start + 275);
    const pending = handleChainWatchAlarm(db.env, HOME_FACTION_ID);
    await reached.promise;
    try {
      expect(editedSummary()).toMatchObject({ components: [{ type: 10, content: "Chain saved. Waiting for the saving attack details." }] });
      expect(vi.mocked(upsertDiscordAlertMessage).mock.calls.map(call => call[1])).toEqual(["chain_watch"]);
      expect(await db.env.DB.prepare("SELECT * FROM chain_watch_warning_cycles").first())
        .toMatchObject({ critical_message_id: null, outcome_text: null, edited_message_id: "warning-1" });
    } finally { release.resolve(); }
    await pending;
    await savingHit(start + 257); await tick(start + 303);
    expect(editedSummary()).toMatchObject({ components: [{ type: 10, content: "Chain saved by M00SE with 43 seconds remaining" }] });
  });

  it("retries a failed superseded-warning deletion while the chain is still unresolved", async () => {
    vi.mocked(deleteWatchDiscordMessage).mockResolvedValue({ status: "failed", error: new Error("delete unavailable") });
    await warnings();
    expect(await db.env.DB.prepare("SELECT * FROM chain_watch_warning_cycles").first())
      .toMatchObject({ warning_deleted_at: null, outcome_text: null, last_error: "delete unavailable" });
    vi.mocked(deleteWatchDiscordMessage).mockResolvedValue({ status: "success", value: undefined });
    await tick(start + 271);
    expect(await db.env.DB.prepare("SELECT * FROM chain_watch_warning_cycles").first())
      .toMatchObject({ warning_deleted_at: start + 271, outcome_text: null, last_error: null });
  });

  it.each([false, true])("summarizes a save using the saving attack and removes only the prior warning (critical: %s)", async critical => {
    await warnings(critical);
    await savingHit();
    await hit(3, start + 290, { chain: 545 });
    // The poll sees multiple hits; Alice's later hit must not take credit.
    await tick(start + 295);
    expect(vi.mocked(editWatchDiscordMessage).mock.calls[0].slice(1, 3)).toEqual([
      critical ? "chain_watch_critical-channel" : "chain_watch_warning-channel", critical ? "critical-1" : "warning-1",
    ]);
    expect(editedSummary()).toEqual({ flags: 32768, content: null, embeds: [],
      components: [{ type: 10, content: "Chain saved by M00SE with 21 seconds remaining" }], allowed_mentions: { parse: [] } });
    if (critical) expect(deleteWatchDiscordMessage).toHaveBeenCalledWith(db.env, "chain_watch_warning-channel", "warning-1");
    else expect(deleteWatchDiscordMessage).not.toHaveBeenCalled();
    await tick(start + 296);
    expect(editWatchDiscordMessage).toHaveBeenCalledTimes(1);
    expect((await readChainWatchState(db.env))?.discord_message_id).toBe("status-1");
  });

  it.each([false, true])("summarizes a drop on the latest alert (critical: %s)", async critical => {
    await warnings(critical);
    await tick(start + 300);
    expect(editedSummary()).toMatchObject({ components: [{ type: 10, content: "Chain length 543 was dropped" }] });
    expect(vi.mocked(editWatchDiscordMessage).mock.calls[0][2]).toBe(critical ? "critical-1" : "warning-1");
    expect(deleteWatchDiscordMessage).toHaveBeenCalledTimes(critical ? 1 : 0);
    expect((await readChainWatchState(db.env))?.discord_message_id).toBeNull();
    // The separate persistent watch status still receives its own dropped edit.
    expect(vi.mocked(upsertDiscordAlertMessage).mock.calls.at(-1)![2]).toBe("status-1");
    await tick(start + 301);
    expect(editWatchDiscordMessage).toHaveBeenCalledTimes(1);
  });

  it("keeps both IDs after an edit failure, then retries the same summary after another hit", async () => {
    await warnings(); await savingHit();
    vi.mocked(editWatchDiscordMessage).mockResolvedValue({ status: "failed", error: new Error("Discord 503") });
    await tick(start + 285);
    expect(deleteWatchDiscordMessage).toHaveBeenCalledTimes(1);
    const pending = await db.env.DB.prepare("SELECT * FROM chain_watch_warning_cycles").first();
    expect(pending).toMatchObject({ warning_message_id: "warning-1", critical_message_id: "critical-1",
      outcome_text: "Chain saved by M00SE with 21 seconds remaining", edited_message_id: null, last_error: "Discord 503" });
    await hit(3, start + 290, { chain: 545 });
    vi.mocked(editWatchDiscordMessage).mockResolvedValue({ status: "success", value: undefined });
    await tick(start + 295);
    expect(editedSummary()).toMatchObject({ components: [{ type: 10, content: "Chain saved by M00SE with 21 seconds remaining" }] });
    expect(deleteWatchDiscordMessage).toHaveBeenCalledTimes(1);
    expect(await db.env.DB.prepare("SELECT * FROM chain_watch_warning_cycles").first())
      .toMatchObject({ edited_message_id: "critical-1", warning_deleted_at: start + 270, last_error: null });
  });

  it("retries deletion without repeating the successful critical edit, even after monitoring stops", async () => {
    vi.mocked(deleteWatchDiscordMessage).mockResolvedValue({ status: "failed", error: new Error("delete unavailable") });
    await warnings(); await savingHit();
    await tick(start + 280);
    expect(editWatchDiscordMessage).toHaveBeenCalledTimes(1);
    await db.env.DB.prepare("UPDATE chain_watch_schedules SET finish_at = ?").bind(start + 3600).run();
    vi.mocked(deleteWatchDiscordMessage).mockResolvedValue({ status: "success", value: undefined });
    await tick(start + 3601);
    expect(editWatchDiscordMessage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deleteWatchDiscordMessage).mock.calls.at(-1)!.slice(1)).toEqual(["chain_watch_warning-channel", "warning-1"]);
    expect(await db.env.DB.prepare("SELECT * FROM chain_watch_warning_cycles").first())
      .toMatchObject({ warning_deleted_at: start + 3601, last_error: null });
  });

  it("clears a live-confirmed saved warning immediately and fills in the first saving attack later", async () => {
    await warnings(false);
    vi.mocked(fetchTrackedTornJson).mockResolvedValue({ chain: { current: 544, timeout: 291 } });
    advance(start + 270); await handleChainWatchAlarm(db.env, HOME_FACTION_ID);
    expect(editedSummary()).toMatchObject({ components: [{ type: 10, content: "Chain saved. Waiting for the saving attack details." }] });
    expect(await db.env.DB.prepare("SELECT outcome_text FROM chain_watch_warning_cycles").first())
      .toMatchObject({ outcome_text: null });
    await hit(3, start + 280, { chain: 545 }); await tick(start + 281);
    expect(editWatchDiscordMessage).toHaveBeenCalledTimes(1);
    await savingHit(start + 261); await tick(start + 282);
    expect(editedSummary()).toMatchObject({ components: [{ type: 10, content: "Chain saved by M00SE with 39 seconds remaining" }] });
  });

  it("retries a failed final summary after the provisional saved message was already edited", async () => {
    await warnings(false);
    vi.mocked(fetchTrackedTornJson).mockResolvedValue({ chain: { current: 544, timeout: 291 } });
    advance(start + 270); await handleChainWatchAlarm(db.env, HOME_FACTION_ID);
    expect(editWatchDiscordMessage).toHaveBeenCalledTimes(1);
    await savingHit(start + 261);
    vi.mocked(editWatchDiscordMessage).mockResolvedValue({ status: "failed", error: new Error("edit unavailable") });
    await tick(start + 280);
    expect(await db.env.DB.prepare("SELECT * FROM chain_watch_warning_cycles").first())
      .toMatchObject({ outcome_text: "Chain saved by M00SE with 39 seconds remaining", edited_message_id: null });
    vi.mocked(editWatchDiscordMessage).mockResolvedValue({ status: "success", value: undefined });
    await tick(start + 281);
    expect(editWatchDiscordMessage).toHaveBeenCalledTimes(3);
    expect(editedSummary()).toMatchObject({ components: [{ type: 10, content: "Chain saved by M00SE with 39 seconds remaining" }] });
    await tick(start + 282);
    expect(editWatchDiscordMessage).toHaveBeenCalledTimes(3);
  });

  it("retries a failed provisional edit without marking the exact outcome resolved", async () => {
    await warnings(false);
    vi.mocked(editWatchDiscordMessage).mockResolvedValue({ status: "failed", error: new Error("edit unavailable") });
    vi.mocked(fetchTrackedTornJson).mockResolvedValue({ chain: { current: 544, timeout: 291 } });
    advance(start + 270); await handleChainWatchAlarm(db.env, HOME_FACTION_ID);
    expect(await db.env.DB.prepare("SELECT * FROM chain_watch_warning_cycles").first())
      .toMatchObject({ outcome_text: null, edited_message_id: null, last_error: "edit unavailable" });
    vi.mocked(editWatchDiscordMessage).mockResolvedValue({ status: "success", value: undefined });
    await tick(start + 271);
    expect(editedSummary()).toMatchObject({ components: [{ type: 10, content: "Chain saved. Waiting for the saving attack details." }] });
    expect(await db.env.DB.prepare("SELECT * FROM chain_watch_warning_cycles").first())
      .toMatchObject({ outcome_text: null, edited_message_id: "warning-1", last_error: null });
  });

  it("ignores a delayed lower hit inside the warned timer instead of declaring the warning dropped", async () => {
    await warnings(false);
    await hit(99, start + 1, { chain: 542 });
    await tick(start + 241);
    expect(editWatchDiscordMessage).not.toHaveBeenCalled();
    expect(await db.env.DB.prepare("SELECT outcome_text FROM chain_watch_warning_cycles").first())
      .toMatchObject({ outcome_text: null });
    await savingHit(start + 261); await tick(start + 262);
    expect(editedSummary()).toMatchObject({ components: [{ type: 10, content: "Chain saved by M00SE with 39 seconds remaining" }] });
  });

  it("cleans a critical sent while the saving attack is being ingested", async () => {
    await warnings(false);
    vi.mocked(upsertDiscordAlertMessage).mockImplementation(async (_env, key, id) => {
      if (key === "chain_watch_critical") {
        await savingHit(start + 271); advance(start + 271);
        await refreshActiveChainWatchFromStoredAttacks(db.env, start + 271);
        return "late-critical";
      }
      return id ?? "status-1";
    });
    vi.mocked(fetchTrackedTornJson).mockResolvedValue({ chain: { current: 543, timeout: 30 } });
    advance(start + 270); await handleChainWatchAlarm(db.env, HOME_FACTION_ID);
    await tick(start + 272);
    expect(vi.mocked(editWatchDiscordMessage).mock.calls.map(call => call[2])).toEqual(["warning-1", "late-critical"]);
    expect(editedSummary()).toMatchObject({ components: [{ type: 10, content: "Chain saved by M00SE with 29 seconds remaining" }] });
    expect(deleteWatchDiscordMessage).toHaveBeenCalledWith(db.env, "chain_watch_warning-channel", "warning-1");
  });

  it("does not let a failed old cleanup edit or delete messages from the next warning cycle", async () => {
    await warnings(); await savingHit();
    vi.mocked(editWatchDiscordMessage).mockResolvedValue({ status: "failed", error: new Error("retry later") });
    await tick(start + 280);
    vi.mocked(upsertDiscordAlertMessage).mockImplementation(async (_env, key, id) => id ??
      (key === "chain_watch_warning" ? "warning-2" : key === "chain_watch_critical" ? "critical-2" : "status-1"));
    vi.mocked(fetchTrackedTornJson).mockResolvedValue({ chain: { current: 544, timeout: 60 } });
    advance(start + 519); await handleChainWatchAlarm(db.env, HOME_FACTION_ID);
    vi.mocked(editWatchDiscordMessage).mockClear().mockResolvedValue({ status: "success", value: undefined });
    await tick(start + 520);
    expect(vi.mocked(editWatchDiscordMessage).mock.calls.map(call => call[2])).toEqual(["critical-1"]);
    expect(vi.mocked(deleteWatchDiscordMessage).mock.calls.map(call => call[2])).toEqual(["warning-1"]);
  });

  it("treats already removed messages as cleaned and does not post replacements", async () => {
    await warnings(); await savingHit();
    vi.mocked(editWatchDiscordMessage).mockResolvedValue({ status: "skipped", reason: "not_found" });
    vi.mocked(deleteWatchDiscordMessage).mockResolvedValue({ status: "skipped", reason: "not_found" });
    await tick(start + 280);
    await tick(start + 281);
    expect(editWatchDiscordMessage).toHaveBeenCalledTimes(1);
    expect(deleteWatchDiscordMessage).toHaveBeenCalledTimes(1);
  });

  it("serializes overlapping cleanup attempts for the same warning cycle", async () => {
    await warnings(); await savingHit();
    const reached = gate(), release = gate();
    vi.mocked(editWatchDiscordMessage).mockImplementationOnce(async () => {
      reached.resolve(); await release.promise; return { status: "success", value: undefined };
    });
    const first = tick(start + 280);
    await reached.promise;
    try {
      await tick(start + 281);
      expect(editWatchDiscordMessage).toHaveBeenCalledTimes(1);
      expect(deleteWatchDiscordMessage).toHaveBeenCalledTimes(1);
    } finally { release.resolve(); }
    await first;
    expect(deleteWatchDiscordMessage).toHaveBeenCalledTimes(1);
    expect(await db.env.DB.prepare("SELECT * FROM chain_watch_warning_cycles").first())
      .toMatchObject({ lease_token: null, lease_until: null, edited_message_id: "critical-1" });
  });

  it("cleans already sent alerts after toggles are muted without creating another notification", async () => {
    await warnings(); await savingHit();
    vi.mocked(upsertDiscordAlertMessage).mockClear();
    vi.mocked(isDiscordAlertEnabled).mockResolvedValue(false);
    await tick(start + 280);
    expect(upsertDiscordAlertMessage).not.toHaveBeenCalled();
    expect(editWatchDiscordMessage).toHaveBeenCalledTimes(1);
    expect(deleteWatchDiscordMessage).toHaveBeenCalledTimes(1);
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

  it("posts warnings and edits the status on drop with the watcher and subscribers", async () => {
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
      expect(call.slice(0, 3)).toEqual([db.env, remaining ? key : "chain_watch", remaining ? null : "message"]);
      expect(call[3]).toMatch(new RegExp(`<@999999> <@&888888> <@${aliceId}>$`));
      expect(call[4]).toEqual({ users: ["999999", aliceId], roles: ["888888"] });
      expect(call[5]).toEqual(remaining ? { cardColor: color } : { cardColor: color, editOnly: true, timeoutMs: 10_000 });
      expect((await readChainWatchState(db.env))?.discord_message_id).toBe(remaining ? "message" : null);
    }
    expect(configured.allowedMentions.users).toEqual(["999999"]);
    const deliveredCount = vi.mocked(upsertDiscordAlertMessage).mock.calls.length;
    await hit(2, start + 310, { chain: 1 }); await tick(start + 310);
    expect(upsertDiscordAlertMessage).toHaveBeenCalledTimes(deliveredCount);
    await hit(3, start + 320, { chain: 101 }); await tick(start + 320);
    const refreshed = vi.mocked(upsertDiscordAlertMessage).mock.calls.at(-1)!;
    expect(refreshed[2]).toBeNull();
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
      if (sql.includes("SELECT links.discord_user_id")) throw new Error("lookup unavailable");
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
    for (const key of ["chain_watch_warning", "chain_watch_critical"].filter((key) => key !== mutedKey)) {
      expect(deliveredKeys).toContain(key);
    }
    expect(vi.mocked(upsertDiscordAlertMessage).mock.calls.at(-1)!.slice(1, 4)).toEqual([
      "chain_watch", "message", expect.stringContaining("DROPPED"),
    ]);
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
