import { describe, expect, it } from "vitest";
import { DISCORD_ALERT_KEYS } from "./discordAlerts";
import {
  getDiscordMemberAlertSubscriptions,
  updateDiscordMemberAlertSubscriptionFromRequest,
} from "./discordMemberAlertSubscriptions";
import type { Env } from "./types";

describe("Discord member alert subscriptions", () => {
  it("defaults every subscribable alert to disabled", async () => {
    const response = await getDiscordMemberAlertSubscriptions(fakeEnv({
      linkedDiscordId: "111111111111111111",
    }), 123);

    const data = await getJson(response);
    expect(data).toMatchObject({
      ok: true,
      discord_link: {
        torn_user_id: 123,
        discord_user_id: "111111111111111111",
        linked: true,
      },
    });
    expect(data.alerts.length).toBeGreaterThan(0);
    expect(data.alerts.every((alert) => alert.enabled === false)).toBe(true);
    expect(data.alerts.some((alert) => alert.key === DISCORD_ALERT_KEYS.chainWatch)).toBe(false);
    expect(data.alerts.some((alert) => alert.key === DISCORD_ALERT_KEYS.chainWatchCritical)).toBe(true);
  });

  it("updates one explicit member subscription", async () => {
    const env = fakeEnv({ linkedDiscordId: "111111111111111111" });
    const response = await updateDiscordMemberAlertSubscriptionFromRequest(
      jsonRequest({ alert_key: DISCORD_ALERT_KEYS.enemyPush, enabled: true }),
      env,
      123,
    );

    expect(response.status).toBe(200);
    expect(env.upserts).toEqual([[123, DISCORD_ALERT_KEYS.enemyPush, 1]]);
    const data = await getJson(response);
    expect(data.alerts.find((alert) => alert.key === DISCORD_ALERT_KEYS.enemyPush)?.enabled).toBe(true);
  });

  it("does not allow enabling notifications before Discord is linked", async () => {
    const env = fakeEnv({});
    const response = await updateDiscordMemberAlertSubscriptionFromRequest(
      jsonRequest({ alert_key: DISCORD_ALERT_KEYS.enemyPush, enabled: true }),
      env,
      123,
    );

    expect(response.status).toBe(400);
    expect(env.upserts).toEqual([]);
    await expect(response.json()).resolves.toMatchObject({ code: "DISCORD_NOT_LINKED" });
  });
});

type FakeEnv = Env & {
  upserts: Array<[number, string, number]>;
};

function fakeEnv(options: {
  linkedDiscordId?: string;
  subscriptions?: Record<string, boolean>;
}): FakeEnv {
  const upserts: Array<[number, string, number]> = [];
  const subscriptions = new Map(
    Object.entries(options.subscriptions ?? {}).map(([key, enabled]) => [key, enabled ? 1 : 0]),
  );

  return {
    upserts,
    DB: {
      prepare(sql: string) {
        return {
          bind(...values: unknown[]) {
            return {
              first() {
                if (sql.includes("FROM discord_member_links") && options.linkedDiscordId) {
                  return Promise.resolve({ discord_user_id: options.linkedDiscordId });
                }
                return Promise.resolve(null);
              },
              all() {
                if (sql.includes("FROM discord_member_alert_subscriptions")) {
                  return Promise.resolve({
                    results: Array.from(subscriptions, ([alert_key, enabled]) => ({ alert_key, enabled })),
                  });
                }
                return Promise.resolve({ results: [] });
              },
              run() {
                const alertKey = String(values[1]);
                const enabled = Number(values[2]);
                upserts.push([Number(values[0]), alertKey, enabled]);
                subscriptions.set(alertKey, enabled);
                return Promise.resolve({ meta: { changes: 1 } });
              },
            };
          },
        };
      },
    },
  } as unknown as FakeEnv;
}

function jsonRequest(body: unknown): Request {
  return new Request("https://worker.test/api/me/discord-alert-subscriptions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function getJson(response: Response): Promise<{
  alerts: Array<{ key: string; enabled: boolean }>;
}> {
  return await response.json();
}
