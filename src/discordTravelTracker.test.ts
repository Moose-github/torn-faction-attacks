import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDiscordWebhookMessage,
  editDiscordWebhookMessage,
} from "./discord";
import {
  readCurrentScoutingWar,
  refreshTrackedFactionMemberStatuses,
} from "./enemyScouting";
import {
  clearDiscordTravelTrackerTargetFromRequest,
  getDiscordTravelTrackerTargetFromRequest,
  setDiscordTravelTrackerTargetFromRequest,
  syncDiscordTravelTracker,
} from "./discordTravelTracker";
import { isWarRoomMemberTrackingActive } from "./warRoomTracking";
import type { Env } from "./types";

vi.mock("./discord", () => ({
  createDiscordWebhookMessage: vi.fn(),
  editDiscordWebhookMessage: vi.fn(),
}));

vi.mock("./enemyScouting", () => ({
  readCurrentScoutingWar: vi.fn(),
  refreshTrackedFactionMemberStatuses: vi.fn(),
}));

vi.mock("./warRoomTracking", () => ({
  isWarRoomMemberTrackingActive: vi.fn(),
}));

describe("Discord travel tracker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readCurrentScoutingWar).mockResolvedValue({
      id: 10,
      name: "test-war",
      enemy_faction_id: 123,
      war_type: "real",
      practical_start_time: 1_800_000_000,
      practical_finish_time: null,
      official_start_time: null,
      enemy_scouting_status_checked_at: null,
    });
    vi.mocked(isWarRoomMemberTrackingActive).mockReturnValue(true);
    vi.mocked(createDiscordWebhookMessage).mockResolvedValue("message-1");
    vi.mocked(editDiscordWebhookMessage).mockResolvedValue(undefined);
    vi.mocked(refreshTrackedFactionMemberStatuses).mockResolvedValue({
      writeStatements: 1,
      changedRows: 1,
      fetchedMembers: 2,
      updatedMembers: 1,
      deletedMembers: 0,
      skipped: false,
      factionId: 456,
      fetchedAt: 1_800_000_000,
    });
  });

  it("creates a persistent webhook message the first time it syncs", async () => {
    const env = fakeEnv();

    await expect(syncDiscordTravelTracker(env, { scheduledTime: 1_800_000_000_000 })).resolves.toMatchObject({
      skipped: false,
      war_id: 10,
      message_id: "message-1",
      traveling: 1,
      abroad: 1,
      changed: true,
    });
    expect(createDiscordWebhookMessage).toHaveBeenCalledWith(
      env,
      expect.stringContaining("Enemy Travel Tracker: War vs test-war"),
      { users: [], roles: [] },
      { embedColor: 0x2f80ed },
    );
    expect(env.state?.message_id).toBe("message-1");
  });

  it("skips Discord edits when the message content has not changed", async () => {
    const env = fakeEnv();
    await syncDiscordTravelTracker(env, { scheduledTime: 1_800_000_000_000 });
    vi.mocked(createDiscordWebhookMessage).mockClear();
    vi.mocked(editDiscordWebhookMessage).mockClear();

    await expect(syncDiscordTravelTracker(env, { scheduledTime: 1_800_000_000_000 })).resolves.toMatchObject({
      skipped: true,
      reason: "travel tracker unchanged",
      changed: false,
    });
    expect(createDiscordWebhookMessage).not.toHaveBeenCalled();
    expect(editDiscordWebhookMessage).not.toHaveBeenCalled();
  });

  it("edits the existing message when travel details change", async () => {
    const env = fakeEnv();
    await syncDiscordTravelTracker(env, { scheduledTime: 1_800_000_000_000 });
    env.rows[0].estimated_arrival_at = 1_800_001_200;
    env.rows[0].estimated_arrival_earliest = 1_800_001_200;
    env.rows[0].estimated_arrival_latest = 1_800_001_200;

    await expect(syncDiscordTravelTracker(env, { scheduledTime: 1_800_000_000_000 })).resolves.toMatchObject({
      skipped: false,
      message_id: "message-1",
      changed: true,
    });
    expect(editDiscordWebhookMessage).toHaveBeenCalledWith(
      env,
      "message-1",
      expect.stringContaining("<t:1800001200:t> (<t:1800001200:R>) | WLT benefit"),
      { users: [], roles: [] },
      { embedColor: 0x2f80ed },
    );
  });

  it("uses the manual target when no active war tracking is available", async () => {
    vi.mocked(isWarRoomMemberTrackingActive).mockReturnValue(false);
    const env = fakeEnv();
    env.target = {
      id: 1,
      faction_id: 456,
      faction_name: "Manual Faction",
      enabled: 1,
      last_refreshed_at: 1_799_999_900,
    };

    await expect(syncDiscordTravelTracker(env, { scheduledTime: 1_800_000_000_000 })).resolves.toMatchObject({
      skipped: false,
      source: "manual",
      war_id: null,
      faction_id: 456,
      changed: true,
    });
    expect(refreshTrackedFactionMemberStatuses).toHaveBeenCalledWith(env, 456, 1_799_999_900);
    expect(createDiscordWebhookMessage).toHaveBeenCalledWith(
      env,
      expect.stringContaining("Faction Travel Tracker: Manual Faction"),
      { users: [], roles: [] },
      { embedColor: 0x2f80ed },
    );
    expect(env.target?.last_refreshed_at).toBe(1_800_000_000);
  });

  it("allows admins to read, set, and clear the manual target", async () => {
    const env = fakeEnv();
    const request = new Request("https://worker.test/api/admin/discord-travel-tracker/target", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ faction_id: 789, faction_name: "Target Name" }),
    });

    const setResponse = await setDiscordTravelTrackerTargetFromRequest(request, env);
    expect(await setResponse.json()).toMatchObject({
      ok: true,
      target: { faction_id: 789, faction_name: "Target Name", enabled: true },
    });

    const getResponse = await getDiscordTravelTrackerTargetFromRequest(env);
    expect(await getResponse.json()).toMatchObject({
      ok: true,
      active_source: "war",
      manual_target: { faction_id: 789, faction_name: "Target Name" },
    });

    const clearResponse = await clearDiscordTravelTrackerTargetFromRequest(env);
    expect(await clearResponse.json()).toEqual({ ok: true, cleared: 1 });
    expect(env.target).toBeNull();
  });
});

type FakeState = {
  id: number;
  war_id: number | null;
  message_id: string | null;
  content_hash: string | null;
  last_synced_at: number | null;
};

type FakeTarget = {
  id: number;
  faction_id: number;
  faction_name: string | null;
  enabled: number;
  last_refreshed_at: number | null;
};

type FakeRow = {
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
};

type FakeEnv = Env & {
  state: FakeState | null;
  target: FakeTarget | null;
  rows: FakeRow[];
};

function fakeEnv(): FakeEnv {
  const env = {
    DISCORD_WEBHOOK_URL: "https://discord.test/webhook",
    state: null,
    target: null,
    rows: [
      {
        member_id: 1,
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
        member_id: 2,
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
    ],
  } as FakeEnv;

  env.DB = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return statement(sql, values);
        },
      };
    },
  } as unknown as D1Database;

  return env;

  function statement(sql: string, values: unknown[]) {
    return {
      first() {
        if (sql.includes("FROM discord_travel_tracker_state")) {
          return Promise.resolve(env.state);
        }
        if (sql.includes("FROM discord_travel_tracker_target")) {
          return Promise.resolve(env.target?.enabled === 1 ? env.target : null);
        }
        return Promise.resolve(null);
      },
      all() {
        if (sql.includes("FROM enemy_faction_members")) {
          return Promise.resolve({ results: env.rows });
        }
        return Promise.resolve({ results: [] });
      },
      run() {
        if (sql.includes("INSERT INTO discord_travel_tracker_state")) {
          env.state = {
            id: Number(values[0]),
            war_id: values[1] as number | null,
            message_id: values[2] as string | null,
            content_hash: values[3] as string | null,
            last_synced_at: values[4] as number | null,
          };
        } else if (sql.includes("INSERT INTO discord_travel_tracker_target")) {
          env.target = {
            id: Number(values[0]),
            faction_id: Number(values[1]),
            faction_name: values[2] as string | null,
            enabled: 1,
            last_refreshed_at: env.target?.faction_id === Number(values[1])
              ? env.target.last_refreshed_at
              : null,
          };
        } else if (sql.includes("DELETE FROM discord_travel_tracker_target")) {
          env.target = null;
        } else if (sql.includes("UPDATE discord_travel_tracker_state") && env.state) {
          env.state = {
            ...env.state,
            last_synced_at: values[0] as number,
          };
        } else if (sql.includes("UPDATE discord_travel_tracker_target") && env.target) {
          env.target = {
            ...env.target,
            last_refreshed_at: values[0] as number,
          };
        }
        return Promise.resolve({ meta: { changes: 1 } });
      },
    };
  }
}
