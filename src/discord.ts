import { Env } from "./types";
import { json } from "./utils";

const MAX_DISCORD_MESSAGE_LENGTH = 1900;

export async function sendDiscordMessageFromRequest(request: Request, env: Env): Promise<Response> {
  if (!env.DISCORD_WEBHOOK_URL) {
    return json(
      { ok: false, error: "DISCORD_WEBHOOK_URL is not configured", code: "MISSING_DISCORD_WEBHOOK" },
      500,
    );
  }

  const body = (await request.json().catch(() => ({}))) as { message?: unknown };
  const message = typeof body.message === "string" ? body.message.trim() : "";
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

export async function sendDiscordMessage(env: Env, message: string): Promise<void> {
  if (!env.DISCORD_WEBHOOK_URL) {
    throw new Error("DISCORD_WEBHOOK_URL is not configured");
  }

  const response = await fetch(env.DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content: message }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Discord webhook failed: ${response.status}${text ? ` ${text}` : ""}`);
  }
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
  if (!env.DISCORD_WEBHOOK_URL) {
    throw new Error("DISCORD_WEBHOOK_URL is not configured");
  }

  if (options.content.length > MAX_DISCORD_MESSAGE_LENGTH) {
    throw new Error(`Discord message must be ${MAX_DISCORD_MESSAGE_LENGTH} characters or fewer`);
  }

  const form = new FormData();
  form.append("payload_json", JSON.stringify({ content: options.content }));
  form.append(
    "files[0]",
    new Blob([options.data], { type: options.mimeType }),
    options.filename,
  );

  const response = await fetch(env.DISCORD_WEBHOOK_URL, {
    method: "POST",
    body: form,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Discord webhook failed: ${response.status}${text ? ` ${text}` : ""}`);
  }
}
