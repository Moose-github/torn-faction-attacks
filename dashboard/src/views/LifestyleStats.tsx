import React from "react";
import { Activity, ArrowDown, ArrowUp, Dumbbell, Pill, RotateCw } from "lucide-react";
import {
  getMemberLifestyleStats,
  MemberLifestyleStats,
  refreshMemberLifestyleStats,
} from "../api";
import { MetricCard, PanelHeader } from "../components/Common";
import { formatNumber, formatRelativeTime } from "../utils/format";

type LifestyleSortKey =
  | "member_name"
  | "overdosed"
  | "average_xantaken"
  | "average_refills"
  | "average_useractivity"
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
  average_refills: "Daily Refills",
  average_useractivity: "Daily Activity",
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
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [refreshMessage, setRefreshMessage] = React.useState<string | null>(null);

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

  async function refreshStats() {
    setIsRefreshing(true);
    setRefreshMessage(null);
    setError(null);

    try {
      const result = await refreshMemberLifestyleStats({ limit: 90, force: true });
      setRefreshMessage(
        `Refreshed ${formatNumber(result.refreshed)} members${
          result.failed ? `, ${formatNumber(result.failed)} failed` : ""
        }${
          result.gym_contributors
            ? result.gym_contributors.error
              ? `; gym refresh failed: ${result.gym_contributors.error}`
              : `; gym stats for ${formatNumber(result.gym_contributors.updated_members)} members`
            : ""
        }`,
      );
      await loadStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRefreshing(false);
    }
  }

  const members = sortLifestyleMembers(stats?.members ?? [], sort);

  return (
    <>
      {error ? <div className="error-panel">{error}</div> : null}
      <section className="hero-panel compact-hero-panel">
        <div>
          <p className="eyebrow">Public personal stats</p>
          <h2>Daily Averages</h2>
          <p>Averaged daily activity from daily snapshots. Made using Torn personal stats and faction contributors.</p>
        </div>
        {isAdmin ? (
          <button
            type="button"
            className="icon-text-button"
            onClick={refreshStats}
            disabled={isRefreshing}
          >
            <RotateCw size={15} />
            Refresh
          </button>
        ) : null}
      </section>

      {refreshMessage ? <div className="lifestyle-refresh-note">{refreshMessage}</div> : null}

      <section className="status-grid lifestyle-status-grid">
        <MetricCard
          label="Daily Xanax"
          value={formatNumber(stats?.summary.average_xantaken ?? 0)}
          icon={<Pill size={18} />}
        />
        <MetricCard
          label="Daily Gym energy"
          value={formatNumber(stats?.summary.average_gymenergy ?? 0)}
          icon={<Dumbbell size={18} />}
        />
        <section className="metric-card lifestyle-period-card">
          <div className="panel-kicker">
            <Activity size={18} />
            <span>Time period</span>
          </div>
          <strong>{stats?.period.days ?? periodDays(period.startDate, period.endDate)} days</strong>
          <div className="lifestyle-filter-row">
            <label>
              <span>Start</span>
              <input
                type="date"
                value={period.startDate}
                onChange={(event) => setPeriod((current) => ({ ...current, startDate: event.target.value }))}
              />
            </label>
            <label>
              <span>End</span>
              <input
                type="date"
                value={period.endDate}
                onChange={(event) => setPeriod((current) => ({ ...current, endDate: event.target.value }))}
              />
            </label>
          </div>
        </section>
      </section>

      <section className="panel table-panel">
        <PanelHeader
          title="Member daily averages"
          aside={isLoading ? "Loading" : `${members.length} members`}
        />
        <p className="panel-description">
          Shows each member's average daily activity during selected time period.
          Overdoses show all drugs because Torn does not have a Xanax-only overdose stat.
        </p>
        <LifestyleTable members={members} sort={sort} onSortChange={setSort} />
      </section>
    </>
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
              "average_refills",
              "average_useractivity",
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
              <td>{cell(member.average_refills)}</td>
              <td>{formatActivityAverage(member.average_useractivity)}</td>
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

function formatHeaderLabel(label: string): React.ReactNode {
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

  const hours = secondsPerDay / 3600;
  return `${formatNumber(hours)}h`;
}
