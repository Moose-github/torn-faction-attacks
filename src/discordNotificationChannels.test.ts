import { describe, expect, it } from "vitest";
import { DISCORD_ALERT_KEYS } from "./discordAlerts";
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
