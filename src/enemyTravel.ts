import { cleanText } from "./utils";

export const TORN_LOCATION = "Torn";

const BUSINESS_CLASS_RESOLUTION_GRACE_SECONDS = 5 * 60;

export type TravelDurationKey = "Standard" | "Airstrip" | "WLT benefit" | "Business Class";
export type StoredTravelTripType = TravelDurationKey | "Business Class/Standard";

export type ParsedTravel = {
  origin: string;
  destination: string;
  flightLocation: string;
};

export type TravelEstimate = {
  estimated_arrival_at: number | null;
  estimated_arrival_earliest: number | null;
  estimated_arrival_latest: number | null;
};

export type TravelDisplay = {
  plane_type_label: string | null;
  travel_type: string | null;
  travel_type_note: string | null;
  travel_time_note: string | null;
  arrival_note: string | null;
  is_travel_time_range: boolean;
  return_travel_type: string | null;
  return_travel_time_seconds: number | null;
  return_travel_time_note: string | null;
};

export type TravelDisplayRow = {
  status_state?: string | null;
  status_description?: string | null;
  plane_image_type?: string | null;
  travel_trip_destination?: string | null;
  travel_trip_type?: string | null;
};

const TRAVEL_DURATIONS_MINUTES: Record<string, Record<TravelDurationKey, number>> = {
  Mexico: { Standard: 26, Airstrip: 18, "WLT benefit": 13, "Business Class": 8 },
  "Cayman Islands": { Standard: 35, Airstrip: 25, "WLT benefit": 18, "Business Class": 11 },
  Canada: { Standard: 41, Airstrip: 29, "WLT benefit": 20, "Business Class": 12 },
  Hawaii: { Standard: 134, Airstrip: 94, "WLT benefit": 67, "Business Class": 40 },
  "United Kingdom": { Standard: 159, Airstrip: 111, "WLT benefit": 80, "Business Class": 48 },
  Argentina: { Standard: 167, Airstrip: 117, "WLT benefit": 83, "Business Class": 50 },
  Switzerland: { Standard: 175, Airstrip: 123, "WLT benefit": 88, "Business Class": 53 },
  Japan: { Standard: 225, Airstrip: 158, "WLT benefit": 113, "Business Class": 68 },
  China: { Standard: 242, Airstrip: 169, "WLT benefit": 121, "Business Class": 72 },
  "United Arab Emirates": { Standard: 271, Airstrip: 190, "WLT benefit": 135, "Business Class": 81 },
  "South Africa": { Standard: 297, Airstrip: 208, "WLT benefit": 149, "Business Class": 89 },
};

const PLANE_IMAGE_TYPE_TO_DURATION_KEY: Record<string, TravelDurationKey> = {
  light_aircraft: "Airstrip",
  private_jet: "WLT benefit",
};

const PLANE_IMAGE_TYPE_LABELS: Record<string, string> = {
  airliner: "Airliner",
  light_aircraft: "Light Aircraft",
  private_jet: "Private Jet",
};

const TRAVEL_LOCATION_ALIASES: Record<string, string> = {
  argentina: "Argentina",
  canada: "Canada",
  cayman: "Cayman Islands",
  "cayman islands": "Cayman Islands",
  china: "China",
  hawaii: "Hawaii",
  japan: "Japan",
  mexico: "Mexico",
  "south africa": "South Africa",
  switzerland: "Switzerland",
  torn: TORN_LOCATION,
  uk: "United Kingdom",
  "united kingdom": "United Kingdom",
  uae: "United Arab Emirates",
  "united arab emirates": "United Arab Emirates",
};

export function parseTravelDescription(description: string | null): ParsedTravel | null {
  if (!description) {
    return null;
  }

  const outbound = /^Traveling to (.+)$/i.exec(description);
  if (outbound) {
    const destination = normalizeTravelLocation(outbound[1]);
    if (!destination || destination === TORN_LOCATION) {
      return null;
    }
    return {
      origin: TORN_LOCATION,
      destination,
      flightLocation: destination,
    };
  }

  const explicitOutbound = /^Traveling from Torn to (.+)$/i.exec(description);
  if (explicitOutbound) {
    const destination = normalizeTravelLocation(explicitOutbound[1]);
    if (!destination || destination === TORN_LOCATION) {
      return null;
    }
    return {
      origin: TORN_LOCATION,
      destination,
      flightLocation: destination,
    };
  }

  const returning = /^Traveling from (.+) to Torn$/i.exec(description);
  if (returning) {
    const origin = normalizeTravelLocation(returning[1]);
    if (!origin || origin === TORN_LOCATION) {
      return null;
    }
    return {
      origin,
      destination: TORN_LOCATION,
      flightLocation: origin,
    };
  }

  return null;
}

export function parseAbroadLocation(description: string | null): string | null {
  if (!description) {
    return null;
  }

  const match =
    /^In (.+)$/i.exec(description) ??
    /^Abroad in (.+)$/i.exec(description) ??
    /^Currently in (.+)$/i.exec(description);
  const location = normalizeTravelLocation(match?.[1] ?? description);
  return location === TORN_LOCATION ? null : location;
}

export function initialTravelTripType(planeImageType: string | null): StoredTravelTripType | null {
  if (planeImageType === "airliner") {
    return "Business Class/Standard";
  }

  const durationKey = planeImageType ? PLANE_IMAGE_TYPE_TO_DURATION_KEY[planeImageType] : undefined;
  return durationKey ?? null;
}

export function parseStoredTravelTripType(value: string | null | undefined): StoredTravelTripType | null {
  if (
    value === "Standard" ||
    value === "Airstrip" ||
    value === "WLT benefit" ||
    value === "Business Class" ||
    value === "Business Class/Standard"
  ) {
    return value;
  }

  return null;
}

export function resolveTravelTripType(
  flightLocation: string,
  planeImageType: string | null,
  startedBefore: number,
  currentType: StoredTravelTripType | null,
  currentInferredAt: number | null,
  fetchedAt: number,
): { type: StoredTravelTripType | null; inferredAt: number | null } {
  if (planeImageType !== "airliner" || currentType !== "Business Class/Standard") {
    return { type: currentType, inferredAt: currentInferredAt };
  }

  const businessClassMinutes = TRAVEL_DURATIONS_MINUTES[flightLocation]?.["Business Class"];
  if (!businessClassMinutes) {
    return { type: currentType, inferredAt: currentInferredAt };
  }

  const businessClassLatestArrival = startedBefore + businessClassMinutes * 60;
  if (fetchedAt > businessClassLatestArrival + BUSINESS_CLASS_RESOLUTION_GRACE_SECONDS) {
    return { type: "Standard", inferredAt: currentInferredAt ?? fetchedAt };
  }

  return { type: currentType, inferredAt: currentInferredAt };
}

export function estimateTravelArrival(
  flightLocation: string,
  planeImageType: string | null,
  startedAfter: number | null,
  startedBefore: number,
  tripType: StoredTravelTripType | null = null,
): TravelEstimate {
  if (planeImageType === "airliner") {
    const businessClassMinutes = TRAVEL_DURATIONS_MINUTES[flightLocation]?.["Business Class"];
    const standardMinutes = TRAVEL_DURATIONS_MINUTES[flightLocation]?.Standard;
    if (!businessClassMinutes || !standardMinutes) {
      return emptyTravelEstimate();
    }

    if (tripType === "Standard" || tripType === "Business Class") {
      const durationMinutes = tripType === "Standard" ? standardMinutes : businessClassMinutes;
      return buildEstimate(startedAfter, startedBefore, durationMinutes);
    }

    const estimatedEarliest =
      startedAfter === null ? null : startedAfter + businessClassMinutes * 60;
    const estimatedLatest = startedBefore + standardMinutes * 60;
    const estimatedArrival =
      estimatedEarliest === null
        ? estimatedLatest
        : Math.floor((estimatedEarliest + estimatedLatest) / 2);

    return {
      estimated_arrival_at: estimatedArrival,
      estimated_arrival_earliest: estimatedEarliest,
      estimated_arrival_latest: estimatedLatest,
    };
  }

  const durationKey = planeImageType ? PLANE_IMAGE_TYPE_TO_DURATION_KEY[planeImageType] : undefined;
  const durationMinutes = durationKey ? TRAVEL_DURATIONS_MINUTES[flightLocation]?.[durationKey] : undefined;
  if (!durationMinutes) {
    return emptyTravelEstimate();
  }

  return buildEstimate(startedAfter, startedBefore, durationMinutes);
}

export function buildTravelDisplay(row: TravelDisplayRow): TravelDisplay {
  const planeTypeLabel = formatPlaneImageType(row.plane_image_type);
  const tripType = parseStoredTravelTripType(row.travel_trip_type);
  const returnTravelTimeSeconds = returnTravelDurationSeconds(row.travel_trip_destination, tripType);
  const returnTravelType =
    tripType === "Business Class/Standard" ? "Business Class minimum" : (tripType ?? null);
  const returnTravelTimeNote =
    row.status_state === "Abroad" && row.travel_trip_destination
      ? `Minimum return time from ${row.travel_trip_destination} if leaving now.`
      : null;

  if (row.plane_image_type === "airliner") {
    if (tripType === "Standard" || tripType === "Business Class") {
      return {
        plane_type_label: planeTypeLabel,
        travel_type: tripType,
        travel_type_note:
          tripType === "Standard"
            ? `${planeTypeLabel ?? "Airliner"}; Standard inferred because Business Class timing was ruled out.`
            : planeTypeLabel,
        travel_time_note: tripType,
        arrival_note: row.status_description ?? "Travel arrival estimate",
        is_travel_time_range: false,
        return_travel_type: returnTravelType,
        return_travel_time_seconds: returnTravelTimeSeconds,
        return_travel_time_note: returnTravelTimeNote,
      };
    }

    const note = "Torn reports both Standard and Business Class flights as airliner.";
    return {
      plane_type_label: planeTypeLabel,
      travel_type: "Business Class/Standard",
      travel_type_note: `${planeTypeLabel ?? "Airliner"}; ${note}`,
      travel_time_note:
        "Airliner can be either Business Class or Standard. Travel time range shows Business Class fastest and Standard slowest.",
      arrival_note:
        "Arrival range uses Business Class for earliest arrival and Standard for latest arrival because Torn reports both as airliner.",
      is_travel_time_range: true,
      return_travel_type: returnTravelType,
      return_travel_time_seconds: returnTravelTimeSeconds,
      return_travel_time_note: returnTravelTimeNote,
    };
  }

  const durationKey = row.plane_image_type
    ? PLANE_IMAGE_TYPE_TO_DURATION_KEY[row.plane_image_type]
    : undefined;
  const travelType = durationKey ?? null;

  return {
    plane_type_label: planeTypeLabel,
    travel_type: row.status_state === "Abroad" ? (tripType ?? travelType) : travelType,
    travel_type_note: planeTypeLabel,
    travel_time_note: travelType ?? planeTypeLabel,
    arrival_note: row.status_description ?? "Travel arrival estimate",
    is_travel_time_range: false,
    return_travel_type: returnTravelType,
    return_travel_time_seconds: returnTravelTimeSeconds,
    return_travel_time_note: returnTravelTimeNote,
  };
}

export function buildTravelSignature(
  description: string | null,
  planeImageType: string | null,
  travel: ParsedTravel,
): string {
  return [
    description ?? "",
    planeImageType ?? "",
    travel.origin,
    travel.destination,
  ].join("|");
}

function normalizeTravelLocation(value: string | undefined): string | null {
  const cleaned = cleanText(value);
  if (!cleaned) {
    return null;
  }

  return TRAVEL_LOCATION_ALIASES[cleaned.toLowerCase()] ?? cleaned;
}

function returnTravelDurationSeconds(
  destination: string | null | undefined,
  tripType: StoredTravelTripType | null,
): number | null {
  if (!destination || !tripType) {
    return null;
  }

  const durationKey = tripType === "Business Class/Standard" ? "Business Class" : tripType;
  const minutes = TRAVEL_DURATIONS_MINUTES[destination]?.[durationKey];
  return minutes ? minutes * 60 : null;
}

function formatPlaneImageType(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  return (
    PLANE_IMAGE_TYPE_LABELS[value] ??
    value
      .split("_")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
  );
}

function buildEstimate(
  startedAfter: number | null,
  startedBefore: number,
  durationMinutes: number,
): TravelEstimate {
  const durationSeconds = durationMinutes * 60;
  const estimatedLatest = startedBefore + durationSeconds;
  const estimatedEarliest = startedAfter === null ? null : startedAfter + durationSeconds;
  const estimatedArrival =
    estimatedEarliest === null
      ? estimatedLatest
      : Math.floor((estimatedEarliest + estimatedLatest) / 2);

  return {
    estimated_arrival_at: estimatedArrival,
    estimated_arrival_earliest: estimatedEarliest,
    estimated_arrival_latest: estimatedLatest,
  };
}

function emptyTravelEstimate(): TravelEstimate {
  return {
    estimated_arrival_at: null,
    estimated_arrival_earliest: null,
    estimated_arrival_latest: null,
  };
}
