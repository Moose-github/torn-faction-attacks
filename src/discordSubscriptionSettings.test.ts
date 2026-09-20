import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discordMentionsDatabase } from "../scripts/discord-mentions-test-database.mjs";
import type { AdminDiscordSubscriptionSettingsResponse } from "../shared/discordSubscriptionSettings";
import { DISCORD_ALERTS } from "./discordAlerts";
import { DISCORD_COMPONENT_IDS } from "./discordCommands";
import { handleVerifiedDiscordInteraction, type DiscordInteraction } from "./discordInteractions";
import { readDiscordMemberAlertSubscriptions, updateDiscordMemberAlertSubscriptionFromRequest } from "./discordMemberAlertSubscriptions";
import { readDiscordAlertMentions } from "./discordMentions";
import { getAdminDiscordSubscriptionSettings, updateAdminDiscordSubscriptionSettingFromRequest } from "./discordSubscriptionSettings";

let db: ReturnType<typeof discordMentionsDatabase>;
const discordId = "111111111111111111";
const request = (body: unknown) => new Request("https://worker.test/api/admin/discord-alerts/subscriptions", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const update = (alert_key: string, subscribable: boolean) => updateAdminDiscordSubscriptionSettingFromRequest(request({ alert_key, subscribable }), db.env);
const subscribe = (alert_key: string, enabled: boolean) => updateDiscordMemberAlertSubscriptionFromRequest(request({ alert_key, enabled }), db.env, 1);
const command = (name: string, linked = true) => handleVerifiedDiscordInteraction({ type: 2,
  member: { user: { id: linked ? discordId : "999999" } }, data: { name: "alerts", options: [{ type: 1, name }] },
}, db.env);
const component = (data: DiscordInteraction["data"]) => handleVerifiedDiscordInteraction({ type: 3,
  member: { user: { id: discordId } }, data,
}, db.env);
async function settings() { return (await getAdminDiscordSubscriptionSettings(db.env)).json<AdminDiscordSubscriptionSettingsResponse>(); }
async function saved() { return (await db.env.DB.prepare("SELECT * FROM discord_member_alert_subscriptions ORDER BY alert_key").all()).results; }
beforeEach(() => {
  db = discordMentionsDatabase();
  db.sqlite.exec(`UPDATE discord_member_links SET discord_user_id = '${discordId}' WHERE torn_user_id = 1`);
});
afterEach(() => db.sqlite.close());

describe("admin-controlled Discord subscription availability", () => {
  it("preserves current defaults without enrolling any members", async () => {
    const data = await settings();
    expect(Object.keys(data.alerts)).toHaveLength(DISCORD_ALERTS.length);
    for (const alert of DISCORD_ALERTS) expect(data.alerts[alert.key]).toEqual({ subscribable: alert.subscribable, subscriber_count: 0 });
    expect(await saved()).toEqual([]);
  });

  it("hides disabled alerts in both UIs, pauses only member mentions, and restores saved choices", async () => {
    await subscribe("enemy_push", true);
    db.sqlite.exec(`INSERT INTO discord_admin_alert_subscriptions (alert_key, subscription_type, discord_id) VALUES
      ('enemy_push', 'role', '222222'), ('enemy_push', 'user', '333333'), ('enemy_push', 'everyone', 'everyone')`);
    const before = await saved();
    expect((await update("enemy_push", false)).status).toBe(200);
    expect((await settings()).alerts.enemy_push).toEqual({ subscribable: false, subscriber_count: 1 });
    expect((await readDiscordMemberAlertSubscriptions(db.env, 1)).alerts.some(alert => alert.key === "enemy_push")).toBe(false);
    expect(JSON.stringify((await command("manage")).data?.components)).not.toContain("enemy_push");
    expect(JSON.stringify((await command("list")).data?.embeds)).not.toContain("Enemy push");
    expect((await subscribe("enemy_push", false)).status).toBe(400);
    expect(await saved()).toEqual(before);
    expect((await readDiscordAlertMentions(db.env, "enemy_push")).allowedMentions).toEqual({ users: ["333333"], roles: ["222222"], everyone: true });
    await update("enemy_push", true);
    expect((await readDiscordMemberAlertSubscriptions(db.env, 1)).alerts.find(alert => alert.key === "enemy_push")?.enabled).toBe(true);
    expect((await readDiscordAlertMentions(db.env, "enemy_push")).allowedMentions?.users).toContain(discordId);
    expect(await saved()).toEqual(before);
  });

  it("allows members to select and subscribe to a newly enabled alert through Discord", async () => {
    await update("enemy_scouting_report", true);
    const available = await readDiscordMemberAlertSubscriptions(db.env, 1);
    expect(available.alerts.find(alert => alert.key === "enemy_scouting_report")?.enabled).toBe(false);
    const pending = await component({ custom_id: DISCORD_COMPONENT_IDS.alertsManageSelect, values: ["enemy_scouting_report"] });
    const submitId = pending.data?.components?.[1]?.components?.[1]?.custom_id;
    expect(submitId).toBeTruthy();
    expect(submitId!.length).toBeLessThanOrEqual(100);
    const response = await component({ custom_id: submitId });
    expect(response.data?.embeds?.[0]?.description).toBe("Saved your alert subscriptions.");
    expect((await readDiscordMemberAlertSubscriptions(db.env, 1)).alerts.find(alert => alert.key === "enemy_scouting_report")?.enabled).toBe(true);
    expect((await readDiscordAlertMentions(db.env, "enemy_scouting_report")).allowedMentions?.users).toEqual([discordId]);
  });

  it("refreshes stale menus without shifting selections or changing saved subscriptions", async () => {
    await subscribe("chain_watch_warning", true);
    const pending = await component({ custom_id: DISCORD_COMPONENT_IDS.alertsManageSelect, values: ["chain_watch_critical"] });
    const submitId = pending.data?.components?.[1]?.components?.[1]?.custom_id;
    await update("chain_watch_warning", false);
    const before = await saved();
    const response = await component({ custom_id: submitId });
    expect(response.data?.embeds?.[0]?.description).toContain("available alerts have changed");
    expect(JSON.stringify(response.data?.components)).not.toContain('"value":"chain_watch_warning"');
    expect(await saved()).toEqual(before);
    const reviewed = await component({ custom_id: DISCORD_COMPONENT_IDS.alertsManageSelect, values: ["chain_watch_critical"] });
    await component({ custom_id: reviewed.data?.components?.[1]?.components?.[1]?.custom_id });
    await update("chain_watch_warning", true);
    const choices = await readDiscordMemberAlertSubscriptions(db.env, 1);
    expect(choices.alerts.find(alert => alert.key === "chain_watch_warning")?.enabled).toBe(true);
    expect(choices.alerts.find(alert => alert.key === "chain_watch_critical")?.enabled).toBe(true);
  });

  it.each(["1", "v2:garbage:1", "v2:ffff:ffff"])("refreshes old or invalid submit buttons (%s) without writing", async mask => {
    await subscribe("enemy_push", true);
    const before = await saved();
    const response = await component({ custom_id: `${DISCORD_COMPONENT_IDS.alertsManageSubmitPrefix}${mask}` });
    expect(response.data?.embeds?.[0]?.description).toContain("menu has expired");
    expect(await saved()).toEqual(before);
  });

  it("handles every alert being unavailable, including unlinked /alerts list", async () => {
    for (const alert of DISCORD_ALERTS) await update(alert.key, false);
    expect((await readDiscordMemberAlertSubscriptions(db.env, 1)).alerts).toEqual([]);
    const response = await command("manage");
    expect(response.data?.components).toEqual([]);
    expect(response.data?.embeds?.[0]?.description).toContain("No subscribable alerts");
    expect((await command("list", false)).data?.embeds?.[0]?.fields).toEqual([]);
  });

  it("rejects a stale member save even if availability changes during the request", async () => {
    await subscribe("enemy_push", true);
    const before = await saved();
    const originalPrepare = db.env.DB.prepare.bind(db.env.DB);
    db.env.DB.prepare = sql => {
      if (sql.includes("INSERT INTO discord_member_alert_subscriptions")) {
        db.sqlite.exec("INSERT INTO discord_alert_subscription_settings (alert_key, subscribable) VALUES ('enemy_push', 0)");
      }
      return originalPrepare(sql);
    };
    expect((await subscribe("enemy_push", false)).status).toBe(400);
    expect(await saved()).toEqual(before);
  });

  it("reports a Discord save that loses availability instead of claiming every choice was saved", async () => {
    await subscribe("enemy_push", true);
    const pending = await component({ custom_id: DISCORD_COMPONENT_IDS.alertsManageSelect, values: [] });
    const originalPrepare = db.env.DB.prepare.bind(db.env.DB);
    db.env.DB.prepare = sql => {
      if (sql.includes("INSERT INTO discord_member_alert_subscriptions")) {
        db.sqlite.exec("INSERT OR IGNORE INTO discord_alert_subscription_settings (alert_key, subscribable) VALUES ('enemy_push', 0)");
      }
      return originalPrepare(sql);
    };
    const response = await component({ custom_id: pending.data?.components?.[1]?.components?.[1]?.custom_id });
    expect(response.data?.embeds?.[0]?.description).toContain("changed availability while saving");
    expect(await db.env.DB.prepare("SELECT enabled FROM discord_member_alert_subscriptions WHERE alert_key = 'enemy_push'").first()).toEqual({ enabled: 1 });
  });

  it.each([{}, null, { alert_key: "default", subscribable: true }, { alert_key: "missing", subscribable: true },
    { alert_key: "enemy_push", subscribable: 1 }, { alert_key: "enemy_push", subscribable: "false" },
  ])("rejects invalid admin settings without writing: %j", async body => {
    expect((await updateAdminDiscordSubscriptionSettingFromRequest(request(body), db.env)).status).toBe(400);
    expect((await db.env.DB.prepare("SELECT * FROM discord_alert_subscription_settings").all()).results).toEqual([]);
  });
});
