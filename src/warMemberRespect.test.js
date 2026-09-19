import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readAuthenticatedUserId, requireAdmin } from "./auth";
import { routeWarCommands } from "./http/warRoutes";
import { handleDiscordInteractions, handleVerifiedDiscordInteraction } from "./discordInteractions";
import { completeDeferredWarMeInteraction } from "./discordWarStats";
import {
  recalculateWarMemberRespectFromRaw,
  rebuildWarStatsFromRaw,
  refreshOpenWarChainBonusAdjustmentsFromRaw,
  refreshWarMemberRespect,
  WarStatsRebuildLeaseError,
} from "./warStats";

vi.mock("./auth", () => ({
  readAuthenticatedUserId: vi.fn(),
  requireAdmin: vi.fn(),
  requireMember: vi.fn(),
}));

const databases = [];
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readAuthenticatedUserId).mockResolvedValue(10);
  vi.mocked(requireAdmin).mockResolvedValue(new Response(null, { status: 403 }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const db of databases.splice(0)) db.sqlite.close();
});

describe("individual member respect recalculation", () => {
  it("matches an exact rebuild while preserving other members, wars, counts, and report metadata", async () => {
    const db = database();
    seedAttacks(db);
    await rebuildWarStatsFromRaw(db.env, { scope: "single-war", warId: 7 });
    const expected = db.member(7, 10);
    db.sqlite.exec(`
      UPDATE war_member_stats SET respect_gained = 999, respect_lost = 999,
        chain_bonus_hit_details_vs_enemy = 'stale', added_from_report = 1
      WHERE war_id = 7 AND member_id = 10;
      UPDATE war_member_stats SET respect_gained = 321 WHERE war_id = 7 AND member_id = 11;
      INSERT INTO war_member_stats (war_id, member_id, respect_gained) VALUES (8, 10, 456);
    `);
    const other = db.member(7, 11);
    const buckets = db.sqlite.prepare("SELECT * FROM war_member_combat_buckets").all();

    const result = await recalculateWarMemberRespectFromRaw(db.env, 7, 10);

    expect(result).toEqual({ ...expected, added_from_report: 1 });
    expect(result).toMatchObject({
      respect_gained: 12, respect_gained_raw: 106,
      chain_bonus_hits_vs_enemy: 2, chain_bonus_respect_removed: 94,
      respect_lost: 14, respect_lost_non_hospitalized: 9,
      respect_lost_raw: 154, enemy_chain_bonus_respect_removed: 140,
    });
    expect(db.member(7, 11)).toEqual(other);
    expect(db.member(8, 10).respect_gained).toBe(456);
    expect(db.sqlite.prepare("SELECT * FROM war_member_combat_buckets").all()).toEqual(buckets);
    expect(db.sqlite.prepare("SELECT * FROM war_summary WHERE war_id = 7").get()).toMatchObject({
      total_respect_gain: 333, total_respect_lost: 20,
    });
    expect(await recalculateWarMemberRespectFromRaw(db.env, 7, 10)).toEqual(result);
  });

  it("uses war-wide fallback averages from other members and enemy attackers", async () => {
    const db = database();
    db.attack({ attacker_id: 11, respect_gain: 8 });
    db.attack({ attacker_id: 10, respect_gain: 100, chain: 10 });
    db.attack({ attacker_id: 21, attacker_faction_id: 99, defender_id: 11, defender_faction_id: 8803, respect_gain: 6 });
    db.attack({ attacker_id: 20, attacker_faction_id: 99, defender_id: 10, defender_faction_id: 8803, respect_gain: 100, chain: 10 });
    db.addMember(10);

    expect(await recalculateWarMemberRespectFromRaw(db.env, 7, 10)).toMatchObject({
      respect_gained: 8, respect_lost: 6,
      chain_bonus_respect_removed: 92, enemy_chain_bonus_respect_removed: 94,
    });
  });

  it("falls back to zero when the war has only chain-bonus attacks", async () => {
    const db = database();
    db.attack({ respect_gain: 100, chain: 10 });
    db.addMember(10);
    expect(await recalculateWarMemberRespectFromRaw(db.env, 7, 10)).toMatchObject({
      respect_gained: 0, respect_gained_raw: 100, chain_bonus_respect_removed: 100,
    });
  });

  it("refreshes ordinary hits and clears stale bonus and defend values", async () => {
    const db = database();
    db.addMember(10);
    db.attack({ respect_gain: 4 });
    db.sqlite.exec(`UPDATE war_member_stats SET respect_lost = 100, respect_lost_raw = 100,
      chain_bonus_hits_vs_enemy = 1, chain_bonus_respect_removed = 50,
      chain_bonus_hit_values_vs_enemy = '10', enemy_chain_bonus_hit_details_received = 'stale'`);
    expect(await recalculateWarMemberRespectFromRaw(db.env, 7, 10)).toMatchObject({
      respect_gained: 4, respect_gained_raw: 4, respect_lost: 0, respect_lost_raw: 0,
      chain_bonus_hits_vs_enemy: 0, chain_bonus_respect_removed: 0,
      chain_bonus_hit_values_vs_enemy: "", enemy_chain_bonus_hit_details_received: "",
    });
  });

  it("zeros a report-only member with no attacks and keeps the report row", async () => {
    const db = database();
    db.addMember(10);
    db.sqlite.exec("UPDATE war_member_stats SET added_from_report = 1, respect_gained = 100, respect_lost = 100");
    expect(await recalculateWarMemberRespectFromRaw(db.env, 7, 10)).toMatchObject({
      member_id: 10, added_from_report: 1, respect_gained: 0, respect_lost: 0,
    });
  });

  it("uses event defend rules and practical start/end boundaries", async () => {
    const db = database();
    db.sqlite.exec("UPDATE wars SET war_type = 'event', enemy_faction_id = NULL WHERE id = 7");
    db.addMember(10);
    db.attack({ respect_gain: 3, started: 1000, ended: 1000 });
    db.attack({ respect_gain: 4, started: 2000, ended: 2000 });
    db.attack({ respect_gain: 90, started: 999 });
    db.attack({ respect_gain: 90, ended: 2001 });
    db.attack({ attacker_id: 31, attacker_faction_id: 123, defender_id: 10, defender_faction_id: 8803, respect_gain: 5 });
    db.attack({ attacker_id: 31, attacker_faction_id: 123, defender_id: 10, defender_faction_id: 8803, respect_gain: 99, started: 999 });
    expect(await recalculateWarMemberRespectFromRaw(db.env, 7, 10)).toMatchObject({
      respect_gained: 7, respect_lost: 5,
    });
  });

  it("returns null for an absent member without creating stats or retaining a lease", async () => {
    const db = database();
    expect(await recalculateWarMemberRespectFromRaw(db.env, 7, 404)).toBeNull();
    expect(db.sqlite.prepare("SELECT * FROM war_member_stats").all()).toEqual([]);
    expect(db.sqlite.prepare("SELECT * FROM sync_state").all()).toEqual([]);
  });

  it("refuses to run while a full rebuild holds the war lease", async () => {
    const db = database();
    db.addMember(10);
    db.sqlite.exec("INSERT INTO sync_state (name, last_started, active_war_id) VALUES ('war_stats_rebuild:7', unixepoch(), 7)");
    const before = db.member(7, 10);
    await expect(recalculateWarMemberRespectFromRaw(db.env, 7, 10)).rejects.toBeInstanceOf(WarStatsRebuildLeaseError);
    expect(db.member(7, 10)).toEqual(before);
  });

  it("rolls back every respect update and releases the lease if the summary fails", async () => {
    const db = database();
    db.addMember(10);
    db.attack({ respect_gain: 10 });
    const before = db.member(7, 10);
    db.sqlite.exec(`CREATE TRIGGER fail_summary BEFORE INSERT ON war_summary
      BEGIN SELECT RAISE(ABORT, 'summary failure'); END;`);
    await expect(recalculateWarMemberRespectFromRaw(db.env, 7, 10)).rejects.toThrow("summary failure");
    expect(db.member(7, 10)).toEqual(before);
    expect(db.sqlite.prepare("SELECT * FROM sync_state").all()).toEqual([]);
  });

  it("preserves scheduled refresh behavior for members with chain bonuses", async () => {
    const db = database();
    seedAttacks(db);
    await rebuildWarStatsFromRaw(db.env, { scope: "single-war", warId: 7 });
    const expected = db.member(7, 10);
    db.sqlite.exec(`UPDATE wars SET practical_finish_time = NULL WHERE id = 7;
      UPDATE war_member_stats SET respect_gained = 999 WHERE member_id IN (10, 11)`);
    const result = await refreshOpenWarChainBonusAdjustmentsFromRaw(db.env);
    expect(result).toMatchObject({ wars_updated: 1, stat_rows_updated: 2 });
    expect(db.member(7, 10)).toEqual(expected);
    expect(db.member(7, 11).respect_gained).toBe(999);
  });
});

describe("member respect HTTP API", () => {
  it("allows self-service and returns refreshed stats, war context, and a cache invalidation", async () => {
    const db = database();
    db.addMember(10);
    db.attack({ respect_gain: 4 });
    const response = await request(db, "/api/wars/Test%20War/members/10/respect/recalculate");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true, war: { id: 7, name: "Test War" },
      member: { member_id: 10, respect_gained: 4, member_respect_limit_percent: 4 },
      recalculated_at: expect.any(Number),
    });
    expect(requireAdmin).not.toHaveBeenCalled();
    expect(db.sqlite.prepare("SELECT last_started FROM sync_state WHERE name = 'cache_version:war:test war'").get().last_started).toBeGreaterThan(0);
    const repeated = await request(db, "/api/wars/test%20war/members/010/respect/recalculate");
    expect(repeated.status).toBe(429);
    expect(await repeated.json()).toMatchObject({ code: "COOLDOWN_ACTIVE", retry_after_seconds: expect.any(Number) });
  });

  it("requires authentication and denies another member before any database access", async () => {
    const db = { env: {} };
    vi.mocked(readAuthenticatedUserId).mockResolvedValueOnce(null);
    expect((await request(db)).status).toBe(401);
    vi.mocked(readAuthenticatedUserId).mockResolvedValueOnce(11);
    expect((await request(db)).status).toBe(403);
  });

  it("allows admins to recalculate another member", async () => {
    const db = database();
    db.addMember(10);
    vi.mocked(readAuthenticatedUserId).mockResolvedValueOnce(11);
    vi.mocked(requireAdmin).mockResolvedValueOnce(null);
    expect((await request(db)).status).toBe(200);
    expect(requireAdmin).toHaveBeenCalledOnce();
  });

  it.each(["0", "-1", "1.5", "abc", "9007199254740992", "1e1"])("rejects invalid member ID %s", async memberId => {
    const response = await request({ env: {} }, `/api/wars/Test%20War/members/${memberId}/respect/recalculate`);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_MEMBER_ID" });
  });

  it("reports missing wars and missing member stats", async () => {
    const db = database();
    const missingWar = await request(db, "/api/wars/missing/members/10/respect/recalculate");
    expect(missingWar.status).toBe(404);
    expect(await missingWar.json()).toMatchObject({ code: "WAR_NOT_FOUND" });
    const missingMember = await request(db);
    expect(missingMember.status).toBe(404);
    expect(await missingMember.json()).toMatchObject({ code: "WAR_MEMBER_NOT_FOUND" });
  });

  it("returns a conflict when a rebuild is running", async () => {
    const db = database();
    db.addMember(10);
    db.sqlite.exec("INSERT INTO sync_state (name, last_started, active_war_id) VALUES ('war_stats_rebuild:7', unixepoch(), 7)");
    const response = await request(db);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "WAR_STATS_REBUILD_LOCKED" });
  });

  it("only routes POST requests with the exact member path", async () => {
    const db = { env: {} };
    expect(await request(db, undefined, "GET")).toBeNull();
    expect(await request(db, "/api/wars/Test%20War/members/10/extra/respect/recalculate")).toBeNull();
    expect(readAuthenticatedUserId).not.toHaveBeenCalled();
  });
});

describe("Discord /war me", () => {
  it("shows successful attacks, refreshed adjusted/raw respect, and a direct war link privately", async () => {
    const db = discordDatabase();
    seedAttacks(db);
    await rebuildWarStatsFromRaw(db.env, { scope: "single-war", warId: 7 });
    db.sqlite.exec("UPDATE war_member_stats SET respect_gained = 999 WHERE member_id = 10");
    const result = await handleVerifiedDiscordInteraction(warInteraction(), db.env);
    expect(result).toMatchObject({ type: 4, data: {
      flags: 64, allowed_mentions: { parse: [] },
      embeds: [{ title: "Your war stats", fields: [
        { name: "Successful attacks", value: "4" },
        { name: "Adjusted respect gained", value: "12" },
        { name: "Raw respect gained", value: "106" },
      ] }],
      components: [{ components: [{ label: "View war details", url: "https://dashboard.test/wars/Test%20War", style: 5 }] }],
    } });
    expect(result.data.embeds[0].description).toContain("latest stored attacks");
    expect(db.member(7, 10).respect_gained).toBe(12);
    expect(db.sqlite.prepare("SELECT last_started FROM sync_state WHERE name = 'cache_version:war:test war'").get().last_started).toBeGreaterThan(0);
  });

  it("shares its cooldown with HTTP in both directions", async () => {
    const db = discordDatabase();
    db.addMember(10);
    expect((await request(db)).status).toBe(200);
    const discord = await handleVerifiedDiscordInteraction(warInteraction(), db.env);
    expect(discord.data.content).toMatch(/Please wait \d+ seconds/);
    expect(discord.data.flags).toBe(64);
    db.sqlite.exec("DELETE FROM sync_state WHERE name LIKE 'war_member_respect_recalculate:%'");
    const refreshed = await handleVerifiedDiscordInteraction(warInteraction(), db.env);
    expect(refreshed.data.embeds).toHaveLength(1);
    expect((await request(db)).status).toBe(429);
  });

  it.each([
    ["missing link", "DELETE FROM discord_member_links"],
    ["former member", "UPDATE home_faction_members SET is_current = 0"],
    ["other faction", "UPDATE home_faction_members SET faction_id = 123"],
  ])("rejects a %s without reading or changing stats", async (_label, sql) => {
    const db = discordDatabase();
    db.sqlite.exec(sql);
    const result = await handleVerifiedDiscordInteraction(warInteraction(), db.env);
    expect(result.data.content).toContain("No current faction member is linked");
    expect(result.data.flags).toBe(64);
    expect(db.sqlite.prepare("SELECT * FROM sync_state WHERE name LIKE 'war_member_respect_recalculate:%'").all()).toEqual([]);
  });

  it.each([undefined, "different-guild"])("rejects use outside the configured guild (%s)", async guildId => {
    const interaction = { ...warInteraction(), guild_id: guildId };
    const result = await handleVerifiedDiscordInteraction(interaction, { DISCORD_GUILD_ID: "guild" });
    expect(result.data.content).toContain("faction Discord server");
    expect(result.data.flags).toBe(64);
  });

  it.each([
    "DELETE FROM sync_state WHERE name = 'attacks'",
    "UPDATE sync_state SET war_state = 'none' WHERE name = 'attacks'",
    "UPDATE sync_state SET war_state = 'upcoming' WHERE name = 'attacks'",
    "UPDATE sync_state SET war_state = 'practically_finished' WHERE name = 'attacks'",
    "UPDATE wars SET status = 'ended' WHERE id = 7",
    "UPDATE wars SET finalized_at = 2000 WHERE id = 7",
    "UPDATE wars SET practical_finish_time = 2000 WHERE id = 7",
  ])("does not substitute an old or upcoming war (%s)", async sql => {
    const db = discordDatabase();
    db.sqlite.exec(sql);
    const result = await handleVerifiedDiscordInteraction(warInteraction(), db.env);
    expect(result.data.content).toBe("There is no ongoing war being tracked right now.");
    expect(result.data.flags).toBe(64);
  });

  it("explains missing stats and keeps the war link", async () => {
    const db = discordDatabase();
    db.env.DASHBOARD_BASE_URL = undefined;
    const result = await handleVerifiedDiscordInteraction(warInteraction(), db.env);
    expect(result.data.content).toContain("No war stats have been recorded for you");
    expect(result.data.components[0].components[0].url).toBe("https://buttgrass.pages.dev/wars/Test%20War");
    expect(result.data.embeds).toBeUndefined();
  });

  it("gives a private retry message when a rebuild holds the lease", async () => {
    const db = discordDatabase();
    db.addMember(10);
    db.sqlite.exec("INSERT INTO sync_state (name, last_started, active_war_id) VALUES ('war_stats_rebuild:7', unixepoch(), 7)");
    const result = await handleVerifiedDiscordInteraction(warInteraction(), db.env);
    expect(result.data.content).toContain("being rebuilt");
    expect(result.data.flags).toBe(64);
  });

  it("handles unavailable storage without exposing the error to the member", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await handleVerifiedDiscordInteraction(warInteraction(), {
      DISCORD_GUILD_ID: "guild", DB: { prepare() { throw new Error("database details"); } },
    });
    expect(result.data.content).toContain("temporarily unavailable");
    expect(result.data.content).not.toContain("database details");
    expect(result.data.flags).toBe(64);
  });

  it("acknowledges a signed command privately before the recalculation finishes and edits the same reply", async () => {
    const db = discordDatabase();
    db.addMember(10);
    db.attack({ respect_gain: 2 });
    const tasks = [];
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    const signed = await signInteraction(warInteraction());
    const response = await handleDiscordInteractions(signed.request,
      { ...db.env, DISCORD_PUBLIC_KEY: signed.publicKey }, { waitUntil(task) { tasks.push(task); } });
    expect(await response.json()).toEqual({ type: 5, data: { flags: 64 } });
    expect(tasks).toHaveLength(1);
    await Promise.all(tasks);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://discord.com/api/v10/webhooks/application/test-interaction-token/messages/@original");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toMatchObject({
      allowed_mentions: { parse: [] }, embeds: [{ fields: [
        { name: "Successful attacks" }, { name: "Adjusted respect gained", value: "2" }, { name: "Raw respect gained", value: "2" },
      ] }],
    });
    expect(JSON.parse(init.body).flags).toBeUndefined();
  });

  it("rejects an unsigned request before scheduling a reply or changing stats", async () => {
    const db = discordDatabase();
    const waitUntil = vi.fn();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const signed = await signInteraction(warInteraction());
    const response = await handleDiscordInteractions(new Request(signed.request.url, {
      method: "POST", body: JSON.stringify(warInteraction()),
    }), { ...db.env, DISCORD_PUBLIC_KEY: signed.publicKey }, { waitUntil });
    expect(response.status).toBe(401);
    expect(waitUntil).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps interaction tokens out of logs when the deferred edit fails", async () => {
    const db = discordDatabase();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("https://discord.com/webhooks/application/test-interaction-token")));
    await completeDeferredWarMeInteraction(warInteraction(), db.env);
    expect(log).toHaveBeenCalledWith("Unable to complete war stats reply", "transport error");
    expect(JSON.stringify(log.mock.calls)).not.toContain("test-interaction-token");
  });
});

describe("shared member respect rate limit", () => {
  it("allows one concurrent refresh, expires at 30 seconds, and isolates members", async () => {
    const db = database();
    db.addMember(10);
    db.addMember(11);
    const now = Math.floor(Date.now() / 1000);
    const time = vi.spyOn(Date, "now").mockReturnValue(now * 1000);
    const war = { id: 7, name: "Test War" };
    const results = await Promise.all([
      refreshWarMemberRespect(db.env, war, 10), refreshWarMemberRespect(db.env, war, 10),
    ]);
    expect(results.map(result => result.status).sort()).toEqual(["cooldown", "refreshed"]);
    expect((await refreshWarMemberRespect(db.env, war, 11)).status).toBe("refreshed");
    time.mockReturnValue((now + 29) * 1000);
    expect(await refreshWarMemberRespect(db.env, war, 10)).toEqual({ status: "cooldown", retry_after_seconds: 1 });
    time.mockReturnValue((now + 30) * 1000);
    expect((await refreshWarMemberRespect(db.env, war, 10)).status).toBe("refreshed");
  });
});

function warInteraction() {
  return {
    type: 2, guild_id: "guild", application_id: "application", token: "test-interaction-token",
    member: { user: { id: "111111111111111111" } },
    data: { name: "war", options: [{ name: "me", type: 1 }] },
  };
}

function discordDatabase() {
  const db = database();
  db.env.DISCORD_GUILD_ID = "guild";
  db.env.DASHBOARD_BASE_URL = "https://dashboard.test/";
  db.sqlite.exec(`
    INSERT INTO home_faction_members (member_id, faction_id, name, is_current) VALUES (10, 8803, 'Member', 1);
    INSERT INTO discord_member_links (torn_user_id, discord_user_id) VALUES (10, '111111111111111111');
    INSERT INTO sync_state (name, last_started, active_war_id, war_state) VALUES ('attacks', 0, 7, 'current');
    UPDATE wars SET practical_finish_time = NULL WHERE id = 7;
  `);
  return db;
}

async function signInteraction(interaction) {
  const keys = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify(interaction);
  const signature = await crypto.subtle.sign("Ed25519", keys.privateKey, new TextEncoder().encode(timestamp + body));
  const toHex = buffer => Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, "0")).join("");
  return {
    publicKey: toHex(await crypto.subtle.exportKey("raw", keys.publicKey)),
    request: new Request("https://worker.test/api/discord/interactions", {
      method: "POST", headers: { "X-Signature-Ed25519": toHex(signature), "X-Signature-Timestamp": timestamp }, body,
    }),
  };
}

function request(db, path = "/api/wars/Test%20War/members/10/respect/recalculate", method = "POST") {
  const url = new URL(path, "https://worker.test");
  return routeWarCommands({ request: new Request(url, { method }), url, env: db.env, ctx: {} });
}

function seedAttacks(db) {
  db.attack({ respect_gain: 2 });
  db.attack({ respect_gain: 4 });
  db.attack({ respect_gain: 50, chain: 10 });
  db.attack({ respect_gain: 50, chain: 25 });
  db.attack({ attacker_id: 11, respect_gain: 8 });
  db.attack({ defender_faction_id: 123, respect_gain: 99 });
  db.attack({ respect_gain: 99, started: 999 });
  db.attack({ war_id: 8, respect_gain: 99 });
  const enemy = { attacker_id: 20, attacker_faction_id: 99, defender_id: 10, defender_faction_id: 8803 };
  db.attack({ ...enemy, respect_gain: 4 });
  db.attack({ ...enemy, defender_id: 11, respect_gain: 6 });
  db.attack({ ...enemy, respect_gain: 50, chain: 10, result: "Hospitalized" });
  db.attack({ ...enemy, respect_gain: 100, chain: 25, result: "Mugged" });
  db.attack({ ...enemy, respect_gain: 3, result: "Lost" });
  db.attack({ ...enemy, attacker_faction_id: 123, respect_gain: 99 });
}

function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  const schema = readFileSync(new URL("../schema/current.sql", import.meta.url), "utf8").replaceAll("\r\n", "\n");
  for (const table of ["wars", "attacks", "sync_state", "war_member_stats", "war_summary", "war_member_combat_buckets", "home_faction_members", "discord_member_links"]) {
    sqlite.exec(schema.match(new RegExp(`CREATE TABLE ${table} \\([\\s\\S]*?\\n\\);`))[0]);
  }
  sqlite.exec(`INSERT INTO wars (id, name, status, practical_start_time, practical_finish_time, enemy_faction_id, war_type, member_respect_limit)
    VALUES (7, 'Test War', 'active', 1000, 2000, 99, 'real', 100), (8, 'Other War', 'ended', 1000, 2000, 99, 'real', NULL)`);

  class Statement {
    constructor(sql, params = []) { this.sql = sql; this.params = params; }
    bind(...params) { return new Statement(this.sql, params); }
    execute() {
      const results = sqlite.prepare(this.sql).all(...this.params);
      return { success: true, results, meta: { changes: Number(sqlite.prepare("SELECT changes() AS n").get().n) } };
    }
    async run() { return this.execute(); }
    async all() { return this.execute(); }
    async first() { return this.execute().results[0] ?? null; }
  }
  const DB = {
    prepare(sql) { return new Statement(sql); },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map(statement => statement.execute());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
  let attackId = 0;
  const db = {
    sqlite, env: { DB },
    member(warId, memberId) { return sqlite.prepare("SELECT * FROM war_member_stats WHERE war_id = ? AND member_id = ?").get(warId, memberId); },
    addMember(memberId) { sqlite.prepare("INSERT INTO war_member_stats (war_id, member_id, member_name) VALUES (7, ?, 'Member')").run(memberId); },
    attack(overrides = {}) {
      const row = {
        id: ++attackId, war_id: 7, attacker_id: 10, attacker_name: "Member", attacker_faction_id: 8803,
        defender_id: 20, defender_name: "Enemy", defender_faction_id: 99, started: 1500, ended: 1501,
        result: "Attacked", respect_gain: 2, chain: 1, ...overrides,
      };
      sqlite.prepare(`INSERT INTO attacks (${Object.keys(row).join(",")}) VALUES (${Object.keys(row).map(() => "?").join(",")})`).run(...Object.values(row));
    },
  };
  databases.push(db);
  return db;
}
