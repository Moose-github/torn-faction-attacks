import React from "react";
import { Plane } from "lucide-react";
import { EnemyFactionMember } from "../api";
import { CollapsiblePanel, EmptyState, FreshnessMeta, FreshnessTone } from "./Common";
import { formatRelativeTime, formatTime } from "../utils/format";

const BUSINESS_CLASS_RESOLUTION_GRACE_SECONDS = 5 * 60;
export function EnemyTravelPanel({
  members,
  statusCheckedAt,
  isLoading,
  collapsed,
  onToggle,
  trackingState,
  trackingCadence,
  trackingTone,
  trackingDetail,
  onShowTrackingDetails,
}: {
  members: EnemyFactionMember[];
  statusCheckedAt: number | null;
  isLoading: boolean;
  collapsed: boolean;
  onToggle: () => void;
  trackingState: string;
  trackingCadence: string;
  trackingTone: FreshnessTone;
  trackingDetail: string;
  onShowTrackingDetails?: () => void;
}) {
  const nowSeconds = Math.floor(useCurrentTime() / 1000);
  const travelers = members
    .filter((member) => member.status_state === "Traveling")
    .sort((a, b) => {
      const arrivalDiff =
        Number(a.estimated_arrival_at ?? Number.MAX_SAFE_INTEGER) -
        Number(b.estimated_arrival_at ?? Number.MAX_SAFE_INTEGER);
      return arrivalDiff !== 0 ? arrivalDiff : a.name.localeCompare(b.name);
    });
  const abroadMembers = members
    .filter((member) => member.status_state === "Abroad")
    .sort((a, b) => formatAbroadLocation(a).localeCompare(formatAbroadLocation(b)) || a.name.localeCompare(b.name));
  const checkedLabel = statusCheckedAt ? `Checked ${formatRelativeTime(statusCheckedAt)}` : "Not checked";
  const travelSummary = `${travelers.length} traveling | ${abroadMembers.length} abroad | ${checkedLabel}`;

  return (
    <CollapsiblePanel
      title="Enemy travel tracker"
      control={
        <FreshnessMeta
          state={isLoading ? "Loading" : trackingState}
          updatedAt={statusCheckedAt}
          cadence={trackingCadence}
          detail={`${trackingDetail} ${travelSummary}.`}
          tone={trackingTone}
          onClick={onShowTrackingDetails}
        />
      }
      collapsed={collapsed}
      onToggle={onToggle}
      className="enemy-travel-panel table-panel"
    >
      <p className="panel-description">
        Tracks enemy members currently shown by Torn as traveling, with arrival estimates from route and plane type.
        <br />
        Torn reports both Standard and Business Class flights as airliner, so those estimates are shown as a range.
      </p>
      {travelers.length === 0 && abroadMembers.length === 0 ? (
        <EmptyState text="No enemy travelers or abroad members cached" />
      ) : (
        <div className="enemy-travel-sections">
          {travelers.length > 0 ? (
            <div className="table-scroll">
              <table className="enemy-travel-table">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Route</th>
                    <th>Departure</th>
                    <th>Travel time</th>
                    <th>Arrival</th>
                    <th>Travel type</th>
                  </tr>
                </thead>
                <tbody>
                  {travelers.map((member) => (
                    <tr key={member.member_id}>
                      <td>
                        <TravelMemberLink member={member} />
                      </td>
                      <td>{formatTravelRoute(member)}</td>
                      <td title={formatTravelStartWindow(member)}>{renderDepartureWindow(member, nowSeconds)}</td>
                      <td title={formatTravelDurationTooltip(member, nowSeconds)}>{renderTravelDuration(member, nowSeconds)}</td>
                      <td title={formatArrivalTooltip(member, nowSeconds)}>{renderArrivalRange(member, nowSeconds)}</td>
                      <td>
                        <span className="plane-type" title={formatPlaneTypeTooltip(member, nowSeconds)}>
                          <Plane size={14} />
                          {renderTravelType(member, nowSeconds)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {abroadMembers.length > 0 ? (
            <section className="enemy-abroad-section">
              <h3>Currently abroad</h3>
              <p className="panel-description">
                Uses the current trip travel type to show the minimum return time if they leave immediately.
              </p>
              <div className="table-scroll">
                <table className="enemy-travel-table">
                  <thead>
                    <tr>
                      <th>Member</th>
                      <th>Location</th>
                      <th>Outbound type</th>
                      <th>Minimum return</th>
                    </tr>
                  </thead>
                  <tbody>
                    {abroadMembers.map((member) => (
                      <tr key={member.member_id}>
                        <td>
                          <TravelMemberLink member={member} />
                        </td>
                        <td>{formatAbroadLocation(member)}</td>
                        <td>
                          <span className="plane-type" title={formatAbroadTravelTypeTooltip(member)}>
                            <Plane size={14} />
                            {formatAbroadTravelType(member)}
                          </span>
                        </td>
                        <td title={member.return_travel_time_note ?? undefined}>
                          {formatMinimumReturnTime(member)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </div>
      )}
    </CollapsiblePanel>
  );
}

function TravelMemberLink({ member }: { member: EnemyFactionMember }) {
  return (
    <a
      href={`https://www.torn.com/profiles.php?XID=${member.member_id}`}
      target="_blank"
      rel="noreferrer"
      title={`Open ${member.name} on Torn`}
    >
      {member.name}
    </a>
  );
}

function formatTravelRoute(member: EnemyFactionMember): string {
  if (!member.travel_origin || !member.travel_destination) {
    return member.status_description ?? "Route unknown";
  }

  const origin = member.travel_origin;
  const destination = member.travel_destination;
  return `${origin} -> ${destination}`;
}

function renderArrivalRange(member: EnemyFactionMember, nowSeconds: number): React.ReactNode {
  if (isAmbiguousAirliner(member)) {
    const possibilities = displayedAmbiguousAirlinerTravelPossibilities(member, nowSeconds);
    if (possibilities) {
      return <StackedTravelOptions values={possibilities.map((option) => option.arrival)} />;
    }
  }

  return formatArrivalRange(member);
}

function formatArrivalRange(member: EnemyFactionMember): string {
  if (!hasKnownDepartureWindow(member)) {
    return "Unknown";
  }

  const earliest = member.estimated_arrival_earliest ?? null;
  const latest = member.estimated_arrival_latest ?? null;
  if (earliest && latest) {
    return earliest === latest ? formatTime(earliest) : `${formatTime(earliest)}-${formatTime(latest)}`;
  }

  if (member.estimated_arrival_at) {
    return `Approx ${formatTime(member.estimated_arrival_at)}`;
  }

  return "ETA unknown";
}

function renderDepartureWindow(member: EnemyFactionMember, nowSeconds: number): React.ReactNode {
  if (isAmbiguousAirliner(member)) {
    const possibilities = displayedAmbiguousAirlinerTravelPossibilities(member, nowSeconds);
    if (possibilities) {
      return <StackedTravelOptions values={possibilities.map((option) => option.departure)} />;
    }
  }

  return formatDepartureWindow(member);
}

function formatDepartureWindow(member: EnemyFactionMember): string {
  const startedAfter = member.travel_started_after ?? null;
  const startedBefore = member.travel_started_before ?? null;
  if (startedAfter && startedBefore) {
    return startedAfter === startedBefore
      ? formatTime(startedBefore)
      : `${formatTime(startedAfter)}-${formatTime(startedBefore)}`;
  }

  if (startedBefore) {
    return "Unknown";
  }

  return "Unknown";
}

function renderTravelDuration(member: EnemyFactionMember, nowSeconds: number): React.ReactNode {
  if (isAmbiguousAirliner(member)) {
    const possibilities = displayedAmbiguousAirlinerTravelPossibilities(member, nowSeconds);
    if (possibilities) {
      return <StackedTravelOptions values={possibilities.map((option) => option.duration)} />;
    }
  }

  return formatTravelDuration(member);
}

function formatTravelDuration(member: EnemyFactionMember): string {
  const startedBefore = member.travel_started_before ?? null;
  const latestArrival = member.estimated_arrival_latest ?? null;
  if (startedBefore && latestArrival && latestArrival >= startedBefore) {
    return formatTravelDurationValue(latestArrival - startedBefore);
  }

  const startedAfter = member.travel_started_after ?? null;
  const earliestArrival = member.estimated_arrival_earliest ?? null;
  if (startedAfter && earliestArrival && earliestArrival >= startedAfter) {
    return formatTravelDurationValue(earliestArrival - startedAfter);
  }

  return "Unknown";
}

function formatTravelDurationTooltip(member: EnemyFactionMember, nowSeconds: number): string {
  if (ambiguousAirlinerResolvedAsStandard(member, nowSeconds)) {
    return "Airliner shown as Standard because the Business Class arrival window has passed.";
  }

  return member.travel_time_note ?? member.travel_type_note ?? formatPlaneType(member.plane_image_type);
}

function formatTravelDurationValue(seconds: number): string {
  const totalMinutes = Math.max(0, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0 && minutes > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (hours > 0) {
    return `${hours}h`;
  }

  return `${minutes}m`;
}

function formatTravelStartWindow(member: EnemyFactionMember): string {
  if (member.travel_started_after && member.travel_started_before) {
    return `Travel started between ${formatTime(member.travel_started_after)} and ${formatTime(member.travel_started_before)}`;
  }

  if (member.travel_started_before) {
    return `Already traveling when first seen at ${formatTime(member.travel_started_before)}; departure happened before tracking observed this trip.`;
  }

  return member.status_description ?? "Travel timing unknown";
}

function formatArrivalTooltip(member: EnemyFactionMember, nowSeconds: number): string {
  if (!hasKnownDepartureWindow(member)) {
    return member.travel_started_before
      ? `Arrival cannot be estimated because this trip was already in progress when first seen at ${formatTime(member.travel_started_before)}.`
      : "Arrival cannot be estimated because the departure time is unknown.";
  }

  if (isAmbiguousAirliner(member)) {
    const possibleArrivals = formatAmbiguousAirlinerArrivalTooltip(member, nowSeconds);
    if (possibleArrivals) {
      return possibleArrivals;
    }
  }

  return member.arrival_note ?? member.status_description ?? "Travel arrival estimate";
}

function formatAmbiguousAirlinerArrivalTooltip(member: EnemyFactionMember, nowSeconds: number): string | null {
  const possibilities = displayedAmbiguousAirlinerTravelPossibilities(member, nowSeconds);
  if (!possibilities) {
    return null;
  }

  return possibilities.map((option) => `${option.label}: ${option.arrival}`).join("\n");
}

function isAmbiguousAirliner(member: EnemyFactionMember): boolean {
  return member.travel_type === "Business Class/Standard";
}

function hasKnownDepartureWindow(member: EnemyFactionMember): boolean {
  return Boolean(member.travel_started_after && member.travel_started_before);
}

function renderTravelType(member: EnemyFactionMember, nowSeconds: number): React.ReactNode {
  if (isAmbiguousAirliner(member)) {
    const possibilities = displayedAmbiguousAirlinerTravelPossibilities(member, nowSeconds);
    if (possibilities) {
      return <StackedTravelOptions values={possibilities.map((option) => option.label)} />;
    }
  }

  return member.travel_type ?? "Unknown";
}

function formatPlaneTypeTooltip(member: EnemyFactionMember, nowSeconds: number): string {
  if (ambiguousAirlinerResolvedAsStandard(member, nowSeconds)) {
    return "Airliner; Business Class arrival window has passed, so this is treated as Standard.";
  }

  return member.travel_type_note ?? member.plane_type_label ?? formatPlaneType(member.plane_image_type);
}

function formatPlaneType(value: string | null | undefined): string {
  if (!value) {
    return "Unknown";
  }

  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
}

function formatAbroadLocation(member: EnemyFactionMember): string {
  const tripDestination = member.travel_trip_destination ?? null;
  if (tripDestination) {
    return tripDestination;
  }

  const description = member.status_description ?? null;
  if (!description) {
    return "Unknown";
  }

  const trimmed = description.trim();
  const match =
    /^In (.+)$/i.exec(trimmed) ??
    /^Abroad in (.+)$/i.exec(trimmed) ??
    /^Currently in (.+)$/i.exec(trimmed);

  return match?.[1]?.trim() || trimmed;
}

function formatAbroadTravelType(member: EnemyFactionMember): string {
  return member.return_travel_type ?? member.travel_trip_type ?? "Unknown";
}

function formatAbroadTravelTypeTooltip(member: EnemyFactionMember): string {
  if (member.travel_trip_inferred_at) {
    return `Travel type inferred ${formatRelativeTime(member.travel_trip_inferred_at)}`;
  }

  if (member.travel_trip_type === "Business Class/Standard") {
    return "Torn reports both Business Class and Standard as airliner; minimum return uses Business Class.";
  }

  return member.travel_trip_type ?? "Travel type unknown";
}

function formatMinimumReturnTime(member: EnemyFactionMember): string {
  const seconds = member.return_travel_time_seconds ?? null;
  if (seconds === null) {
    return "Unknown";
  }

  return formatTravelDurationValue(seconds);
}

function ambiguousAirlinerTravelPossibilities(member: EnemyFactionMember): Array<{
  label: "Business Class" | "Standard";
  departure: string;
  duration: string;
  arrival: string;
  latestArrival: number;
}> | null {
  const startedAfter = member.travel_started_after ?? null;
  const startedBefore = member.travel_started_before ?? null;
  const earliestArrival = member.estimated_arrival_earliest ?? null;
  const latestArrival = member.estimated_arrival_latest ?? null;

  if (!startedAfter || !startedBefore || !earliestArrival || !latestArrival) {
    return null;
  }

  const businessClassDuration = earliestArrival - startedAfter;
  const standardDuration = latestArrival - startedBefore;
  if (businessClassDuration < 0 || standardDuration < 0) {
    return null;
  }

  return [
    {
      label: "Business Class",
      departure: formatTimeWindow(startedAfter, startedBefore),
      duration: formatTravelDurationValue(businessClassDuration),
      arrival: formatTimeWindow(startedAfter + businessClassDuration, startedBefore + businessClassDuration),
      latestArrival: startedBefore + businessClassDuration,
    },
    {
      label: "Standard",
      departure: formatTimeWindow(startedAfter, startedBefore),
      duration: formatTravelDurationValue(standardDuration),
      arrival: formatTimeWindow(startedAfter + standardDuration, startedBefore + standardDuration),
      latestArrival: startedBefore + standardDuration,
    },
  ];
}

function displayedAmbiguousAirlinerTravelPossibilities(
  member: EnemyFactionMember,
  nowSeconds: number,
): ReturnType<typeof ambiguousAirlinerTravelPossibilities> {
  const possibilities = ambiguousAirlinerTravelPossibilities(member);
  if (!possibilities) {
    return null;
  }

  return ambiguousAirlinerResolvedAsStandard(member, nowSeconds)
    ? possibilities.filter((option) => option.label === "Standard")
    : possibilities;
}

function ambiguousAirlinerResolvedAsStandard(member: EnemyFactionMember, nowSeconds: number): boolean {
  const businessClass = ambiguousAirlinerTravelPossibilities(member)?.find(
    (option) => option.label === "Business Class",
  );
  if (!businessClass) {
    return false;
  }

  return nowSeconds > businessClass.latestArrival + BUSINESS_CLASS_RESOLUTION_GRACE_SECONDS;
}

function StackedTravelOptions({ values }: { values: string[] }) {
  return (
    <span className="stacked-travel-options">
      {values.map((value, index) => (
        <span key={`${value}-${index}`}>{value}</span>
      ))}
    </span>
  );
}

function formatTimeWindow(start: number, end: number): string {
  return start === end ? formatTime(start) : `${formatTime(start)}-${formatTime(end)}`;
}

function useCurrentTime(): number {
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return now;
}
