import {
  patchDiscordBotJson,
  postDiscordBotFormAndRead,
  postDiscordBotJsonAndRead,
} from "./external/discord";
import { Env } from "./types";

const MAX_DISCORD_MESSAGE_LENGTH = 1900;

export type DiscordAllowedMentions = {
  users?: string[];
  roles?: string[];
};

export type DiscordEmbed = {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  timestamp?: string;
  fields?: Array<{
    name: string;
    value: string;
    inline?: boolean;
  }>;
  footer?: {
    text: string;
  };
};

type DiscordPayloadOptions = {
  embedColor?: number;
  embeds?: DiscordEmbed[];
  clearEmbeds?: boolean;
};

export async function createDiscordBotMessage(
  env: Env,
  channelId: string,
  message: string,
  allowedMentions?: DiscordAllowedMentions,
  options?: Pick<DiscordPayloadOptions, "embedColor" | "embeds">,
): Promise<string | null> {
  const botToken = readDiscordBotToken(env);
  const response = await postDiscordBotJsonAndRead<DiscordMessage>(
    botToken,
    discordChannelMessagesPath(channelId),
    discordPayload(message, allowedMentions, options),
  );

  return discordMessageId(response);
}

export async function editDiscordBotMessage(
  env: Env,
  channelId: string,
  messageId: string,
  message: string,
  allowedMentions?: DiscordAllowedMentions,
  options?: Pick<DiscordPayloadOptions, "embedColor" | "embeds">,
): Promise<void> {
  const botToken = readDiscordBotToken(env);
  await patchDiscordBotJson(
    botToken,
    discordChannelMessagePath(channelId, messageId),
    discordPayload(message, allowedMentions, {
      ...options,
      clearEmbeds: options?.embedColor === undefined && options?.embeds === undefined,
    }),
  );
}

type DiscordMessage = {
  id?: unknown;
};

function discordPayload(
  content: string,
  allowedMentions?: DiscordAllowedMentions,
  options: DiscordPayloadOptions = {},
): {
  content: string;
  embeds?: DiscordEmbed[];
  allowed_mentions?: {
    parse: [];
    users?: string[];
    roles?: string[];
  };
} {
  let payload: { content: string; embeds?: DiscordEmbed[] };
  if (options.embeds !== undefined) {
    payload = {
      content,
      embeds: options.embeds,
    };
  } else if (options.embedColor !== undefined) {
    payload = discordEmbedPayload(content, options.embedColor);
  } else {
    payload = {
      content,
      ...(options.clearEmbeds ? { embeds: [] } : {}),
    };
  }

  if (!allowedMentions) {
    return payload;
  }

  return {
    ...payload,
    allowed_mentions: {
      parse: [],
      users: allowedMentions.users ?? [],
      roles: allowedMentions.roles ?? [],
    },
  };
}

function discordEmbedPayload(content: string, color: number): {
  content: string;
  embeds: Array<{
    title: string;
    description?: string;
    color: number;
  }>;
} {
  const lines = content.split("\n");
  const mentionLine = lines.length > 1 && isDiscordMentionLine(lines[lines.length - 1])
    ? lines.pop() ?? ""
    : "";
  const [title = "", ...descriptionLines] = lines;
  const description = descriptionLines.join("\n").trim();

  return {
    content: mentionLine,
    embeds: [
      {
        title,
        ...(description ? { description } : {}),
        color,
      },
    ],
  };
}

function isDiscordMentionLine(line: string): boolean {
  return line
    .trim()
    .split(/\s+/)
    .every((token) => /^<@&?\d{5,32}>$/.test(token));
}

export async function sendDiscordBotMessageWithAttachment(
  env: Env,
  channelId: string,
  options: {
    content: string;
    filename: string;
    mimeType: string;
    data: string | Uint8Array;
    allowedMentions?: DiscordAllowedMentions;
  },
): Promise<string | null> {
  return sendDiscordBotMessageWithAttachments(env, channelId, {
    content: options.content,
    allowedMentions: options.allowedMentions,
    attachments: [
      {
        filename: options.filename,
        mimeType: options.mimeType,
        data: options.data,
      },
    ],
  });
}

export async function sendDiscordBotMessageWithAttachments(
  env: Env,
  channelId: string,
  options: {
    content: string;
    allowedMentions?: DiscordAllowedMentions;
    attachments: Array<{
      filename: string;
      mimeType: string;
      data: string | Uint8Array;
    }>;
  },
): Promise<string | null> {
  const botToken = readDiscordBotToken(env);

  if (options.content.length > MAX_DISCORD_MESSAGE_LENGTH) {
    throw new Error(`Discord message must be ${MAX_DISCORD_MESSAGE_LENGTH} characters or fewer`);
  }

  const form = new FormData();
  form.append("payload_json", JSON.stringify(discordPayload(options.content, options.allowedMentions)));
  options.attachments.forEach((attachment, index) => {
    form.append(
      `files[${index}]`,
      new Blob([attachment.data], { type: attachment.mimeType }),
      attachment.filename,
    );
  });

  const response = await postDiscordBotFormAndRead<DiscordMessage>(
    botToken,
    discordChannelMessagesPath(channelId),
    form,
  );
  return discordMessageId(response);
}

function readDiscordBotToken(env: Env): string {
  const token = env.DISCORD_BOT_TOKEN?.trim();
  if (!token) {
    throw new Error("DISCORD_BOT_TOKEN is not configured");
  }
  return token;
}

function discordMessageId(message: DiscordMessage): string | null {
  return typeof message.id === "string" && message.id ? message.id : null;
}

function discordChannelMessagesPath(channelId: string): string {
  return `/channels/${encodeURIComponent(channelId)}/messages`;
}

function discordChannelMessagePath(channelId: string, messageId: string): string {
  return `${discordChannelMessagesPath(channelId)}/${encodeURIComponent(messageId)}`;
}
