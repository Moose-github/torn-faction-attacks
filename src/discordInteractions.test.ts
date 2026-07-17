import { describe, expect, it, vi } from "vitest";
import {
  handleDiscordInteractions,
  handleVerifiedDiscordInteraction,
  verifyDiscordRequestSignature,
} from "./discordInteractions";
import { DISCORD_COMPONENT_IDS, discordApplicationCommands } from "./discordCommands";
import { DISCORD_ALERT_KEYS } from "./discordAlerts";
import type { Env, WarRow } from "./types";

describe("Discord interactions", () => {
  it("registers bot and alert slash commands", () => {
    expect(discordApplicationCommands().map((command) => command.name)).toEqual(["bot", "alerts", "alert-channels"]);
    expect(discordApplicationCommands().find((command) => command.name === "alerts")?.options?.map((option) => option.name))
      .toEqual(["list", "manage", "subscribe", "unsubscribe"]);
    expect(discordApplicationCommands().find((command) => command.name === "alert-channels"))
      .toMatchObject({
        default_member_permissions: "32",
        dm_permission: false,
      });
  });

  it("verifies valid Ed25519 request signatures", async () => {
    const signed = await signedDiscordRequest({ type: 1 });

    await expect(verifyDiscordRequestSignature(
      signed.request,
      signed.bodyText,
      signed.publicKeyHex,
    )).resolves.toBe(true);
  });

  it("rejects invalid request signatures", async () => {
    const signed = await signedDiscordRequest({ type: 1 });
    const request = new Request("https://worker.test/api/discord/interactions", {
      method: "POST",
      headers: signed.request.headers,
      body: JSON.stringify({ type: 2 }),
    });

    await expect(verifyDiscordRequestSignature(request, "{\"type\":2}", signed.publicKeyHex)).resolves.toBe(false);
  });

  it("responds to Discord PING interactions", async () => {
    const signed = await signedDiscordRequest({ type: 1 });
    const response = await handleDiscordInteractions(signed.request, {
      DISCORD_PUBLIC_KEY: signed.publicKeyHex,
    } as Env);

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ type: 1 });
  });

  it("returns 401 when the interaction signature is invalid", async () => {
    const signed = await signedDiscordRequest({ type: 1 });
    const request = new Request("https://worker.test/api/discord/interactions", {
      method: "POST",
      headers: {
        "X-Signature-Ed25519": signed.request.headers.get("X-Signature-Ed25519") ?? "",
        "X-Signature-Timestamp": signed.request.headers.get("X-Signature-Timestamp") ?? "",
      },
      body: JSON.stringify({ type: 2 }),
    });

    const response = await handleDiscordInteractions(request, {
      DISCORD_PUBLIC_KEY: signed.publicKeyHex,
    } as Env);

    expect(response?.status).toBe(401);
  });

  it("returns a Discord-safe response when verified routing fails", async () => {
    const signed = await signedDiscordRequest({
      type: 2,
      data: {
        name: "war",
        options: [{ type: 1, name: "current" }],
      },
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const response = await handleDiscordInteractions(signed.request, {
        DISCORD_PUBLIC_KEY: signed.publicKeyHex,
        DB: {
          prepare() {
            throw new Error("D1 unavailable");
          },
        },
      } as unknown as Env);
      const body = await response?.json();

      expect(response?.status).toBe(200);
      expect(body).toEqual({
        type: 4,
        data: {
          content: "Discord bot is temporarily unavailable. Please try again shortly.",
          flags: 64,
          allowed_mentions: { parse: [] },
        },
      });
      expect(errorSpy).toHaveBeenCalledWith("Discord interaction failed", expect.objectContaining({
        command: "war",
        error: "D1 unavailable",
      }));
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("shows ephemeral bot help", async () => {
    const response = await handleVerifiedDiscordInteraction({
      type: 2,
      data: {
        name: "bot",
        options: [
          {
            type: 1,
            name: "help",
          },
        ],
      },
    }, fakeDiscordEnv());

    expect(response.type).toBe(4);
    expect(response.data?.flags).toBe(64);
    expect(response.data?.embeds?.[0]?.title).toBe("Butt Dashboard Bot");
    expect(response.data?.embeds?.[0]?.description).toContain("`/alerts list`");
    expect(response.data?.embeds?.[0]?.description).toContain("`/alerts manage`");
    expect(response.data?.embeds?.[0]?.description).toContain("`/alerts subscribe`");
    expect(response.data?.embeds?.[0]?.description).toContain("`/alerts unsubscribe`");
  });

  it("formats member leaderboards with linked Discord mentions", async () => {
    const response = await handleVerifiedDiscordInteraction({
      type: 2,
      data: {
        name: "war",
        options: [
          {
            type: 1,
            name: "members",
            options: [
              { type: 3, name: "metric", value: "respect" },
              { type: 4, name: "limit", value: 5 },
            ],
          },
        ],
      },
    }, fakeDiscordEnv());

    expect(response.type).toBe(4);
    expect(response.data?.allowed_mentions).toEqual({ parse: [] });
    expect(response.data?.embeds?.[0]?.description).toContain("<@111111111111111111>");
    expect(response.data?.embeds?.[0]?.description).toContain("Bob");
  });

  it("bounds member leaderboard embed descriptions", async () => {
    const response = await handleVerifiedDiscordInteraction({
      type: 2,
      data: {
        name: "war",
        options: [
          {
            type: 1,
            name: "members",
            options: [{ type: 4, name: "limit", value: 20 }],
          },
        ],
      },
    }, fakeDiscordEnv({
      members: Array.from({ length: 20 }, (_, index) => ({
        member_id: index + 1,
        member_name: `Member ${index + 1} ${"LongName".repeat(80)}`,
        discord_user_id: null,
        attacks_vs_enemy_total: 10,
        attacks_vs_enemy_successful: 8,
        respect_gained: 55,
        defends_total: 0,
        defends_won: 0,
        outside_hits: 0,
      })),
    }));

    const description = response.data?.embeds?.[0]?.description ?? "";
    expect(description.length).toBeLessThanOrEqual(3900);
    expect(description).toMatch(/\n\.\.\.$/);
  });

  it("formats the Discord travel tracker with routes and abroad returns", async () => {
    const response = await handleVerifiedDiscordInteraction({
      type: 2,
      data: {
        name: "war",
        options: [
          {
            type: 1,
            name: "enemy",
            options: [
              { type: 3, name: "view", value: "travel" },
            ],
          },
        ],
      },
    }, fakeDiscordEnv());

    expect(response.type).toBe(4);
    expect(response.data?.embeds?.[0]?.title).toBe("test-war travel tracker");
    expect(response.data?.embeds?.[0]?.description).toContain("**Traveling (1)**");
    expect(response.data?.embeds?.[0]?.description).toContain("**Member** | **Route** | **Departure** | **Travel time** | **Arrival** | **Travel type**");
    expect(response.data?.embeds?.[0]?.description).toContain("Torn -> Mexico");
    expect(response.data?.embeds?.[0]?.description).toContain("<t:1799999820:t> | 13m | <t:1800000600:t> (<t:1800000600:R>) | WLT benefit");
    expect(response.data?.embeds?.[0]?.description).toContain("**Currently abroad (1)**");
    expect(response.data?.embeds?.[0]?.description).toContain("**Member** | **Location** | **Outbound type** | **Minimum return**");
    expect(response.data?.embeds?.[0]?.description).toContain("[Abroad](https://www.torn.com/profiles.php?XID=4) | Canada | Business Class | 12m");
  });

  it("bounds travel tracker embed descriptions", async () => {
    const response = await handleVerifiedDiscordInteraction({
      type: 2,
      data: {
        name: "war",
        options: [
          {
            type: 1,
            name: "enemy",
            options: [{ type: 3, name: "view", value: "travel" }],
          },
        ],
      },
    }, fakeDiscordEnv({
      travelers: Array.from({ length: 20 }, (_, index) => ({
        member_id: index + 100,
        name: `Traveler ${index + 1} ${"LongName".repeat(60)}`,
        status_state: "Traveling",
        status_description: `Traveling to ${"Destination".repeat(50)}`,
        plane_image_type: "private_jet",
        travel_origin: "Torn",
        travel_destination: `Destination ${index + 1} ${"VeryLong".repeat(50)}`,
        travel_started_after: 1_799_999_820,
        travel_started_before: 1_799_999_820,
        estimated_arrival_at: 1_800_000_600,
        estimated_arrival_earliest: 1_800_000_600,
        estimated_arrival_latest: 1_800_000_600,
        travel_trip_destination: `Destination ${index + 1}`,
        travel_trip_type: "WLT benefit",
        travel_trip_inferred_at: null,
      })),
    }));

    const description = response.data?.embeds?.[0]?.description ?? "";
    expect(description.length).toBeLessThanOrEqual(3900);
    expect(description).toMatch(/\n\.\.\.$/);
  });

  it("uses the manual travel target when the latest war has ended", async () => {
    const response = await handleVerifiedDiscordInteraction({
      type: 2,
      data: {
        name: "war",
        options: [
          {
            type: 1,
            name: "enemy",
            options: [
              { type: 3, name: "view", value: "travel" },
            ],
          },
        ],
      },
    }, fakeDiscordEnv({
      war: { status: "ended" },
      manualTarget: { faction_id: 456, faction_name: "Manual Faction" },
    }));

    expect(response.type).toBe(4);
    expect(response.data?.embeds?.[0]?.title).toBe("Manual Faction travel tracker");
    expect(response.data?.embeds?.[0]?.description).toContain("Torn -> Mexico");
    expect(response.data?.components).toEqual([]);
  });

  it("splits war buttons into valid Discord action rows", async () => {
    const response = await handleVerifiedDiscordInteraction({
      type: 2,
      data: {
        name: "war",
        options: [
          {
            type: 1,
            name: "current",
          },
        ],
      },
    }, fakeDiscordEnv());

    expect(response.type).toBe(4);
    expect(response.data?.components).toHaveLength(2);
    expect(response.data?.components?.[0]?.components).toHaveLength(5);
    expect(response.data?.components?.[1]?.components).toHaveLength(1);
  });

  it("lists alert subscriptions for the linked Discord user", async () => {
    const response = await handleVerifiedDiscordInteraction({
      type: 2,
      member: { user: { id: "222222222222222222" } },
      data: {
        name: "alerts",
        options: [
          {
            type: 1,
            name: "list",
          },
        ],
      },
    }, fakeDiscordEnv({
      discordLink: { torn_user_id: 99, discord_user_id: "222222222222222222" },
      subscriptions: { [DISCORD_ALERT_KEYS.enemyPush]: true },
    }));

    expect(response.type).toBe(4);
    expect(response.data?.flags).toBe(64);
    expect(response.data?.embeds?.[0]?.title).toBe("Available alert subscriptions");
    expect(response.data?.embeds?.[0]?.description).toContain("`/alerts manage`");
    expect(response.data?.embeds?.[0]?.description).toContain("`/alerts subscribe`");
    expect(response.data?.embeds?.[0]?.description).toContain("`/alerts unsubscribe`");
    expect(response.data?.embeds?.[0]?.description).toContain("[Dashboard settings](https://buttgrass.pages.dev/settings)");
    expect(response.data?.embeds?.[0]?.fields?.some((field) =>
      field.name === "Enemy push - subscribed"
    )).toBe(true);
    expect(response.data?.embeds?.[0]?.fields?.some((field) =>
      field.name === "Chain watch critical - not subscribed"
    )).toBe(true);
    expect(JSON.stringify(response.data?.embeds)).not.toContain(DISCORD_ALERT_KEYS.enemyPush);
  });

  it("shows combined alert list guidance for unknown alert subcommands", async () => {
    const response = await handleVerifiedDiscordInteraction({
      type: 2,
      member: { user: { id: "222222222222222222" } },
      data: {
        name: "alerts",
        options: [
          {
            type: 1,
            name: "unknown",
          },
        ],
      },
    }, fakeDiscordEnv({
      discordLink: { torn_user_id: 99, discord_user_id: "222222222222222222" },
    }));

    expect(response.data?.content).toBe("Use `/alerts list`, `/alerts manage`, `/alerts subscribe`, or `/alerts unsubscribe`.");
    expect(response.data?.content).not.toContain("subscribed");
  });

  it("shows alert subscriptions in a manage dropdown", async () => {
    const response = await handleVerifiedDiscordInteraction({
      type: 2,
      member: { user: { id: "222222222222222222" } },
      data: {
        name: "alerts",
        options: [
          {
            type: 1,
            name: "manage",
          },
        ],
      },
    }, fakeDiscordEnv({
      discordLink: { torn_user_id: 99, discord_user_id: "222222222222222222" },
      subscriptions: { [DISCORD_ALERT_KEYS.enemyPush]: true },
    }));

    const select = response.data?.components?.[0]?.components?.[0];
    expect(response.type).toBe(4);
    expect(response.data?.flags).toBe(64);
    expect(response.data?.embeds?.[0]?.title).toBe("Manage alert subscriptions");
    expect(select).toMatchObject({
      type: 3,
      custom_id: DISCORD_COMPONENT_IDS.alertsManageSelect,
      min_values: 0,
    });
    expect(selectOptionDefault(select, DISCORD_ALERT_KEYS.enemyPush))
      .toBe(true);
    expect(response.data?.components?.[1]?.components).toEqual([
      expect.objectContaining({
        label: "Clear",
        custom_id: DISCORD_COMPONENT_IDS.alertsManageClear,
      }),
      expect.objectContaining({
        label: "Submit",
        custom_id: expect.stringMatching(new RegExp(`^${DISCORD_COMPONENT_IDS.alertsManageSubmitPrefix}`)),
      }),
    ]);
  });

  it("updates pending alert subscriptions from the manage dropdown", async () => {
    const env = fakeDiscordEnv({
      discordLink: { torn_user_id: 99, discord_user_id: "222222222222222222" },
      subscriptions: {
        [DISCORD_ALERT_KEYS.enemyPush]: true,
        [DISCORD_ALERT_KEYS.chainWatchCritical]: false,
      },
    });

    const response = await handleVerifiedDiscordInteraction({
      type: 3,
      member: { user: { id: "222222222222222222" } },
      data: {
        custom_id: DISCORD_COMPONENT_IDS.alertsManageSelect,
        values: [DISCORD_ALERT_KEYS.chainWatchCritical],
      },
    }, env);

    const select = response.data?.components?.[0]?.components?.[0];
    expect(response.type).toBe(7);
    expect(response.data?.embeds?.[0]?.title).toBe("Manage alert subscriptions");
    expect(response.data?.embeds?.[0]?.description).toBe("Review your changes, then press Submit to save them.");
    expect(env.upserts).toEqual([]);
    expect(selectOptionDefault(select, DISCORD_ALERT_KEYS.enemyPush))
      .toBe(false);
    expect(selectOptionDefault(select, DISCORD_ALERT_KEYS.chainWatchCritical))
      .toBe(true);
  });

  it("clears pending alert subscriptions from the manage controls", async () => {
    const env = fakeDiscordEnv({
      discordLink: { torn_user_id: 99, discord_user_id: "222222222222222222" },
      subscriptions: {
        [DISCORD_ALERT_KEYS.enemyPush]: true,
        [DISCORD_ALERT_KEYS.chainWatchCritical]: true,
      },
    });

    const response = await handleVerifiedDiscordInteraction({
      type: 3,
      member: { user: { id: "222222222222222222" } },
      data: {
        custom_id: DISCORD_COMPONENT_IDS.alertsManageClear,
      },
    }, env);

    const select = response.data?.components?.[0]?.components?.[0];
    expect(response.type).toBe(7);
    expect(response.data?.embeds?.[0]?.description).toBe("All alerts are cleared in this pending selection. Press Submit to save.");
    expect(env.upserts).toEqual([]);
    expect(selectOptionDefault(select, DISCORD_ALERT_KEYS.enemyPush)).toBe(false);
    expect(selectOptionDefault(select, DISCORD_ALERT_KEYS.chainWatchCritical)).toBe(false);
  });

  it("submits alert subscriptions from the manage controls", async () => {
    const env = fakeDiscordEnv({
      discordLink: { torn_user_id: 99, discord_user_id: "222222222222222222" },
      subscriptions: {
        [DISCORD_ALERT_KEYS.enemyPush]: true,
        [DISCORD_ALERT_KEYS.chainWatchCritical]: false,
      },
    });

    const pendingResponse = await handleVerifiedDiscordInteraction({
      type: 3,
      member: { user: { id: "222222222222222222" } },
      data: {
        custom_id: DISCORD_COMPONENT_IDS.alertsManageSelect,
        values: [DISCORD_ALERT_KEYS.chainWatchCritical],
      },
    }, env);
    const submitCustomId = componentCustomId(pendingResponse.data?.components?.[1]?.components?.[1]);

    const response = await handleVerifiedDiscordInteraction({
      type: 3,
      member: { user: { id: "222222222222222222" } },
      data: {
        custom_id: submitCustomId,
      },
    }, env);

    expect(response.type).toBe(7);
    expect(response.data?.embeds?.[0]?.description).toBe("Saved your alert subscriptions.");
    expect(response.data?.components).toEqual([]);
    expect(env.upserts).toContainEqual([99, DISCORD_ALERT_KEYS.enemyPush, 0]);
    expect(env.upserts).toContainEqual([99, DISCORD_ALERT_KEYS.chainWatchCritical, 1]);
  });

  it("subscribes the linked Discord user to an alert", async () => {
    const env = fakeDiscordEnv({
      discordLink: { torn_user_id: 99, discord_user_id: "222222222222222222" },
    });
    const response = await handleVerifiedDiscordInteraction({
      type: 2,
      member: { user: { id: "222222222222222222" } },
      data: {
        name: "alerts",
        options: [
          {
            type: 1,
            name: "subscribe",
            options: [
              { type: 3, name: "alert", value: DISCORD_ALERT_KEYS.enemyPush },
            ],
          },
        ],
      },
    }, env);

    expect(response.data?.embeds?.[0]?.title).toBe("Alert subscribed");
    expect(env.upserts).toEqual([[99, DISCORD_ALERT_KEYS.enemyPush, 1]]);
  });

  it("unsubscribes the linked Discord user from an alert", async () => {
    const env = fakeDiscordEnv({
      discordLink: { torn_user_id: 99, discord_user_id: "222222222222222222" },
      subscriptions: { [DISCORD_ALERT_KEYS.enemyPush]: true },
    });
    const response = await handleVerifiedDiscordInteraction({
      type: 2,
      member: { user: { id: "222222222222222222" } },
      data: {
        name: "alerts",
        options: [
          {
            type: 1,
            name: "unsubscribe",
            options: [
              { type: 3, name: "alert", value: DISCORD_ALERT_KEYS.enemyPush },
            ],
          },
        ],
      },
    }, env);

    expect(response.data?.embeds?.[0]?.title).toBe("Alert unsubscribed");
    expect(env.upserts).toEqual([[99, DISCORD_ALERT_KEYS.enemyPush, 0]]);
  });

  it("does not subscribe when the Discord user is not linked", async () => {
    const env = fakeDiscordEnv();
    const response = await handleVerifiedDiscordInteraction({
      type: 2,
      member: { user: { id: "222222222222222222" } },
      data: {
        name: "alerts",
        options: [
          {
            type: 1,
            name: "subscribe",
            options: [
              { type: 3, name: "alert", value: DISCORD_ALERT_KEYS.enemyPush },
            ],
          },
        ],
      },
    }, env);

    expect(response.data?.content).toBe("I cannot find a Torn member linked to your Discord account yet.");
    expect(env.upserts).toEqual([]);
  });

  it("sets alert channel routes for Discord admins", async () => {
    const env = fakeDiscordEnv({
      discordAdminUserIds: "222222222222222222",
    });
    const response = await handleVerifiedDiscordInteraction({
      type: 2,
      guild_id: "727247760931160167",
      member: { user: { id: "222222222222222222" }, roles: [] },
      data: {
        name: "alert-channels",
        options: [
          {
            type: 1,
            name: "set",
            options: [
              { type: 3, name: "alert", value: DISCORD_ALERT_KEYS.enemyPush },
              { type: 7, name: "channel", value: "333333333333333333" },
            ],
          },
        ],
      },
    }, env);

    expect(response.data?.embeds?.[0]?.title).toBe("Alert channel route saved");
    expect(response.data?.embeds?.[0]?.description).toContain("<#333333333333333333>");
    expect(env.notificationRoutes.get("727247760931160167:enemy_push")).toMatchObject({
      guild_id: "727247760931160167",
      alert_key: DISCORD_ALERT_KEYS.enemyPush,
      channel_id: "333333333333333333",
      enabled: 1,
      updated_by_discord_id: "222222222222222222",
    });
  });

  it("lists configured alert channel routes", async () => {
    const response = await handleVerifiedDiscordInteraction({
      type: 2,
      guild_id: "727247760931160167",
      member: { user: { id: "222222222222222222" }, roles: ["999999999999999999"] },
      data: {
        name: "alert-channels",
        options: [
          { type: 1, name: "list" },
        ],
      },
    }, fakeDiscordEnv({
      discordAdminRoleIds: "999999999999999999",
      notificationRoutes: {
        [DISCORD_ALERT_KEYS.enemyPush]: "333333333333333333",
      },
    }));

    expect(response.data?.embeds?.[0]?.title).toBe("Alert channel routes");
    expect(response.data?.embeds?.[0]?.fields?.[0]).toMatchObject({
      name: "Enemy push",
      value: expect.stringContaining("<#333333333333333333>"),
    });
    expect(response.data?.embeds?.[0]?.fields?.[0]?.value).not.toContain("Key:");
    expect(response.data?.embeds?.[0]?.fields?.[0]?.value).not.toContain(DISCORD_ALERT_KEYS.enemyPush);
  });

  it("unsets alert channel routes for Discord admins", async () => {
    const env = fakeDiscordEnv({
      discordAdminUserIds: "222222222222222222",
      notificationRoutes: {
        [DISCORD_ALERT_KEYS.enemyPush]: "333333333333333333",
      },
    });
    const response = await handleVerifiedDiscordInteraction({
      type: 2,
      guild_id: "727247760931160167",
      member: { user: { id: "222222222222222222" }, roles: [] },
      data: {
        name: "alert-channels",
        options: [
          {
            type: 1,
            name: "unset",
            options: [
              { type: 3, name: "alert", value: DISCORD_ALERT_KEYS.enemyPush },
            ],
          },
        ],
      },
    }, env);

    expect(response.data?.embeds?.[0]?.title).toBe("Alert channel route removed");
    expect(env.notificationRoutes.has("727247760931160167:enemy_push")).toBe(false);
  });

  it("trusts Discord command permissions for alert channel routes", async () => {
    const env = fakeDiscordEnv();
    const response = await handleVerifiedDiscordInteraction({
      type: 2,
      guild_id: "727247760931160167",
      member: { user: { id: "222222222222222222" }, roles: [] },
      data: {
        name: "alert-channels",
        options: [
          { type: 1, name: "list" },
        ],
      },
    }, env);

    expect(response.data?.embeds?.[0]?.title).toBe("Alert channel routes");
    expect(response.data?.embeds?.[0]?.description).toBe("No alert channels are configured yet.");
  });
});

function selectOptionDefault(
  component: unknown,
  value: string,
): boolean | undefined {
  const options = (component as {
    options?: Array<{ value: string; default?: boolean }>;
  } | undefined)?.options ?? [];
  return options.find((option) => option.value === value)?.default;
}

function componentCustomId(component: unknown): string {
  const customId = (component as { custom_id?: string } | undefined)?.custom_id;
  expect(customId).toBeTypeOf("string");
  return customId ?? "";
}

async function signedDiscordRequest(payload: unknown): Promise<{
  request: Request;
  bodyText: string;
  publicKeyHex: string;
}> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"],
  ) as CryptoKeyPair;
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey) as ArrayBuffer);
  const bodyText = JSON.stringify(payload);
  const timestamp = "1800000000";
  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: "Ed25519" },
    keyPair.privateKey,
    new TextEncoder().encode(`${timestamp}${bodyText}`),
  ));

  return {
    bodyText,
    publicKeyHex: bytesToHex(publicKey),
    request: new Request("https://worker.test/api/discord/interactions", {
      method: "POST",
      headers: {
        "X-Signature-Ed25519": bytesToHex(signature),
        "X-Signature-Timestamp": timestamp,
      },
      body: bodyText,
    }),
  };
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fakeDiscordEnv(options: {
  war?: Partial<WarRow>;
  manualTarget?: { faction_id: number; faction_name: string | null; enabled?: number } | null;
  discordLink?: { torn_user_id: number; discord_user_id: string };
  subscriptions?: Record<string, boolean>;
  members?: Array<{
    member_id: number;
    member_name: string | null;
    discord_user_id: string | null;
    attacks_vs_enemy_total: number;
    attacks_vs_enemy_successful: number;
    respect_gained: number;
    defends_total: number;
    defends_won: number;
    outside_hits: number;
  }>;
  travelers?: Array<{
    member_id: number;
    name: string;
    status_state: string | null;
    status_description: string | null;
    plane_image_type: string | null;
    travel_origin: string | null;
    travel_destination: string | null;
    travel_started_after: number | null;
    travel_started_before: number | null;
    estimated_arrival_at: number | null;
    estimated_arrival_earliest: number | null;
    estimated_arrival_latest: number | null;
    travel_trip_destination: string | null;
    travel_trip_type: string | null;
    travel_trip_inferred_at: number | null;
  }>;
  discordAdminUserIds?: string;
  discordAdminRoleIds?: string;
  notificationRoutes?: Record<string, string>;
} = {}): Env & {
  upserts: Array<[number, string, number]>;
  notificationRoutes: Map<string, {
    guild_id: string;
    alert_key: string;
    channel_id: string;
    thread_id: string | null;
    enabled: number;
    updated_by_discord_id: string | null;
    updated_at: number;
  }>;
} {
  const war = {
    id: 10,
    name: "test-war",
    status: "active",
    practical_start_time: 1_800_000_000,
    practical_finish_time: null,
    official_start_time: null,
    official_end_time: null,
    enemy_faction_id: 123,
    war_type: "real",
    torn_war_id: 456,
    auto_end_enabled: 0,
    faction_respect_limit: null,
    member_respect_limit: null,
    winner_faction_id: null,
    torn_report_fetched_at: null,
    official_home_score: 10,
    official_home_attacks: 5,
    official_enemy_score: 4,
    official_enemy_attacks: 2,
    enemy_scouting_auto_attempted_at: null,
    enemy_scouting_status_checked_at: null,
    finalized_at: null,
    attacks_vs_enemy_total: 20,
    attacks_from_enemy_total: 5,
    outside_hits: 1,
    total_respect_gain: 123.4,
    total_respect_lost: 12,
    unique_attackers: 2,
    first_attack_at: 1_800_000_010,
    last_attack_at: 1_800_000_120,
    summary_updated_at: 1_800_000_130,
  };
  Object.assign(war, options.war ?? {});
  const manualTarget = options.manualTarget ?? null;
  const discordLink = options.discordLink ?? null;
  const subscriptions = new Map(
    Object.entries(options.subscriptions ?? {}).map(([key, enabled]) => [key, enabled ? 1 : 0]),
  );
  const upserts: Array<[number, string, number]> = [];
  const notificationRoutes = new Map<string, {
    guild_id: string;
    alert_key: string;
    channel_id: string;
    thread_id: string | null;
    enabled: number;
    updated_by_discord_id: string | null;
    updated_at: number;
  }>(
    Object.entries(options.notificationRoutes ?? {}).map(([alert_key, channel_id]) => [
      `727247760931160167:${alert_key}`,
      {
        guild_id: "727247760931160167",
        alert_key,
        channel_id,
        thread_id: null,
        enabled: 1,
        updated_by_discord_id: "111111111111111111",
        updated_at: 1_800_000_000,
      },
    ]),
  );
  const members = options.members ?? [
    {
      member_id: 1,
      member_name: "Alice",
      discord_user_id: "111111111111111111",
      attacks_vs_enemy_total: 10,
      attacks_vs_enemy_successful: 8,
      respect_gained: 55,
      defends_total: 0,
      defends_won: 0,
      outside_hits: 0,
    },
    {
      member_id: 2,
      member_name: "Bob",
      discord_user_id: null,
      attacks_vs_enemy_total: 6,
      attacks_vs_enemy_successful: 4,
      respect_gained: 33,
      defends_total: 1,
      defends_won: 1,
      outside_hits: 0,
    },
  ];
  const travelers = options.travelers ?? [
    {
      member_id: 3,
      name: "Traveler",
      status_state: "Traveling",
      status_description: "Traveling to Mexico",
      plane_image_type: "private_jet",
      travel_origin: "Torn",
      travel_destination: "Mexico",
      travel_started_after: 1_799_999_820,
      travel_started_before: 1_799_999_820,
      estimated_arrival_at: 1_800_000_600,
      estimated_arrival_earliest: 1_800_000_600,
      estimated_arrival_latest: 1_800_000_600,
      travel_trip_destination: "Mexico",
      travel_trip_type: "WLT benefit",
      travel_trip_inferred_at: null,
    },
    {
      member_id: 4,
      name: "Abroad",
      status_state: "Abroad",
      status_description: "In Canada",
      plane_image_type: null,
      travel_origin: null,
      travel_destination: null,
      travel_started_after: null,
      travel_started_before: null,
      estimated_arrival_at: null,
      estimated_arrival_earliest: null,
      estimated_arrival_latest: null,
      travel_trip_destination: "Canada",
      travel_trip_type: "Business Class",
      travel_trip_inferred_at: null,
    },
  ];

  return {
    upserts,
    notificationRoutes,
    DASHBOARD_BASE_URL: "https://dashboard.test",
    DISCORD_ADMIN_USER_IDS: options.discordAdminUserIds,
    DISCORD_ADMIN_ROLE_IDS: options.discordAdminRoleIds,
    DB: {
      prepare(sql: string) {
        return {
          bind(...values: unknown[]) {
            return statement(sql, values);
          },
          first() {
            if (sql.includes("FROM wars w")) {
              return Promise.resolve(war);
            }
            if (sql.includes("FROM discord_travel_tracker_target")) {
              return Promise.resolve(manualTarget && manualTarget.enabled !== 0 ? manualTarget : null);
            }
            return Promise.resolve(null);
          },
        };
      },
    },
  } as unknown as Env & {
    upserts: Array<[number, string, number]>;
    notificationRoutes: typeof notificationRoutes;
  };

  function statement(sql: string, values: unknown[] = []) {
    return {
      first() {
        if (sql.includes("FROM wars w")) {
          return Promise.resolve(war);
        }
        if (sql.includes("FROM discord_travel_tracker_target")) {
          return Promise.resolve(manualTarget && manualTarget.enabled !== 0 ? manualTarget : null);
        }
        if (sql.includes("FROM discord_member_links") && sql.includes("discord_user_id = ?")) {
          return Promise.resolve(discordLink?.discord_user_id === values[0] ? discordLink : null);
        }
        if (sql.includes("FROM discord_member_links") && sql.includes("torn_user_id = ?")) {
          return Promise.resolve(discordLink?.torn_user_id === values[0] ? discordLink : null);
        }
        if (sql.includes("FROM discord_notification_channels")) {
          const guildId = String(values[0]);
          const alertKey = String(values[1]);
          const row = notificationRoutes.get(`${guildId}:${alertKey}`) ?? null;
          return Promise.resolve(row && row.enabled === 1 ? row : null);
        }
        return Promise.resolve(null);
      },
      all() {
        if (sql.includes("FROM war_member_stats")) {
          return Promise.resolve({ results: members });
        }
        if (sql.includes("FROM enemy_faction_members")) {
          return Promise.resolve({ results: travelers });
        }
        if (sql.includes("FROM discord_member_alert_subscriptions")) {
          return Promise.resolve({
            results: Array.from(subscriptions, ([alert_key, enabled]) => ({ alert_key, enabled })),
          });
        }
        if (sql.includes("FROM discord_notification_channels")) {
          const guildId = String(values[0]);
          return Promise.resolve({
            results: Array.from(notificationRoutes.values()).filter((row) => row.guild_id === guildId),
          });
        }
        return Promise.resolve({ results: [] });
      },
      run() {
        if (sql.includes("INSERT INTO discord_notification_channels")) {
          const guildId = String(values[0]);
          const alertKey = String(values[1]);
          notificationRoutes.set(`${guildId}:${alertKey}`, {
            guild_id: guildId,
            alert_key: alertKey,
            channel_id: String(values[2]),
            thread_id: typeof values[3] === "string" ? values[3] : null,
            enabled: 1,
            updated_by_discord_id: String(values[4]),
            updated_at: 1_800_000_001,
          });
          return Promise.resolve({ meta: { changes: 1 } });
        }
        if (sql.includes("DELETE FROM discord_notification_channels")) {
          notificationRoutes.delete(`${String(values[0])}:${String(values[1])}`);
          return Promise.resolve({ meta: { changes: 1 } });
        }
        const alertKey = String(values[1]);
        const enabled = Number(values[2]);
        upserts.push([Number(values[0]), alertKey, enabled]);
        subscriptions.set(alertKey, enabled);
        return Promise.resolve({ meta: { changes: 1 } });
      },
    };
  }
}
