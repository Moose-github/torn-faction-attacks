import React from "react";
import { Activity, BatteryCharging, Pill, RotateCw } from "lucide-react";
import {
  getMemberLifestyleStats,
  MemberLifestyleStats,
  refreshMemberLifestyleStats,
} from "../api";
import { MetricCard, PanelHeader } from "../components/Common";
import { formatNumber, formatRelativeTime } from "../utils/format";

type LifestyleSortKey =
  | "member_name"
  | "level"
  | "xantaken"
  | "overdosed"
  | "drugsused"
  | "refills"
  | "statenhancersused"
  | "energydrinkused"
  | "boostersused"
  | "alcoholused"
  | "candyused"
  | "rehabs"
  | "useractivity"
  | "gymenergy"
  | "gymstrength"
  | "gymspeed"
  | "gymdefense"
  | "gymdexterity"
  | "updated_at";

type LifestyleSort = {
  key: LifestyleSortKey;
  direction: "asc" | "desc";
};

const SORT_LABELS: Record<LifestyleSortKey, string> = {
  member_name: "Member",
  level: "Level",
  xantaken: "Xanax",
  overdosed: "ODs",
  drugsused: "Drugs",
  refills: "Refills",
  statenhancersused: "SEs",
  energydrinkused: "Energy drinks",
  boostersused: "Boosters",
  alcoholused: "Alcohol",
  candyused: "Candy",
  rehabs: "Rehabs",
  useractivity: "Activity",
  gymenergy: "Gym energy",
  gymstrength: "Strength",
  gymspeed: "Speed",
  gymdefense: "Defense",
  gymdexterity: "Dexterity",
  updated_at: "Updated",
};

export function LifestyleStats({ isAdmin }: { isAdmin: boolean }) {
  const [stats, setStats] = React.useState<Awaited<ReturnType<typeof getMemberLifestyleStats>> | null>(null);
  const [sort, setSort] = React.useState<LifestyleSort>({ key: "xantaken", direction: "desc" });
  const [error, setError] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [refreshMessage, setRefreshMessage] = React.useState<string | null>(null);

  const loadStats = React.useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      setStats(await getMemberLifestyleStats());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

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
            ? `; gym stats for ${formatNumber(result.gym_contributors.updated_members)} members`
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
          <h2>Faction lifestyle stats</h2>
          <p>Cached non-war member stats from Torn personal stats.</p>
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
          label="Xanax taken"
          value={formatNumber(stats?.summary.total_xantaken ?? 0)}
          icon={<Pill size={18} />}
        />
        <MetricCard
          label="Total overdoses"
          value={formatNumber(stats?.summary.total_overdosed ?? 0)}
          icon={<Activity size={18} />}
        />
        <MetricCard
          label="Average Xanax"
          value={formatNumber(stats?.summary.average_xantaken ?? 0)}
          icon={<BatteryCharging size={18} />}
        />
      </section>

      <section className="panel table-panel">
        <PanelHeader
          title="Member lifestyle breakdown"
          aside={isLoading ? "Loading" : `${members.length} members`}
        />
        <p className="panel-description">
          Overdoses are Torn's all-drug lifetime overdose stat; Xanax-only overdoses are not exposed as a public lifetime stat.
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
  function nextSort(key: LifestyleSortKey) {
    onSortChange({
      key,
      direction: sort.key === key && sort.direction === "desc" ? "asc" : "desc",
    });
  }

  return (
    <div className="table-scroll">
      <table className="lifestyle-table">
        <thead>
          <tr>
            {[
              "member_name",
              "level",
              "xantaken",
              "overdosed",
              "drugsused",
              "refills",
              "statenhancersused",
              "energydrinkused",
              "boostersused",
              "alcoholused",
              "candyused",
              "rehabs",
              "useractivity",
              "gymenergy",
              "gymstrength",
              "gymspeed",
              "gymdefense",
              "gymdexterity",
              "updated_at",
            ].map((key) => (
              <th key={key}>
                <button
                  type="button"
                  className={sort.key === key ? "sort-button active" : "sort-button"}
                  onClick={() => nextSort(key as LifestyleSortKey)}
                >
                  {SORT_LABELS[key as LifestyleSortKey]}
                  {sort.key === key ? (sort.direction === "desc" ? "v" : "^") : ""}
                </button>
              </th>
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
              <td>{cell(member.level)}</td>
              <td>{cell(member.xantaken)}</td>
              <td>{cell(member.overdosed)}</td>
              <td>{cell(member.drugsused)}</td>
              <td>{cell(member.refills)}</td>
              <td>{cell(member.statenhancersused)}</td>
              <td>{cell(member.energydrinkused)}</td>
              <td>{cell(member.boostersused)}</td>
              <td>{cell(member.alcoholused)}</td>
              <td>{cell(member.candyused)}</td>
              <td>{cell(member.rehabs)}</td>
              <td>{formatActivity(member.useractivity)}</td>
              <td>{cell(member.gymenergy)}</td>
              <td>{cell(member.gymstrength)}</td>
              <td>{cell(member.gymspeed)}</td>
              <td>{cell(member.gymdefense)}</td>
              <td>{cell(member.gymdexterity)}</td>
              <td title={member.error ?? undefined}>{member.error ? "Error" : formatRelativeTime(member.updated_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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

function formatActivity(seconds: number | null): string {
  if (seconds === null) {
    return "-";
  }

  const hours = Math.floor(seconds / 3600);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${formatNumber(days)}d`;
  }

  return `${formatNumber(hours)}h`;
}
