import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendDiscordDirectMessage } from "./discord";
import { ExternalApiError } from "./external/http";
import type { Env } from "./types";

const env = { DISCORD_BOT_TOKEN: "test-token" } as Env;
const users = ["111111111111111111", "222222222222222222"];
const channels = ["333333333333333333", "444444444444444444"];
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async (url, init) => {
    if (String(url).endsWith("/users/@me/channels")) {
      const { recipient_id } = JSON.parse(String(init?.body));
      return Response.json({ id: channels[users.indexOf(recipient_id)] });
    }
    return Response.json({ id: "555555555555555555" });
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("Discord direct messages", () => {
  it("sends to each selected user without billing configuration or cross-routing", async () => {
    for (const [index, user] of users.entries()) {
      await expect(sendDiscordDirectMessage(env, ` ${user} `, `Alert ${index} @everyone`))
        .resolves.toBe("555555555555555555");
      const [url, init] = fetchMock.mock.calls[index * 2 + 1];
      expect(url).toBe(`https://discord.com/api/v10/channels/${channels[index]}/messages`);
      expect(JSON.parse(String(init?.body))).toEqual({
        content: `Alert ${index} @everyone`,
        allowed_mentions: { parse: [], users: [], roles: [] },
      });
      expect(init?.headers).toMatchObject({ Authorization: "Bot test-token" });
      expect(init?.signal).toBeDefined();
    }
  });

  it("keeps retries stable per user and separates different users and events", async () => {
    for (const [user, nonce] of [[users[0], "event:1"], [users[0], "event:1"],
      [users[1], "event:1"], [users[0], "event:2"]]) {
      await sendDiscordDirectMessage(env, user, "Alert", { nonce });
    }
    const messages = [1, 3, 5, 7].map(index => JSON.parse(String(fetchMock.mock.calls[index][1]?.body)));
    expect(messages[0].nonce).toBe(messages[1].nonce);
    expect(new Set([messages[0].nonce, messages[2].nonce, messages[3].nonce]).size).toBe(3);
    for (const message of messages) {
      expect(message.nonce).toHaveLength(25);
      expect(message.enforce_nonce).toBe(true);
    }
  });

  it("supports formatted alerts", async () => {
    const embeds = [{ title: "Chain warning", description: "Time remaining: 30 seconds", color: 123 }];
    await sendDiscordDirectMessage(env, users[0], "Your chain alert", { embeds });
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({ embeds });
  });

  it.each(["", "name", "123", "1/../../channels", "1".repeat(21)])("rejects invalid recipient %j before sending", async user => {
    await expect(sendDiscordDirectMessage(env, user, "Alert")).rejects.toThrow("Invalid Discord user ID");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["", "  ", "x".repeat(1901)])("rejects an empty or oversized message", async message => {
    await expect(sendDiscordDirectMessage(env, users[0], message)).rejects.toThrow("1 to 1900");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects missing bot credentials before sending", async () => {
    await expect(sendDiscordDirectMessage({} as Env, users[0], "Alert")).rejects.toThrow("DISCORD_BOT_TOKEN");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([null, {}, { id: 123 }, { id: "invalid" }])("rejects invalid DM channel responses %j", async response => {
    fetchMock.mockResolvedValueOnce(Response.json(response));
    await expect(sendDiscordDirectMessage(env, users[0], "Alert")).rejects.toThrow("DM channel");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([403, 429, 500])("preserves Discord failure status %i at either request", async status => {
    fetchMock.mockResolvedValueOnce(Response.json({}, { status }));
    await expect(sendDiscordDirectMessage(env, users[0], "Alert"))
      .rejects.toMatchObject({ status, service: "Discord bot" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValueOnce(Response.json({ id: channels[0] }))
      .mockResolvedValueOnce(Response.json({}, { status }));
    await expect(sendDiscordDirectMessage(env, users[0], "Alert")).rejects.toBeInstanceOf(ExternalApiError);
  });

  it("rejects unconfirmed message delivery", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ id: channels[0] }))
      .mockResolvedValueOnce(Response.json({}));
    await expect(sendDiscordDirectMessage(env, users[0], "Alert")).rejects.toThrow("did not confirm delivery");
  });
});
