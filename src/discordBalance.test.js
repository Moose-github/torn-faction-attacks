import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { watchDatabase } from "../scripts/watch-test-database.mjs";
import { completeDeferredBalanceInteraction } from "./discordBalance";
import { handleDiscordInteractions, handleVerifiedDiscordInteraction } from "./discordInteractions";

let db;
let fetchMock;
let errorLog;

beforeEach(() => {
  db = watchDatabase(1_800_000_000);
  db.sqlite.exec("ALTER TABLE home_faction_members ADD COLUMN faction_id INTEGER DEFAULT 8803");
  const schema = readFileSync(new URL("../schema/current.sql", import.meta.url), "utf8");
  db.sqlite.exec(schema.match(/CREATE TABLE torn_api_call_log \([\s\S]*?\n\);/)[0]);
  db.env.TORN_API_KEY = "test-faction-key";
  fetchMock = vi.fn().mockImplementation(async () => Response.json(balancePayload()));
  vi.stubGlobal("fetch", fetchMock);
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  db.sqlite.close();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Discord /bal", () => {
  it.each([["111", "$1,234,567"], ["222", "$7,654,321"]])(
    "returns only the calling member's money for Discord user %s",
    async (discordUserId, expected) => {
      const result = await handleVerifiedDiscordInteraction(balanceInteraction(discordUserId), db.env);
      expect(result).toEqual(privateReply(expected));
      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("https://api.torn.com/v2/faction/balance?cat=current");
      expect(init).toMatchObject({ method: "GET", headers: {
        Accept: "application/json", Authorization: "ApiKey test-faction-key",
      } });
      const log = db.sqlite.prepare("SELECT * FROM torn_api_call_log").all();
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({ feature: "discord-balance", endpoint: "/v2/faction/balance?cat=current" });
      expect(JSON.stringify(log)).not.toMatch(/test-faction-key|1234567|7654321|Other player/);
    },
  );

  it("ignores supplied player IDs and top-level users in a guild interaction", async () => {
    const interaction = balanceInteraction();
    interaction.data.options = [{ type: 4, name: "player_id", value: 2 }];
    interaction.user = { id: "222" };
    expect(await handleVerifiedDiscordInteraction(interaction, db.env)).toEqual(privateReply("$1,234,567"));
  });

  it.each([[0, "$0"], [-500, "-$500"], [Number.MAX_SAFE_INTEGER, "$9,007,199,254,740,991"]])(
    "preserves the money value %s",
    async (money, formatted) => {
      fetchMock.mockResolvedValue(Response.json({ balance: { members: [{ id: 1, money }] } }));
      expect(await handleVerifiedDiscordInteraction(balanceInteraction(), db.env)).toEqual(privateReply(formatted));
    },
  );

  it.each([
    ["missing link", "DELETE FROM discord_member_links WHERE torn_user_id = 1"],
    ["former member", "UPDATE home_faction_members SET is_current = 0 WHERE member_id = 1"],
    ["other faction", "UPDATE home_faction_members SET faction_id = 999 WHERE member_id = 1"],
    ["ambiguous link", "UPDATE discord_member_links SET discord_user_id = '111' WHERE torn_user_id = 2"],
  ])("rejects a %s before requesting any balances", async (_label, sql) => {
    db.sqlite.exec(sql);
    const result = await handleVerifiedDiscordInteraction(balanceInteraction(), db.env);
    expect(result.data.content).toContain("could not be matched");
    expect(result.data.flags).toBe(64);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { guild_id: undefined, member: undefined, user: { id: "111" } },
    { guild_id: "another-guild" },
    { member: undefined, user: { id: "111" } },
  ])("rejects callers outside the faction server or without a guild member identity: %j", async override => {
    const prepare = vi.spyOn(db.env.DB, "prepare");
    const result = await handleVerifiedDiscordInteraction({ ...balanceInteraction(), ...override }, db.env);
    expect(result).toEqual(privateReply("Use `/bal` in the faction Discord server."));
    expect(prepare).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects use when the faction guild is not configured", async () => {
    db.env.DISCORD_GUILD_ID = undefined;
    const result = await handleVerifiedDiscordInteraction(balanceInteraction(), db.env);
    expect(result.data.flags).toBe(64);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("supports the server key in Secrets Store", async () => {
    db.env.TORN_API_KEY = { get: async () => " test-secret-key " };
    expect(await handleVerifiedDiscordInteraction(balanceInteraction(), db.env)).toEqual(privateReply("$1,234,567"));
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("ApiKey test-secret-key");
  });

  it("does not query Torn when the server key is missing", async () => {
    db.env.TORN_API_KEY = " ";
    expectUnavailable(await handleVerifiedDiscordInteraction(balanceInteraction(), db.env));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not substitute another member or faction balance when the caller is absent", async () => {
    const payload = balancePayload();
    payload.balance.members = payload.balance.members.filter(member => member.id !== 1);
    fetchMock.mockResolvedValue(Response.json(payload));
    expect(await handleVerifiedDiscordInteraction(balanceInteraction(), db.env)).toEqual(
      privateReply("No current faction money balance was found for your linked Torn account."),
    );
  });

  it.each([
    null, {}, { balance: { members: null } },
    { balance: { members: [{ id: 1, points: 100 }] } },
    { balance: { members: [{ id: 1, money: null }] } },
    { balance: { members: [{ id: 1, money: "1234567" }] } },
    { balance: { members: [{ id: 1, money: 1.5 }] } },
    { balance: { members: [{ id: 1, money: Number.MAX_SAFE_INTEGER + 1 }] } },
    { balance: { members: [{ id: 1, money: 100 }, { id: 1, money: 200 }] } },
  ])("fails privately for malformed or ambiguous balances: %j", async payload => {
    fetchMock.mockResolvedValue(Response.json(payload));
    expectUnavailable(await handleVerifiedDiscordInteraction(balanceInteraction(), db.env));
  });

  it.each([200, 403, 429, 500])("does not expose upstream error details (HTTP %s)", async status => {
    const details = JSON.stringify(balancePayload());
    fetchMock.mockResolvedValue(Response.json({ error: { code: 7, error: details } }, { status }));
    expectUnavailable(await handleVerifiedDiscordInteraction(balanceInteraction(), db.env));
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(details);
  });

  it("handles a network timeout with a private error", async () => {
    fetchMock.mockRejectedValue(new Error("Request timed out"));
    expectUnavailable(await handleVerifiedDiscordInteraction(balanceInteraction(), db.env));
  });

  it("handles a database failure without exposing its details", async () => {
    vi.spyOn(db.env.DB, "prepare").mockImplementation(() => { throw new Error("private database details"); });
    expectUnavailable(await handleVerifiedDiscordInteraction(balanceInteraction(), db.env));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("private database details");
  });

  it("acknowledges a signed command privately before Torn finishes, then edits only the original reply", async () => {
    let finishTorn;
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { finishTorn = resolve; }));
    fetchMock.mockResolvedValueOnce(Response.json({}));
    const signed = await signInteraction(balanceInteraction());
    const tasks = [];
    const response = await handleDiscordInteractions(signed.request,
      { ...db.env, DISCORD_PUBLIC_KEY: signed.publicKey }, { waitUntil(task) { tasks.push(task); } });
    expect(await response.json()).toEqual({ type: 5, data: { flags: 64 } });
    expect(tasks).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledOnce();
    finishTorn(Response.json(balancePayload()));
    await Promise.all(tasks);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("https://discord.com/api/v10/webhooks/application/test-interaction-token/messages/@original");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ content: "$1,234,567", allowed_mentions: { parse: [] } });
  });

  it("rejects an unsigned request before scheduling a reply or querying Torn", async () => {
    const signed = await signInteraction(balanceInteraction());
    const waitUntil = vi.fn();
    const response = await handleDiscordInteractions(new Request(signed.request.url, {
      method: "POST", body: JSON.stringify(balanceInteraction()),
    }), { ...db.env, DISCORD_PUBLIC_KEY: signed.publicKey }, { waitUntil });
    expect(response.status).toBe(401);
    expect(waitUntil).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps deferred errors private and interaction tokens out of logs", async () => {
    db.sqlite.exec("DELETE FROM discord_member_links");
    fetchMock.mockRejectedValue(new Error("https://discord.com/webhooks/application/test-interaction-token"));
    await completeDeferredBalanceInteraction(balanceInteraction(), db.env);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).content).toContain("could not be matched");
    expect(errorLog).toHaveBeenCalledWith("Unable to complete balance reply", "transport error");
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("test-interaction-token");
  });
});

function balanceInteraction(userId = "111") {
  return { type: 2, application_id: "application", token: "test-interaction-token", guild_id: "guild",
    member: { user: { id: userId } }, data: { name: "bal" } };
}

function balancePayload() {
  return { balance: {
    faction: { money: 999999999, points: 88888, scope: 77777 },
    members: [
      { id: 2, username: "Other player", money: 7654321, points: 44444 },
      { id: 1, username: "Calling player", money: 1234567, points: 33333 },
    ],
  } };
}

function privateReply(content) {
  return { type: 4, data: { content, flags: 64, allowed_mentions: { parse: [] } } };
}

function expectUnavailable(result) {
  expect(result).toEqual(privateReply("Your faction money balance is temporarily unavailable. Please try again shortly."));
}

async function signInteraction(payload) {
  const keys = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const hex = buffer => Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, "0")).join("");
  const publicKey = hex(await crypto.subtle.exportKey("raw", keys.publicKey));
  const timestamp = "1800000000";
  const body = JSON.stringify(payload);
  const signature = hex(await crypto.subtle.sign({ name: "Ed25519" }, keys.privateKey,
    new TextEncoder().encode(timestamp + body)));
  return { publicKey, request: new Request("https://worker.test/api/discord/interactions", {
    method: "POST", headers: { "X-Signature-Ed25519": signature, "X-Signature-Timestamp": timestamp }, body,
  }) };
}
