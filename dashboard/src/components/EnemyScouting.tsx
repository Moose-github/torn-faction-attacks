import React from "react";
import { ArrowDown, ArrowUp, RefreshCw, Sword } from "lucide-react";
import { EnemyFactionMember, EnemyScoutingResponse } from "../api";
import { formatNetworth, formatNumber, formatRelativeTime } from "../utils/format";
import { EmptyState, PanelHeader } from "./Common";
import { StickyTable } from "./StickyTable";

type EnemyScoutingSortKey =
  | "name"
  | "status"
  | "level"
  | "position"
  | "days_in_faction"
  | "ff_battlestats"
  | "bsp_battlestats"
  | "networth";

type EnemyScoutingSort = {
  key: EnemyScoutingSortKey;
  direction: "asc" | "desc";
};

export function EnemyScoutingPanel({
  scouting,
  isLoading,
  isRefreshing,
  canRefresh,
  showStatusColumn,
  onRefresh,
}: {
  scouting: EnemyScoutingResponse | null;
  isLoading: boolean;
  isRefreshing: boolean;
  canRefresh: boolean;
  showStatusColumn: boolean;
  onRefresh: () => void;
}) {
  const [sort, setSort] = React.useState<EnemyScoutingSort>({
    key: "ff_battlestats",
    direction: "desc",
  });

  React.useEffect(() => {
    if (!showStatusColumn && sort.key === "status") {
      setSort({ key: "ff_battlestats", direction: "desc" });
    }
  }, [showStatusColumn, sort.key]);

  const members = sortEnemyScoutingMembers(scouting?.members ?? [], sort);
  const renderHeader = () => (
    <tr>
      <SortableHeader label="Member" sortKey="name" sort={sort} onSortChange={setSort} />
      {showStatusColumn ? (
        <SortableHeader label="Status" sortKey="status" sort={sort} onSortChange={setSort} />
      ) : null}
      <SortableHeader label="Level" sortKey="level" sort={sort} onSortChange={setSort} />
      <SortableHeader label="Position" sortKey="position" sort={sort} onSortChange={setSort} />
      <SortableHeader label="Days in faction" sortKey="days_in_faction" sort={sort} onSortChange={setSort} />
      <SortableHeader label="FF stats" sortKey="ff_battlestats" sort={sort} onSortChange={setSort} />
      <SortableHeader label="BSP stats" sortKey="bsp_battlestats" sort={sort} onSortChange={setSort} />
      <SortableHeader label="Networth" sortKey="networth" sort={sort} onSortChange={setSort} />
    </tr>
  );

  return (
    <section className="panel table-panel enemy-scouting-panel">
      <PanelHeader
        title="Enemy faction scouting"
        aside={isLoading ? "Loading" : `${formatNumber(members.length)} members`}
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
        Shows the latest stored enemy roster from Torn, with FF stats, BSP stats, and networth where available.
      </p>

      {members.length === 0 ? (
        <EmptyState text="No enemy scouting data available for this war" />
      ) : (
        <StickyTable renderHeader={renderHeader}>
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
              {showStatusColumn ? (
                <td title={enemyStatusTitle(member)}>
                  <span className={`enemy-status-badge ${enemyStatusClass(member.status_state)}`}>
                    {enemyStatusLabel(member)}
                  </span>
                </td>
              ) : null}
              <td>{formatNumber(member.level ?? 0)}</td>
              <td>{member.position ?? "-"}</td>
              <td>{formatNumber(member.days_in_faction ?? 0)}</td>
              <td title={updatedTitle("FF battle stats", member.ff_battlestats_updated_at)}>
                {member.ff_battlestats === null
                  ? "-"
                  : formatNumber(member.ff_battlestats)}
              </td>
              <td title={bspBattlestatsTitle(member)}>
                {member.bsp_battlestats == null
                  ? "-"
                  : formatNumber(member.bsp_battlestats)}
              </td>
              <td title={networthTitle(member.networth, member.networth_updated_at)}>
                {formatNetworth(member.networth)}
              </td>
            </tr>
          ))}
        </StickyTable>
      )}
    </section>
  );
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

function bspBattlestatsTitle(member: EnemyFactionMember): string {
  return updatedTitle("BSP battle stats", member.bsp_battlestats_updated_at);
}

function enemyStatusLabel(member: EnemyFactionMember): string {
  if (member.status_state === "Traveling") {
    return member.travel_destination ? `Traveling to ${member.travel_destination}` : "Traveling";
  }

  if (member.status_state === "Hospital") {
    const duration = hospitalDurationLabel(member.status_description);
    return duration ? `Hospital ${duration}` : "Hospital";
  }

  if (member.status_state === "Abroad") {
    const location = abroadLocationLabel(member.status_description);
    return location ? `Abroad - ${location}` : "Abroad";
  }

  return member.status_state ?? "Unknown";
}

function enemyStatusTitle(member: EnemyFactionMember): string {
  if (member.status_state === "Hospital") {
    return `Hospital. Status updated: ${formatRelativeTime(member.status_updated_at ?? null)}`;
  }

  const description = member.status_description ?? member.status_state ?? "Unknown status";
  return `${description}. Status updated: ${formatRelativeTime(member.status_updated_at ?? null)}`;
}

function hospitalDurationLabel(description: string | null | undefined): string | null {
  if (!description) {
    return null;
  }

  const parts: string[] = [];
  const matches = description.matchAll(
    /(\d+)\s*(days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/gi,
  );

  for (const match of matches) {
    const value = match[1];
    const unit = match[2].toLowerCase();
    if (unit.startsWith("d")) {
      parts.push(`${value}d`);
    } else if (unit.startsWith("h")) {
      parts.push(`${value}h`);
    } else if (unit.startsWith("m")) {
      parts.push(`${value}m`);
    } else if (unit.startsWith("s")) {
      parts.push(`${value}s`);
    }
  }

  return parts.length > 0 ? parts.slice(0, 2).join(" ") : null;
}

function abroadLocationLabel(description: string | null | undefined): string | null {
  if (!description) {
    return null;
  }

  const trimmed = description.trim();
  const match =
    /^In (.+)$/i.exec(trimmed) ??
    /^Abroad in (.+)$/i.exec(trimmed) ??
    /^Currently in (.+)$/i.exec(trimmed);

  return match?.[1]?.trim() || trimmed;
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
