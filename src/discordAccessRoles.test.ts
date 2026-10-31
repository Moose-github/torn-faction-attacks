import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authDatabase } from "../scripts/auth-test-database.mjs";
import { authenticateWithTornKey, getCurrentAuthSession, requireAdmin, requireMember } from "./auth";
import { HOME_FACTION_ID } from "./constants";
import { readDiscordAccessRoles } from "./discordAccessRoles";
import { fetchExternal } from "./external/http";
import { fetchTrackedTornJson } from "./external/torn";

vi.mock("./external/http", () => ({ fetchExternal: vi.fn() }));
vi.mock("./external/torn", () => ({ fetchTrackedTornJson: vi.fn() }));

const organizerId = "889777697268576276", officerId = "1551674982701076621";
const guildId = "111111111111111111", discordUserId = "222222222222222222";
let db: ReturnType<typeof authDatabase>;
function login() {
  return authenticateWithTornKey(new Request("https://example.test/api/auth/torn", {
    method: "POST", body: JSON.stringify({ key: "fixture-torn-key", roles: ["officer"], access_level: "admin" }),
  }), db.env);
}
function authenticated(token: string) {
  return new Request("https://example.test/api/auth/me", { headers: { Authorization: `Bearer ${token}` } });
}

beforeEach(() => {
  vi.resetAllMocks();
  db = authDatabase();
  db.env.DISCORD_GUILD_ID = guildId;
  db.env.DISCORD_BOT_TOKEN = "fixture-bot-token";
  db.sqlite.prepare("UPDATE discord_member_links SET discord_user_id = ? WHERE torn_user_id = 1").run(discordUserId);
  vi.mocked(fetchExternal).mockResolvedValue(Response.json({ roles: [] }));
  vi.mocked(fetchTrackedTornJson).mockResolvedValue({
    info: { user: { id: 1, name: "Alice", faction_id: HOME_FACTION_ID }, access: { faction: false } },
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { db.sqlite.close(); vi.restoreAllMocks(); });

describe("independent Discord access roles", () => {
  it.each([
    { discord: [], expected: [] },
    { discord: [organizerId], expected: ["event_organizer"] },
    { discord: [officerId], expected: ["officer"] },
    { discord: [officerId, organizerId, organizerId, "999999"], expected: ["event_organizer", "officer"] },
  ])("assigns only matching roles: $expected, without admin privileges", async ({ discord, expected }) => {
    vi.mocked(fetchExternal).mockResolvedValue(Response.json({ roles: discord }));
    const result = await login();
    expect(result.status).toBe(200);
    const session = await result.json<{ token: string; roles: string[]; access_level: string }>();
    expect(session.roles).toEqual(expected);
    expect(session.access_level).toBe("member");
    expect(db.sqlite.prepare("SELECT * FROM admin_users").all()).toEqual([]);
    expect(await requireMember(authenticated(session.token), db.env)).toBeNull();
    expect((await requireAdmin(authenticated(session.token), db.env))?.status).toBe(403);
    expect(fetchExternal).toHaveBeenCalledTimes(1);
    expect(fetchExternal).toHaveBeenCalledWith(
      `https://discord.com/api/v10/guilds/${guildId}/members/${discordUserId}`,
      { headers: { Authorization: "Bot fixture-bot-token" } }, { timeoutMs: 10_000 },
    );
  });

  it("refreshes assignments and removes roles independently, including server departure", async () => {
    const { token } = await (await login()).json<{ token: string }>();
    for (const discord of [[officerId, organizerId], [organizerId], [], [officerId]]) {
      vi.mocked(fetchExternal).mockResolvedValue(Response.json({ roles: discord }));
      const session = await (await getCurrentAuthSession(authenticated(token), db.env)).json<{ roles: string[] }>();
      expect(session.roles).toEqual([
        ...(discord.includes(organizerId) ? ["event_organizer"] : []),
        ...(discord.includes(officerId) ? ["officer"] : []),
      ]);
    }
    vi.mocked(fetchExternal).mockResolvedValue(new Response(null, { status: 404 }));
    expect(await (await getCurrentAuthSession(authenticated(token), db.env)).json()).toMatchObject({ roles: [] });
  });

  it("preserves explicit admin access independently of Discord roles", async () => {
    db.sqlite.exec("INSERT INTO admin_users (torn_user_id) VALUES (1)");
    vi.mocked(fetchExternal).mockResolvedValue(Response.json({ roles: [officerId] }));
    const session = await (await login()).json<{ token: string; roles: string[]; access_level: string }>();
    expect(session).toMatchObject({ access_level: "admin", roles: ["officer"] });
    expect(await requireAdmin(authenticated(session.token), db.env)).toBeNull();
    vi.mocked(fetchExternal).mockResolvedValue(Response.json({ roles: [] }));
    expect(await (await getCurrentAuthSession(authenticated(session.token), db.env)).json())
      .toMatchObject({ access_level: "admin", roles: [] });
  });

  it.each(["missing link", "invalid link", "missing bot", "invalid guild"])("handles %s without a Discord request", async kind => {
    if (kind === "missing link") db.sqlite.exec("DELETE FROM discord_member_links");
    if (kind === "invalid link") db.sqlite.exec("UPDATE discord_member_links SET discord_user_id = 'invalid'");
    if (kind === "missing bot") db.env.DISCORD_BOT_TOKEN = undefined;
    if (kind === "invalid guild") db.env.DISCORD_GUILD_ID = "invalid";
    expect(await readDiscordAccessRoles(db.env, 1)).toEqual([]);
    expect(fetchExternal).not.toHaveBeenCalled();
  });

  it.each([403, 404, 429, 500])("does not block login or retain unverified roles after Discord HTTP %s", async status => {
    vi.mocked(fetchExternal).mockResolvedValue(new Response(null, { status }));
    expect(await (await login()).json()).toMatchObject({ ok: true, access_level: "member", roles: [] });
  });

  it.each([null, {}, { roles: "officer" }, { roles: [Number(officerId)] }])("rejects malformed Discord membership: %j", async body => {
    vi.mocked(fetchExternal).mockResolvedValue(Response.json(body));
    expect(await readDiscordAccessRoles(db.env, 1)).toEqual([]);
  });

  it("handles network failures without exposing upstream credentials", async () => {
    vi.mocked(fetchExternal).mockRejectedValue(new Error("fixture-bot-token sensitive"));
    const result = await login();
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ roles: [] });
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("fixture-bot-token");
  });

  it("does not query Discord for an unauthenticated request or non-faction login", async () => {
    expect((await getCurrentAuthSession(authenticated("invalid-session"), db.env)).status).toBe(401);
    vi.mocked(fetchTrackedTornJson).mockResolvedValue({ info: { user: { id: 1, faction_id: 123 }, access: {} } });
    expect((await login()).status).toBe(403);
    expect(fetchExternal).not.toHaveBeenCalled();
  });
});
