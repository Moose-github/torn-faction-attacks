import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDiscordWebhookMessage, editDiscordWebhookMessage } from "./discord";
import { patchDiscordJson, postDiscordJsonAndRead } from "./external/discord";
import { Env } from "./types";

vi.mock("./external/discord", () => ({
  patchDiscordJson: vi.fn(),
  postDiscordForm: vi.fn(),
  postDiscordJson: vi.fn(),
  postDiscordJsonAndRead: vi.fn(),
}));

const webhookEnv = {
  DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/webhook-id/token?thread_id=thread-1",
} as Env;

describe("Discord webhook messages", () => {
  beforeEach(() => {
    vi.mocked(patchDiscordJson).mockReset();
    vi.mocked(postDiscordJsonAndRead).mockReset();
  });

  it("creates webhook messages with wait enabled and returns the Discord message id", async () => {
    vi.mocked(postDiscordJsonAndRead).mockResolvedValueOnce({ id: "message-1" });

    await expect(createDiscordWebhookMessage(webhookEnv, "Chain warning", { users: [], roles: [] }))
      .resolves.toBe("message-1");

    expect(postDiscordJsonAndRead).toHaveBeenCalledWith(
      "https://discord.com/api/webhooks/webhook-id/token?thread_id=thread-1&wait=true",
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

  it("edits an existing webhook message instead of posting another one", async () => {
    vi.mocked(patchDiscordJson).mockResolvedValueOnce(undefined);

    await editDiscordWebhookMessage(webhookEnv, "message-1", "Chain dropped", { users: [], roles: [] });

    expect(patchDiscordJson).toHaveBeenCalledWith(
      "https://discord.com/api/webhooks/webhook-id/token/messages/message-1?thread_id=thread-1",
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

  it("creates colored webhook embeds from the first message line", async () => {
    vi.mocked(postDiscordJsonAndRead).mockResolvedValueOnce({ id: "message-1" });

    await createDiscordWebhookMessage(
      webhookEnv,
      "Chain Watch WARNING: chain 125 60 seconds remaining\nLast hit: Alice v Bob",
      { users: [], roles: [] },
      { embedColor: 0xffa500 },
    );

    expect(postDiscordJsonAndRead).toHaveBeenCalledWith(
      "https://discord.com/api/webhooks/webhook-id/token?thread_id=thread-1&wait=true",
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

  it("keeps alert mentions in message content when using embeds", async () => {
    vi.mocked(postDiscordJsonAndRead).mockResolvedValueOnce({ id: "message-1" });

    await createDiscordWebhookMessage(
      webhookEnv,
      "Chain Watch CRITICAL: chain 125 30 seconds remaining\nLast hit: Alice v Bob\n<@327916221330620436>",
      { users: ["327916221330620436"], roles: [] },
      { embedColor: 0xff0000 },
    );

    expect(postDiscordJsonAndRead).toHaveBeenCalledWith(
      "https://discord.com/api/webhooks/webhook-id/token?thread_id=thread-1&wait=true",
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
});
