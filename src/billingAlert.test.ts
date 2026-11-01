import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleBillingAlert } from "./billingAlert";
import type { Env } from "./types";

const env = {
  BILLING_ALERT_WEBHOOK_SECRET: "test-webhook-secret",
  BILLING_ALERT_DISCORD_USER_ID: "327916221330620436",
  DISCORD_BOT_TOKEN: "test-bot-token",
} as Env;
const channelId = "123456789012345678";
const fetchMock = vi.fn<typeof fetch>();
const makeRequest = (body: unknown = { text: "Usage exceeded the threshold" }, secret: string | null = env.BILLING_ALERT_WEBHOOK_SECRET!) =>
  new Request("https://worker.test/billing-alert", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(secret === null ? {} : { "cf-webhook-auth": secret }) },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async url => Response.json({
    id: String(url).endsWith("/users/@me/channels") ? channelId : "987654321098765432",
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("billing alert webhook", () => {
  it("delivers Cloudflare's text-only test payload as a DM with mentions suppressed", async () => {
    const response = await handleBillingAlert(makeRequest({ text: "Hello @everyone" }), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [dmUrl, dmInit] = fetchMock.mock.calls[0];
    expect(dmUrl).toBe("https://discord.com/api/v10/users/@me/channels");
    expect(dmInit?.headers).toMatchObject({ Authorization: "Bot test-bot-token" });
    expect(JSON.parse(String(dmInit?.body))).toEqual({ recipient_id: env.BILLING_ALERT_DISCORD_USER_ID });
    const [messageUrl, messageInit] = fetchMock.mock.calls[1];
    expect(messageUrl).toBe(`https://discord.com/api/v10/channels/${channelId}/messages`);
    expect(JSON.parse(String(messageInit?.body))).toMatchObject({
      content: "Cloudflare usage alert\n\nHello @everyone",
      allowed_mentions: { parse: [], users: [], roles: [] }, enforce_nonce: true,
    });
  });

  it.each([null, "", "wrong-secret"])("rejects missing/invalid authentication: %j", async secret => {
    expect((await handleBillingAlert(makeRequest(undefined, secret), env)).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["BILLING_ALERT_WEBHOOK_SECRET", "BILLING_ALERT_DISCORD_USER_ID", "DISCORD_BOT_TOKEN"])("fails closed without %s", async key => {
    expect((await handleBillingAlert(makeRequest(), { ...env, [key]: "" })).status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects browser GET requests without contacting Discord", async () => {
    const response = await handleBillingAlert(new Request("https://worker.test/billing-alert"), env);
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([null, [], {}, { text: " " }, { text: 12 }])("rejects invalid payload %j", async body => {
    expect((await handleBillingAlert(makeRequest(body), env)).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON", async () => {
    const request = new Request(makeRequest(), { body: "{" });
    expect((await handleBillingAlert(request, env)).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("bounds the body even without a Content-Length header", async () => {
    expect((await handleBillingAlert(makeRequest({ text: "x".repeat(65536) }), env)).status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts normal alerts, bounds message length, and ignores recipient overrides", async () => {
    const payload = { text: "x".repeat(4000), policy_id: "policy", ts: 123, recipient_id: "999999999999999999" };
    expect((await handleBillingAlert(makeRequest(payload), env)).status).toBe(200);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).recipient_id).toBe(env.BILLING_ALERT_DISCORD_USER_ID);
    const message = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(message.content).toHaveLength(1900);
    expect(message.content.endsWith("…")).toBe(true);
  });

  it("uses the same nonce for retries and distinct nonces for different events", async () => {
    for (const ts of [123, 123, 456]) await handleBillingAlert(makeRequest({ text: "Alert", ts }), env);
    const nonces = [1, 3, 5].map(index => JSON.parse(String(fetchMock.mock.calls[index][1]?.body)).nonce);
    expect(nonces[0]).toBe(nonces[1]);
    expect(nonces[0]).not.toBe(nonces[2]);
    expect(nonces[0]).toHaveLength(25);
  });

  it.each([403, 429, 500])("does not acknowledge Discord failure %i or expose upstream details", async status => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockResolvedValue(Response.json({ message: "private details" }, { status }));
    const response = await handleBillingAlert(makeRequest(), env);
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("private details");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not acknowledge an unconfirmed message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(Response.json({ id: channelId })).mockResolvedValueOnce(Response.json({}));
    expect((await handleBillingAlert(makeRequest(), env)).status).toBe(502);
  });
});
