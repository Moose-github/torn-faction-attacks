import { describe, expect, it, vi } from "vitest";
import {
  handleDiscordInteractions,
  handleVerifiedDiscordInteraction,
  verifyDiscordRequestSignature,
} from "./discordInteractions";
import { discordApplicationCommands } from "./discordCommands";
import { DISCORD_ALERT_KEYS } from "./discordAlerts";
import type { Env, WarRow } from "./types";

describe("Discord interactions", () => {
  it("registers bot and alert slash commands", () => {
    expect(discordApplicationCommands().map((command) => command.name)).toEqual(["bot", "alerts"]);
    expect(discordApplicationCommands().find((command) => command.name === "alerts")?.options?.map((option) => option.name))
      .toEqual(["list", "subscribed", "subscribe", "unsubscribe"]);
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
    expect(response.data?.embeds?.[0]?.fields?.some((field) =>
      field.name === "Enemy push - subscribed"
    )).toBe(true);
  });

  it("shows only active alert subscriptions", async () => {
    const response = await handleVerifiedDiscordInteraction({
      type: 2,
      member: { user: { id: "222222222222222222" } },
      data: {
        name: "alerts",
        options: [
          {
            type: 1,
            name: "subscribed",
          },
        ],
      },
    }, fakeDiscordEnv({
      discordLink: { torn_user_id: 99, discord_user_id: "222222222222222222" },
      subscriptions: {
        [DISCORD_ALERT_KEYS.enemyPush]: true,
        [DISCORD_ALERT_KEYS.chainWatchCritical]: false,
      },
    }));

    expect(response.data?.embeds?.[0]?.title).toBe("Your alert subscriptions");
    expect(response.data?.embeds?.[0]?.fields).toHaveLength(1);
    expect(response.data?.embeds?.[0]?.fields?.[0]?.name).toBe("Enemy push - subscribed");
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
});

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
} = {}): Env & { upserts: Array<[number, string, number]> } {
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
    DASHBOARD_BASE_URL: "https://dashboard.test",
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
  } as unknown as Env & { upserts: Array<[number, string, number]> };

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
  }
}
