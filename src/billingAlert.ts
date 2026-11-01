import { isRecord } from "./backend/request";
import { createDiscordBotMessage } from "./discord";
import { postDiscordBotJsonAndRead } from "./external/discord";
import type { Env } from "./types";

const MAX_BODY_BYTES = 64 * 1024;
const DISCORD_ID = /^\d{17,20}$/;

/** Cloudflare generic webhook destination; independent of dashboard session auth. */
export async function handleBillingAlert(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
  }
  const secret = env.BILLING_ALERT_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: "Billing alerts are not configured" }, { status: 503 });
  const suppliedSecret = request.headers.get("cf-webhook-auth");
  if (!suppliedSecret || !(await secretsMatch(secret, suppliedSecret))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const recipient = env.BILLING_ALERT_DISCORD_USER_ID?.trim() ?? "";
  const token = env.DISCORD_BOT_TOKEN?.trim();
  if (!DISCORD_ID.test(recipient) || !token) {
    return Response.json({ error: "Billing alerts are not configured" }, { status: 503 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(await readBoundedBody(request));
  } catch (error) {
    return Response.json({ error: "Invalid webhook body" }, { status: error instanceof RangeError ? 413 : 400 });
  }
  if (!isRecord(payload) || typeof payload.text !== "string" || !payload.text.trim()) {
    return Response.json({ error: "Webhook must contain non-empty text" }, { status: 400 });
  }

  // Cloudflare's Save and Test payload contains only text. Real alerts can also
  // contain policy metadata, but no payload field can override the recipient.
  const message = `Cloudflare usage alert\n\n${payload.text.trim()}`;
  const content = message.length > 1900 ? `${message.slice(0, 1899)}…` : message;
  try {
    const channel = await postDiscordBotJsonAndRead<{ id?: unknown }>(
      token, "/users/@me/channels", { recipient_id: recipient }, { timeoutMs: 8000 },
    );
    if (!channel || typeof channel.id !== "string" || !DISCORD_ID.test(channel.id)) {
      throw new Error("Discord did not return a DM channel");
    }
    // Discord enforces matching nonces for a short window, limiting duplicate
    // DMs if Cloudflare retries after an uncertain response. No D1 writes needed.
    const digest = await hash(JSON.stringify(payload));
    const nonce = `b${Array.from(digest.slice(0, 12), byte => byte.toString(16).padStart(2, "0")).join("")}`;
    const messageId = await createDiscordBotMessage(env, channel.id, content, undefined, { nonce, timeoutMs: 8000 });
    if (!messageId) throw new Error("Discord did not confirm delivery");
    return Response.json({ ok: true });
  } catch {
    // Do not acknowledge until Discord confirms receipt, or expose upstream data.
    console.error("Billing alert Discord delivery failed");
    return Response.json({ error: "Discord delivery failed" }, { status: 502 });
  }
}

async function hash(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function secretsMatch(expected: string, supplied: string): Promise<boolean> {
  const [left, right] = await Promise.all([hash(expected), hash(supplied)]);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}

async function readBoundedBody(request: Request): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let size = 0;
  let body = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new RangeError("Webhook too large");
      }
      body += decoder.decode(value, { stream: true });
    }
    return body + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}
