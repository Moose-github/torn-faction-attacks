import {
  buildTravelDisplay,
  initialTravelTripType,
  parseAbroadLocation,
  parseStoredTravelTripType,
  parseTravelDescription,
  planeImageTypeForTripType,
  travelDurationRangeSeconds,
} from "./enemyTravel";

export type DiscordTravelRow = {
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

export function formatTravelTrackerSections(
  members: DiscordTravelRow[],
  options: { view?: "all" | "traveling" | "abroad"; includeEmptySections?: boolean } = {},
): string[] {
  const view = options.view ?? "all";
  const traveling = members.filter((member) => member.status_state === "Traveling");
  const abroad = members.filter((member) => member.status_state === "Abroad");
  const sections: string[] = [];

  if (view !== "abroad" && (traveling.length > 0 || options.includeEmptySections)) {
    sections.push(...travelingSection(traveling));
  }

  if (view !== "traveling" && (abroad.length > 0 || options.includeEmptySections)) {
    if (sections.length > 0) {
      sections.push("");
    }
    sections.push(...abroadSection(abroad));
  }

  return sections;
}

export function travelCounts(members: DiscordTravelRow[]): { traveling: number; abroad: number } {
  return {
    traveling: members.filter((member) => member.status_state === "Traveling").length,
    abroad: members.filter((member) => member.status_state === "Abroad").length,
  };
}

function travelingSection(travelers: DiscordTravelRow[]): string[] {
  if (travelers.length === 0) {
    return ["**Traveling**", "No enemy travelers shown."];
  }

  return [
    `**Traveling (${travelers.length})**`,
    "**Member** | **Route** | **Departure** | **Travel time** | **Arrival** | **Travel type**",
    ...travelers.map((member) => [
      profileLink(member),
      travelRoute(member),
      departureWindow(member),
      travelDuration(member),
      arrivalWindow(member),
      travelType(member),
    ].join(" | ")),
  ];
}

function abroadSection(abroad: DiscordTravelRow[]): string[] {
  if (abroad.length === 0) {
    return ["**Currently abroad**", "No enemy members shown abroad."];
  }

  return [
    `**Currently abroad (${abroad.length})**`,
    "**Member** | **Location** | **Outbound type** | **Travel time**",
    ...abroad.map((member) => [
      profileLink(member),
      abroadLocation(member),
      abroadTravelType(member),
      abroadTravelTime(member),
    ].join(" | ")),
  ];
}

function profileLink(member: DiscordTravelRow): string {
  return `[${cleanName(member.name, member.member_id)}](https://www.torn.com/profiles.php?XID=${member.member_id})`;
}

function travelRoute(member: DiscordTravelRow): string {
  if (member.travel_origin && member.travel_destination) {
    return abbreviateLocation(`${member.travel_origin} -> ${member.travel_destination}`);
  }

  return abbreviateLocation(member.status_description ?? "Route unknown");
}

function departureWindow(member: DiscordTravelRow): string {
  const startedAfter = member.travel_started_after ?? null;
  const startedBefore = member.travel_started_before ?? null;
  if (startedAfter && startedBefore) {
    return startedAfter === startedBefore
      ? discordTime(startedBefore)
      : `${discordTime(startedAfter)}-${discordTime(startedBefore)}`;
  }

  return "Unknown";
}

function travelDuration(member: DiscordTravelRow): string {
  const travel = parseTravelDescription(member.status_description);
  const duration = travel && travelDurationRangeSeconds(
    travel.flightLocation,
    member.plane_image_type,
    parseStoredTravelTripType(member.travel_trip_type),
  );
  if (duration) {
    return duration.shortest === duration.longest
      ? durationLabel(duration.shortest)
      : `${durationLabel(duration.shortest)}-${durationLabel(duration.longest)}`;
  }

  const startedAfter = member.travel_started_after ?? null;
  const startedBefore = member.travel_started_before ?? null;
  const earliestArrival = member.estimated_arrival_earliest ?? null;
  const latestArrival = member.estimated_arrival_latest ?? null;

  if (startedAfter && startedBefore && earliestArrival && latestArrival) {
    const shortest = earliestArrival - startedAfter;
    const longest = latestArrival - startedBefore;
    if (shortest >= 0 && longest >= 0) {
      return shortest === longest
        ? durationLabel(shortest)
        : `${durationLabel(shortest)}-${durationLabel(longest)}`;
    }
  }

  if (startedBefore && latestArrival && latestArrival >= startedBefore) {
    return durationLabel(latestArrival - startedBefore);
  }

  return "Unknown";
}

function arrivalWindow(member: DiscordTravelRow): string {
  // A first sighting supplies only an upper bound, not a known departure.
  if (!member.travel_started_after || !member.travel_started_before) {
    return "Unknown";
  }

  const earliest = member.estimated_arrival_earliest ?? null;
  const latest = member.estimated_arrival_latest ?? null;
  if (earliest && latest) {
    return earliest === latest
      ? `${discordTime(earliest)} (${discordRelative(earliest)})`
      : `${discordTime(earliest)}-${discordTime(latest)} (${discordRelative(latest)})`;
  }

  const eta = member.estimated_arrival_at ?? earliest ?? latest;
  return eta ? `${discordTime(eta)} (${discordRelative(eta)})` : "Unknown";
}

function travelType(member: DiscordTravelRow): string {
  return buildTravelDisplay(member).travel_type ?? "Unknown";
}

function abroadLocation(member: DiscordTravelRow): string {
  if (member.travel_trip_destination) {
    return abbreviateLocation(member.travel_trip_destination);
  }

  const description = member.status_description?.trim();
  if (!description) {
    return "Unknown";
  }

  const match =
    /^In (.+)$/i.exec(description) ??
    /^Abroad in (.+)$/i.exec(description) ??
    /^Currently in (.+)$/i.exec(description);
  return abbreviateLocation(match?.[1]?.trim() || description);
}

function abbreviateLocation(value: string): string {
  return value
    .replace(/\bUnited Arab Emirates\b/gi, "UAE")
    .replace(/\bSouth Africa\b/gi, "SA");
}

function abroadTravelType(member: DiscordTravelRow): string {
  const type = parseStoredTravelTripType(member.travel_trip_type) ?? initialTravelTripType(member.plane_image_type);
  return type === "Business Class/Standard" ? "Unknown" : type ?? "Unknown";
}

function abroadTravelTime(member: DiscordTravelRow): string {
  const location = parseAbroadLocation(member.travel_trip_destination ?? member.status_description);
  if (!location) {
    return "Unknown";
  }

  const type = parseStoredTravelTripType(member.travel_trip_type) ?? initialTravelTripType(member.plane_image_type);
  // Business Class and Standard bound all supported travel types when none is known.
  const plane = type ? planeImageTypeForTripType(type) : "airliner";
  const duration = travelDurationRangeSeconds(location, plane, type);
  if (!duration) {
    return "Unknown";
  }

  return duration.shortest === duration.longest
    ? durationLabel(duration.shortest)
    : `${durationLabel(duration.shortest)} - ${durationLabel(duration.longest)}`;
}

function durationLabel(seconds: number): string {
  const totalMinutes = Math.max(0, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) {
    return `${hours}h ${minutes}m`;
  }
  return hours > 0 ? `${hours}h` : `${minutes}m`;
}

function discordTime(timestamp: number): string {
  return `<t:${Math.floor(timestamp)}:t>`;
}

function discordRelative(timestamp: number): string {
  return `<t:${Math.floor(timestamp)}:R>`;
}

function cleanName(name: string | null, id: number): string {
  return name?.replace(/\s+/g, " ").trim() || `Torn ${id}`;
}
