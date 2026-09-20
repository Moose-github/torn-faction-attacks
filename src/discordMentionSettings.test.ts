import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { discordMentionsDatabase } from "../scripts/discord-mentions-test-database.mjs";
import { getAdminDiscordAlertMentions, updateAdminDiscordAlertMentionsFromRequest } from "./discordMentionSettings";
import { readDiscordAlertMentions } from "./discordMentions";
import { fetchExternal } from "./external/http";
import type { AdminDiscordAlertMentionsResponse } from "../shared/discordAlertMentions";

vi.mock("./external/http", () => ({ fetchExternal: vi.fn() }));
let db: ReturnType<typeof discordMentionsDatabase>;
const role = "222222", otherRole = "333333";
const body = { alert_key: "chain_watch_warning", role_ids: [role], everyone: false, here: false };
function update(payload: unknown = body) {
  return updateAdminDiscordAlertMentionsFromRequest(new Request("https://worker.test/api/admin/discord-alerts/mentions", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  }), db.env);
}
async function rows() { return (await db.env.DB.prepare("SELECT * FROM discord_admin_alert_subscriptions ORDER BY id").all()).results; }
beforeEach(() => {
  vi.clearAllMocks(); db = discordMentionsDatabase();
  vi.mocked(fetchExternal).mockImplementation(async () => Response.json([
    { id: "111111", name: "@everyone", position: 0 },
    { id: role, name: "Watchers", position: 1 }, { id: otherRole, name: "Officers", position: 2 },
  ]));
});
afterEach(() => db.sqlite.close());

describe("admin alert mention settings", () => {
  it("lists settings and named faction roles, separating @everyone from roles", async () => {
    const result = await (await getAdminDiscordAlertMentions(db.env)).json<AdminDiscordAlertMentionsResponse>();
    expect(result.alerts.chain_watch_warning).toEqual({ role_ids: [], everyone: false, here: false });
    expect(result.alerts.chain_watch_missed_check_in).toBeDefined();
    expect(result.alerts.chain_watch_unfilled_slot).toEqual({ role_ids: [], everyone: false, here: false });
    expect(result.roles).toEqual([{ id: otherRole, name: "Officers" }, { id: role, name: "Watchers" }]);
    expect(fetchExternal).toHaveBeenCalledWith("https://discord.com/api/v10/guilds/111111/roles", { headers: { Authorization: "Bot fixture-token" } }, { timeoutMs: 10000 });
  });
  it("saves roles and broadcasts atomically without changing users, members or other alerts", async () => {
    db.sqlite.exec(`INSERT INTO discord_admin_alert_subscriptions (alert_key, subscription_type, discord_id) VALUES
      ('chain_watch_warning', 'user', '444444'), ('enemy_push', 'role', '${otherRole}');
      INSERT INTO discord_member_alert_subscriptions (torn_user_id, alert_key, enabled) VALUES (1, 'chain_watch_warning', 1);
      UPDATE discord_member_links SET discord_user_id = '555555' WHERE torn_user_id = 1;`);
    expect((await update({ ...body, role_ids: [role, role], everyone: true, here: true })).status).toBe(200);
    expect(await readDiscordAlertMentions(db.env, body.alert_key)).toEqual({
      messageSuffix: `<@444444> <@555555> <@&${role}> @everyone @here`,
      allowedMentions: { users: ["444444", "555555"], roles: [role], everyone: true },
    });
    expect(await readDiscordAlertMentions(db.env, "enemy_push")).toMatchObject({ messageSuffix: `<@&${otherRole}>` });
    expect((await rows()).filter(row => row.subscription_type === "role")).toHaveLength(2);
    expect((await update({ ...body, role_ids: [], everyone: false, here: false })).status).toBe(200);
    expect(await readDiscordAlertMentions(db.env, body.alert_key)).toEqual({ messageSuffix: "<@444444> <@555555>", allowedMentions: { users: ["444444", "555555"], roles: [] } });
  });
  it.each(["everyone", "here"])("supports %s on its own with no roles", async key => {
    expect((await update({ ...body, role_ids: [], [key]: true })).status).toBe(200);
    expect(await readDiscordAlertMentions(db.env, body.alert_key)).toEqual({ messageSuffix: `@${key}`, allowedMentions: { users: [], roles: [], everyone: true } });
  });
  it.each([
    { ...body, alert_key: "default" }, { ...body, alert_key: "unknown" }, { ...body, role_ids: ["not-an-id"] },
    { ...body, role_ids: [222222] }, { ...body, role_ids: Array(21).fill(role) }, { ...body, role_ids: null },
    { ...body, everyone: "true" }, { ...body, here: undefined },
  ])("rejects invalid requests without writes: %j", async payload => {
    expect((await update(payload)).status).toBe(400); expect(await rows()).toEqual([]);
  });
  it.each(["999999", "111111"])("rejects missing roles and the guild's everyone role: %s", async id => {
    expect((await update({ ...body, role_ids: [id] })).status).toBe(400); expect(await rows()).toEqual([]);
  });
  it.each([403, 429, 500])("keeps saved settings when Discord role lookup fails with %s", async status => {
    await update();
    vi.mocked(fetchExternal).mockResolvedValue(new Response(null, { status }));
    expect((await update({ ...body, role_ids: [otherRole] })).status).toBe(502);
    const result = await (await getAdminDiscordAlertMentions(db.env)).json<AdminDiscordAlertMentionsResponse>();
    expect(result.alerts[body.alert_key].role_ids).toEqual([role]);
    expect(result.roles_error).toBeTruthy(); expect(result.roles).toEqual([]);
  });
  it("redacts network errors", async () => {
    vi.mocked(fetchExternal).mockRejectedValue(new Error("Discord fixture-token sensitive"));
    const result = await update(); expect(await result.text()).not.toContain("fixture-token");
  });
  it("rolls back the old settings when an insert fails", async () => {
    await update();
    db.sqlite.exec(`CREATE TRIGGER reject_broadcast BEFORE INSERT ON discord_admin_alert_subscriptions
      WHEN NEW.subscription_type = 'everyone' BEGIN SELECT RAISE(ABORT, 'test failure'); END;`);
    await expect(update({ ...body, role_ids: [otherRole], everyone: true })).rejects.toThrow("test failure");
    expect(await readDiscordAlertMentions(db.env, body.alert_key)).toMatchObject({ messageSuffix: `<@&${role}>` });
  });
  it("migrates old subscriptions without losing ids, flags or timestamps", async () => {
    db.sqlite.close(); db = discordMentionsDatabase(false);
    db.sqlite.exec(`INSERT INTO discord_admin_alert_subscriptions (id, alert_key, subscription_type, discord_id, enabled, created_at, updated_at)
      VALUES (7, 'enemy_push', 'role', '${role}', 0, 10, 20), (8, 'chain_watch_warning', 'user', '444444', 1, 11, 22);`);
    const before = await rows(); db.applyMigration(); expect(await rows()).toEqual(before);
    await update({ ...body, everyone: true });
    expect((await rows()).some(row => row.subscription_type === "everyone")).toBe(true);
  });
});
