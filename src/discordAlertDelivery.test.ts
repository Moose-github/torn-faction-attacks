import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDiscordBotMessage,
  createDiscordWebhookMessage,
  editDiscordBotMessage,
  editDiscordWebhookMessage,
  sendDiscordMessage,
} from "./discord";
import { sendDiscordAlertMessage, upsertDiscordAlertMessage } from "./discordAlertDelivery";
import { DISCORD_ALERT_KEYS } from "./discordAlerts";
import { readConfiguredDiscordNotificationChannel } from "./discordNotificationChannels";
import type { Env } from "./types";

vi.mock("./discord", () => ({
  createDiscordBotMessage: vi.fn(),
  createDiscordWebhookMessage: vi.fn(),
  editDiscordBotMessage: vi.fn(),
  editDiscordWebhookMessage: vi.fn(),
  sendDiscordMessage: vi.fn(),
}));

vi.mock("./discordNotificationChannels", () => ({
  discordNotificationChannelTargetId: (route: { channelId: string; threadId: string | null }) =>
    route.threadId ?? route.channelId,
  readConfiguredDiscordNotificationChannel: vi.fn(),
}));

describe("discord alert delivery", () => {
  const env = {} as Env;
  const route = {
    guildId: "guild-1",
    alertKey: DISCORD_ALERT_KEYS.enemyPush,
    alertName: "Enemy push",
    alertDescription: "Warnings when enemy push pressure reaches likely or underway.",
    channelId: "channel-1",
    threadId: null,
    enabled: true,
    updatedByDiscordId: "user-1",
    updatedAt: 1,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readConfiguredDiscordNotificationChannel).mockResolvedValue(null);
    vi.mocked(createDiscordBotMessage).mockResolvedValue("bot-message-1");
    vi.mocked(createDiscordWebhookMessage).mockResolvedValue("webhook-message-1");
  });

  it("sends through the bot when an alert route is configured", async () => {
    vi.mocked(readConfiguredDiscordNotificationChannel).mockResolvedValue(route);

    await sendDiscordAlertMessage(env, DISCORD_ALERT_KEYS.enemyPush, "Enemy push", { users: ["1"] });

    expect(createDiscordBotMessage).toHaveBeenCalledWith(env, "channel-1", "Enemy push", { users: ["1"] });
    expect(sendDiscordMessage).not.toHaveBeenCalled();
  });

  it("uses the configured thread as the bot target when present", async () => {
    vi.mocked(readConfiguredDiscordNotificationChannel).mockResolvedValue({
      ...route,
      threadId: "thread-1",
    });

    await sendDiscordAlertMessage(env, DISCORD_ALERT_KEYS.enemyPush, "Enemy push");

    expect(createDiscordBotMessage).toHaveBeenCalledWith(env, "thread-1", "Enemy push", undefined);
  });

  it("falls back to webhooks when there is no alert route", async () => {
    await sendDiscordAlertMessage(env, DISCORD_ALERT_KEYS.enemyPush, "Enemy push");

    expect(sendDiscordMessage).toHaveBeenCalledWith(env, "Enemy push", undefined);
    expect(createDiscordBotMessage).not.toHaveBeenCalled();
  });

  it("falls back to webhooks when bot send fails", async () => {
    vi.mocked(readConfiguredDiscordNotificationChannel).mockResolvedValue(route);
    vi.mocked(createDiscordBotMessage).mockRejectedValue(new Error("missing access"));

    await sendDiscordAlertMessage(env, DISCORD_ALERT_KEYS.enemyPush, "Enemy push");

    expect(sendDiscordMessage).toHaveBeenCalledWith(env, "Enemy push", undefined);
  });

  it("edits bot messages for routed upserts", async () => {
    vi.mocked(readConfiguredDiscordNotificationChannel).mockResolvedValue(route);

    const messageId = await upsertDiscordAlertMessage(
      env,
      DISCORD_ALERT_KEYS.chainWatch,
      "message-1",
      "Chain watch",
      { roles: ["2"] },
      { embedColor: 0xff0000 },
    );

    expect(messageId).toBe("message-1");
    expect(editDiscordBotMessage).toHaveBeenCalledWith(
      env,
      "channel-1",
      "message-1",
      "Chain watch",
      { roles: ["2"] },
      { embedColor: 0xff0000 },
    );
    expect(editDiscordWebhookMessage).not.toHaveBeenCalled();
  });

  it("creates a fresh bot message when editing a routed message fails", async () => {
    vi.mocked(readConfiguredDiscordNotificationChannel).mockResolvedValue(route);
    vi.mocked(editDiscordBotMessage).mockRejectedValue(new Error("unknown message"));
    vi.mocked(createDiscordBotMessage).mockResolvedValue("bot-message-2");

    const messageId = await upsertDiscordAlertMessage(
      env,
      DISCORD_ALERT_KEYS.chainWatch,
      "old-message",
      "Chain watch",
    );

    expect(messageId).toBe("bot-message-2");
    expect(createDiscordBotMessage).toHaveBeenCalledWith(
      env,
      "channel-1",
      "Chain watch",
      undefined,
      undefined,
    );
  });

  it("edits webhook messages when no route is configured", async () => {
    const messageId = await upsertDiscordAlertMessage(
      env,
      DISCORD_ALERT_KEYS.chainWatch,
      "message-1",
      "Chain watch",
    );

    expect(messageId).toBe("message-1");
    expect(editDiscordWebhookMessage).toHaveBeenCalledWith(
      env,
      "message-1",
      "Chain watch",
      undefined,
      undefined,
    );
  });
});
