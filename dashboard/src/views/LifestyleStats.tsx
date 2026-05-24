import React from "react";
import { Activity, ArrowDown, ArrowUp, Dumbbell, Pill } from "lucide-react";
import {
  getMemberLifestyleStats,
  MemberLifestyleStats,
} from "../api";
import { PanelHeader } from "../components/Common";
import { downloadCsv, sanitizeCsvFilename } from "../utils/csv";
import { formatNetworth, formatNumber, formatRelativeTime } from "../utils/format";

type LifestyleSortKey =
  | "member_name"
  | "overdosed"
  | "average_xantaken"
  | "adjusted_average_xantaken"
  | "average_refills"
  | "average_useractivity"
  | "networth"
  | "average_gymenergy"
  | "average_gymstrength"
  | "average_gymspeed"
  | "average_gymdefense"
  | "average_gymdexterity"
  | "updated_at";

type LifestyleSort = {
  key: LifestyleSortKey;
  direction: "asc" | "desc";
};

const SORT_LABELS: Record<LifestyleSortKey, string> = {
  member_name: "Member",
  overdosed: "ODs",
  average_xantaken: "Daily Xanax",
  adjusted_average_xantaken: "Adjusted Xanax",
  average_refills: "Daily Refills",
  average_useractivity: "Daily Activity",
  networth: "Networth",
  average_gymenergy: "Daily Gym energy",
  average_gymstrength: "Daily Strength",
  average_gymspeed: "Daily Speed",
  average_gymdefense: "Daily Defense",
  average_gymdexterity: "Daily Dexterity",
  updated_at: "Updated",
};

export function LifestyleStats({ isAdmin }: { isAdmin: boolean }) {
  const [stats, setStats] = React.useState<Awaited<ReturnType<typeof getMemberLifestyleStats>> | null>(null);
  const [sort, setSort] = React.useState<LifestyleSort>({ key: "average_xantaken", direction: "desc" });
  const [period, setPeriod] = React.useState(() => currentMonthPeriod());
  const [error, setError] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);

  const loadStats = React.useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await getMemberLifestyleStats(period);
      setStats(response);
      if (
        response.period.start_date !== period.startDate ||
        response.period.end_date !== period.endDate
      ) {
        setPeriod({
          startDate: response.period.start_date,
          endDate: response.period.end_date,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [period]);

  React.useEffect(() => {
    loadStats();
  }, [loadStats]);

  const members = sortLifestyleMembers(stats?.members ?? [], sort);
  const periodLengthDays = stats?.period.days ?? periodDays(period.startDate, period.endDate);
  const dailyXanax = stats?.summary.average_xantaken ?? 0;
  const totalXanax = stats?.summary.total_xantaken ?? 0;
  const dailyGymEnergy = stats?.summary.average_gymenergy ?? 0;
  const totalGymEnergy = stats?.summary.total_gymenergy ?? 0;
  const factionDailyXanax = totalXanax / Math.max(1, periodLengthDays);
  const factionDailyGymEnergy = totalGymEnergy / Math.max(1, periodLengthDays);
  const availableStartDate = stats?.period.available_start_date ?? null;
  const availableEndDate = stats?.period.available_end_date ?? null;
  const hasAvailableRange = availableStartDate !== null && availableEndDate !== null;

  function updateStartDate(value: string) {
    setPeriod((current) => {
      const startDate = clampDateToAvailableRange(value, availableStartDate, availableEndDate);
      const endDate = clampDateToAvailableRange(
        current.endDate < startDate ? startDate : current.endDate,
        availableStartDate,
        availableEndDate,
      );
      return { startDate, endDate };
    });
  }

  function updateEndDate(value: string) {
    setPeriod((current) => {
      const endDate = clampDateToAvailableRange(value, availableStartDate, availableEndDate);
      const startDate = clampDateToAvailableRange(
        current.startDate > endDate ? endDate : current.startDate,
        availableStartDate,
        availableEndDate,
      );
      return { startDate, endDate };
    });
  }

  return (
    <>
      {error ? <div className="error-panel">{error}</div> : null}
      <section className="hero-panel compact-hero-panel">
        <div>
          <p className="eyebrow">Public personal stats</p>
          <h2>
            Daily stats
            <span
              className="data-wip-badge"
              title="Historical daily stat snapshots are quarantined while the guarded data rebuilds."
            >
              WIP
            </span>
          </h2>
          <p>Averaged daily activity from daily snapshots. Made using Torn personal stats and faction contributors.</p>
        </div>
      </section>

      <section className="status-grid lifestyle-status-grid">
        <LifestyleAverageCard
          label="Daily Xanax"
          value={formatNumber(dailyXanax)}
          icon={<Pill size={18} />}
          factionDailyValue={formatNumber(factionDailyXanax)}
          factionTotalValue={formatNumber(totalXanax)}
        />
        <LifestyleAverageCard
          label="Daily Gym energy"
          value={formatNumber(dailyGymEnergy)}
          icon={<Dumbbell size={18} />}
          factionDailyValue={formatNumber(factionDailyGymEnergy)}
          factionTotalValue={formatNumber(totalGymEnergy)}
        />
        <section className="metric-card lifestyle-period-card">
          <div className="panel-kicker">
            <Activity size={18} />
            <span>Time period</span>
          </div>
          <strong>{periodLengthDays} days</strong>
          <div className="lifestyle-filter-row">
            <label>
              <span>Start</span>
              <input
                type="date"
                value={period.startDate}
                min={availableStartDate ?? undefined}
                max={availableEndDate ?? undefined}
                disabled={!hasAvailableRange}
                onChange={(event) => updateStartDate(event.target.value)}
              />
            </label>
            <label>
              <span>End</span>
              <input
                type="date"
                value={period.endDate}
                min={availableStartDate ?? undefined}
                max={availableEndDate ?? undefined}
                disabled={!hasAvailableRange}
                onChange={(event) => updateEndDate(event.target.value)}
              />
            </label>
          </div>
          {hasAvailableRange ? (
            <span className="lifestyle-date-range-note">
              Available {availableStartDate} to {availableEndDate}
            </span>
          ) : (
            <span className="lifestyle-date-range-note">No snapshot data available yet</span>
          )}
        </section>
      </section>

      <section className="panel table-panel">
        <PanelHeader
          title="Member daily averages"
          aside={isLoading ? "Loading" : `${members.length} members`}
          control={
            isAdmin ? (
              <>
                <span>{isLoading ? "Loading" : `${members.length} members`}</span>
                <button
                  type="button"
                  className="panel-action-button"
                  onClick={() => exportLifestyleCsv(members, period)}
                >
                  CSV
                </button>
              </>
            ) : undefined
          }
        />
        <p className="panel-description">
          Shows each member's average daily activity during selected time period.
          ODs show the total change in recorded overdoses during the selected time period.
        </p>
        <LifestyleTable members={members} sort={sort} onSortChange={setSort} />
      </section>
    </>
  );
}

function LifestyleAverageCard({
  label,
  value,
  icon,
  factionDailyValue,
  factionTotalValue,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  factionDailyValue: string;
  factionTotalValue: string;
}) {
  return (
    <article className="metric-card lifestyle-average-card">
      <div className="panel-kicker">
        {icon}
        <span>{label}</span>
      </div>
      <strong>{value}</strong>
      <span className="lifestyle-main-metric-label">Avg per player / day</span>
      <div className="lifestyle-sub-metrics">
        <span>
          <b>{factionDailyValue}</b>
          <small>Faction / day</small>
        </span>
        <span>
          <b>{factionTotalValue}</b>
          <small>Faction total</small>
        </span>
      </div>
    </article>
  );
}

function exportLifestyleCsv(
  members: MemberLifestyleStats[],
  period: { startDate: string; endDate: string },
) {
  const columns: Array<{
    label: string;
    value: (member: MemberLifestyleStats) => string | number | null | undefined;
  }> = [
    { label: "Player name", value: (member) => member.member_name ?? member.member_id },
    { label: "Member ID", value: (member) => member.member_id },
    { label: "ODs", value: (member) => member.overdosed },
    { label: "Daily Xanax", value: (member) => member.average_xantaken },
    { label: "Adjusted Xanax", value: (member) => member.adjusted_average_xantaken },
    { label: "Daily Refills", value: (member) => member.average_refills },
    { label: "Daily Activity Hours", value: (member) => activityHours(member.average_useractivity) },
    { label: "Networth", value: (member) => member.networth },
    { label: "Daily Gym Energy", value: (member) => member.average_gymenergy },
    { label: "Daily Strength", value: (member) => member.average_gymstrength },
    { label: "Daily Speed", value: (member) => member.average_gymspeed },
    { label: "Daily Defense", value: (member) => member.average_gymdefense },
    { label: "Daily Dexterity", value: (member) => member.average_gymdexterity },
    { label: "Updated At", value: (member) => member.updated_at },
  ];

  downloadCsv(
    `member-daily-averages-${sanitizeCsvFilename(period.startDate)}-${sanitizeCsvFilename(period.endDate)}.csv`,
    columns,
    members,
  );
}

function LifestyleTable({
  members,
  sort,
  onSortChange,
}: {
  members: MemberLifestyleStats[];
  sort: LifestyleSort;
  onSortChange: (sort: LifestyleSort) => void;
}) {
  return (
    <div className="table-scroll">
      <table className="lifestyle-table">
        <thead>
          <tr>
            {[
              "member_name",
              "overdosed",
              "average_xantaken",
              "adjusted_average_xantaken",
              "average_refills",
              "average_useractivity",
              "networth",
              "average_gymenergy",
              "average_gymstrength",
              "average_gymspeed",
              "average_gymdefense",
              "average_gymdexterity",
              "updated_at",
            ].map((key) => (
              <SortableHeader
                key={key}
                label={formatHeaderLabel(SORT_LABELS[key as LifestyleSortKey])}
                sortKey={key as LifestyleSortKey}
                sort={sort}
                onSortChange={onSortChange}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <tr key={member.member_id}>
              <td>
                <a
                  className="member-link"
                  href={`https://www.torn.com/profiles.php?XID=${member.member_id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {member.member_name ?? member.member_id}
                </a>
              </td>
              <td>{cell(member.overdosed)}</td>
              <td>{cell(member.average_xantaken)}</td>
              <td>{cell(member.adjusted_average_xantaken)}</td>
              <td>{cell(member.average_refills)}</td>
              <td>{formatActivityAverage(member.average_useractivity)}</td>
              <td title={networthTitle(member.networth)}>{formatNetworth(member.networth)}</td>
              <td>{cell(member.average_gymenergy)}</td>
              <td>{cell(member.average_gymstrength)}</td>
              <td>{cell(member.average_gymspeed)}</td>
              <td>{cell(member.average_gymdefense)}</td>
              <td>{cell(member.average_gymdexterity)}</td>
              <td>{formatRelativeTime(member.updated_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SortableHeader<TSortKey extends string>({
  label,
  sortKey,
  sort,
  onSortChange,
}: {
  label: React.ReactNode;
  sortKey: TSortKey;
  sort: { key: TSortKey; direction: "asc" | "desc" };
  onSortChange: (sort: { key: TSortKey; direction: "asc" | "desc" }) => void;
}) {
  const isActive = sort.key === sortKey;
  const nextDirection = isActive && sort.direction === "desc" ? "asc" : "desc";

  return (
    <th>
      <button
        type="button"
        className={isActive ? "sort-button active" : "sort-button"}
        onClick={() => onSortChange({ key: sortKey, direction: nextDirection })}
      >
        {label}
        {isActive ? (
          sort.direction === "desc" ? <ArrowDown size={14} /> : <ArrowUp size={14} />
        ) : null}
      </button>
    </th>
  );
}

function sortLifestyleMembers(
  members: MemberLifestyleStats[],
  sort: LifestyleSort,
): MemberLifestyleStats[] {
  const direction = sort.direction === "desc" ? -1 : 1;

  return [...members].sort((left, right) => {
    const leftValue = left[sort.key] ?? (sort.key === "member_name" ? "" : -Infinity);
    const rightValue = right[sort.key] ?? (sort.key === "member_name" ? "" : -Infinity);

    if (typeof leftValue === "string" || typeof rightValue === "string") {
      return String(leftValue).localeCompare(String(rightValue)) * direction;
    }

    return (Number(leftValue) - Number(rightValue)) * direction;
  });
}

function cell(value: number | null): string {
  return value === null ? "-" : formatNumber(value);
}

function networthTitle(networth: number | null): string {
  return networth === null ? "No networth loaded" : `Exact networth: ${formatNumber(networth)}`;
}

function clampDateToAvailableRange(
  value: string,
  availableStartDate: string | null,
  availableEndDate: string | null,
): string {
  if (availableStartDate && value < availableStartDate) {
    return availableStartDate;
  }

  if (availableEndDate && value > availableEndDate) {
    return availableEndDate;
  }

  return value;
}

function formatHeaderLabel(label: string): React.ReactNode {
  if (label === "Adjusted Xanax") {
    return (
      <>
        Adjusted
        <br />
        Xanax
      </>
    );
  }

  if (!label.startsWith("Daily ")) {
    return label;
  }

  return (
    <>
      Daily
      <br />
      {label.slice("Daily ".length)}
    </>
  );
}

function currentMonthPeriod(): { startDate: string; endDate: string } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: now.toISOString().slice(0, 10),
  };
}

function periodDays(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00.000Z`);
  const end = Date.parse(`${endDate}T00:00:00.000Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return 1;
  }

  return Math.max(1, Math.round((end - start) / 86_400_000));
}

function formatActivityAverage(secondsPerDay: number | null): string {
  if (secondsPerDay === null) {
    return "-";
  }

  return `${formatNumber(secondsPerDay / 3600)}h`;
}

function activityHours(secondsPerDay: number | null): number | null {
  return secondsPerDay === null ? null : secondsPerDay / 3600;
}
