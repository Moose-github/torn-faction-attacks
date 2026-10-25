import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chainWatchDatabase } from "../scripts/chain-watch-test-database.mjs";
import { watchUtc } from "../shared/chainWatchSchedule";
import { handleChainWatchAlarm, readChainWatchState, refreshActiveChainWatchFromStoredAttacks, runChainWatchCron } from "./chainWatch";
import { createWatch } from "./chainWatchSchedule";
import { fetchChainWatchTargets, type ChainWatchTargetsResult } from "./chainWatchTargets";
import { deliverChainWatchWarningAlert, editWatchDiscordMessage, deleteWatchDiscordMessage } from "./chainWatchDiscordDelivery";
import { HOME_FACTION_ID } from "./constants";
import { fetchTrackedTornJson } from "./external/torn";

vi.mock("./external/torn", () => ({ fetchTrackedTornJson: vi.fn() }));
vi.mock("./tornKeyPool", () => ({ withTornKeyPool: (_env: unknown, options: { run: (key: unknown) => Promise<unknown> }) => options.run({ key: "fixture-key" }) }));
vi.mock("./chainWatchTargets", () => ({ fetchChainWatchTargets: vi.fn() }));
vi.mock("./discordMentions", async original => ({
  ...await original<typeof import("./discordMentions")>(),
  readDiscordAlertMentions: async () => ({ messageSuffix: "<@123456>", allowedMentions: { users: ["123456"] } }),
}));
vi.mock("./chainWatchDiscordDelivery", () => ({
  deliverChainWatchAlert: vi.fn().mockResolvedValue({ status: "success", value: "status-message" }),
  deliverChainWatchDroppedStatus: vi.fn().mockResolvedValue({ status: "success", value: "status-message" }),
  deliverChainWatchWarningAlert: vi.fn(),
  editWatchDiscordMessage: vi.fn(),
  deleteWatchDiscordMessage: vi.fn(),
}));

const start = Date.UTC(2030, 0, 1, 13) / 1000;
let db: ReturnType<typeof chainWatchDatabase>;
const syncFaction = vi.fn().mockResolvedValue(undefined);
const background: Promise<void>[] = [];
const targets: ChainWatchTargetsResult = { target_ids: [1234, 5678, 9012], status: "ok", pages_fetched: 2, failed_pages: 0, checked_at: start + 240 };
function advance(now: number) { db.setNow(now); vi.setSystemTime(now * 1000); }
function gate<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function hit(id: number, at: number, chain: number) {
  await db.env.DB.prepare(`INSERT INTO attacks (id, started, ended, attacker_faction_id, defender_faction_id,
    attacker_name, defender_name, result, chain) VALUES (?, ?, ?, ?, 999, 'Alice', 'Bob', 'Hospitalized', ?)`)
    .bind(id, at, at, HOME_FACTION_ID, chain).run();
}
async function fire(remaining = 60, enrich = true) {
  advance(start + 300 - remaining);
  vi.mocked(fetchTrackedTornJson).mockResolvedValue({ chain: { current: 150, timeout: remaining } });
  await handleChainWatchAlarm(db.env, HOME_FACTION_ID, enrich ? task => { background.push(task); } : undefined);
}
function hasLinks(payload: Record<string, unknown>) { return JSON.stringify(payload).includes("user2ID="); }
function linkEdits() { return vi.mocked(editWatchDiscordMessage).mock.calls.filter(call => hasLinks(call[3])); }
function finalText() { return JSON.stringify(vi.mocked(editWatchDiscordMessage).mock.calls.at(-1)?.[3]); }
async function finishBackground() { await Promise.all(background); }

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.mocked(editWatchDiscordMessage).mockReset().mockResolvedValue({ status: "success", value: undefined });
  vi.mocked(deleteWatchDiscordMessage).mockResolvedValue({ status: "success", value: undefined });
  vi.mocked(deliverChainWatchWarningAlert).mockReset().mockImplementation(async (_env, _message, _color, key) => ({
    status: "success", value: { messageId: `${key}-message`, channelId: `${key}-channel` },
  }));
  vi.mocked(fetchChainWatchTargets).mockReset().mockResolvedValue(targets);
  vi.mocked(fetchTrackedTornJson).mockReset().mockResolvedValue({ chain: { current: 0, timeout: 0 } });
  background.length = 0;
  db = chainWatchDatabase(start - 60);
  advance(start - 60);
  db.env.CHAIN_WATCH_ALARMS = { getByName: () => ({ syncFaction }) } as unknown as DurableObjectNamespace;
  await createWatch(db.env, { name: "Watch", start: watchUtc(start), guildId: "guild", channelId: "channel", discordUserId: "111" }, start - 60);
  await hit(1, start, 150);
  advance(start);
  await runChainWatchCron(db.env, start * 1000);
});
afterEach(async () => { await finishBackground(); db.sqlite.close(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("background target links", () => {
  it("delivers the alert and schedules the next alarm before starting a lookup, without awaiting it", async () => {
    const delivery = gate<Awaited<ReturnType<typeof deliverChainWatchWarningAlert>>>();
    const lookup = gate<ChainWatchTargetsResult>();
    vi.mocked(deliverChainWatchWarningAlert).mockReturnValueOnce(delivery.promise);
    vi.mocked(fetchChainWatchTargets).mockImplementation(() => {
      expect(db.sqlite.prepare("SELECT scheduled_alarm_stage FROM faction_chain_watch_state").get()?.scheduled_alarm_stage).toBe("warning_30");
      return lookup.promise;
    });
    const alarm = fire();
    await vi.waitFor(() => expect(deliverChainWatchWarningAlert).toHaveBeenCalledOnce());
    expect(fetchChainWatchTargets).not.toHaveBeenCalled();
    delivery.resolve({ status: "success", value: { messageId: "warning", channelId: "channel" } });
    await alarm;
    await vi.waitFor(() => expect(fetchChainWatchTargets).toHaveBeenCalledOnce());
    expect(background).toHaveLength(1);
    expect(editWatchDiscordMessage).not.toHaveBeenCalled();
    expect(await readChainWatchState(db.env)).toMatchObject({ warning_60_sent_at: start + 240, scheduled_alarm_at: start + 270 });
    lookup.resolve(targets);
    await finishBackground();
    expect(linkEdits()).toHaveLength(1);
  });

  it.each([60, 30])("adds up to two distinct attack buttons to the %s-second warning, preserving its card and suppressing pings", async remaining => {
    if (remaining === 30) await fire(60, false);
    vi.spyOn(Math, "random").mockReturnValue(0);
    vi.mocked(fetchChainWatchTargets).mockResolvedValue({ ...targets, target_ids: [1234, 1234, 5678, 9012] });
    await fire(remaining); await finishBackground();
    const [, channel, message, payload] = linkEdits()[0];
    const prefix = remaining === 60 ? "chain_watch_warning" : "chain_watch_critical";
    expect([channel, message]).toEqual([`${prefix}-channel`, `${prefix}-message`]);
    expect(payload).toMatchObject({ flags: 32768, content: null, embeds: [], allowed_mentions: { parse: [], users: [], roles: [] } });
    expect(payload.components).toEqual([
      { type: 17, accent_color: remaining === 60 ? 0xffa500 : 0xff0000, components: [{ type: 10, content: expect.stringContaining(`**Chain Watch ${remaining === 60 ? "WARNING" : "CRITICAL"}: ${remaining} seconds remaining**`) }] },
      { type: 10, content: "<@123456>" },
      { type: 1, components: [
        { type: 2, style: 5, label: "Attack 1234", url: "https://www.torn.com/page.php?sid=attack&user2ID=1234" },
        { type: 2, style: 5, label: "Backup 5678", url: "https://www.torn.com/page.php?sid=attack&user2ID=5678" },
      ] },
    ]);
    expect(deliverChainWatchWarningAlert).toHaveBeenCalledTimes(remaining === 60 ? 1 : 2);
  });

  it.each(["no_targets", "unavailable", "timeout"] as const)("leaves the original warning untouched when lookup returns %s", async status => {
    vi.mocked(fetchChainWatchTargets).mockResolvedValue({ ...targets, target_ids: [], status });
    await fire(); await finishBackground();
    expect(editWatchDiscordMessage).not.toHaveBeenCalled();
    expect(await readChainWatchState(db.env)).toMatchObject({ last_error: null, scheduled_alarm_stage: "warning_30" });
  });

  it("absorbs lookup exceptions without retrying the delivered alert", async () => {
    vi.mocked(fetchChainWatchTargets).mockRejectedValue(new Error("lookup failed"));
    await fire(); await finishBackground();
    expect(editWatchDiscordMessage).not.toHaveBeenCalled();
    expect(deliverChainWatchWarningAlert).toHaveBeenCalledOnce();
    expect(await readChainWatchState(db.env)).toMatchObject({ last_error: null, scheduled_alarm_stage: "warning_30" });
  });

  it.each(["deleted", "failed"])("never posts a replacement when the target edit is %s", async outcome => {
    vi.mocked(editWatchDiscordMessage).mockResolvedValue(outcome === "deleted" ? { status: "skipped", reason: "not_found" } : { status: "failed", error: new Error("Discord unavailable") });
    await fire(); await finishBackground();
    expect(editWatchDiscordMessage).toHaveBeenCalledOnce();
    expect(deliverChainWatchWarningAlert).toHaveBeenCalledOnce();
    expect(db.sqlite.prepare("SELECT lease_token FROM chain_watch_warning_cycles").get()?.lease_token).toBeNull();
    expect(await readChainWatchState(db.env)).toMatchObject({ last_error: null, scheduled_alarm_stage: "warning_30" });
  });

  it("does not launch a lookup when warning delivery is skipped", async () => {
    vi.mocked(deliverChainWatchWarningAlert).mockResolvedValue({ status: "skipped", reason: "disabled" });
    await fire();
    expect(background).toHaveLength(0);
    expect(fetchChainWatchTargets).not.toHaveBeenCalled();
  });
});

describe("late target results and cleanup", () => {
  async function waitingLookup() {
    const lookup = gate<ChainWatchTargetsResult>();
    vi.mocked(fetchChainWatchTargets).mockReturnValue(lookup.promise);
    await fire();
    await vi.waitFor(() => expect(fetchChainWatchTargets).toHaveBeenCalledOnce());
    return lookup;
  }

  it("never overwrites a saved-chain summary after a late lookup", async () => {
    const lookup = await waitingLookup();
    advance(start + 250); await hit(2, start + 250, 151);
    await refreshActiveChainWatchFromStoredAttacks(db.env, start + 250);
    expect(finalText()).toContain("Chain saved by Alice with 50 seconds remaining");
    lookup.resolve(targets); await finishBackground();
    expect(linkEdits()).toHaveLength(0);
    expect(editWatchDiscordMessage).toHaveBeenCalledOnce();
  });

  it("also notices a saving attack before the live state has been refreshed", async () => {
    const lookup = await waitingLookup();
    advance(start + 250); await hit(2, start + 250, 151);
    expect((await readChainWatchState(db.env))?.current_chain).toBe(150);
    lookup.resolve(targets); await finishBackground();
    expect(linkEdits()).toHaveLength(0);
    expect(finalText()).toContain("Chain saved by Alice with 50 seconds remaining");
  });

  it.each([
    "UPDATE faction_chain_watch_state SET timer_version = timer_version + 1",
    "UPDATE faction_chain_watch_state SET enabled = 0",
    "UPDATE faction_chain_watch_state SET source = 'dropped', current_chain = 0, last_checked_at = timeout_at",
    "UPDATE chain_watch_warning_cycles SET warning_message_id = 'replacement'",
    "UPDATE chain_watch_warning_cycles SET warning_deleted_at = 1",
  ])("discards results after the warning becomes stale (%s)", async sql => {
    const lookup = await waitingLookup();
    db.sqlite.exec(sql);
    lookup.resolve(targets); await finishBackground();
    expect(linkEdits()).toHaveLength(0);
  });

  it("does not add links after the original timer expires", async () => {
    const lookup = await waitingLookup();
    advance(start + 301);
    lookup.resolve(targets); await finishBackground();
    expect(linkEdits()).toHaveLength(0);
  });

  it("discards the 60-second results after the critical warning has been published", async () => {
    const lookup = await waitingLookup();
    await fire(30, false);
    lookup.resolve(targets); await finishBackground();
    expect(linkEdits()).toHaveLength(0);
    expect(deliverChainWatchWarningAlert).toHaveBeenCalledTimes(2);
  });

  it("does not wait for or steal a cleanup lease", async () => {
    const lookup = await waitingLookup();
    db.sqlite.prepare("UPDATE chain_watch_warning_cycles SET lease_token = 'cleanup', lease_until = ?").run(start + 299);
    lookup.resolve(targets); await finishBackground();
    expect(editWatchDiscordMessage).not.toHaveBeenCalled();
    expect(db.sqlite.prepare("SELECT lease_token FROM chain_watch_warning_cycles").get()?.lease_token).toBe("cleanup");
  });

  it("lets cleanup finish last when a saving hit arrives during the target PATCH", async () => {
    const patch = gate<Awaited<ReturnType<typeof editWatchDiscordMessage>>>();
    vi.mocked(editWatchDiscordMessage).mockImplementationOnce(() => patch.promise);
    await fire();
    await vi.waitFor(() => expect(linkEdits()).toHaveLength(1));
    expect(db.sqlite.prepare("SELECT lease_token FROM chain_watch_warning_cycles").get()?.lease_token).toBeTruthy();
    advance(start + 250); await hit(2, start + 250, 151);
    await refreshActiveChainWatchFromStoredAttacks(db.env, start + 250);
    // Cleanup yielded to the PATCH lease, so it has not written a summary yet.
    expect(editWatchDiscordMessage).toHaveBeenCalledOnce();
    patch.resolve({ status: "success", value: undefined });
    await finishBackground();
    expect(editWatchDiscordMessage).toHaveBeenCalledTimes(2);
    expect(finalText()).toContain("Chain saved by Alice with 50 seconds remaining");
    expect(finalText()).not.toContain("user2ID=");
    expect(db.sqlite.prepare("SELECT lease_token FROM chain_watch_warning_cycles").get()?.lease_token).toBeNull();
  });

  it("cleans up the critical message and removes the earlier warning after both have links", async () => {
    await fire(); await finishBackground();
    await fire(30); await finishBackground();
    expect(linkEdits()).toHaveLength(2);
    advance(start + 280); await hit(2, start + 280, 151);
    await refreshActiveChainWatchFromStoredAttacks(db.env, start + 280);
    expect(finalText()).toContain("Chain saved by Alice with 20 seconds remaining");
    expect(finalText()).not.toContain("user2ID=");
    expect(deleteWatchDiscordMessage).toHaveBeenCalledWith(db.env, "chain_watch_warning-channel", "chain_watch_warning-message");
  });
});
