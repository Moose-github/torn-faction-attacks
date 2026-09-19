import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendAdminDiscordMessageFromRequest } from "./discordMessageSend";
import type { Env } from "./types";

const env = { DISCORD_GUILD_ID: "111111", DISCORD_BOT_TOKEN: "test-token" } as Env;
const channel = { id: "222222", guild_id: "111111", type: 0, name: "general" };
const thread = { ...channel, id: "333333", type: 11, parent_id: channel.id, name: "War plans" };
const fetchMock = vi.fn<typeof fetch>();
const request = (body: unknown) => new Request("https://worker.test/api/admin/discord-messages/send", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const send = (body: unknown = { channel_id: channel.id, message: "Hello faction" }) => sendAdminDiscordMessageFromRequest(request(body), env);
const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async (url, init) => {
    if (init?.method === "POST") return Response.json({ id: "444444" });
    if (String(url).endsWith(`/channels/${thread.id}`)) return Response.json(thread);
    return Response.json(channel);
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("custom admin Discord messages", () => {
  it("sends exactly one custom message to the verified channel and returns its link", async () => {
    const response = await send({ channel_id: channel.id, message: "  **Hello**\n@everyone <@123456>  " });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, channel_id: channel.id, message_id: "444444", message_link: "https://discord.com/channels/111111/222222/444444" });
    expect(posts()).toHaveLength(1);
    expect(posts()[0][0]).toBe("https://discord.com/api/v10/channels/222222/messages");
    expect(JSON.parse(String(posts()[0][1]?.body))).toEqual({
      content: "**Hello**\n@everyone <@123456>", allowed_mentions: { parse: [], users: [], roles: [] },
    });
    expect(fetchMock.mock.calls[0][0]).toBe("https://discord.com/api/v10/channels/222222");
  });

  it("supports active threads after verifying the parent server", async () => {
    const response = await send({ channel_id: thread.id, message: "Thread message" });
    expect(response.status).toBe(200);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://discord.com/api/v10/channels/333333", "https://discord.com/api/v10/channels/222222",
      "https://discord.com/api/v10/channels/333333/messages",
    ]);
  });

  it.each([null, {}, { channel_id: channel.id }, { channel_id: channel.id, message: " \n " },
    { channel_id: channel.id, message: 123 }, { channel_id: channel.id, message: "x".repeat(1901) },
    { channel_id: "bad/id", message: "Hello" }, { channel_id: 222222, message: "Hello" }, { message: "Hello" },
  ])("rejects invalid input without contacting Discord: %j", async body => {
    expect((await send(body)).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts a message at the length limit without truncating it", async () => {
    expect((await send({ channel_id: channel.id, message: "x".repeat(1900) })).status).toBe(200);
    expect(JSON.parse(String(posts()[0][1]?.body)).content).toHaveLength(1900);
  });

  it.each([
    { ...channel, guild_id: "999999" }, { ...channel, id: "999999" }, { ...channel, type: 2 },
    { ...channel, type: 4 }, { ...channel, type: 15 },
    { ...thread, id: channel.id, thread_metadata: { archived: true } },
    { ...thread, id: channel.id, thread_metadata: { locked: true } },
  ])("rejects unavailable or unsupported destinations before posting: %j", async destination => {
    fetchMock.mockResolvedValue(Response.json(destination));
    expect((await send()).status).toBe(400);
    expect(posts()).toHaveLength(0);
  });

  it("rejects a thread whose parent is in another server", async () => {
    fetchMock.mockImplementation(async url => Response.json(String(url).endsWith(thread.id) ? thread : { ...channel, guild_id: "999999" }));
    expect((await send({ channel_id: thread.id, message: "Hello" })).status).toBe(400);
    expect(posts()).toHaveLength(0);
  });

  it.each(["DISCORD_BOT_TOKEN", "DISCORD_GUILD_ID"])("reports missing %s without sending", async key => {
    const response = await sendAdminDiscordMessageFromRequest(request({ channel_id: channel.id, message: "Hello" }), { ...env, [key]: "" });
    expect(response.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([[403, 403], [404, 403], [429, 429], [500, 502]])("handles Discord send failure %i without retrying", async (upstream, expected) => {
    fetchMock.mockImplementation(async (_url, init) => init?.method === "POST"
      ? Response.json({ message: "private upstream details" }, { status: upstream }) : Response.json(channel));
    const response = await send();
    expect(response.status).toBe(expected);
    expect(await response.text()).not.toContain("private upstream details");
    expect(posts()).toHaveLength(1);
  });

  it("does not claim success or retry when delivery is unconfirmed", async () => {
    fetchMock.mockImplementation(async (_url, init) => Response.json(init?.method === "POST" ? {} : channel));
    const response = await send();
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: "DISCORD_SEND_UNCONFIRMED" });
    expect(posts()).toHaveLength(1);
  });
});
