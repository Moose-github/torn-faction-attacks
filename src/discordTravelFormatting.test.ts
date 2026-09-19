import { describe, expect, it } from "vitest";
import { formatTravelTrackerSections, type DiscordTravelRow } from "./discordTravelFormatting";

const departure = 1_800_000_000;
const arrival = departure + 190 * 60;

function traveler(overrides: Partial<DiscordTravelRow> = {}): DiscordTravelRow {
  return {
    member_id: 1,
    name: "rubenmatos",
    status_state: "Traveling",
    status_description: "Traveling from United Arab Emirates to Torn",
    plane_image_type: "light_aircraft",
    travel_origin: "United Arab Emirates",
    travel_destination: "Torn",
    travel_started_after: departure,
    travel_started_before: departure,
    estimated_arrival_at: arrival,
    estimated_arrival_earliest: arrival,
    estimated_arrival_latest: arrival,
    travel_trip_destination: "United Arab Emirates",
    travel_trip_type: "Airstrip",
    travel_trip_inferred_at: null,
    ...overrides,
  };
}

describe("Discord travel formatting", () => {
  it("keeps the flight duration but hides the arrival when departure is unknown", () => {
    const lines = formatTravelTrackerSections([traveler({
      travel_started_after: null,
      estimated_arrival_earliest: null,
    })]);

    expect(lines.at(-1)).toBe(
      "[rubenmatos](https://www.torn.com/profiles.php?XID=1) | United Arab Emirates -> Torn | Unknown | 3h 10m | Unknown | Airstrip",
    );
  });

  it.each([
    { travel_started_after: null },
    { travel_started_before: null },
    { travel_started_after: null, travel_started_before: null },
  ])("hides cached arrival timestamps for an incomplete departure window: %j", (overrides) => {
    const lines = formatTravelTrackerSections([traveler(overrides)]);

    expect(lines.at(-1)).toMatch(/\| Unknown \| Airstrip$/);
    expect(lines.join("\n")).not.toContain("<t:");
  });

  it("preserves a known departure and arrival", () => {
    const lines = formatTravelTrackerSections([traveler()]);

    expect(lines.at(-1)).toContain(
      `<t:${departure}:t> | 3h 10m | <t:${arrival}:t> (<t:${arrival}:R>) | Airstrip`,
    );
  });

  it("shows both possible airliner durations even when departure is unknown", () => {
    const lines = formatTravelTrackerSections([traveler({
      plane_image_type: "airliner",
      travel_trip_type: "Business Class/Standard",
      travel_started_after: null,
      estimated_arrival_earliest: null,
      estimated_arrival_at: departure + 271 * 60,
      estimated_arrival_latest: departure + 271 * 60,
    })]);

    expect(lines.at(-1)).toContain("| Unknown | 1h 21m-4h 31m | Unknown | Business Class/Standard");
  });

  it("shows a known route's duration without requiring cached timing fields", () => {
    const lines = formatTravelTrackerSections([traveler({
      travel_started_after: null,
      travel_started_before: null,
      estimated_arrival_earliest: null,
      estimated_arrival_latest: null,
      estimated_arrival_at: null,
    })]);

    expect(lines.at(-1)).toContain("| Unknown | 3h 10m | Unknown | Airstrip");
  });

  it("preserves a bounded departure and arrival range", () => {
    const lines = formatTravelTrackerSections([traveler({
      travel_started_after: departure - 60,
      estimated_arrival_earliest: arrival - 60,
    })]);

    expect(lines.at(-1)).toContain(
      `<t:${departure - 60}:t>-<t:${departure}:t> | 3h 10m | <t:${arrival - 60}:t>-<t:${arrival}:t> (<t:${arrival}:R>) | Airstrip`,
    );
  });
});
