import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refreshHomeFactionMembers, refreshTrackedFactionMemberStatuses } from "./enemyScouting";
import { readEnemyScouting, readHomeScouting } from "./enemyScouting/queries";
import type { EnemyFactionMemberRow } from "./enemyScouting/model";
import { upsertMemberLiveStatus } from "./memberLiveStatus";
import type { Env, TornFactionMember } from "./types";
import { readSyncTimestamp, upsertSyncTimestamp } from "./syncState";
import { withTornKeyPool } from "./tornKeyPool";
import { buildTravelDisplay } from "./enemyTravel";
import { formatTravelTrackerSections } from "./discordTravelFormatting";

vi.mock("./syncState", () => ({
  hasSyncState: vi.fn(),
  readSyncTimestamp: vi.fn(),
  upsertSyncTimestamp: vi.fn(),
}));
vi.mock("./tornKeyPool", () => ({ withTornKeyPool: vi.fn() }));

vi.mock("./enemyScouting/queries", () => ({
  readCurrentScoutingWar: vi.fn(),
  readEnemyScouting: vi.fn(),
  readHomeScouting: vi.fn(),
}));

vi.mock("./memberLiveStatus", async (importOriginal) => ({
  ...await importOriginal<typeof import("./memberLiveStatus")>(),
  upsertMemberLiveStatus: vi.fn(),
}));

const now = 1_800_000_000;
const flightSeconds = 190 * 60;
const member: TornFactionMember = {
  id: 1,
  name: "rubenmatos",
  level: 50,
  status: {
    state: "Traveling",
    description: "Traveling from United Arab Emirates to Torn",
    plane_image_type: "light_aircraft",
  },
};

function previousTraveler(startedBefore: number): EnemyFactionMemberRow {
  return {
    member_id: member.id,
    faction_id: 123,
    name: member.name,
    level: member.level,
    position: null,
    days_in_faction: null,
    company_type: null,
    company_rating: null,
    company_id: null,
    is_revivable: 0,
    ff_battlestats: null,
    ff_battlestats_updated_at: null,
    bsp_battlestats: null,
    bsp_battlestats_updated_at: null,
    networth: null,
    networth_updated_at: null,
    networth_attempted_at: null,
    networth_attempt_count: null,
    networth_error: null,
    networth_key_source: null,
    status_state: "Traveling",
    status_description: member.status!.description,
    last_action_status: null,
    last_action_timestamp: null,
    plane_image_type: "light_aircraft",
    travel_origin: "United Arab Emirates",
    travel_destination: "Torn",
    travel_signature: `${member.status!.description}|light_aircraft|United Arab Emirates|Torn`,
    travel_detected_at: startedBefore,
    travel_started_after: null,
    travel_started_before: startedBefore,
    estimated_arrival_at: startedBefore + flightSeconds,
    estimated_arrival_earliest: null,
    estimated_arrival_latest: startedBefore + flightSeconds,
    travel_trip_destination: "United Arab Emirates",
    travel_trip_type: "Airstrip",
    travel_trip_inferred_at: null,
    status_updated_at: startedBefore,
    updated_at: startedBefore,
  };
}

describe("travel observations during faction refresh", () => {
  let env: Env;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(now * 1000);
    const statement = {
      bind: vi.fn().mockReturnThis(),
      run: vi.fn().mockResolvedValue({ meta: { changes: 0 } }),
      all: vi.fn().mockResolvedValue({ results: [] }),
    } as unknown as D1PreparedStatement;
    env = {
      DB: {
        prepare: vi.fn().mockReturnValue(statement),
        batch: vi.fn().mockImplementation(async (statements: D1PreparedStatement[]) =>
          statements.map(() => ({ meta: { changes: 1 } }))),
      },
    } as unknown as Env;
    vi.mocked(upsertMemberLiveStatus).mockReturnValue(statement);
    vi.mocked(readSyncTimestamp).mockResolvedValue(now - 60);
    vi.mocked(withTornKeyPool).mockResolvedValue({ members: [member] });
  });

  afterEach(() => vi.useRealTimers());

  it("uses the latest successful home poll as the departure lower bound", async () => {
    vi.mocked(readHomeScouting).mockResolvedValue([{
      ...previousTraveler(now - 86400),
      faction_id: 8803,
      status_state: "Abroad",
      status_description: "In United Arab Emirates",
      plane_image_type: null,
      travel_signature: null,
    }]);

    await refreshHomeFactionMembers(env);

    expect(upsertMemberLiveStatus).toHaveBeenCalledWith(env, "home_member_live_status", expect.objectContaining({
      travel_started_after: now - 60,
      travel_started_before: now,
      estimated_arrival_earliest: now - 60 + flightSeconds,
    }));
    expect(upsertSyncTimestamp).toHaveBeenCalledWith(env, "home_faction_status_checked_at", now);
  });

  it("does not advance the home poll timestamp when saving observations fails", async () => {
    vi.mocked(readHomeScouting).mockResolvedValue([]);
    vi.mocked(env.DB.batch).mockRejectedValueOnce(new Error("database unavailable"));

    await expect(refreshHomeFactionMembers(env)).rejects.toThrow("database unavailable");

    expect(upsertSyncTimestamp).not.toHaveBeenCalled();
  });

  it("does not infer a departure from a roster row with no observed status", async () => {
    vi.mocked(readEnemyScouting).mockResolvedValue([{
      ...previousTraveler(now - 600),
      status_state: null,
      status_description: null,
      status_updated_at: null,
      travel_signature: null,
    }]);

    await refreshTrackedFactionMemberStatuses(env, 123, now - 60, { members: [member] });

    expect(upsertMemberLiveStatus).toHaveBeenCalledWith(env, "enemy_member_live_status", expect.objectContaining({
      travel_started_after: null,
      travel_started_before: now,
      estimated_arrival_earliest: null,
    }));
  });

  it("keeps the original departure when the plane type becomes available", async () => {
    vi.mocked(readEnemyScouting).mockResolvedValue([{
      ...previousTraveler(now - 600),
      plane_image_type: null,
      travel_signature: `${member.status!.description}||United Arab Emirates|Torn`,
      travel_trip_type: null,
      estimated_arrival_at: null,
      estimated_arrival_latest: null,
    }]);

    await refreshTrackedFactionMemberStatuses(env, 123, now - 60, { members: [member] });

    expect(upsertMemberLiveStatus).toHaveBeenCalledWith(env, "enemy_member_live_status", expect.objectContaining({
      plane_image_type: "light_aircraft",
      travel_detected_at: now - 600,
      travel_started_after: null,
      travel_started_before: now - 600,
      estimated_arrival_latest: now - 600 + flightSeconds,
    }));
  });

  it("keeps known timing when a later poll omits the plane type", async () => {
    vi.mocked(readEnemyScouting).mockResolvedValue([previousTraveler(now - 600)]);

    const result = await refreshTrackedFactionMemberStatuses(env, 123, now - 60, {
      members: [{ ...member, status: { ...member.status, plane_image_type: null } }],
    });

    expect(result.updatedMembers).toBe(0);
    expect(upsertMemberLiveStatus).not.toHaveBeenCalled();
  });

  it.each([
    ["Airstrip", "light_aircraft", 190],
    ["WLT benefit", "private_jet", 135],
    ["Standard", "airliner", 271],
    ["Business Class", "airliner", 81],
    ["Business Class/Standard", "airliner", 271],
  ])("retains outbound %s travel on the return leg when plane details are omitted", async (tripType, planeType, durationMinutes) => {
    vi.mocked(readEnemyScouting).mockResolvedValue([{
      ...previousTraveler(now - 86400),
      status_state: "Abroad",
      status_description: "In United Arab Emirates",
      plane_image_type: null,
      travel_signature: null,
      travel_trip_type: tripType as string,
      travel_trip_inferred_at: now - 80000,
    }]);

    await refreshTrackedFactionMemberStatuses(env, 123, now - 60, {
      members: [{ ...member, status: { ...member.status, plane_image_type: null } }],
    });

    expect(upsertMemberLiveStatus).toHaveBeenCalledWith(env, "enemy_member_live_status", expect.objectContaining({
      plane_image_type: planeType,
      travel_trip_type: tripType,
      travel_trip_inferred_at: now - 80000,
      travel_started_after: now - 60,
      travel_started_before: now,
      estimated_arrival_latest: now + Number(durationMinutes) * 60,
    }));
  });

  it("preserves timing when the same route uses a different location alias", async () => {
    vi.mocked(readEnemyScouting).mockResolvedValue([previousTraveler(now - 600)]);

    await refreshTrackedFactionMemberStatuses(env, 123, now - 60, {
      members: [{ ...member, status: { ...member.status, description: "Traveling from UAE to Torn" } }],
    });

    expect(upsertMemberLiveStatus).toHaveBeenCalledWith(env, "enemy_member_live_status", expect.objectContaining({
      travel_detected_at: now - 600,
      travel_started_after: null,
      travel_started_before: now - 600,
    }));
  });

  it("repairs missing arrival estimates using the stored departure bounds", async () => {
    vi.mocked(readEnemyScouting).mockResolvedValue([{
      ...previousTraveler(now - 600),
      estimated_arrival_at: null,
      estimated_arrival_latest: null,
    }]);

    await refreshTrackedFactionMemberStatuses(env, 123, now - 60, { members: [member] });

    expect(upsertMemberLiveStatus).toHaveBeenCalledWith(env, "enemy_member_live_status", expect.objectContaining({
      travel_started_before: now - 600,
      estimated_arrival_latest: now - 600 + flightSeconds,
    }));
  });

  it("records a stable first sighting when a cached traveling row has no timing", async () => {
    vi.mocked(readEnemyScouting).mockResolvedValue([{
      ...previousTraveler(now - 600),
      travel_detected_at: null,
      travel_started_before: null,
      estimated_arrival_at: null,
      estimated_arrival_latest: null,
    }]);

    await refreshTrackedFactionMemberStatuses(env, 123, now - 60, { members: [member] });

    expect(upsertMemberLiveStatus).toHaveBeenCalledWith(env, "enemy_member_live_status", expect.objectContaining({
      travel_detected_at: now,
      travel_started_after: null,
      travel_started_before: now,
      estimated_arrival_latest: now + flightSeconds,
    }));
  });

  it.each([null, now - 60])("discards a four-day-old matching flight with previous poll %s", async (previousPollAt) => {
    vi.mocked(readEnemyScouting).mockResolvedValue([previousTraveler(now - 4 * 86400)]);

    await refreshTrackedFactionMemberStatuses(env, 123, previousPollAt, { members: [member] });

    expect(upsertMemberLiveStatus).toHaveBeenCalledWith(env, "enemy_member_live_status", expect.objectContaining({
      travel_detected_at: now,
      travel_started_after: null,
      travel_started_before: now,
      estimated_arrival_earliest: null,
      estimated_arrival_latest: now + flightSeconds,
      estimated_arrival_at: now + flightSeconds,
      status_updated_at: now,
    }));
  });

  it("keeps the refreshed flight stable on subsequent polls", async () => {
    const previous = previousTraveler(now - 4 * 86400);
    vi.mocked(readEnemyScouting).mockResolvedValue([previous]);
    await refreshTrackedFactionMemberStatuses(env, 123, null, { members: [member] });
    const snapshot = vi.mocked(upsertMemberLiveStatus).mock.calls[0][2];
    vi.mocked(readEnemyScouting).mockResolvedValue([{ ...previous, ...snapshot }]);
    vi.mocked(upsertMemberLiveStatus).mockClear();
    vi.setSystemTime((now + 60) * 1000);

    const result = await refreshTrackedFactionMemberStatuses(env, 123, now, { members: [member] });

    expect(snapshot.travel_started_before).toBe(now);
    expect(result.updatedMembers).toBe(0);
    expect(upsertMemberLiveStatus).not.toHaveBeenCalled();
  });

  it("discards known departure bounds once the flight and grace period have expired", async () => {
    const previous = previousTraveler(now - flightSeconds - 301);
    vi.mocked(readEnemyScouting).mockResolvedValue([{
      ...previous,
      travel_started_after: previous.travel_started_before,
      estimated_arrival_earliest: previous.estimated_arrival_latest,
    }]);

    await refreshTrackedFactionMemberStatuses(env, 123, now - 60, { members: [member] });

    expect(upsertMemberLiveStatus).toHaveBeenCalledWith(env, "enemy_member_live_status", expect.objectContaining({
      travel_started_after: null,
      travel_started_before: now,
      estimated_arrival_earliest: null,
      estimated_arrival_latest: now + flightSeconds,
    }));
  });

  it.each([now - 60, now - flightSeconds - 300])("preserves an ongoing flight or one within the arrival grace period: %s", async (startedBefore) => {
    vi.mocked(readEnemyScouting).mockResolvedValue([previousTraveler(startedBefore)]);

    const result = await refreshTrackedFactionMemberStatuses(env, 123, now - 60, { members: [member] });

    expect(result.updatedMembers).toBe(0);
    expect(upsertMemberLiveStatus).not.toHaveBeenCalled();
  });

  it("allows an ambiguous airliner to resolve to Standard without resetting departure", async () => {
    const startedBefore = now - 100 * 60;
    const airliner = { ...member, status: { ...member.status, plane_image_type: "airliner" } };
    vi.mocked(readEnemyScouting).mockResolvedValue([{
      ...previousTraveler(startedBefore),
      plane_image_type: "airliner",
      travel_signature: `${member.status!.description}|airliner|United Arab Emirates|Torn`,
      travel_trip_type: "Business Class/Standard",
      estimated_arrival_at: startedBefore + 271 * 60,
      estimated_arrival_latest: startedBefore + 271 * 60,
    }]);

    await refreshTrackedFactionMemberStatuses(env, 123, now - 60, { members: [airliner] });

    expect(upsertMemberLiveStatus).toHaveBeenCalledWith(env, "enemy_member_live_status", expect.objectContaining({
      travel_started_before: startedBefore,
      travel_trip_type: "Standard",
      travel_trip_inferred_at: now,
      estimated_arrival_latest: startedBefore + 271 * 60,
    }));
  });

  it.each(["Business Class", "Standard"] as const)("remembers an outbound %s classification through landing, waiting abroad, and the return estimate", async (expectedType) => {
    const duration = (expectedType === "Business Class" ? 81 : 271) * 60;
    const departure = now - duration;
    let previous: EnemyFactionMemberRow = {
      ...previousTraveler(departure),
      status_description: "Traveling to United Arab Emirates",
      plane_image_type: "airliner",
      travel_origin: "Torn",
      travel_destination: "United Arab Emirates",
      travel_signature: "Traveling to United Arab Emirates|airliner|Torn|United Arab Emirates",
      travel_started_after: departure - 60,
      travel_started_before: departure,
      travel_trip_type: "Business Class/Standard",
      estimated_arrival_earliest: departure - 60 + 81 * 60,
      estimated_arrival_latest: departure + 271 * 60,
    };
    const abroadMember = { ...member, status: { state: "Abroad", description: "In United Arab Emirates" } };
    let previousPollAt = now - 60;

    if (expectedType === "Standard") {
      const stillFlyingAt = departure + 81 * 60 + 301;
      vi.setSystemTime(stillFlyingAt * 1000);
      vi.mocked(readEnemyScouting).mockResolvedValue([previous]);
      await refreshTrackedFactionMemberStatuses(env, 123, stillFlyingAt - 60, {
        members: [{ ...member, status: { state: "Traveling", description: previous.status_description, plane_image_type: "airliner" } }],
      });
      previous = { ...previous, ...vi.mocked(upsertMemberLiveStatus).mock.calls.at(-1)![2] };
      expect(previous.travel_trip_type).toBe("Standard");
      previousPollAt = stillFlyingAt;
      vi.setSystemTime(now * 1000);
    }
    vi.mocked(readEnemyScouting).mockResolvedValue([previous]);
    await refreshTrackedFactionMemberStatuses(env, 123, previousPollAt, { members: [abroadMember] });
    const landed = vi.mocked(upsertMemberLiveStatus).mock.calls.at(-1)![2];
    expect(landed).toMatchObject({
      status_state: "Abroad",
      travel_trip_type: expectedType,
      travel_trip_inferred_at: expect.any(Number),
      travel_started_after: null,
      travel_started_before: null,
    });
    expect(buildTravelDisplay(landed)).toMatchObject({
      return_travel_type: expectedType,
      return_travel_time_seconds: duration,
    });

    previous = { ...previous, ...landed };
    vi.mocked(readEnemyScouting).mockResolvedValue([previous]);
    vi.mocked(upsertMemberLiveStatus).mockClear();
    vi.setSystemTime((now + 600) * 1000);
    const waiting = await refreshTrackedFactionMemberStatuses(env, 123, now, { members: [abroadMember] });
    expect(waiting.updatedMembers).toBe(0);

    vi.setSystemTime((now + 660) * 1000);
    await refreshTrackedFactionMemberStatuses(env, 123, now + 600, {
      members: [{ ...member, status: { ...member.status, plane_image_type: "airliner" } }],
    });
    const returning = vi.mocked(upsertMemberLiveStatus).mock.calls.at(-1)![2];
    expect(returning).toMatchObject({
      travel_trip_type: expectedType,
      travel_trip_inferred_at: landed.travel_trip_inferred_at,
      travel_started_after: now + 600,
      travel_started_before: now + 660,
      estimated_arrival_earliest: now + 600 + duration,
      estimated_arrival_latest: now + 660 + duration,
    });
    const message = formatTravelTrackerSections([{ ...returning, name: member.name }]).join("\n");
    expect(message).toContain(expectedType);
    expect(message).not.toContain("Business Class/Standard");
    expect(message).toContain(`<t:${now + 600 + duration}:t>-<t:${now + 660 + duration}:t>`);
  });

  it("does not classify a different destination as the observed outbound landing", async () => {
    vi.mocked(readEnemyScouting).mockResolvedValue([{
      ...previousTraveler(now - 81 * 60),
      status_description: "Traveling to United Arab Emirates",
      plane_image_type: "airliner",
      travel_origin: "Torn",
      travel_destination: "United Arab Emirates",
      travel_started_after: now - 81 * 60 - 60,
      travel_trip_type: "Business Class/Standard",
    }]);

    await refreshTrackedFactionMemberStatuses(env, 123, now - 60, {
      members: [{ ...member, status: { state: "Abroad", description: "In Mexico" } }],
    });

    expect(vi.mocked(upsertMemberLiveStatus).mock.calls.at(-1)![2]).toMatchObject({
      travel_trip_type: null,
      travel_trip_inferred_at: null,
    });
  });

  it("discards an old airliner trip's inferred travel type along with its timing", async () => {
    const startedBefore = now - 4 * 86400;
    const airliner = { ...member, status: { ...member.status, plane_image_type: "airliner" } };
    vi.mocked(readEnemyScouting).mockResolvedValue([{
      ...previousTraveler(startedBefore),
      plane_image_type: "airliner",
      travel_signature: `${member.status!.description}|airliner|United Arab Emirates|Torn`,
      travel_trip_type: "Standard",
      travel_trip_inferred_at: startedBefore + 90 * 60,
      estimated_arrival_at: startedBefore + 271 * 60,
      estimated_arrival_latest: startedBefore + 271 * 60,
    }]);

    await refreshTrackedFactionMemberStatuses(env, 123, now - 60, { members: [airliner] });

    expect(upsertMemberLiveStatus).toHaveBeenCalledWith(env, "enemy_member_live_status", expect.objectContaining({
      travel_started_after: null,
      travel_started_before: now,
      travel_trip_type: "Business Class/Standard",
      travel_trip_inferred_at: null,
      estimated_arrival_earliest: null,
      estimated_arrival_latest: now + 271 * 60,
    }));
  });

  it("expires a known Business Class trip using its own duration", async () => {
    const startedBefore = now - 100 * 60;
    vi.mocked(readEnemyScouting).mockResolvedValue([{
      ...previousTraveler(startedBefore),
      plane_image_type: "airliner",
      travel_signature: `${member.status!.description}|airliner|United Arab Emirates|Torn`,
      travel_trip_type: "Business Class",
      estimated_arrival_at: startedBefore + 81 * 60,
      estimated_arrival_latest: startedBefore + 81 * 60,
    }]);

    await refreshTrackedFactionMemberStatuses(env, 123, now - 60, {
      members: [{ ...member, status: { ...member.status, plane_image_type: "airliner" } }],
    });

    expect(upsertMemberLiveStatus).toHaveBeenCalledWith(env, "enemy_member_live_status", expect.objectContaining({
      travel_detected_at: now,
      travel_started_after: null,
      travel_started_before: now,
      travel_trip_type: "Business Class/Standard",
      estimated_arrival_latest: now + 271 * 60,
    }));
  });

  it("preserves a departure window when a status change was observed", async () => {
    vi.mocked(readEnemyScouting).mockResolvedValue([{
      ...previousTraveler(now - 600),
      status_state: "Abroad",
      status_description: "In United Arab Emirates",
      plane_image_type: null,
      travel_signature: null,
    }]);

    await refreshTrackedFactionMemberStatuses(env, 123, now - 60, { members: [member] });

    expect(upsertMemberLiveStatus).toHaveBeenCalledWith(env, "enemy_member_live_status", expect.objectContaining({
      travel_started_after: now - 60,
      travel_started_before: now,
      estimated_arrival_earliest: now - 60 + flightSeconds,
      estimated_arrival_latest: now + flightSeconds,
    }));
  });
});
