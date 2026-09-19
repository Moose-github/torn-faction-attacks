import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { discordRouteDatabase } from "../scripts/discord-route-test-database.mjs";
import { getAdminDiscordRouteDestinations, updateAdminDiscordRouteFromRequest } from "./discordRouteAdmin";
import { readConfiguredDiscordNotificationChannel } from "./discordNotificationChannels";
import { fetchExternal } from "./external/http";

vi.mock("./external/http", () => ({ fetchExternal: vi.fn() }));
let db: ReturnType<typeof discordRouteDatabase>;
const channel = { id: "222222", guild_id: "111111", type: 0, name: "war-alerts" };
const otherChannel = { ...channel, id: "444444", name: "travel" };
const thread = { ...channel, id: "333333", type: 11, name: "War planning", parent_id: channel.id };
const payload = { alert_key: "chain_watch_warning", target_id: channel.id };
const request = (body: unknown) => new Request("https://worker.test/api/admin/discord-alerts/routes", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const rows = async () => (await db.env.DB.prepare("SELECT * FROM discord_notification_channels ORDER BY guild_id, alert_key").all()).results;

beforeEach(() => {
  vi.resetAllMocks(); db = discordRouteDatabase();
  db.sqlite.exec(`INSERT INTO alert_settings (alert_key, enabled) VALUES ('chain_watch_warning', 0);
    INSERT INTO discord_notification_channels (guild_id, alert_key, channel_id) VALUES
    ('111111', 'default', '444444'), ('111111', 'enemy_push', '444444'), ('999999', 'chain_watch_warning', '555555');`);
  vi.mocked(fetchExternal).mockImplementation(async (url) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/guilds/111111/channels")) return Response.json([channel, otherChannel]);
    if (path.endsWith("/threads/active")) return Response.json({ threads: [thread] });
    if (path.endsWith(`/channels/${thread.id}`)) return Response.json(thread);
    if (path.endsWith(`/channels/${channel.id}`)) return Response.json(channel);
    return new Response(null, { status: 404 });
  });
});
afterEach(() => db.sqlite.close());

describe("admin Discord route editor", () => {
  it("lists named text channels and active threads while excluding unsupported destinations", async () => {
    vi.mocked(fetchExternal).mockImplementation(async (url) => Response.json(String(url).endsWith("/channels")
      ? [channel, { ...channel, id: "555555", type: 4 }, { ...channel, id: "666666", type: 15 }]
      : { threads: [thread, { ...thread, id: "777777", thread_metadata: { archived: true } }, { ...thread, id: "888888", guild_id: "999999" }] }));
    expect(await (await getAdminDiscordRouteDestinations(db.env)).json()).toEqual({
      ok: true, threads_error: null, destinations: [
        { id: channel.id, name: channel.name, kind: "channel", parent_name: null },
        { id: thread.id, name: thread.name, kind: "thread", parent_name: channel.name },
      ],
    });
  });

  it("still offers channels when Discord cannot list active threads", async () => {
    vi.mocked(fetchExternal).mockImplementation(async (url) => String(url).endsWith("/channels")
      ? Response.json([channel]) : new Response(null, { status: 403 }));
    expect(await (await getAdminDiscordRouteDestinations(db.env)).json()).toMatchObject({
      ok: true, destinations: [{ id: channel.id }], threads_error: expect.any(String),
    });
  });

  it("changes only the requested assignment and preserves mute settings", async () => {
    const before = await rows();
    const response = await updateAdminDiscordRouteFromRequest(request(payload), db.env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ routes: { chain_watch_warning: { channel_id: channel.id, channel_name: channel.name } } });
    expect(await rows()).toEqual(expect.arrayContaining(before!));
    expect(await readConfiguredDiscordNotificationChannel(db.env, "chain_watch_warning")).toMatchObject({ channelId: channel.id, threadId: null });
    expect(await db.env.DB.prepare("SELECT enabled FROM alert_settings WHERE alert_key = 'chain_watch_warning'").first()).toEqual({ enabled: 0 });
    expect(vi.mocked(fetchExternal).mock.calls.every(([, init]) => !init.method || init.method === "GET")).toBe(true);
  });

  it("stores a verified thread and its parent channel", async () => {
    expect((await updateAdminDiscordRouteFromRequest(request({ ...payload, target_id: thread.id }), db.env)).status).toBe(200);
    expect(await readConfiguredDiscordNotificationChannel(db.env, "chain_watch_warning")).toMatchObject({ channelId: channel.id, threadId: thread.id });
  });

  it("clears an assignment back to the default without Discord access or changing other routes", async () => {
    await updateAdminDiscordRouteFromRequest(request(payload), db.env);
    db.env.DISCORD_BOT_TOKEN = "";
    const response = await updateAdminDiscordRouteFromRequest(request({ ...payload, target_id: null }), db.env);
    expect(response.status).toBe(200);
    expect(await readConfiguredDiscordNotificationChannel(db.env, "chain_watch_warning")).toMatchObject({ alertKey: "default", channelId: otherChannel.id });
    expect((await rows())?.some(row => row.guild_id === "999999" && row.alert_key === payload.alert_key)).toBe(true);
  });

  it("can change or clear the default route itself", async () => {
    expect((await updateAdminDiscordRouteFromRequest(request({ ...payload, alert_key: "default" }), db.env)).status).toBe(200);
    expect(await readConfiguredDiscordNotificationChannel(db.env, "home_travel_tracker")).toMatchObject({ channelId: channel.id });
    expect((await updateAdminDiscordRouteFromRequest(request({ alert_key: "default", target_id: null }), db.env)).status).toBe(200);
    expect(await readConfiguredDiscordNotificationChannel(db.env, "home_travel_tracker")).toBeNull();
  });

  it.each([{ ...payload, alert_key: "unknown" }, { ...payload, target_id: "bad/id" }, { alert_key: payload.alert_key }, { ...payload, target_id: 222222 }])
    ("rejects invalid inputs without changing assignments: %j", async body => {
      const before = await rows();
      expect((await updateAdminDiscordRouteFromRequest(request(body), db.env)).status).toBe(400);
      expect(await rows()).toEqual(before); expect(fetchExternal).not.toHaveBeenCalled();
    });

  it.each([
    { ...channel, guild_id: "999999" }, { ...channel, id: "999999" }, { ...channel, type: 4 },
    { ...thread, id: channel.id, thread_metadata: { locked: true } },
    { ...thread, id: channel.id, thread_metadata: { archived: true } },
  ])("rejects invalid or unavailable destinations before saving: %j", async result => {
    vi.mocked(fetchExternal).mockResolvedValue(Response.json(result));
    const before = await rows();
    expect((await updateAdminDiscordRouteFromRequest(request(payload), db.env)).status).toBe(400);
    expect(await rows()).toEqual(before);
  });

  it.each([403, 404, 429, 500])("preserves assignments when Discord responds with %s", async status => {
    vi.mocked(fetchExternal).mockResolvedValue(new Response(null, { status }));
    const before = await rows();
    expect((await updateAdminDiscordRouteFromRequest(request(payload), db.env)).status).toBeGreaterThanOrEqual(400);
    expect(await rows()).toEqual(before);
  });
});
