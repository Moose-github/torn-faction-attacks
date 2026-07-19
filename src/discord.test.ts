import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDiscordBotMessage,
  editDiscordBotMessage,
  sendDiscordBotMessageWithAttachment,
} from "./discord";
import {
  patchDiscordBotJson,
  postDiscordBotFormAndRead,
  postDiscordBotJsonAndRead,
} from "./external/discord";
import { Env } from "./types";

vi.mock("./external/discord", () => ({
  patchDiscordBotJson: vi.fn(),
  postDiscordBotFormAndRead: vi.fn(),
  postDiscordBotJsonAndRead: vi.fn(),
}));

const botEnv = {
  DISCORD_BOT_TOKEN: "bot-token",
} as Env;

describe("Discord bot messages", () => {
  beforeEach(() => {
    vi.mocked(patchDiscordBotJson).mockReset();
    vi.mocked(postDiscordBotFormAndRead).mockReset();
    vi.mocked(postDiscordBotJsonAndRead).mockReset();
  });

  it("creates bot messages in a channel and returns the Discord message id", async () => {
    vi.mocked(postDiscordBotJsonAndRead).mockResolvedValueOnce({ id: "message-1" });

    await expect(createDiscordBotMessage(botEnv, "123456789012345678", "Chain warning", { users: [], roles: [] }))
      .resolves.toBe("message-1");

    expect(postDiscordBotJsonAndRead).toHaveBeenCalledWith(
      "bot-token",
      "/channels/123456789012345678/messages",
      {
        content: "Chain warning",
        allowed_mentions: {
          parse: [],
          users: [],
          roles: [],
        },
      },
    );
  });

  it("edits bot messages in a channel", async () => {
    vi.mocked(patchDiscordBotJson).mockResolvedValueOnce(undefined);

    await editDiscordBotMessage(
      botEnv,
      "123456789012345678",
      "message-1",
      "Chain dropped",
      { users: [], roles: [] },
    );

    expect(patchDiscordBotJson).toHaveBeenCalledWith(
      "bot-token",
      "/channels/123456789012345678/messages/message-1",
      {
        content: "Chain dropped",
        embeds: [],
        allowed_mentions: {
          parse: [],
          users: [],
          roles: [],
        },
      },
    );
  });

  it("creates colored bot embeds from the first message line", async () => {
    vi.mocked(postDiscordBotJsonAndRead).mockResolvedValueOnce({ id: "message-1" });

    await createDiscordBotMessage(
      botEnv,
      "123456789012345678",
      "Chain Watch WARNING: chain 125 60 seconds remaining\nLast hit: Alice v Bob",
      { users: [], roles: [] },
      { embedColor: 0xffa500 },
    );

    expect(postDiscordBotJsonAndRead).toHaveBeenCalledWith(
      "bot-token",
      "/channels/123456789012345678/messages",
      {
        content: "",
        embeds: [
          {
            title: "Chain Watch WARNING: chain 125 60 seconds remaining",
            description: "Last hit: Alice v Bob",
            color: 0xffa500,
          },
        ],
        allowed_mentions: {
          parse: [],
          users: [],
          roles: [],
        },
      },
    );
  });

  it("keeps alert mentions in bot message content when using embeds", async () => {
    vi.mocked(postDiscordBotJsonAndRead).mockResolvedValueOnce({ id: "message-1" });

    await createDiscordBotMessage(
      botEnv,
      "123456789012345678",
      "Chain Watch CRITICAL: chain 125 30 seconds remaining\nLast hit: Alice v Bob\n<@327916221330620436>",
      { users: ["327916221330620436"], roles: [] },
      { embedColor: 0xff0000 },
    );

    expect(postDiscordBotJsonAndRead).toHaveBeenCalledWith(
      "bot-token",
      "/channels/123456789012345678/messages",
      {
        content: "<@327916221330620436>",
        embeds: [
          {
            title: "Chain Watch CRITICAL: chain 125 30 seconds remaining",
            description: "Last hit: Alice v Bob",
            color: 0xff0000,
          },
        ],
        allowed_mentions: {
          parse: [],
          users: ["327916221330620436"],
          roles: [],
        },
      },
    );
  });

  it("creates bot messages with explicit embed arrays", async () => {
    vi.mocked(postDiscordBotJsonAndRead).mockResolvedValueOnce({ id: "message-1" });

    await createDiscordBotMessage(
      botEnv,
      "123456789012345678",
      "Retaliation Board",
      { users: [], roles: [] },
      {
        embeds: [
          {
            title: "Retal on nex [2054500]",
            url: "https://www.torn.com/page.php?sid=attack&user2ID=2054500",
            color: 0xed4245,
            fields: [{ name: "Timeout", value: "<t:1000:R>", inline: true }],
          },
        ],
      },
    );

    expect(postDiscordBotJsonAndRead).toHaveBeenCalledWith(
      "bot-token",
      "/channels/123456789012345678/messages",
      {
        content: "Retaliation Board",
        embeds: [
          {
            title: "Retal on nex [2054500]",
            url: "https://www.torn.com/page.php?sid=attack&user2ID=2054500",
            color: 0xed4245,
            fields: [{ name: "Timeout", value: "<t:1000:R>", inline: true }],
          },
        ],
        allowed_mentions: {
          parse: [],
          users: [],
          roles: [],
        },
      },
    );
  });

  it("sends bot attachment messages with safe allowed mentions", async () => {
    vi.mocked(postDiscordBotFormAndRead).mockResolvedValueOnce({ id: "message-1" });

    await expect(sendDiscordBotMessageWithAttachment(botEnv, "123456789012345678", {
      content: "Monthly Xanax reminder",
      filename: "xanax.png",
      mimeType: "image/png",
      data: new Uint8Array([1, 2, 3]),
      allowedMentions: { users: ["111111111111111111"], roles: [] },
    })).resolves.toBe("message-1");

    expect(postDiscordBotFormAndRead).toHaveBeenCalledWith(
      "bot-token",
      "/channels/123456789012345678/messages",
      expect.any(FormData),
    );
    const form = vi.mocked(postDiscordBotFormAndRead).mock.calls[0]?.[2] as FormData;
    expect(form.get("payload_json")).toBe(JSON.stringify({
      content: "Monthly Xanax reminder",
      allowed_mentions: {
        parse: [],
        users: ["111111111111111111"],
        roles: [],
      },
    }));
    expect(form.get("files[0]")).toBeInstanceOf(Blob);
  });

  it("requires a bot token before sending bot messages", async () => {
    await expect(createDiscordBotMessage({} as Env, "123456789012345678", "Nope"))
      .rejects.toThrow("DISCORD_BOT_TOKEN is not configured");
  });
});
