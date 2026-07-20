import { beforeEach, describe, expect, it, vi } from "vitest";
import { upsertDiscordAlertMessage } from "./discordAlertDelivery";
import { DISCORD_ALERT_KEYS } from "./discordAlerts";
import {
  readCurrentScoutingWar,
  refreshHomeFactionMembers,
  refreshTrackedFactionMemberStatuses,
} from "./enemyScouting";
import {
  clearDiscordTravelTrackerTargetFromRequest,
  enableDiscordTargetTravelTracker,
  enableDiscordTravelTrackersForWar,
  getDiscordTravelTrackerTargetFromRequest,
  setDiscordTravelTrackerTargetFromRequest,
  stopDiscordTravelTrackersForWar,
  syncDiscordTravelTracker,
  updateDiscordTravelTrackerSettingsFromRequest,
} from "./discordTravelTracker";
import { isWarRoomMemberTrackingActive } from "./warRoomTracking";
import type { Env } from "./types";

vi.mock("./discordAlertDelivery", () => ({
  upsertDiscordAlertMessage: vi.fn(),
}));

vi.mock("./enemyScouting", () => ({
  readCurrentScoutingWar: vi.fn(),
  refreshHomeFactionMembers: vi.fn(),
  refreshTrackedFactionMemberStatuses: vi.fn(),
}));

vi.mock("./warRoomTracking", () => ({
  isWarRoomMemberTrackingActive: vi.fn(),
}));

const TARGET_TRAVEL_TRACKER_COLOR = 0xeb5757;
const HOME_TRAVEL_TRACKER_COLOR = 0x27ae60;

describe("Discord travel tracker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readCurrentScoutingWar).mockResolvedValue({
      id: 10,
      name: "test-war",
      status: "active",
      enemy_faction_id: 123,
      war_type: "real",
      practical_start_time: 1_800_000_000,
      practical_finish_time: null,
      official_start_time: null,
      enemy_scouting_status_checked_at: null,
    });
    vi.mocked(isWarRoomMemberTrackingActive).mockReturnValue(true);
    vi.mocked(upsertDiscordAlertMessage).mockImplementation(async (_env, _alertKey, existingMessageId) =>
      existingMessageId ?? "message-1"
    );
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
    vi.mocked(refreshHomeFactionMembers).mockResolvedValue([]);
  });

  it("creates a persistent bot-routed message the first time it syncs", async () => {
    const env = fakeEnv();

    await expect(syncDiscordTravelTracker(env, { scheduledTime: 1_800_000_000_000 })).resolves.toMatchObject({
      skipped: false,
      war_id: 10,
      message_id: "message-1",
      traveling: 1,
      abroad: 1,
      changed: true,
    });
    expect(upsertDiscordAlertMessage).toHaveBeenCalledWith(
      env,
      DISCORD_ALERT_KEYS.targetTravelTracker,
      null,
      expect.stringContaining("test-war Travel Tracker"),
      { users: [], roles: [] },
      { embedColor: TARGET_TRAVEL_TRACKER_COLOR },
    );
    expect(env.state?.message_id).toBe("message-1");
    expect(env.state?.display_name).toBe("test-war Travel Tracker");
  });

  it("skips Discord edits when the message content has not changed", async () => {
    const env = fakeEnv();
    await syncDiscordTravelTracker(env, { scheduledTime: 1_800_000_000_000 });
    vi.mocked(upsertDiscordAlertMessage).mockClear();

    await expect(syncDiscordTravelTracker(env, { scheduledTime: 1_800_000_000_000 })).resolves.toMatchObject({
      skipped: true,
      reason: "travel tracker unchanged",
      changed: false,
    });
    expect(upsertDiscordAlertMessage).not.toHaveBeenCalled();
  });

  it("backfills the display name without editing Discord when existing content is unchanged", async () => {
    const env = fakeEnv();
    await syncDiscordTravelTracker(env, { scheduledTime: 1_800_000_000_000 });
    env.states.target = {
      ...env.states.target!,
      display_name: null,
    };
    env.state = env.states.target;
    vi.mocked(upsertDiscordAlertMessage).mockClear();

    await expect(syncDiscordTravelTracker(env, { scheduledTime: 1_800_000_000_000 })).resolves.toMatchObject({
      skipped: true,
      reason: "travel tracker unchanged",
      changed: false,
    });
    expect(upsertDiscordAlertMessage).not.toHaveBeenCalled();
    expect(env.state?.display_name).toBe("test-war Travel Tracker");
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
    expect(upsertDiscordAlertMessage).toHaveBeenCalledWith(
      env,
      DISCORD_ALERT_KEYS.targetTravelTracker,
      "message-1",
      expect.stringContaining("<t:1800001200:t> (<t:1800001200:R>) | WLT benefit"),
      { users: [], roles: [] },
      { embedColor: TARGET_TRAVEL_TRACKER_COLOR },
    );
  });

  it("creates a fresh message when tracking switches to a different target", async () => {
    const env = fakeEnv();
    await syncDiscordTravelTracker(env, { scheduledTime: 1_800_000_000_000 });
    expect(env.state?.message_id).toBe("message-1");

    vi.mocked(isWarRoomMemberTrackingActive).mockReturnValue(false);
    vi.mocked(upsertDiscordAlertMessage).mockResolvedValue("message-2");
    vi.mocked(upsertDiscordAlertMessage).mockClear();
    env.target = {
      id: 1,
      faction_id: 456,
      faction_name: "Manual Faction",
      enabled: 1,
      last_refreshed_at: 1_799_999_900,
    };

    await expect(syncDiscordTravelTracker(env, { scheduledTime: 1_800_000_000_000 })).resolves.toMatchObject({
      source: "manual",
      faction_id: 456,
      message_id: "message-2",
      changed: true,
    });
    expect(upsertDiscordAlertMessage).toHaveBeenCalledWith(
      env,
      DISCORD_ALERT_KEYS.targetTravelTracker,
      null,
      expect.stringContaining("Manual Faction Travel Tracker"),
      { users: [], roles: [] },
      { embedColor: TARGET_TRAVEL_TRACKER_COLOR },
    );
    expect(env.state?.message_id).toBe("message-2");
    expect(env.state?.target_source).toBe("manual");
    expect(env.state?.faction_id).toBe(456);
    expect(env.state?.display_name).toBe("Manual Faction Travel Tracker");
  });

  it("ignores travel tracker webhooks when no bot route is configured", async () => {
    const env = fakeEnv();
    env.notificationRoutes.clear();
    env.DISCORD_TRAVEL_TRACKER_WEBHOOK_URL = "https://discord.test/travel-webhook";

    await expect(syncDiscordTravelTracker(env, { scheduledTime: 1_800_000_000_000 })).resolves.toMatchObject({
      target: { skipped: true, reason: "Discord travel tracker route is not configured" },
      home: { skipped: true, reason: "Discord travel tracker route is not configured" },
    });
    expect(upsertDiscordAlertMessage).not.toHaveBeenCalled();
  });

  it("syncs target travel through a bot route", async () => {
    const env = fakeEnv();
    env.DISCORD_GUILD_ID = "guild-1";
    env.notificationRoutes.set(`guild-1:${DISCORD_ALERT_KEYS.targetTravelTracker}`, {
      guild_id: "guild-1",
      alert_key: DISCORD_ALERT_KEYS.targetTravelTracker,
      channel_id: "channel-1",
      thread_id: null,
      enabled: 1,
      updated_by_discord_id: "user-1",
      updated_at: 1,
    });

    await expect(syncDiscordTravelTracker(env, { scheduledTime: 1_800_000_000_000 })).resolves.toMatchObject({
      target: {
        skipped: false,
        message_id: "message-1",
        changed: true,
      },
      home: {
        skipped: true,
        reason: "home travel tracker disabled",
      },
    });
    expect(upsertDiscordAlertMessage).toHaveBeenCalledWith(
      env,
      DISCORD_ALERT_KEYS.targetTravelTracker,
      null,
      expect.stringContaining("test-war Travel Tracker"),
      { users: [], roles: [] },
      { embedColor: TARGET_TRAVEL_TRACKER_COLOR },
    );
  });

  it("syncs home travel when home is enabled and target is disabled", async () => {
    const env = fakeEnv();
    env.states.target = trackerState("target", { enabled: 0, message_id: "target-message" });
    env.state = env.states.target;
    env.states.home = trackerState("home", { enabled: 1 });

    await expect(syncDiscordTravelTracker(env, { scheduledTime: 1_800_000_000_000 })).resolves.toMatchObject({
      skipped: true,
      reason: "target travel tracker disabled",
      target: { skipped: true, enabled: false },
      home: {
        skipped: false,
        enabled: true,
        source: "home",
        faction_id: 8803,
        traveling: 1,
        changed: true,
      },
    });
    expect(upsertDiscordAlertMessage).toHaveBeenCalledOnce();
    expect(upsertDiscordAlertMessage).toHaveBeenCalledWith(
      env,
      DISCORD_ALERT_KEYS.homeTravelTracker,
      null,
      expect.stringContaining("Buttgrass Travel Tracker"),
      { users: [], roles: [] },
      { embedColor: HOME_TRAVEL_TRACKER_COLOR },
    );
  });

  it("creates separate messages when both target and home trackers are enabled", async () => {
    const env = fakeEnv();
    env.states.home = trackerState("home", { enabled: 1 });
    vi.mocked(upsertDiscordAlertMessage)
      .mockResolvedValueOnce("target-message")
      .mockResolvedValueOnce("home-message");

    await expect(syncDiscordTravelTracker(env, { scheduledTime: 1_800_000_000_000 })).resolves.toMatchObject({
      target: { message_id: "target-message", source: "war", changed: true },
      home: { message_id: "home-message", source: "home", changed: true },
    });
    expect(upsertDiscordAlertMessage).toHaveBeenCalledTimes(2);
    expect(env.states.target?.message_id).toBe("target-message");
    expect(env.states.home?.message_id).toBe("home-message");
  });

  it("skips Discord posts when both trackers are disabled during scheduled syncs", async () => {
    const env = fakeEnv();
    env.states.target = trackerState("target", { enabled: 0, message_id: "target-message" });
    env.state = env.states.target;
    env.states.home = trackerState("home", { enabled: 0, message_id: "home-message" });

    await expect(syncDiscordTravelTracker(env, { scheduledTime: 1_800_000_000_000 })).resolves.toMatchObject({
      target: { skipped: true, reason: "target travel tracker disabled", changed: false },
      home: { skipped: true, reason: "home travel tracker disabled", changed: false },
    });
    expect(upsertDiscordAlertMessage).not.toHaveBeenCalled();
  });

  it("edits existing messages to stopped notices when trackers are disabled by settings", async () => {
    const env = fakeEnv();
    env.states.target = trackerState("target", {
      enabled: 1,
      message_id: "target-message",
      content_hash: "old-target-hash",
      target_source: "war",
      display_name: "test-war Travel Tracker",
      war_id: 10,
      faction_id: 123,
    });
    env.state = env.states.target;
    env.states.home = trackerState("home", {
      enabled: 1,
      message_id: "home-message",
      content_hash: "old-home-hash",
      target_source: "home",
      display_name: "Buttgrass Travel Tracker",
      faction_id: 8803,
    });
    const request = new Request("https://worker.test/api/admin/discord-travel-tracker/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_enabled: false, home_enabled: false }),
    });

    const response = await updateDiscordTravelTrackerSettingsFromRequest(request, env);

    expect(await response.json()).toMatchObject({
      ok: true,
      target_enabled: false,
      home_enabled: false,
      sync: {
        target: { changed: true, source: "inactive", reason: "target travel tracker disabled" },
        home: { changed: true, source: "inactive", reason: "home travel tracker disabled" },
      },
    });
    expect(upsertDiscordAlertMessage).toHaveBeenCalledWith(
      env,
      DISCORD_ALERT_KEYS.targetTravelTracker,
      "target-message",
      expect.stringContaining("test-war Travel Tracker: stopped"),
      { users: [], roles: [] },
      { embedColor: 0x778899 },
    );
    expect(upsertDiscordAlertMessage).toHaveBeenCalledWith(
      env,
      DISCORD_ALERT_KEYS.homeTravelTracker,
      "home-message",
      expect.stringContaining("Buttgrass Travel Tracker: stopped"),
      { users: [], roles: [] },
      { embedColor: 0x778899 },
    );
  });

  it("edits the existing target message when active target tracking stops", async () => {
    vi.mocked(isWarRoomMemberTrackingActive).mockReturnValue(false);
    const env = fakeEnv();
    env.states.target = trackerState("target", {
      enabled: 1,
      message_id: "target-message",
      content_hash: "old-target-hash",
      target_source: "war",
      display_name: "test-war Travel Tracker",
      war_id: 10,
      faction_id: 123,
    });
    env.state = env.states.target;

    await expect(syncDiscordTravelTracker(env, {
      force: true,
      scheduledTime: 1_800_000_000_000,
    })).resolves.toMatchObject({
      target: {
        changed: true,
        source: "inactive",
        reason: "no active travel tracker target",
        message_id: "target-message",
      },
    });
    expect(upsertDiscordAlertMessage).toHaveBeenCalledWith(
      env,
      DISCORD_ALERT_KEYS.targetTravelTracker,
      "target-message",
      expect.stringContaining("test-war Travel Tracker: stopped"),
      { users: [], roles: [] },
      { embedColor: 0x778899 },
    );
    expect(upsertDiscordAlertMessage).toHaveBeenCalledTimes(1);
  });

  it("falls back to a generic stopped title for older tracker rows without a display name", async () => {
    vi.mocked(isWarRoomMemberTrackingActive).mockReturnValue(false);
    const env = fakeEnv();
    env.states.target = trackerState("target", {
      enabled: 1,
      message_id: "target-message",
      content_hash: "old-target-hash",
      target_source: "war",
      war_id: 10,
      faction_id: 123,
    });
    env.state = env.states.target;

    await syncDiscordTravelTracker(env, {
      force: true,
      scheduledTime: 1_800_000_000_000,
    });

    expect(upsertDiscordAlertMessage).toHaveBeenCalledWith(
      env,
      DISCORD_ALERT_KEYS.targetTravelTracker,
      "target-message",
      expect.stringContaining("Target Travel Tracker: stopped"),
      { users: [], roles: [] },
      { embedColor: 0x778899 },
    );
  });

  it("manual-only sync still allows enabled home tracking", async () => {
    const env = fakeEnv();
    env.states.home = trackerState("home", { enabled: 1 });

    await expect(syncDiscordTravelTracker(env, {
      manualOnly: true,
      scheduledTime: 1_800_000_000_000,
    })).resolves.toMatchObject({
      target: {
        skipped: true,
        reason: "manual travel tracker not active",
        source: "war",
      },
      home: {
        skipped: false,
        source: "home",
        changed: true,
      },
    });
    expect(refreshTrackedFactionMemberStatuses).not.toHaveBeenCalled();
    expect(refreshHomeFactionMembers).toHaveBeenCalledWith(env);
    expect(upsertDiscordAlertMessage).toHaveBeenCalledOnce();
  });

  it("updates target and home tracker settings independently", async () => {
    const env = fakeEnv();
    const request = new Request("https://worker.test/api/admin/discord-travel-tracker/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_enabled: false, home_enabled: true }),
    });

    const response = await updateDiscordTravelTrackerSettingsFromRequest(request, env);

    expect(await response.json()).toMatchObject({
      ok: true,
      target_enabled: false,
      home_enabled: true,
      sync: {
        target: { enabled: false, skipped: true },
        home: { enabled: true, changed: true },
      },
    });
    expect(env.states.target?.enabled).toBe(0);
    expect(env.states.home?.enabled).toBe(1);
  });

  it("can enable the target tracker for automatic war tracking", async () => {
    const env = fakeEnv();
    env.states.target = trackerState("target", { enabled: 0 });
    env.state = env.states.target;

    await enableDiscordTargetTravelTracker(env);

    expect(env.states.target?.enabled).toBe(1);
  });

  it("can enable target and home trackers when war tracking starts", async () => {
    const env = fakeEnv();
    env.states.target = trackerState("target", { enabled: 0 });
    env.states.home = trackerState("home", { enabled: 0 });
    env.state = env.states.target;

    await enableDiscordTravelTrackersForWar(env);

    expect(env.states.target?.enabled).toBe(1);
    expect(env.states.home?.enabled).toBe(1);
  });

  it("stops target and home trackers when war tracking ends", async () => {
    const env = fakeEnv();
    env.states.target = trackerState("target", {
      enabled: 1,
      message_id: "target-message",
      content_hash: "old-target-hash",
      target_source: "war",
      display_name: "test-war Travel Tracker",
      war_id: 10,
      faction_id: 123,
    });
    env.state = env.states.target;
    env.states.home = trackerState("home", {
      enabled: 1,
      message_id: "home-message",
      content_hash: "old-home-hash",
      target_source: "home",
      display_name: "Buttgrass Travel Tracker",
      faction_id: 8803,
    });

    await stopDiscordTravelTrackersForWar(env);

    expect(env.states.target?.enabled).toBe(0);
    expect(env.states.home?.enabled).toBe(0);
    expect(upsertDiscordAlertMessage).toHaveBeenCalledWith(
      env,
      DISCORD_ALERT_KEYS.targetTravelTracker,
      "target-message",
      expect.stringContaining("test-war Travel Tracker: stopped"),
      { users: [], roles: [] },
      { embedColor: 0x778899 },
    );
    expect(upsertDiscordAlertMessage).toHaveBeenCalledWith(
      env,
      DISCORD_ALERT_KEYS.homeTravelTracker,
      "home-message",
      expect.stringContaining("Buttgrass Travel Tracker: stopped"),
      { users: [], roles: [] },
      { embedColor: 0x778899 },
    );
  });

  it("keeps tracker embeds above the old message content limit", async () => {
    const env = fakeEnv();
    env.rows = Array.from({ length: 18 }, (_, index) => ({
      ...env.rows[0],
      member_id: 10_000 + index,
      name: `LongTrackerName${index}WithSeveralWords`,
      estimated_arrival_at: 1_800_000_600 + index * 60,
      estimated_arrival_earliest: 1_800_000_600 + index * 60,
      estimated_arrival_latest: 1_800_000_600 + index * 60,
    }));

    await syncDiscordTravelTracker(env, { scheduledTime: 1_800_000_000_000 });

    const message = vi.mocked(upsertDiscordAlertMessage).mock.calls[0]?.[3] ?? "";
    expect(message.length).toBeGreaterThan(1900);
    expect(message).not.toContain("\n...");
    expect(message).toContain("LongTrackerName17WithSeveralWords");
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
    expect(upsertDiscordAlertMessage).toHaveBeenCalledWith(
      env,
      DISCORD_ALERT_KEYS.targetTravelTracker,
      null,
      expect.stringContaining("Manual Faction Travel Tracker"),
      { users: [], roles: [] },
      { embedColor: TARGET_TRAVEL_TRACKER_COLOR },
    );
    expect(env.target?.last_refreshed_at).toBe(1_800_000_000);
  });

  it("syncs immediately when admins set a manual target", async () => {
    vi.mocked(isWarRoomMemberTrackingActive).mockReturnValue(false);
    const env = fakeEnv();
    const request = new Request("https://worker.test/api/admin/discord-travel-tracker/target", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ faction_id: 789, faction_name: "Target Name" }),
    });

    const response = await setDiscordTravelTrackerTargetFromRequest(request, env);

    expect(await response.json()).toMatchObject({
      ok: true,
      target: { faction_id: 789, faction_name: "Target Name", enabled: true },
      sync: { source: "manual", faction_id: 789, changed: true },
    });
    expect(upsertDiscordAlertMessage).toHaveBeenCalledWith(
      env,
      DISCORD_ALERT_KEYS.targetTravelTracker,
      null,
      expect.stringContaining("Target Name Travel Tracker"),
      { users: [], roles: [] },
      { embedColor: TARGET_TRAVEL_TRACKER_COLOR },
    );
  });

  it("uses the manual target when the current war record is ended", async () => {
    vi.mocked(readCurrentScoutingWar).mockResolvedValue({
      id: 10,
      name: "ended-war",
      status: "ended",
      enemy_faction_id: 123,
      war_type: "real",
      practical_start_time: 1_800_000_000,
      practical_finish_time: null,
      official_start_time: null,
      enemy_scouting_status_checked_at: null,
    });
    vi.mocked(isWarRoomMemberTrackingActive).mockReturnValue(true);
    const env = fakeEnv();
    env.target = {
      id: 1,
      faction_id: 456,
      faction_name: "Manual Faction",
      enabled: 1,
      last_refreshed_at: 1_799_999_900,
    };

    await expect(syncDiscordTravelTracker(env, { scheduledTime: 1_800_000_000_000 })).resolves.toMatchObject({
      source: "manual",
      war_id: null,
      faction_id: 456,
      changed: true,
    });
    expect(upsertDiscordAlertMessage).toHaveBeenCalledWith(
      env,
      DISCORD_ALERT_KEYS.targetTravelTracker,
      null,
      expect.stringContaining("Manual Faction Travel Tracker"),
      { users: [], roles: [] },
      { embedColor: TARGET_TRAVEL_TRACKER_COLOR },
    );
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
    expect(await clearResponse.json()).toMatchObject({
      ok: true,
      cleared: 1,
      sync: { source: "war", war_id: 10, changed: true },
    });
    expect(env.target).toBeNull();
  });
});

type FakeState = {
  tracker_key: "target" | "home";
  enabled: number;
  war_id: number | null;
  target_source: string | null;
  faction_id: number | null;
  destination_key: string | null;
  display_name: string | null;
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
  DISCORD_TRAVEL_TRACKER_WEBHOOK_URL?: string;
  state: FakeState | null;
  states: Record<"target" | "home", FakeState | null>;
  target: FakeTarget | null;
  rows: FakeRow[];
  homeRows: FakeRow[];
  notificationRoutes: Map<string, {
    guild_id: string;
    alert_key: string;
    channel_id: string;
    thread_id: string | null;
    enabled: number;
    updated_by_discord_id: string | null;
    updated_at: number;
  }>;
};

function fakeEnv(): FakeEnv {
  const env = {
    DISCORD_GUILD_ID: "guild-1",
    state: null,
    states: {
      target: null,
      home: null,
    },
    notificationRoutes: new Map([
      [`guild-1:${DISCORD_ALERT_KEYS.targetTravelTracker}`, notificationRoute(DISCORD_ALERT_KEYS.targetTravelTracker)],
      [`guild-1:${DISCORD_ALERT_KEYS.homeTravelTracker}`, notificationRoute(DISCORD_ALERT_KEYS.homeTravelTracker)],
    ]),
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
    homeRows: [
      {
        member_id: 3,
        name: "Home Traveler",
        status_state: "Traveling",
        status_description: "Traveling to Argentina",
        plane_image_type: "airliner",
        travel_origin: "Torn",
        travel_destination: "Argentina",
        travel_started_after: 1_799_999_700,
        travel_started_before: 1_799_999_760,
        estimated_arrival_at: 1_800_001_500,
        estimated_arrival_earliest: 1_800_001_440,
        estimated_arrival_latest: 1_800_001_560,
        travel_trip_destination: "Argentina",
        travel_trip_type: "Business Class/Standard",
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
          return Promise.resolve(env.states[values[0] as "target" | "home"] ?? null);
        }
        if (sql.includes("FROM discord_travel_tracker_target")) {
          return Promise.resolve(env.target?.enabled === 1 ? env.target : null);
        }
        if (sql.includes("FROM discord_notification_channels")) {
          const guildId = String(values[0]);
          const alertKey = String(values[1]);
          const row = env.notificationRoutes.get(`${guildId}:${alertKey}`) ?? null;
          return Promise.resolve(row && row.enabled === 1 ? row : null);
        }
        return Promise.resolve(null);
      },
      all() {
        if (sql.includes("FROM enemy_faction_members")) {
          return Promise.resolve({ results: env.rows });
        }
        if (sql.includes("FROM home_faction_members")) {
          return Promise.resolve({ results: env.homeRows });
        }
        return Promise.resolve({ results: [] });
      },
      run() {
        if (sql.includes("INSERT INTO discord_travel_tracker_state")) {
          const trackerKey = values[0] as "target" | "home";
          if (values.length === 2) {
            env.states[trackerKey] = {
              tracker_key: trackerKey,
              enabled: Number(values[1]),
              war_id: env.states[trackerKey]?.war_id ?? null,
              target_source: env.states[trackerKey]?.target_source ?? null,
              faction_id: env.states[trackerKey]?.faction_id ?? null,
              destination_key: env.states[trackerKey]?.destination_key ?? null,
              display_name: env.states[trackerKey]?.display_name ?? null,
              message_id: env.states[trackerKey]?.message_id ?? null,
              content_hash: env.states[trackerKey]?.content_hash ?? null,
              last_synced_at: env.states[trackerKey]?.last_synced_at ?? null,
            };
          } else {
            env.states[trackerKey] = {
              tracker_key: trackerKey,
              enabled: Number(values[1]),
              war_id: values[2] as number | null,
              target_source: values[3] as string | null,
              faction_id: values[4] as number | null,
              destination_key: values[5] as string | null,
              display_name: values[6] as string | null,
              message_id: values[7] as string | null,
              content_hash: values[8] as string | null,
              last_synced_at: values[9] as number | null,
            };
          }
          if (trackerKey === "target") {
            env.state = env.states.target;
          }
        } else if (sql.includes("UPDATE discord_travel_tracker_state") && env.states[values[1] as "target" | "home"]) {
          const trackerKey = values[1] as "target" | "home";
          env.states[trackerKey] = {
            ...env.states[trackerKey]!,
            last_synced_at: values[0] as number,
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

function notificationRoute(alertKey: string): {
  guild_id: string;
  alert_key: string;
  channel_id: string;
  thread_id: string | null;
  enabled: number;
  updated_by_discord_id: string | null;
  updated_at: number;
} {
  return {
    guild_id: "guild-1",
    alert_key: alertKey,
    channel_id: "channel-1",
    thread_id: null,
    enabled: 1,
    updated_by_discord_id: "user-1",
    updated_at: 1,
  };
}

function trackerState(
  trackerKey: "target" | "home",
  overrides: Partial<FakeState> = {},
): FakeState {
  return {
    tracker_key: trackerKey,
    enabled: trackerKey === "target" ? 1 : 0,
    war_id: null,
    target_source: null,
    faction_id: null,
    destination_key: null,
    display_name: null,
    message_id: null,
    content_hash: null,
    last_synced_at: null,
    ...overrides,
  };
}
