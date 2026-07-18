import {
  createDiscordBotMessage,
  createDiscordWebhookMessage,
  editDiscordBotMessage,
  editDiscordWebhookMessage,
  sendDiscordBotMessageWithAttachment,
  sendDiscordBotMessageWithAttachments,
  sendDiscordMessage,
  sendDiscordMessageWithAttachment,
  sendDiscordMessageWithAttachments,
  type DiscordAllowedMentions,
  type DiscordEmbed,
} from "./discord";
import { type DiscordAlertKey } from "./discordAlerts";
import { readConfiguredDiscordNotificationChannel } from "./discordNotificationChannels";
import type { Env } from "./types";

type DiscordAlertDeliveryOptions = {
  embedColor?: number;
  embeds?: DiscordEmbed[];
  webhookUrl?: string;
};

type DiscordAlertAttachment = {
  filename: string;
  mimeType: string;
  data: string | Uint8Array;
};

type DiscordAlertAttachmentOptions = {
  content: string;
  allowedMentions?: DiscordAllowedMentions;
  webhookUrl?: string;
};

export async function sendDiscordAlertMessage(
  env: Env,
  alertKey: DiscordAlertKey,
  message: string,
  allowedMentions?: DiscordAllowedMentions,
): Promise<void> {
  const route = await readConfiguredDiscordNotificationChannel(env, alertKey);
  if (route) {
    try {
      await createDiscordBotMessage(env, discordBotTargetChannelId(route), message, allowedMentions);
      return;
    } catch (err: any) {
      console.warn(`Discord bot alert send failed for ${alertKey}; falling back to webhook:`, err?.message || err);
    }
  }

  await sendDiscordMessage(env, message, allowedMentions);
}

export async function sendDiscordAlertMessageWithAttachment(
  env: Env,
  alertKey: DiscordAlertKey,
  options: DiscordAlertAttachmentOptions & DiscordAlertAttachment,
): Promise<string | null> {
  const route = await readConfiguredDiscordNotificationChannel(env, alertKey);
  if (route) {
    try {
      return await sendDiscordBotMessageWithAttachment(env, discordBotTargetChannelId(route), options);
    } catch (err: any) {
      console.warn(`Discord bot alert attachment send failed for ${alertKey}; falling back to webhook:`, err?.message || err);
    }
  }

  await sendDiscordMessageWithAttachment(env, options);
  return null;
}

export async function sendDiscordAlertMessageWithAttachments(
  env: Env,
  alertKey: DiscordAlertKey,
  options: DiscordAlertAttachmentOptions & { attachments: DiscordAlertAttachment[] },
): Promise<string | null> {
  const route = await readConfiguredDiscordNotificationChannel(env, alertKey);
  if (route) {
    try {
      return await sendDiscordBotMessageWithAttachments(env, discordBotTargetChannelId(route), options);
    } catch (err: any) {
      console.warn(`Discord bot alert attachments send failed for ${alertKey}; falling back to webhook:`, err?.message || err);
    }
  }

  await sendDiscordMessageWithAttachments(env, options);
  return null;
}

export async function createDiscordAlertMessage(
  env: Env,
  alertKey: DiscordAlertKey,
  message: string,
  allowedMentions?: DiscordAllowedMentions,
  options?: DiscordAlertDeliveryOptions,
): Promise<string | null> {
  const route = await readConfiguredDiscordNotificationChannel(env, alertKey);
  if (route) {
    try {
      return await createDiscordBotMessage(env, discordBotTargetChannelId(route), message, allowedMentions, options);
    } catch (err: any) {
      console.warn(`Discord bot alert create failed for ${alertKey}; falling back to webhook:`, err?.message || err);
    }
  }

  return await createDiscordWebhookMessage(env, message, allowedMentions, options);
}

export async function upsertDiscordAlertMessage(
  env: Env,
  alertKey: DiscordAlertKey,
  existingMessageId: string | null,
  message: string,
  allowedMentions?: DiscordAllowedMentions,
  options?: DiscordAlertDeliveryOptions,
): Promise<string | null> {
  const route = await readConfiguredDiscordNotificationChannel(env, alertKey);
  if (route) {
    if (existingMessageId) {
      try {
        await editDiscordBotMessage(
          env,
          discordBotTargetChannelId(route),
          existingMessageId,
          message,
          allowedMentions,
          options,
        );
        return existingMessageId;
      } catch (err: any) {
        console.warn(`Discord bot alert edit failed for ${alertKey}; creating a new bot message:`, err?.message || err);
      }
    }

    try {
      return await createDiscordBotMessage(env, discordBotTargetChannelId(route), message, allowedMentions, options);
    } catch (err: any) {
      console.warn(`Discord bot alert create failed for ${alertKey}; falling back to webhook:`, err?.message || err);
    }
  }

  if (existingMessageId) {
    await editDiscordWebhookMessage(env, existingMessageId, message, allowedMentions, options);
    return existingMessageId;
  }

  return await createDiscordWebhookMessage(env, message, allowedMentions, options);
}

function discordBotTargetChannelId(route: { channelId: string; threadId: string | null }): string {
  return route.threadId ?? route.channelId;
}
