import { describe, expect, it } from "vitest";
import { DISCORD_ALERTS, DISCORD_ADMIN_ALERTS, DISCORD_ALERT_CHANNEL_ROUTES } from "./discordAlertCatalog";
import { discordAlertSettingsFromResponse } from "./discordAlertSettingsCompatibility";

describe("Discord alert catalog compatibility", () => {
  it("preserves the exact subscription bit positions used by existing v2 Submit buttons", () => {
    expect(DISCORD_ALERTS.map(alert => alert.key)).toEqual([
      "chain_watch", "chain_watch_warning", "chain_watch_critical", "chain_watch_drop",
      "retaliation_board", "enemy_push", "target_travel_tracker", "home_travel_tracker",
      "enemy_scouting_report", "xanax_competition", "termed_war_auto_end",
      "shoplifting_security_alert:big_als", "shoplifting_security_alert:jewelry_store",
      "chain_watch_missed_check_in", "chain_watch_unfilled_slot", "item_stock_low",
    ]);
  });

  it("preserves delivery and subscription defaults independently", () => {
    expect(DISCORD_ALERTS.filter(alert => !alert.defaultEnabled).map(alert => alert.key)).toEqual([
      "enemy_push", "shoplifting_security_alert:jewelry_store",
    ]);
    expect(DISCORD_ALERTS.filter(alert => alert.subscribable).map(alert => alert.key)).toEqual([
      "chain_watch_warning", "chain_watch_critical", "chain_watch_drop", "enemy_push",
      "shoplifting_security_alert:big_als", "shoplifting_security_alert:jewelry_store",
      "chain_watch_missed_check_in", "chain_watch_unfilled_slot",
    ]);
    expect(DISCORD_ALERTS.every(alert => alert.configurable)).toBe(true);
  });

  it("keeps admin ordering separate and gives every alert exactly one route", () => {
    expect(DISCORD_ADMIN_ALERTS.map(alert => alert.key)).toEqual([
      "chain_watch", "chain_watch_warning", "chain_watch_critical", "chain_watch_drop",
      "chain_watch_unfilled_slot", "chain_watch_missed_check_in", "retaliation_board", "enemy_push",
      "target_travel_tracker", "home_travel_tracker", "item_stock_low", "enemy_scouting_report",
      "xanax_competition", "termed_war_auto_end", "shoplifting_security_alert:big_als",
      "shoplifting_security_alert:jewelry_store",
    ]);
    expect(DISCORD_ALERT_CHANNEL_ROUTES.map(route => route.key)).toEqual(["default", ...DISCORD_ALERTS.map(alert => alert.key)]);
    expect(new Set(DISCORD_ALERTS.map(alert => alert.key)).size).toBe(16);
  });

  it("reads older Worker responses including the two shop alerts without inventing missing settings", () => {
    const settings = discordAlertSettingsFromResponse({
      ok: true, routes: {},
      chain_watch_alert: { key: "chain_watch", name: "Chain watch alerts", enabled: false, configurable: false },
      delivery_alerts: [{ key: "item_stock_low", name: "Item stock low", enabled: true, configurable: true }],
      alerts: [
        { shop_key: "big_als", shop_name: "Big Als", enabled: false, configurable: true },
        { shop_key: "jewelry_store", shop_name: "Jewelry Store", enabled: true, configurable: false },
      ],
    });
    expect(Object.keys(settings)).toHaveLength(4);
    expect(settings.chain_watch).toMatchObject({ enabled: false, configurable: false });
    expect(settings["shoplifting_security_alert:big_als"]).toMatchObject({ enabled: false });
    expect(settings["shoplifting_security_alert:jewelry_store"]).toMatchObject({ enabled: true, configurable: false });
    expect(settings.enemy_push).toBeUndefined();
  });

  it("prefers the new map, including missing values, over legacy fields", () => {
    expect(discordAlertSettingsFromResponse({
      ok: true, routes: {}, settings_by_key: {},
      chain_watch_alert: { key: "chain_watch", name: "Chain watch", enabled: true, configurable: true },
    })).toEqual({});
  });
});
