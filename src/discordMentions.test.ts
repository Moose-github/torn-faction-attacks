import { describe, expect, it } from "vitest";
import { readDiscordAlertMentions } from "./discordMentions";
import type { Env } from "./types";

describe("Discord alert mentions", () => {
  it("combines admin and linked member subscriptions", async () => {
    const env = fakeEnv({
      adminRows: [
        { subscription_type: "user", discord_id: "111111111111111111" },
        { subscription_type: "role", discord_id: "222222222222222222" },
      ],
      memberRows: [
        { subscription_type: "user", discord_id: "111111111111111111" },
        { subscription_type: "user", discord_id: "333333333333333333" },
      ],
    });

    await expect(readDiscordAlertMentions(env, "enemy_push")).resolves.toEqual({
      messageSuffix: "<@111111111111111111> <@333333333333333333> <@&222222222222222222>",
      allowedMentions: {
        users: ["111111111111111111", "333333333333333333"],
        roles: ["222222222222222222"],
      },
    });
  });

  it("omits allowed mentions when no enabled subscriptions resolve", async () => {
    await expect(readDiscordAlertMentions(fakeEnv({}), "enemy_push")).resolves.toEqual({
      messageSuffix: "",
      allowedMentions: undefined,
    });
  });
});

type MentionRow = {
  subscription_type: string;
  discord_id: string;
};

function fakeEnv(options: {
  adminRows?: MentionRow[];
  memberRows?: MentionRow[];
}): Env {
  return {
    DB: {
      prepare(sql: string) {
        return {
          bind() {
            return {
              all() {
                if (sql.includes("FROM discord_admin_alert_subscriptions")) {
                  return Promise.resolve({ results: options.adminRows ?? [] });
                }
                if (sql.includes("FROM discord_member_alert_subscriptions")) {
                  return Promise.resolve({ results: options.memberRows ?? [] });
                }
                return Promise.resolve({ results: [] });
              },
            };
          },
        };
      },
    },
  } as unknown as Env;
}
