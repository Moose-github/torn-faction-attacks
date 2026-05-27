import React from "react";
import { Activity, ArrowDown, ArrowUp, ChevronDown, ChevronRight, Dumbbell, Pill, X } from "lucide-react";
import {
  getMemberLifestyleDailyChart,
  getMemberLifestyleStats,
  MemberLifestyleDailyChartResponse,
  MemberLifestyleDailyMetric,
  MemberLifestyleStats,
} from "../api";
import { PanelHeader } from "../components/Common";
import { StickyTable } from "../components/StickyTable";
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

const DAILY_CHART_MEMBER_LIMIT = 5;
const DAILY_CHART_METRICS: Array<{ key: MemberLifestyleDailyMetric; label: string }> = [
  { key: "xantaken", label: "Xanax taken" },
  { key: "overdosed", label: "Overdoses" },
  { key: "refills", label: "Refills" },
  { key: "useractivity", label: "Active hours" },
  { key: "gymenergy", label: "Gym energy" },
  { key: "gymstrength", label: "Gym strength" },
  { key: "gymspeed", label: "Gym speed" },
  { key: "gymdefense", label: "Gym defense" },
  { key: "gymdexterity", label: "Gym dexterity" },
  { key: "networth", label: "Networth" },
];

const LifestyleDailyChart = React.lazy(() =>
  import("../components/LifestyleDailyChart").then((module) => ({ default: module.LifestyleDailyChart })),
);

export function LifestyleStats({ currentUserId, isAdmin }: { currentUserId: number | null; isAdmin: boolean }) {
  const [stats, setStats] = React.useState<Awaited<ReturnType<typeof getMemberLifestyleStats>> | null>(null);
  const [sort, setSort] = React.useState<LifestyleSort>({ key: "average_xantaken", direction: "desc" });
  const [period, setPeriod] = React.useState(() => currentMonthPeriod());
  const [error, setError] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [chartExpanded, setChartExpanded] = React.useState(false);
  const [chartDefaultsApplied, setChartDefaultsApplied] = React.useState(false);
  const [chartMetric, setChartMetric] = React.useState<MemberLifestyleDailyMetric>("xantaken");
  const [selectedChartMemberIds, setSelectedChartMemberIds] = React.useState<number[]>([]);
  const [pendingChartMemberId, setPendingChartMemberId] = React.useState("");
  const [chartData, setChartData] = React.useState<MemberLifestyleDailyChartResponse | null>(null);
  const [chartError, setChartError] = React.useState<string | null>(null);
  const [isChartLoading, setIsChartLoading] = React.useState(false);

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
  const selectedChartMembers = selectedChartMemberIds
    .map((memberId) => members.find((member) => member.member_id === memberId))
    .filter((member): member is MemberLifestyleStats => Boolean(member));
  const chartMemberOptions = members.filter((member) => !selectedChartMemberIds.includes(member.member_id));
  const chartSelectionKey = selectedChartMemberIds.join(",");

  React.useEffect(() => {
    if (!chartExpanded || chartDefaultsApplied || members.length === 0) {
      return;
    }

    setSelectedChartMemberIds(defaultChartMemberIds(members, currentUserId));
    setChartDefaultsApplied(true);
  }, [chartDefaultsApplied, chartExpanded, currentUserId, members]);

  React.useEffect(() => {
    if (!chartExpanded || selectedChartMemberIds.length === 0) {
      setChartData(null);
      setChartError(null);
      setIsChartLoading(false);
      return;
    }

    let cancelled = false;
    setIsChartLoading(true);
    setChartError(null);

    getMemberLifestyleDailyChart({
      startDate: period.startDate,
      endDate: period.endDate,
      metric: chartMetric,
      memberIds: selectedChartMemberIds,
    })
      .then((response) => {
        if (!cancelled) {
          setChartData(response);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setChartError(err instanceof Error ? err.message : String(err));
          setChartData(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsChartLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [chartExpanded, chartMetric, chartSelectionKey, period.startDate, period.endDate]);

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

  function addChartMember() {
    const memberId = Number(pendingChartMemberId);
    if (
      !Number.isInteger(memberId) ||
      selectedChartMemberIds.includes(memberId) ||
      selectedChartMemberIds.length >= DAILY_CHART_MEMBER_LIMIT
    ) {
      return;
    }

    setSelectedChartMemberIds((current) => [...current, memberId].slice(0, DAILY_CHART_MEMBER_LIMIT));
    setPendingChartMemberId("");
    setChartDefaultsApplied(true);
  }

  function removeChartMember(memberId: number) {
    setSelectedChartMemberIds((current) => current.filter((candidate) => candidate !== memberId));
    setChartDefaultsApplied(true);
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

      <section className="panel lifestyle-daily-chart-panel">
        <div className="panel-header collapsible-header">
          <button
            type="button"
            className="collapse-button"
            onClick={() => setChartExpanded((current) => !current)}
            aria-expanded={chartExpanded}
          >
            <span>{chartExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</span>
            <strong>Daily member chart</strong>
          </button>
          <span>{chartExpanded ? `${selectedChartMemberIds.length} selected` : "Collapsed"}</span>
        </div>
        {chartExpanded ? (
          <div className="lifestyle-daily-chart-content">
            <div className="lifestyle-chart-controls">
              <label>
                <span>Metric</span>
                <select
                  value={chartMetric}
                  onChange={(event) => setChartMetric(event.target.value as MemberLifestyleDailyMetric)}
                >
                  {DAILY_CHART_METRICS.map((metric) => (
                    <option key={metric.key} value={metric.key}>
                      {metric.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Add member</span>
                <select
                  value={pendingChartMemberId}
                  disabled={selectedChartMemberIds.length >= DAILY_CHART_MEMBER_LIMIT || chartMemberOptions.length === 0}
                  onChange={(event) => setPendingChartMemberId(event.target.value)}
                >
                  <option value="">Select member</option>
                  {chartMemberOptions.map((member) => (
                    <option key={member.member_id} value={member.member_id}>
                      {member.member_name ?? `#${member.member_id}`}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="panel-action-button"
                disabled={!pendingChartMemberId || selectedChartMemberIds.length >= DAILY_CHART_MEMBER_LIMIT}
                onClick={addChartMember}
              >
                Add
              </button>
            </div>
            <div className="lifestyle-chart-member-chips" aria-label="Selected chart members">
              {selectedChartMembers.map((member) => (
                <span key={member.member_id}>
                  {member.member_name ?? `#${member.member_id}`}
                  <button
                    type="button"
                    onClick={() => removeChartMember(member.member_id)}
                    aria-label={`Remove ${member.member_name ?? member.member_id} from chart`}
                  >
                    <X size={13} />
                  </button>
                </span>
              ))}
              {selectedChartMemberIds.length >= DAILY_CHART_MEMBER_LIMIT ? (
                <small>Maximum {DAILY_CHART_MEMBER_LIMIT} members</small>
              ) : null}
            </div>
            {chartError ? <div className="error-panel">{chartError}</div> : null}
            {isChartLoading ? (
              <div className="lifestyle-chart-loading">Loading chart</div>
            ) : (
              <React.Suspense fallback={<div className="lifestyle-chart-loading">Loading chart</div>}>
                <LifestyleDailyChart metric={chartMetric} series={chartData?.series ?? []} />
              </React.Suspense>
            )}
          </div>
        ) : null}
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
  const renderHeader = () => (
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
  );

  return (
    <StickyTable className="lifestyle-table" renderHeader={renderHeader}>
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
    </StickyTable>
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

function defaultChartMemberIds(members: MemberLifestyleStats[], currentUserId: number | null): number[] {
  if (currentUserId !== null && members.some((member) => member.member_id === currentUserId)) {
    return [currentUserId];
  }

  return members[0] ? [members[0].member_id] : [];
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
