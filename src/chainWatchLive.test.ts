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

vi.mock("./external/torn", () => ({ fetchTrackedTornJson: vi.fn() }));
vi.mock("./tornKeyPool", () => ({ withTornKeyPool: (_env: unknown, options: { run: (key: unknown) => Promise<unknown> }) => options.run({ key: "test", keySource: "test" }) }));
vi.mock("./discordAlertSettings", () => ({ isDiscordAlertEnabled: vi.fn().mockResolvedValue(true) }));
vi.mock("./discordAlertDelivery", () => ({ upsertDiscordAlertMessage: vi.fn().mockResolvedValue("message") }));
vi.mock("./discordMentions", () => ({ readDiscordAlertMentions: vi.fn().mockResolvedValue({ messageSuffix: "", allowedMentions: { users: [], roles: [] } }), formatDiscordAlertMessage: (message: string) => message }));

const start = Date.UTC(2030, 0, 1, 13) / 1000;
let db: ReturnType<typeof chainWatchDatabase>;
const alarm = { scheduleFaction: vi.fn().mockResolvedValue(undefined), cancel: vi.fn().mockResolvedValue(undefined) };
const getByName = vi.fn(() => alarm);
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.clearAllMocks();
  db = chainWatchDatabase(start - 60);
  advance(start - 60);
  db.env.CHAIN_WATCH_ALARMS = { getByName } as unknown as DurableObjectNamespace;
  vi.mocked(fetchTrackedTornJson).mockResolvedValue({ chain: { current: 0, timeout: 0 } });
});
afterEach(() => { db.sqlite.close(); vi.useRealTimers(); });
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
    expect(alarm.scheduleFaction).toHaveBeenLastCalledWith(HOME_FACTION_ID, start + 220);
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
    expect(alarm.cancel).not.toHaveBeenCalled();
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
    expect(alarm.cancel).toHaveBeenCalled();
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
    expect(alarm.scheduleFaction).toHaveBeenLastCalledWith(HOME_FACTION_ID, start + 260);
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

  it("exposes read-only faction status without a war or extra Torn request", async () => {
    await watch(); await hit(1, start); await tick();
    expect(await (await getChainWatchLive(db.env)).json()).toMatchObject({ faction_id: HOME_FACTION_ID,
      state: { current_chain: 150 }, computed: { active: true, remaining_seconds: 300 }, demand: { war_id: null } });
    expect(fetchTrackedTornJson).not.toHaveBeenCalled();
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
