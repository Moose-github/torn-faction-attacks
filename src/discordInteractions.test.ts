import { describe, expect, it } from "vitest";
import {
  handleDiscordInteractions,
  handleVerifiedDiscordInteraction,
  verifyDiscordRequestSignature,
} from "./discordInteractions";
import type { Env } from "./types";

describe("Discord interactions", () => {
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

  it("formats the Discord travel tracker with routes and abroad returns", async () => {
    const response = await handleVerifiedDiscordInteraction({
      type: 2,
      data: {
        name: "travel",
        options: [
          {
            type: 1,
            name: "current",
            options: [
              { type: 3, name: "view", value: "all" },
              { type: 4, name: "limit", value: 5 },
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

function fakeDiscordEnv(): Env {
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
  const members = [
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
  const travelers = [
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
    DASHBOARD_BASE_URL: "https://dashboard.test",
    DB: {
      prepare(sql: string) {
        return {
          bind() {
            return statement(sql);
          },
          first() {
            return Promise.resolve(sql.includes("FROM wars w") ? war : null);
          },
        };
      },
    },
  } as unknown as Env;

  function statement(sql: string) {
    return {
      first() {
        if (sql.includes("FROM wars w")) {
          return Promise.resolve(war);
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
        return Promise.resolve({ results: [] });
      },
    };
  }
}
