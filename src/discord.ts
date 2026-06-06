import { cleanString, readJsonObject } from "./backend/request";
import { postDiscordForm, postDiscordJson } from "./external/discord";
import { Env } from "./types";
import { json } from "./utils";

const MAX_DISCORD_MESSAGE_LENGTH = 1900;

export type DiscordAllowedMentions = {
  users?: string[];
  roles?: string[];
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

function discordPayload(content: string, allowedMentions?: DiscordAllowedMentions): {
  content: string;
  allowed_mentions?: {
    parse: [];
    users?: string[];
    roles?: string[];
  };
} {
  if (!allowedMentions) {
    return { content };
  }

  return {
    content,
    allowed_mentions: {
      parse: [],
      users: allowedMentions.users ?? [],
      roles: allowedMentions.roles ?? [],
    },
  };
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
