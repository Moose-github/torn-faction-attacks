import { describe, expect, it } from "vitest";
import { DISCORD_ALERT_KEYS, DISCORD_DEFAULT_ALERT_ROUTE_KEY } from "./discordAlerts";
import { readConfiguredDiscordNotificationChannel } from "./discordNotificationChannels";
import type { Env } from "./types";

describe("Discord notification channels", () => {
  it("reads alert routes from the configured Discord guild", async () => {
    const binds: unknown[][] = [];
    const env = {
      DISCORD_GUILD_ID: " guild-1 ",
      DB: {
        prepare() {
          return {
            bind(...values: unknown[]) {
              binds.push(values);
              return {
                first() {
                  return Promise.resolve({
                    guild_id: "guild-1",
                    alert_key: DISCORD_ALERT_KEYS.enemyPush,
                    channel_id: "channel-1",
                    thread_id: null,
                    enabled: 1,
                    updated_by_discord_id: "user-1",
                    updated_at: 1,
                  });
                },
              };
            },
          };
        },
      },
    } as unknown as Env;

    await expect(readConfiguredDiscordNotificationChannel(env, DISCORD_ALERT_KEYS.enemyPush))
      .resolves.toMatchObject({
        guildId: "guild-1",
        alertKey: DISCORD_ALERT_KEYS.enemyPush,
        channelId: "channel-1",
      });
    expect(binds).toEqual([["guild-1", DISCORD_ALERT_KEYS.enemyPush]]);
  });

  it("falls back to the default route when the alert route is missing", async () => {
    const binds: unknown[][] = [];
    const env = envWithRoutes(binds, {
      [`guild-1:${DISCORD_DEFAULT_ALERT_ROUTE_KEY}`]: {
        guild_id: "guild-1",
        alert_key: DISCORD_DEFAULT_ALERT_ROUTE_KEY,
        channel_id: "default-channel",
        thread_id: null,
        enabled: 1,
        updated_by_discord_id: "user-1",
        updated_at: 1,
      },
    });

    await expect(readConfiguredDiscordNotificationChannel(env, DISCORD_ALERT_KEYS.enemyPush))
      .resolves.toMatchObject({
        guildId: "guild-1",
        alertKey: DISCORD_DEFAULT_ALERT_ROUTE_KEY,
        channelId: "default-channel",
      });
    expect(binds).toEqual([
      ["guild-1", DISCORD_ALERT_KEYS.enemyPush],
      ["guild-1", DISCORD_DEFAULT_ALERT_ROUTE_KEY],
    ]);
  });

  it("returns null when neither the alert route nor the default route is configured", async () => {
    const binds: unknown[][] = [];
    const env = envWithRoutes(binds, {});

    await expect(readConfiguredDiscordNotificationChannel(env, DISCORD_ALERT_KEYS.enemyPush))
      .resolves.toBeNull();
    expect(binds).toEqual([
      ["guild-1", DISCORD_ALERT_KEYS.enemyPush],
      ["guild-1", DISCORD_DEFAULT_ALERT_ROUTE_KEY],
    ]);
  });

  it("does not read a global default route when no Discord guild is configured", async () => {
    let prepared = false;
    const env = {
      DB: {
        prepare() {
          prepared = true;
          throw new Error("should not query notification channels");
        },
      },
    } as unknown as Env;

    await expect(readConfiguredDiscordNotificationChannel(env, DISCORD_ALERT_KEYS.enemyPush))
      .resolves.toBeNull();
    expect(prepared).toBe(false);
  });
});

function envWithRoutes(
  binds: unknown[][],
  routes: Record<string, {
    guild_id: string;
    alert_key: string;
    channel_id: string;
    thread_id: string | null;
    enabled: number;
    updated_by_discord_id: string | null;
    updated_at: number;
  }>,
): Env {
  return {
    DISCORD_GUILD_ID: " guild-1 ",
    DB: {
      prepare() {
        return {
          bind(...values: unknown[]) {
            binds.push(values);
            return {
              first() {
                const row = routes[`${String(values[0])}:${String(values[1])}`] ?? null;
                return Promise.resolve(row && row.enabled === 1 ? row : null);
              },
            };
          },
        };
      },
    },
  } as unknown as Env;
}
