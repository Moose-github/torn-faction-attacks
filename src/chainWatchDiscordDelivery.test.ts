import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deliverChainWatchAlert, deleteWatchDiscordMessage, editWatchDiscordMessage, sendWatchDiscordMessage } from "./chainWatchDiscordDelivery";
import { upsertDiscordAlertMessage } from "./discordAlertDelivery";
import { isDiscordAlertEnabled } from "./discordAlertSettings";
import { readDiscordAlertMentions } from "./discordMentions";
import type { Env } from "./types";

vi.mock("./discordAlertDelivery", () => ({ upsertDiscordAlertMessage: vi.fn() }));
vi.mock("./discordAlertSettings", () => ({ isDiscordAlertEnabled: vi.fn() }));
vi.mock("./discordMentions", async importOriginal => ({
  ...await importOriginal<typeof import("./discordMentions")>(), readDiscordAlertMentions: vi.fn(),
}));

const env = { DISCORD_BOT_TOKEN: "fixture-token" } as Env;
const fetcher = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isDiscordAlertEnabled).mockResolvedValue(true);
  vi.mocked(readDiscordAlertMentions).mockResolvedValue({ messageSuffix: "", allowedMentions: undefined });
  vi.mocked(upsertDiscordAlertMessage).mockResolvedValue("alert-id");
  fetcher.mockReset().mockImplementation(async () => Response.json({ id: "message-id" }));
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("chain watch Discord delivery outcomes", () => {
  it("returns the delivered ID and preserves a stable nonce on retries", async () => {
    const payload = { content: "Reminder", allowed_mentions: { parse: [] } };
    expect(await sendWatchDiscordMessage(env, "channel", payload, "check-in:reminder"))
      .toEqual({ status: "success", value: "message-id" });
    await sendWatchDiscordMessage(env, "channel", payload, "check-in:reminder");
    const bodies = fetcher.mock.calls.map(call => JSON.parse(call[1].body));
    expect(bodies[0]).toEqual(bodies[1]);
    expect(bodies[0]).toMatchObject({ ...payload, enforce_nonce: true });
    // Keep the pre-refactor nonce format so a retry spans deployments safely.
    expect(bodies[0].nonce).toBe("02c9f10c2f4dc68209f5e137");
  });

  it.each(["network", "http", "missing id"])("returns failure for a %s problem without a success ID", async problem => {
    if (problem === "network") fetcher.mockRejectedValue(new Error("Connection lost"));
    else fetcher.mockImplementation(async () => Response.json({}, { status: problem === "http" ? 503 : 200 }));
    expect(await sendWatchDiscordMessage(env, "channel", {}, "reminder")).toEqual({ status: "failed", error: expect.any(Error) });
  });

  it.each([editWatchDiscordMessage, deleteWatchDiscordMessage])("distinguishes missing messages from failed edits/deletes", async deliver => {
    fetcher.mockImplementation(async () => Response.json({}, { status: 404 }));
    expect(await deliver(env, "channel", "message-id", {})).toEqual({ status: "skipped", reason: "not_found" });
    fetcher.mockImplementation(async () => Response.json({}, { status: 403 }));
    expect(await deliver(env, "channel", "message-id", {})).toEqual({ status: "failed", error: expect.any(Error) });
  });

  it("distinguishes muted alerts, missing routes and failed sends", async () => {
    vi.mocked(isDiscordAlertEnabled).mockResolvedValue(false);
    expect(await deliverChainWatchAlert(env, null, "Warning")).toEqual({ status: "skipped", reason: "disabled" });
    expect(upsertDiscordAlertMessage).not.toHaveBeenCalled();
    vi.mocked(isDiscordAlertEnabled).mockResolvedValue(true);
    vi.mocked(upsertDiscordAlertMessage).mockResolvedValue(null);
    expect(await deliverChainWatchAlert(env, null, "Warning")).toEqual({ status: "skipped", reason: "no_route" });
    const error = new Error("Discord unavailable");
    vi.mocked(upsertDiscordAlertMessage).mockRejectedValue(error);
    expect(await deliverChainWatchAlert(env, "old-id", "Warning")).toEqual({ status: "failed", error });
  });

  it("preserves prepared watcher mentions and the alert route", async () => {
    const options = { message: "Warning <@123456>", allowedMentions: { users: ["123456"], roles: [] } };
    expect(await deliverChainWatchAlert(env, null, options, 0xffa500, "chain_watch_warning"))
      .toEqual({ status: "success", value: "alert-id" });
    expect(upsertDiscordAlertMessage).toHaveBeenCalledWith(env, "chain_watch_warning", null, options.message,
      options.allowedMentions, { cardColor: 0xffa500 });
    expect(readDiscordAlertMentions).not.toHaveBeenCalled();
  });
});
