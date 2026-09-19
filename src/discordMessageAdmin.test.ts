import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteDiscordBotMessageFromRequest, parseDiscordMessageLink, previewDiscordBotMessageFromRequest } from "./discordMessageAdmin";
import { fetchExternal } from "./external/http";
import type { Env } from "./types";

vi.mock("./external/http", () => ({ fetchExternal: vi.fn() }));
const env = { DISCORD_GUILD_ID: "111111", DISCORD_BOT_TOKEN: "test-bot-token" } as Env;
const link = "https://discord.com/channels/111111/222222/333333";
const api = "https://discord.com/api/v10";
let authorId: string;
let channelGuild: string;
let deletionStatus: number;
function request(value: unknown = link) {
  return new Request("https://worker.test/api/admin/discord-messages", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message_link: value }),
  });
}
const deleteCalls = () => vi.mocked(fetchExternal).mock.calls.filter((call) => call[1].method === "DELETE");
beforeEach(() => {
  vi.clearAllMocks(); authorId = "444444"; channelGuild = "111111"; deletionStatus = 204;
  vi.mocked(fetchExternal).mockImplementation(async (url, options) => {
    if (options.method === "DELETE") return new Response(null, { status: deletionStatus });
    const body = String(url).endsWith("/users/@me") ? { id: "444444", bot: true }
      : String(url).endsWith("/channels/222222") ? { id: "222222", guild_id: channelGuild, name: "chain-alerts" }
      : { id: "333333", channel_id: "222222", author: { id: authorId, username: "Faction bot" },
        timestamp: "2030-01-01T12:00:00Z", content: "<@123456> Chain warning",
        embeds: [{ title: "60 seconds remaining", description: "Last hit: Alice", fields: [{ name: "Chain", value: "150" }] }],
        attachments: [{ filename: "chain.png", url: "https://example.test/private" }] };
    return Response.json(body);
  });
});

describe("Discord message link parsing", () => {
  it("accepts copied links, including thread links and legacy Discord hosts, preserving string IDs", () => {
    expect(parseDiscordMessageLink(`  ${link}  `)).toMatchObject({ guildId: "111111", channelId: "222222", messageId: "333333", url: link });
    expect(parseDiscordMessageLink("https://ptb.discordapp.com/channels/111111/222222/1234567890123456789?jump=true").messageId).toBe("1234567890123456789");
  });
  it.each([null, "333333", "https://example.com/channels/111111/222222/333333", "http://discord.com/channels/111111/222222/333333",
    "https://discord.com.evil.test/channels/111111/222222/333333", "https://user:password@discord.com/channels/111111/222222/333333",
    "https://discord.com:8443/channels/111111/222222/333333", "https://discord.com/channels/@me/222222/333333",
    "https://discord.com/channels/111111/222222", `${link}/extra`, "https://discord.com/channels/111111/222222/%3333333"])("rejects invalid links: %s", (value) => {
    expect(() => parseDiscordMessageLink(value)).toThrow("Copy Message Link");
  });
});

describe("admin bot message operations", () => {
  it("previews this bot's message, channel, embeds and attachment names without deleting", async () => {
    const result = await previewDiscordBotMessageFromRequest(request(), env);
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ ok: true, message_link: link, message_id: "333333", channel_name: "chain-alerts",
      author_name: "Faction bot", timestamp: "2030-01-01T12:00:00Z", content: "<@123456> Chain warning",
      embeds: [{ title: "60 seconds remaining", description: "Last hit: Alice", fields: [{ name: "Chain", value: "150" }], footer: "" }], attachments: ["chain.png"] });
    expect(deleteCalls()).toHaveLength(0);
  });
  it("verifies the actual channel and bot author before deleting from the fixed Discord API", async () => {
    const result = await deleteDiscordBotMessageFromRequest(request(), env);
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ ok: true, already_deleted: false });
    expect(fetchExternal).toHaveBeenLastCalledWith(`${api}/channels/222222/messages/333333`,
      { method: "DELETE", headers: { Authorization: "Bot test-bot-token" } }, { timeoutMs: 10_000 });
    expect(deleteCalls()).toHaveLength(1);
    expect(vi.mocked(fetchExternal).mock.calls.slice(0, 3).every((call) => call[1].method === "GET")).toBe(true);
  });
  it.each([previewDiscordBotMessageFromRequest, deleteDiscordBotMessageFromRequest])("rejects non-bot ownership for %s", async (operation) => {
    authorId = "555555";
    expect((await operation(request(), env)).status).toBe(403);
    expect(deleteCalls()).toHaveLength(0);
  });
  it("does not trust ownership from a previous browser preview", async () => {
    expect((await previewDiscordBotMessageFromRequest(request(), env)).status).toBe(200);
    authorId = "555555";
    expect((await deleteDiscordBotMessageFromRequest(request(), env)).status).toBe(403);
    expect(deleteCalls()).toHaveLength(0);
  });
  it("rejects another guild in the link before making a Discord request", async () => {
    expect((await deleteDiscordBotMessageFromRequest(request(link.replace("111111", "999999")), env)).status).toBe(403);
    expect(fetchExternal).not.toHaveBeenCalled();
  });
  it("rejects a forged guild prefix when the actual channel belongs to another server", async () => {
    channelGuild = "999999";
    expect((await deleteDiscordBotMessageFromRequest(request(), env)).status).toBe(403);
    expect(fetchExternal).toHaveBeenCalledOnce();
    expect(deleteCalls()).toHaveLength(0);
  });
  it("rejects malformed input and missing configuration without making external requests", async () => {
    expect((await deleteDiscordBotMessageFromRequest(request("bad"), env)).status).toBe(400);
    expect((await deleteDiscordBotMessageFromRequest(request(), {} as Env)).status).toBe(503);
    expect(fetchExternal).not.toHaveBeenCalled();
  });
  it.each([403, 404, 429, 500])("reports Discord HTTP %s errors without deleting", async (status) => {
    vi.mocked(fetchExternal).mockResolvedValueOnce(new Response(null, { status }));
    const result = await deleteDiscordBotMessageFromRequest(request(), env);
    expect(result.status).toBe(status === 500 ? 502 : status);
    expect(deleteCalls()).toHaveLength(0);
  });
  it("handles deletion by someone else between verification and deletion", async () => {
    deletionStatus = 404;
    expect(await (await deleteDiscordBotMessageFromRequest(request(), env)).json()).toEqual({ ok: true, already_deleted: true });
  });
  it("reports failed deletion instead of success", async () => {
    deletionStatus = 403;
    expect((await deleteDiscordBotMessageFromRequest(request(), env)).status).toBe(403);
  });
  it("does not expose transport error details", async () => {
    vi.mocked(fetchExternal).mockRejectedValueOnce(new Error("sensitive transport details"));
    const result = await previewDiscordBotMessageFromRequest(request(), env);
    expect(result.status).toBe(502);
    expect(await result.text()).not.toContain("sensitive");
  });
});
