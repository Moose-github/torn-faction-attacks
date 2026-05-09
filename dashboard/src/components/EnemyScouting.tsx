import React from "react";
import { ArrowDown, ArrowUp, RefreshCw, Sword } from "lucide-react";
import { EnemyFactionMember, EnemyScoutingResponse } from "../api";
import { formatNetworth, formatNumber, formatRelativeTime } from "../utils/format";
import { EmptyState, PanelHeader } from "./Common";

type EnemyScoutingSortKey =
  | "name"
  | "status"
  | "level"
  | "position"
  | "days_in_faction"
  | "estimated_stats"
  | "networth";

type EnemyScoutingSort = {
  key: EnemyScoutingSortKey;
  direction: "asc" | "desc";
};

type EnemyScoutingFilterKey = EnemyScoutingSortKey | "status";
type EnemyScoutingFilters = Record<EnemyScoutingFilterKey, string>;

const emptyEnemyScoutingFilters: EnemyScoutingFilters = {
  name: "",
  status: "",
  level: "",
  position: "",
  days_in_faction: "",
  estimated_stats: "",
  networth: "",
};

export function EnemyScoutingPanel({
  scouting,
  isLoading,
  isRefreshing,
  canRefresh,
  onRefresh,
}: {
  scouting: EnemyScoutingResponse | null;
  isLoading: boolean;
  isRefreshing: boolean;
  canRefresh: boolean;
  onRefresh: () => void;
}) {
  const [sort, setSort] = React.useState<EnemyScoutingSort>({
    key: "estimated_stats",
    direction: "desc",
  });
  const [filters, setFilters] = React.useState<EnemyScoutingFilters>(emptyEnemyScoutingFilters);
  const rawMembers = scouting?.members ?? [];
  const filteredMembers = filterEnemyScoutingMembers(rawMembers, filters);
  const members = sortEnemyScoutingMembers(filteredMembers, sort);
  const hasFilters = Object.values(filters).some((value) => value.trim() !== "");
  const aside = isLoading
    ? "Loading"
    : hasFilters
      ? `${formatNumber(members.length)} / ${formatNumber(rawMembers.length)} members`
      : `${formatNumber(members.length)} members`;

  return (
    <section className="panel table-panel enemy-scouting-panel">
      <PanelHeader
        title="Enemy faction scouting"
        aside={aside}
        control={
          <button
            type="button"
            className="icon-text-button"
            onClick={onRefresh}
            disabled={!canRefresh || isRefreshing}
            title={
              canRefresh
                ? "Load or update enemy scouting data"
                : "Admin sign in required to refresh scouting data"
            }
          >
            <RefreshCw size={15} />
            {canRefresh ? (isRefreshing ? "Refreshing" : "Refresh") : "Admin only"}
          </button>
        }
      />
      <p className="panel-description">
        Shows the cached enemy roster from Torn, estimated battle stats, and networth where available.
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
                  <SortableHeader label="Status" sortKey="status" sort={sort} onSortChange={setSort} />
                  <SortableHeader label="Level" sortKey="level" sort={sort} onSortChange={setSort} />
                  <SortableHeader label="Position" sortKey="position" sort={sort} onSortChange={setSort} />
                  <SortableHeader label="Days in faction" sortKey="days_in_faction" sort={sort} onSortChange={setSort} />
                  <SortableHeader label="Estimated stats" sortKey="estimated_stats" sort={sort} onSortChange={setSort} />
                  <SortableHeader label="Networth" sortKey="networth" sort={sort} onSortChange={setSort} />
                </tr>
                <tr className="enemy-scouting-filter-row">
                  <FilterHeader label="Member" filterKey="name" filters={filters} onFiltersChange={setFilters} />
                  <FilterHeader label="Status" filterKey="status" filters={filters} onFiltersChange={setFilters} />
                  <FilterHeader label="Level" filterKey="level" filters={filters} onFiltersChange={setFilters} />
                  <FilterHeader label="Position" filterKey="position" filters={filters} onFiltersChange={setFilters} />
                  <FilterHeader
                    label="Days in faction"
                    filterKey="days_in_faction"
                    filters={filters}
                    onFiltersChange={setFilters}
                  />
                  <FilterHeader
                    label="Estimated stats"
                    filterKey="estimated_stats"
                    filters={filters}
                    onFiltersChange={setFilters}
                  />
                  <FilterHeader label="Networth" filterKey="networth" filters={filters} onFiltersChange={setFilters} />
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.member_id}>
                    <td>
                      <span className="enemy-member-actions">
                        <a
                          href={`https://www.torn.com/profiles.php?XID=${member.member_id}`}
                          target="_blank"
                          rel="noreferrer"
                          title="Open Torn profile"
                        >
                          {member.name}
                        </a>
                        <a
                          className="enemy-attack-link"
                          href={`https://www.torn.com/page.php?sid=attack&user2ID=${member.member_id}`}
                          target="_blank"
                          rel="noreferrer"
                          title="Attack on Torn"
                          aria-label={`Attack ${member.name} on Torn`}
                        >
                          <Sword size={14} />
                        </a>
                      </span>
                    </td>
                    <td title={enemyStatusTitle(member)}>
                      <span className={`enemy-status-badge ${enemyStatusClass(member.status_state)}`}>
                        {enemyStatusLabel(member)}
                      </span>
                    </td>
                    <td>{formatNumber(member.level ?? 0)}</td>
                    <td>{member.position ?? "-"}</td>
                    <td>{formatNumber(member.days_in_faction ?? 0)}</td>
                    <td title={updatedTitle("Estimated stats", member.estimated_stats_updated_at)}>
                      {member.estimated_stats === null
                        ? "-"
                        : formatNumber(member.estimated_stats)}
                    </td>
                    <td title={networthTitle(member.networth, member.networth_updated_at)}>
                      {formatNetworth(member.networth)}
                    </td>
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

function filterEnemyScoutingMembers(
  members: EnemyFactionMember[],
  filters: EnemyScoutingFilters,
): EnemyFactionMember[] {
  const activeFilters = Object.entries(filters).filter(([, value]) => value.trim() !== "") as Array<
    [EnemyScoutingFilterKey, string]
  >;
  if (activeFilters.length === 0) {
    return members;
  }

  return members.filter((member) =>
    activeFilters.every(([key, filter]) =>
      enemyScoutingFilterValue(member, key).includes(normalizeFilterText(filter)),
    ),
  );
}

function enemyScoutingFilterValue(
  member: EnemyFactionMember,
  key: EnemyScoutingFilterKey,
): string {
  if (key === "name") {
    return normalizeFilterText(`${member.name} ${member.member_id}`);
  }

  if (key === "status") {
    return normalizeFilterText(
      [
        member.status_state,
        member.status_description,
        enemyStatusLabel(member),
        member.travel_origin,
        member.travel_destination,
      ]
        .filter(Boolean)
        .join(" "),
    );
  }

  if (key === "position") {
    return normalizeFilterText(member.position ?? "-");
  }

  if (key === "networth") {
    return normalizeFilterText(
      member.networth === null
        ? "-"
        : `${member.networth} ${formatNumber(member.networth)} ${formatNetworth(member.networth)}`,
    );
  }

  const value = member[key];
  return normalizeFilterText(value === null || value === undefined ? "-" : `${value} ${formatNumber(Number(value))}`);
}

function normalizeFilterText(value: string): string {
  return value.toLowerCase().trim();
}

function updatedTitle(label: string, updatedAt: number | null): string {
  return `${label} updated: ${formatRelativeTime(updatedAt)}`;
}

function networthTitle(networth: number | null, updatedAt: number | null): string {
  if (networth === null) {
    return updatedTitle("Networth", updatedAt);
  }

  return `Exact networth: ${formatNumber(networth)}. ${updatedTitle("Networth", updatedAt)}`;
}

function enemyStatusLabel(member: EnemyFactionMember): string {
  if (member.status_state === "Traveling") {
    return member.travel_destination ? `Traveling to ${member.travel_destination}` : "Traveling";
  }

  return member.status_state ?? "Unknown";
}

function enemyStatusTitle(member: EnemyFactionMember): string {
  const description = member.status_description ?? member.status_state ?? "Unknown status";
  return `${description}. Status updated: ${formatRelativeTime(member.status_updated_at ?? null)}`;
}

function enemyStatusClass(status: string | null | undefined): string {
  const normalized = (status ?? "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return normalized || "unknown";
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

  if (key === "status") {
    return enemyStatusLabel(member).toLowerCase();
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

function FilterHeader({
  label,
  filterKey,
  filters,
  onFiltersChange,
}: {
  label: string;
  filterKey: EnemyScoutingFilterKey;
  filters: EnemyScoutingFilters;
  onFiltersChange: React.Dispatch<React.SetStateAction<EnemyScoutingFilters>>;
}) {
  return (
    <th className="enemy-scouting-filter-cell">
      <input
        aria-label={`Filter enemy scouting by ${label}`}
        value={filters[filterKey]}
        onChange={(event) =>
          onFiltersChange((current) => ({
            ...current,
            [filterKey]: event.target.value,
          }))
        }
      />
    </th>
  );
}
