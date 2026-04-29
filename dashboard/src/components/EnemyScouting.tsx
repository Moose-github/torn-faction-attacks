import React from "react";
import { ArrowDown, ArrowUp, RefreshCw } from "lucide-react";
import { EnemyFactionMember, EnemyScoutingResponse } from "../api";
import { formatNumber } from "../utils/format";
import { EmptyState, PanelHeader } from "./Common";

type EnemyScoutingSortKey =
  | "name"
  | "level"
  | "position"
  | "days_in_faction"
  | "estimated_stats"
  | "is_revivable";

type EnemyScoutingSort = {
  key: EnemyScoutingSortKey;
  direction: "asc" | "desc";
};

export function EnemyScoutingPanel({
  scouting,
  isLoading,
  isRefreshing,
  onRefresh,
}: {
  scouting: EnemyScoutingResponse | null;
  isLoading: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
}) {
  const [sort, setSort] = React.useState<EnemyScoutingSort>({
    key: "estimated_stats",
    direction: "desc",
  });
  const members = sortEnemyScoutingMembers(scouting?.members ?? [], sort);

  return (
    <section className="panel table-panel">
      <PanelHeader
        title="Enemy faction scouting"
        aside={isLoading ? "Loading" : `${formatNumber(members.length)} members`}
        control={
          <button
            type="button"
            className="icon-text-button"
            onClick={onRefresh}
            disabled={isRefreshing}
            title="Load or update enemy scouting data"
          >
            <RefreshCw size={15} />
            {isRefreshing ? "Refreshing" : "Refresh"}
          </button>
        }
      />
      <p className="panel-description">
        Shows the cached enemy roster from Torn and estimated stats from FFScouter where available.
      </p>

      {members.length === 0 ? (
        <EmptyState text="No enemy scouting data loaded for this war" />
      ) : (
        <>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <SortableHeader label="Member" sortKey="name" sort={sort} onSortChange={setSort} />
                  <SortableHeader label="Level" sortKey="level" sort={sort} onSortChange={setSort} />
                  <SortableHeader label="Position" sortKey="position" sort={sort} onSortChange={setSort} />
                  <SortableHeader label="Days in faction" sortKey="days_in_faction" sort={sort} onSortChange={setSort} />
                  <SortableHeader label="Estimated stats" sortKey="estimated_stats" sort={sort} onSortChange={setSort} />
                  <SortableHeader label="Revivable" sortKey="is_revivable" sort={sort} onSortChange={setSort} />
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.member_id}>
                    <td>{member.name}</td>
                    <td>{formatNumber(member.level ?? 0)}</td>
                    <td>{member.position ?? "-"}</td>
                    <td>{formatNumber(member.days_in_faction ?? 0)}</td>
                    <td>
                      {member.estimated_stats === null
                        ? "-"
                        : formatNumber(member.estimated_stats)}
                    </td>
                    <td>{member.is_revivable ? "Yes" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function sortEnemyScoutingMembers(
  members: EnemyFactionMember[],
  sort: EnemyScoutingSort,
): EnemyFactionMember[] {
  return [...members].sort((a, b) => {
    const direction = sort.direction === "desc" ? -1 : 1;
    const aValue = scoutingSortValue(a, sort.key);
    const bValue = scoutingSortValue(b, sort.key);

    if (typeof aValue === "string" && typeof bValue === "string") {
      return aValue.localeCompare(bValue) * direction;
    }

    if (aValue < bValue) {
      return -1 * direction;
    }

    if (aValue > bValue) {
      return 1 * direction;
    }

    return a.name.localeCompare(b.name);
  });
}

function scoutingSortValue(
  member: EnemyFactionMember,
  key: EnemyScoutingSortKey,
): string | number {
  if (key === "name") {
    return member.name.toLowerCase();
  }

  if (key === "position") {
    return (member.position ?? "").toLowerCase();
  }

  return Number(member[key] ?? 0);
}

function SortableHeader({
  label,
  sortKey,
  sort,
  onSortChange,
}: {
  label: React.ReactNode;
  sortKey: EnemyScoutingSortKey;
  sort: EnemyScoutingSort;
  onSortChange: (sort: EnemyScoutingSort) => void;
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
