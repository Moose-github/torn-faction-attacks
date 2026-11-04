import { describe, expect, it, vi } from "vitest";
import { createBackgroundReadScope, readBackgroundSetting } from "./backgroundReadScope";
import { isDiscordAlertEnabled } from "./discordAlertSettings";
import { readConfiguredDiscordNotificationChannel } from "./discordNotificationChannels";
import { DISCORD_ALERT_KEYS } from "./discordAlerts";
import type { Env } from "./types";

describe("background settings reads", () => {
  it("shares concurrent reads only inside one run and retries failures", async () => {
    const env = {} as Env;
    const scoped = createBackgroundReadScope(env);
    const load = vi.fn().mockResolvedValue(null);
    await Promise.all(Array.from({ length: 10 }, () => readBackgroundSetting(scoped, "setting", load)));
    expect(load).toHaveBeenCalledTimes(1);
    expect(createBackgroundReadScope(scoped)).toBe(scoped);
    await readBackgroundSetting(createBackgroundReadScope(env), "setting", load);
    await readBackgroundSetting(env, "setting", load);
    await readBackgroundSetting(env, "setting", load);
    expect(load).toHaveBeenCalledTimes(4);
    const retry = vi.fn().mockRejectedValueOnce(new Error("temporary")).mockResolvedValue(42);
    await expect(readBackgroundSetting(scoped, "retry", retry)).rejects.toThrow("temporary");
    await expect(readBackgroundSetting(scoped, "retry", retry)).resolves.toBe(42);
  });

  it("reuses alert settings and default-route lookups but sees changes on the next run", async () => {
    let enabled = 1;
    let channel = "123456";
    const first = vi.fn(async (sql: string, args: unknown[]) => {
      if (sql.includes("FROM alert_settings")) return { alert_key: args[0], enabled, configurable: 1 };
      if (args[1] === DISCORD_ALERT_KEYS.retaliationBoard) return null;
      return { guild_id: "654321", alert_key: args[1], channel_id: channel,
        thread_id: null, enabled: 1, updated_by_discord_id: null, updated_at: 1 };
    });
    const env = { DISCORD_GUILD_ID: "654321", DB: { prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({ first: () => first(sql, args) }),
    }) } } as unknown as Env;
    const scoped = createBackgroundReadScope(env);
    const read = (e: Env) => Promise.all([
      isDiscordAlertEnabled(e, DISCORD_ALERT_KEYS.retaliationBoard),
      readConfiguredDiscordNotificationChannel(e, DISCORD_ALERT_KEYS.retaliationBoard),
    ]);
    const values = await Promise.all(Array.from({ length: 20 }, () => read(scoped)));
    expect(first).toHaveBeenCalledTimes(3); // Setting + missing specific route + fallback.
    expect(values[0][0]).toBe(true);
    expect(values[0][1]?.channelId).toBe("123456");
    enabled = 0; channel = "999999";
    const next = await read(createBackgroundReadScope(env));
    expect(next[0]).toBe(false);
    expect(next[1]?.channelId).toBe("999999");
    expect(first).toHaveBeenCalledTimes(6);
    await read(env); await read(env);
    expect(first).toHaveBeenCalledTimes(12); // Normal request reads are never cached.
  });
});
