import {
  createDiscordBotMessage,
  editDiscordBotMessage,
  sendDiscordBotMessageWithAttachment,
  sendDiscordBotMessageWithAttachments,
  type DiscordAllowedMentions,
  type DiscordEmbed,
} from "./discord";
import { type DiscordAlertKey } from "./discordAlerts";
import {
  discordNotificationChannelTargetId,
  readConfiguredDiscordNotificationChannel,
} from "./discordNotificationChannels";
import type { Env } from "./types";

type DiscordAlertDeliveryOptions = {
  embedColor?: number;
  embeds?: DiscordEmbed[];
};

type DiscordAlertAttachment = {
  filename: string;
  mimeType: string;
  data: string | Uint8Array;
};

type DiscordAlertAttachmentOptions = {
  content: string;
  allowedMentions?: DiscordAllowedMentions;
};

export async function sendDiscordAlertMessage(
  env: Env,
  alertKey: DiscordAlertKey,
  message: string,
  allowedMentions?: DiscordAllowedMentions,
): Promise<void> {
  const route = await readConfiguredDiscordNotificationChannel(env, alertKey);
  if (!route) {
    console.warn(`Discord alert ${alertKey} skipped: no bot channel route is configured.`);
    return;
  }

  await createDiscordBotMessage(env, discordNotificationChannelTargetId(route), message, allowedMentions);
}

export async function sendDiscordAlertMessageWithAttachment(
  env: Env,
  alertKey: DiscordAlertKey,
  options: DiscordAlertAttachmentOptions & DiscordAlertAttachment,
): Promise<string | null> {
  const route = await readConfiguredDiscordNotificationChannel(env, alertKey);
  if (!route) {
    console.warn(`Discord alert ${alertKey} attachment skipped: no bot channel route is configured.`);
    return null;
  }

  return await sendDiscordBotMessageWithAttachment(env, discordNotificationChannelTargetId(route), options);
}

export async function sendDiscordAlertMessageWithAttachments(
  env: Env,
  alertKey: DiscordAlertKey,
  options: DiscordAlertAttachmentOptions & { attachments: DiscordAlertAttachment[] },
): Promise<string | null> {
  const route = await readConfiguredDiscordNotificationChannel(env, alertKey);
  if (!route) {
    console.warn(`Discord alert ${alertKey} attachments skipped: no bot channel route is configured.`);
    return null;
  }

  return await sendDiscordBotMessageWithAttachments(env, discordNotificationChannelTargetId(route), options);
}

export async function createDiscordAlertMessage(
  env: Env,
  alertKey: DiscordAlertKey,
  message: string,
  allowedMentions?: DiscordAllowedMentions,
  options?: DiscordAlertDeliveryOptions,
): Promise<string | null> {
  const route = await readConfiguredDiscordNotificationChannel(env, alertKey);
  if (!route) {
    console.warn(`Discord alert ${alertKey} create skipped: no bot channel route is configured.`);
    return null;
  }

  return await createDiscordBotMessage(
    env,
    discordNotificationChannelTargetId(route),
    message,
    allowedMentions,
    options,
  );
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
  if (!route) {
    console.warn(`Discord alert ${alertKey} upsert skipped: no bot channel route is configured.`);
    return null;
  }

  if (existingMessageId) {
    try {
      await editDiscordBotMessage(
        env,
        discordNotificationChannelTargetId(route),
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

  return await createDiscordBotMessage(
    env,
    discordNotificationChannelTargetId(route),
    message,
    allowedMentions,
    options,
  );
}
