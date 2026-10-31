import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { retaliationDatabase } from "../scripts/retaliation-test-database.mjs";
import { createDiscordBotMessage, editDiscordBotMessage } from "./discord";
import { isDiscordAlertEnabled } from "./discordAlertSettings";
import { readConfiguredDiscordNotificationChannel, type DiscordNotificationChannel } from "./discordNotificationChannels";
import { readDiscordAlertMentions } from "./discordMentions";
import { syncRetaliationDiscordBoard } from "./retaliations";
import { ExternalApiError } from "./external/http";
import { ingestRecentFactionAttacks } from "./ingestion";

vi.mock("./discord", () => ({ createDiscordBotMessage: vi.fn(), editDiscordBotMessage: vi.fn() }));
vi.mock("./discordAlertSettings", () => ({ isDiscordAlertEnabled: vi.fn() }));
vi.mock("./discordNotificationChannels", async importOriginal => ({
  ...await importOriginal<typeof import("./discordNotificationChannels")>(), readConfiguredDiscordNotificationChannel: vi.fn(),
}));
vi.mock("./discordMentions", async importOriginal => ({
  ...await importOriginal<typeof import("./discordMentions")>(), readDiscordAlertMentions: vi.fn(),
}));
vi.mock("./ingestion", () => ({ ingestRecentFactionAttacks: vi.fn() }));
vi.mock("./chainWatch", () => ({ refreshActiveChainWatchFromStoredAttacks: vi.fn() }));

const start = 1900000000;
let db: ReturnType<typeof retaliationDatabase>;
const schedule = vi.fn();
let now = start;
const route = (channelId = "111111"): DiscordNotificationChannel => ({
  guildId: "222222", alertKey: "retaliation_board", alertName: "Retaliation opportunities", alertDescription: "",
  channelId, threadId: null, enabled: true, updatedByDiscordId: null, updatedAt: start,
});
const state = (id: number) => db.sqlite.prepare("SELECT * FROM retaliation_discord_messages WHERE opening_attack_id = ?").get(id);
function time(seconds: number) { now = start + seconds; vi.setSystemTime(new Date(now * 1000)); db.setNow(now); }
function opening(id = 1, target = 200, at = start) {
  db.sqlite.prepare(`INSERT INTO attacks (id, attacker_id, attacker_name, attacker_faction_id, defender_id,
    defender_faction_id, result, started, ended) VALUES (?, ?, 'Enemy', 999, 1, 8803, 'Hospitalized', ?, ?)`)
    .run(id, target, at - 10, at);
}
function taken(target = 200, at = now) {
  db.sqlite.prepare(`INSERT INTO attacks (id, attacker_id, attacker_name, attacker_faction_id, defender_id,
    defender_faction_id, result, m_retaliation, ended) VALUES (10000, 1, 'Alice', 8803, ?, 999, 'Hospitalized', 2, ?)`)
    .run(target, at);
}
function pending(id = 1, expiresAt = now + 30) {
  db.sqlite.prepare(`INSERT INTO retaliation_claim_signals
    VALUES (?, 200, 1, 'dashboard', NULL, ?, ?, ?)`).run(id, now, now, expiresAt);
}
const sync = () => syncRetaliationDiscordBoard(db.env, now);
const editedStatus = (index = 0) => vi.mocked(editDiscordBotMessage).mock.calls[index][5]?.embeds?.[0]?.fields?.find(field => field.name === "Status")?.value;

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  db = retaliationDatabase(start);
  db.env.RETALIATION_BOARD_ALARMS = { getByName: () => ({ schedule }) } as unknown as typeof db.env.RETALIATION_BOARD_ALARMS;
  time(0);
  vi.mocked(isDiscordAlertEnabled).mockResolvedValue(true);
  vi.mocked(readConfiguredDiscordNotificationChannel).mockResolvedValue(route());
  vi.mocked(readDiscordAlertMentions).mockResolvedValue({ messageSuffix: "<@&333333>", allowedMentions: { roles: ["333333"] } });
  vi.mocked(createDiscordBotMessage).mockImplementation(async (...args) => `message-${args[4]?.nonce}`);
  vi.mocked(editDiscordBotMessage).mockResolvedValue(undefined);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "debug").mockImplementation(() => {});
});
afterEach(() => { db.sqlite.close(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("individual retaliation message lifecycle", () => {
  it("posts each opening once, including two from the same target and more than ten opportunities", async () => {
    for (let id = 1; id <= 55; id++) opening(id, id < 3 ? 200 : 200 + id);
    await sync();
    expect(createDiscordBotMessage).toHaveBeenCalledTimes(55);
    const first = vi.mocked(createDiscordBotMessage).mock.calls[0];
    expect(first[2]).toContain("<@&333333>");
    expect(first[4]).toMatchObject({ nonce: "retal:1", timeoutMs: 10000 });
    expect(first[4]?.embeds).toHaveLength(1);
    expect(state(1)?.discord_message_id).not.toBe(state(2)?.discord_message_id);
    time(10); await sync();
    expect(createDiscordBotMessage).toHaveBeenCalledTimes(55);
    expect(editDiscordBotMessage).not.toHaveBeenCalled();
  });

  it("edits pending/open/taken, then forgets the reference and never edits or reposts it", async () => {
    opening(); await sync();
    time(10); pending(); await sync();
    expect(editedStatus()).toBe("Attack started by Alice");
    expect(vi.mocked(editDiscordBotMessage).mock.calls[0]).toMatchObject({
      1: "111111", 2: "message-retal:1", 3: "**Retaliation opportunity**", 4: { users: [], roles: [] },
    });
    time(41); await sync();
    expect(editedStatus(1)).toBe("Open");
    time(42); taken(); await sync(); // Final status bypasses the edit cooldown.
    expect(editedStatus(2)).toBe("Taken — retaliated by Alice");
    expect(state(1)).toMatchObject({ finalized_at: now, discord_message_id: null, discord_channel_id: null, last_rendered_hash: null });
    time(52); await sync();
    expect(createDiscordBotMessage).toHaveBeenCalledTimes(1);
    expect(editDiscordBotMessage).toHaveBeenCalledTimes(3);
    time(87000); await sync();
    expect(state(1)).toBeUndefined();
  });

  it("updates an expired opportunity even after it drops out of the discovery window", async () => {
    opening(); await sync();
    time(301); const result = await sync();
    expect(editedStatus()).toBe("Timed out");
    expect(result.active).toBe(false);
    expect(state(1)?.discord_message_id).toBeNull();
    await sync(); expect(editDiscordBotMessage).toHaveBeenCalledTimes(1);
  });

  it("refreshes attacks at expiry before choosing the final status", async () => {
    opening(); await sync(); time(301);
    vi.mocked(ingestRecentFactionAttacks).mockImplementation(async () => {
      taken(200, start + 299);
      return { inserted_attacks: 1 } as Awaited<ReturnType<typeof ingestRecentFactionAttacks>>;
    });
    await syncRetaliationDiscordBoard(db.env, now, { allowActiveLightSync: true });
    expect(ingestRecentFactionAttacks).toHaveBeenCalled();
    expect(editedStatus()).toBe("Taken — retaliated by Alice");
  });

  it("does not treat a retaliation after the opening's deadline as taken", async () => {
    opening(); await sync(); time(301); taken(); await sync();
    expect(editedStatus()).toBe("Timed out");
  });

  it("sends nothing when empty or when an opportunity is already taken before discovery", async () => {
    await sync(); opening(); taken(); await sync();
    expect(createDiscordBotMessage).not.toHaveBeenCalled();
    expect(editDiscordBotMessage).not.toHaveBeenCalled();
    expect(state(1)).toBeUndefined();
  });

  it("continues updating old messages in their original channel after routing changes", async () => {
    opening(); await sync(); time(10);
    vi.mocked(readConfiguredDiscordNotificationChannel).mockResolvedValue(route("444444"));
    pending(); opening(2, 201, now); await sync();
    expect(vi.mocked(editDiscordBotMessage).mock.calls[0][1]).toBe("111111");
    expect(vi.mocked(createDiscordBotMessage).mock.calls[1][1]).toBe("444444");
  });

  it.each([429, 500])("retries a failed final edit after HTTP %s without a new message", async status => {
    opening(); await sync(); time(301);
    vi.mocked(editDiscordBotMessage).mockRejectedValueOnce(new ExternalApiError("failed", "Discord bot", status));
    expect((await sync()).active).toBe(true);
    expect(state(1)?.discord_message_id).toBe("message-retal:1");
    time(311); await sync();
    expect(state(1)?.discord_message_id).toBeNull();
    expect(createDiscordBotMessage).toHaveBeenCalledTimes(1);
    expect(editDiscordBotMessage).toHaveBeenCalledTimes(2);
  });

  it("forgets a manually deleted message without replacing it", async () => {
    opening(); await sync(); time(10); pending();
    vi.mocked(editDiscordBotMessage).mockRejectedValueOnce(new ExternalApiError("Unknown message", "Discord bot", 404));
    await sync(); time(20); await sync();
    expect(state(1)?.discord_message_id).toBeNull();
    expect(createDiscordBotMessage).toHaveBeenCalledTimes(1);
    expect(editDiscordBotMessage).toHaveBeenCalledTimes(1);
  });

  it("retries a failed creation with the same nonce and expires unsent messages quietly", async () => {
    opening(); vi.mocked(createDiscordBotMessage).mockRejectedValueOnce(new Error("timeout"));
    await sync(); time(10); await sync();
    expect(vi.mocked(createDiscordBotMessage).mock.calls.map(call => call[4]?.nonce)).toEqual(["retal:1", "retal:1"]);
    opening(2, 202, now);
    vi.mocked(createDiscordBotMessage).mockRejectedValue(new Error("timeout"));
    await sync(); time(311); await sync();
    expect(state(2)).toMatchObject({ finalized_at: now, discord_message_id: null });
    expect(createDiscordBotMessage).toHaveBeenCalledTimes(3);
  });

  it("serializes overlapping cron, alarm and claim refreshes per opportunity", async () => {
    opening();
    let finish!: (messageId: string) => void;
    let started!: () => void;
    const inFlight = new Promise<void>(resolve => { started = resolve; });
    vi.mocked(createDiscordBotMessage).mockImplementationOnce(async () => {
      started(); return new Promise<string>(resolve => { finish = resolve; });
    });
    const first = sync(); await inFlight;
    await sync(); expect(createDiscordBotMessage).toHaveBeenCalledTimes(1);
    finish("only-message"); await first;
    expect(state(1)).toMatchObject({ discord_message_id: "only-message", lease_until: 0 });
  });

  it("recovers an abandoned lease after a worker restart", async () => {
    opening();
    db.sqlite.prepare(`INSERT INTO retaliation_discord_messages
      (opening_attack_id, expires_at, lease_token, lease_until) VALUES (1, ?, 'old-worker', ?)`)
      .run(start + 300, start + 60);
    await sync(); expect(createDiscordBotMessage).not.toHaveBeenCalled();
    time(61); await sync(); expect(createDiscordBotMessage).toHaveBeenCalledTimes(1);
  });

  it("honors mute and finalizes existing messages after re-enabling", async () => {
    opening(); await sync();
    vi.mocked(isDiscordAlertEnabled).mockResolvedValue(false);
    time(301); await sync();
    expect(editDiscordBotMessage).not.toHaveBeenCalled();
    expect(state(1)?.discord_message_id).toBe("message-retal:1");
    vi.mocked(isDiscordAlertEnabled).mockResolvedValue(true);
    await sync(); expect(editedStatus()).toBe("Timed out");
  });

  it("retires the old board once without reusing it for an opportunity", async () => {
    db.sqlite.exec(`INSERT INTO retaliation_board_state (id, discord_message_id, discord_target_id)
      VALUES (1, 'legacy-message', 'bot:111111')`);
    opening(); await sync(); await sync();
    expect(editDiscordBotMessage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(editDiscordBotMessage).mock.calls[0][3]).toContain("no longer updated");
    expect(state(1)?.discord_message_id).toBe("message-retal:1");
    expect(db.sqlite.prepare("SELECT discord_message_id FROM retaliation_board_state").get()?.discord_message_id).toBeNull();
  });
});
