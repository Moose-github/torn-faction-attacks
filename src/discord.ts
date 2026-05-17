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
