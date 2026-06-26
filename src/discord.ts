import { cleanString, readJsonObject } from "./backend/request";
import { patchDiscordJson, postDiscordForm, postDiscordJson, postDiscordJsonAndRead } from "./external/discord";
import { Env } from "./types";
import { json } from "./utils";

const MAX_DISCORD_MESSAGE_LENGTH = 1900;

export type DiscordAllowedMentions = {
  users?: string[];
  roles?: string[];
};

type DiscordPayloadOptions = {
  embedColor?: number;
  clearEmbeds?: boolean;
  webhookUrl?: string;
};

export async function sendDiscordMessageFromRequest(request: Request, env: Env): Promise<Response> {
  if (!env.DISCORD_WEBHOOK_URL) {
    return json(
      { ok: false, error: "DISCORD_WEBHOOK_URL is not configured", code: "MISSING_DISCORD_WEBHOOK" },
      500,
    );
  }

  const body = await readJsonObject(request);
  const message = cleanString(body.message) ?? "";
  if (!message) {
    return json({ ok: false, error: "Message is required", code: "MISSING_MESSAGE" }, 400);
  }

  if (message.length > MAX_DISCORD_MESSAGE_LENGTH) {
    return json(
      {
        ok: false,
        error: `Message must be ${MAX_DISCORD_MESSAGE_LENGTH} characters or fewer`,
        code: "MESSAGE_TOO_LONG",
      },
      400,
    );
  }

  await sendDiscordMessage(env, message);
  return json({ ok: true, sent: true });
}

export async function sendDiscordMessage(
  env: Env,
  message: string,
  allowedMentions?: DiscordAllowedMentions,
): Promise<void> {
  if (!env.DISCORD_WEBHOOK_URL) {
    throw new Error("DISCORD_WEBHOOK_URL is not configured");
  }

  await postDiscordJson(env.DISCORD_WEBHOOK_URL, discordPayload(message, allowedMentions));
}

export async function createDiscordWebhookMessage(
  env: Env,
  message: string,
  allowedMentions?: DiscordAllowedMentions,
  options?: Pick<DiscordPayloadOptions, "embedColor" | "webhookUrl">,
): Promise<string | null> {
  const webhookUrl = options?.webhookUrl ?? env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    throw new Error("DISCORD_WEBHOOK_URL is not configured");
  }

  const response = await postDiscordJsonAndRead<DiscordWebhookMessage>(
    discordWebhookUrlWithQuery(webhookUrl, { wait: "true" }),
    discordPayload(message, allowedMentions, options),
  );

  return typeof response.id === "string" && response.id ? response.id : null;
}

export async function editDiscordWebhookMessage(
  env: Env,
  messageId: string,
  message: string,
  allowedMentions?: DiscordAllowedMentions,
  options?: Pick<DiscordPayloadOptions, "embedColor" | "webhookUrl">,
): Promise<void> {
  const webhookUrl = options?.webhookUrl ?? env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    throw new Error("DISCORD_WEBHOOK_URL is not configured");
  }

  await patchDiscordJson(
    discordWebhookMessageUrl(webhookUrl, messageId),
    discordPayload(message, allowedMentions, { ...options, clearEmbeds: options?.embedColor === undefined }),
  );
}

type DiscordWebhookMessage = {
  id?: unknown;
};

function discordPayload(
  content: string,
  allowedMentions?: DiscordAllowedMentions,
  options: DiscordPayloadOptions = {},
): {
  content: string;
  embeds?: Array<{
    title: string;
    description?: string;
    color: number;
  }>;
  allowed_mentions?: {
    parse: [];
    users?: string[];
    roles?: string[];
  };
} {
  const payload = options.embedColor === undefined
    ? {
      content,
      ...(options.clearEmbeds ? { embeds: [] } : {}),
    }
    : discordEmbedPayload(content, options.embedColor);

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

function discordWebhookMessageUrl(webhookUrl: string, messageId: string): string {
  const url = new URL(webhookUrl);
  const pathname = url.pathname.replace(/\/+$/, "");
  url.pathname = `${pathname}/messages/${encodeURIComponent(messageId)}`;
  url.searchParams.delete("wait");
  return url.toString();
}

function discordWebhookUrlWithQuery(webhookUrl: string, params: Record<string, string>): string {
  const url = new URL(webhookUrl);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url.toString();
}

export async function sendDiscordMessageWithAttachment(
  env: Env,
  options: {
    content: string;
    filename: string;
    mimeType: string;
    data: string | Uint8Array;
  },
): Promise<void> {
  return sendDiscordMessageWithAttachments(env, {
    content: options.content,
    attachments: [
      {
        filename: options.filename,
        mimeType: options.mimeType,
        data: options.data,
      },
    ],
  });
}

export async function sendDiscordMessageWithAttachments(
  env: Env,
  options: {
    content: string;
    attachments: Array<{
      filename: string;
      mimeType: string;
      data: string | Uint8Array;
    }>;
  },
): Promise<void> {
  if (!env.DISCORD_WEBHOOK_URL) {
    throw new Error("DISCORD_WEBHOOK_URL is not configured");
  }

  if (options.content.length > MAX_DISCORD_MESSAGE_LENGTH) {
    throw new Error(`Discord message must be ${MAX_DISCORD_MESSAGE_LENGTH} characters or fewer`);
  }

  const form = new FormData();
  form.append("payload_json", JSON.stringify({ content: options.content }));
  options.attachments.forEach((attachment, index) => {
    form.append(
      `files[${index}]`,
      new Blob([attachment.data], { type: attachment.mimeType }),
      attachment.filename,
    );
  });

  await postDiscordForm(env.DISCORD_WEBHOOK_URL, form);
}
