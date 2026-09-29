import { describe, expect, it, vi } from "vitest";
import { DISCORD_ALERTS } from "../../../../shared/discordAlertCatalog";
import type { DiscordAlertSettingsMap } from "../../../../shared/discordAlertSettings";
import { discordAlertRows, discordAlertStatus } from "./discordAlertRows";

const settings: DiscordAlertSettingsMap = Object.fromEntries(DISCORD_ALERTS.map(alert => [alert.key, {
  key: alert.key, name: alert.admin.label, enabled: alert.defaultEnabled, configurable: true,
}]));

describe("catalog-driven admin alert rows", () => {
  it("renders each alert once and dispatches each toggle to its own key", () => {
    const update = vi.fn();
    const rows = discordAlertRows(settings, false, update);
    expect(rows).toHaveLength(17);
    expect(rows[0]).toMatchObject({ key: "default", kind: "status", statusLabel: "Fallback" });
    expect(new Set(rows.map(row => row.key)).size).toBe(17);
    for (const row of rows.slice(1)) {
      expect(row.kind).toBe("alert");
      if (row.kind !== "alert") throw new Error("Missing toggle");
      row.onChange(false);
      expect(update).toHaveBeenLastCalledWith(row.key, false);
    }
    expect(rows.slice(-2).map(row => row.label)).toEqual(["Big Als", "Jewelry Store"]);
    expect(discordAlertStatus(settings, false)).toBe("14/16 active");
  });

  it("shows missing data as loading or unavailable without offering a delivery toggle", () => {
    for (const loading of [true, false]) {
      const rows = discordAlertRows({}, loading, vi.fn());
      expect(rows.slice(1).every(row => row.kind === "status" && row.statusLabel === (loading ? "Loading" : "Unavailable"))).toBe(true);
      expect(discordAlertStatus({}, loading)).toBe(loading ? "Loading" : "Unavailable");
    }
  });

  it("honors saved disabled and non-configurable settings", () => {
    const rows = discordAlertRows({ chain_watch: { key: "chain_watch", name: "Chain watch", enabled: false, configurable: false } }, false, vi.fn());
    expect(rows[1]).toMatchObject({ key: "chain_watch", kind: "alert", checked: false, configurable: false });
    expect(rows[2]).toMatchObject({ kind: "status", statusLabel: "Unavailable" });
  });
});
