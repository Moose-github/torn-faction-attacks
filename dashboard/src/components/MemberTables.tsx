import { ArrowDown, ArrowUp } from "lucide-react";
import { MemberAttack, MemberStats } from "../api";
import { EmptyState } from "./Common";
import { formatDate, formatNumber } from "../utils/format";
import {
  classificationLabel,
  displayMember,
  memberDefendsLost,
  MemberAttackSort,
  MemberSort,
} from "../utils/members";

export function MemberTable({
  members,
  sort,
  onSortChange,
  showTermedColumns,
  termedColumnVariant = "war",
  selectedMemberId,
  onMemberSelect,
}: {
  members: MemberStats[];
  sort: MemberSort;
  onSortChange: (sort: MemberSort) => void;
  showTermedColumns?: boolean;
  termedColumnVariant?: "war" | "overview";
  selectedMemberId?: number | null;
  onMemberSelect?: (member: MemberStats) => void;
}) {
  if (members.length === 0) {
    return <EmptyState text="No members to show" />;
  }

  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <SortableHeader label="Member" sortKey="member_name" sort={sort} onSortChange={onSortChange} />
            <SortableHeader label="Attacks" sortKey="attacks_vs_enemy_successful" sort={sort} onSortChange={onSortChange} />
            <SortableHeader label="Defends" sortKey="defends_total" sort={sort} onSortChange={onSortChange} />
            <SortableHeader label={<>Defends<br />lost</>} sortKey="defends_lost" sort={sort} onSortChange={onSortChange} />
            {showTermedColumns ? null : (
              <SortableHeader label="Outside hits" sortKey="outside_hits" sort={sort} onSortChange={onSortChange} />
            )}
            <SortableHeader
              label={<span title="Adjusted respect, with chain bonus hits counted at the member's average hit value.">Respect gained</span>}
              sortKey="respect_gained"
              sort={sort}
              onSortChange={onSortChange}
            />
            <SortableHeader label={<>Respect<br />lost</>} sortKey="respect_lost" sort={sort} onSortChange={onSortChange} />
            <SortableHeader label="Assists" sortKey="assists_vs_enemy" sort={sort} onSortChange={onSortChange} />
            {showTermedColumns ? (
              <>
                {termedColumnVariant === "war" ? (
                  <SortableHeader label={<>Average<br />fair fight</>} sortKey="average_fair_fight" sort={sort} onSortChange={onSortChange} />
                ) : null}
                <SortableHeader label={<>Percent<br />limit</>} sortKey="member_respect_limit_percent" sort={sort} onSortChange={onSortChange} />
              </>
            ) : (
              <>
                <SortableHeader label={<>Average<br />fair fight</>} sortKey="average_fair_fight" sort={sort} onSortChange={onSortChange} />
                <SortableHeader label={<>Friendly<br />hosps</>} sortKey="friendly_hosps" sort={sort} onSortChange={onSortChange} />
                <SortableHeader label="Retaliations" sortKey="retaliations_vs_enemy" sort={sort} onSortChange={onSortChange} />
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <tr
              key={member.member_id}
              className={[
                onMemberSelect ? "clickable-member-row" : "",
                member.member_id === selectedMemberId ? "selected-member-row" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={onMemberSelect ? () => onMemberSelect(member) : undefined}
            >
              <td>
                {onMemberSelect ? (
                  <button
                    type="button"
                    className="member-link"
                    title={`View ${displayMember(member)} attacks`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onMemberSelect(member);
                    }}
                  >
                    {displayMember(member)}
                  </button>
                ) : (
                  displayMember(member)
                )}
              </td>
              <td>
                <AttackBreakdown member={member} />
              </td>
              <td>
                <DefendBreakdown member={member} />
              </td>
              <td>{formatNumber(memberDefendsLost(member))}</td>
              {showTermedColumns ? null : <td>{formatNumber(member.outside_hits)}</td>}
              <td>{formatNumber(member.respect_gained)}</td>
              <td>{formatNumber(member.respect_lost)}</td>
              <td>{formatNumber(member.assists_vs_enemy)}</td>
              {showTermedColumns ? (
                <>
                  {termedColumnVariant === "war" ? (
                    <td>{formatNullableNumber(member.average_fair_fight, 2)}</td>
                  ) : null}
                  <td>{formatNullablePercent(member.member_respect_limit_percent)}</td>
                </>
              ) : (
                <>
                  <td>{formatNullableNumber(member.average_fair_fight, 2)}</td>
                  <td>{formatNumber(member.friendly_hosps)}</td>
                  <td>{formatNumber(member.retaliations_vs_enemy)}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatNullableNumber(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "-";
  }

  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatNullablePercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "-";
  }

  return `${Number(value).toFixed(1)}%`;
}

export function MemberAttackList({
  attacks,
  sort,
  onSortChange,
}: {
  attacks: MemberAttack[];
  sort: MemberAttackSort;
  onSortChange: (sort: MemberAttackSort) => void;
}) {
  if (attacks.length === 0) {
    return <EmptyState text="No attacks for this member" />;
  }

  return (
    <div className="table-scroll">
      <table className="attack-log-table">
        <thead>
          <tr>
            <SortableHeader label="Time" sortKey="started" sort={sort} onSortChange={onSortChange} />
            <SortableHeader label="Type" sortKey="classification" sort={sort} onSortChange={onSortChange} />
            <SortableHeader label="Attacker" sortKey="attacker_name" sort={sort} onSortChange={onSortChange} />
            <SortableHeader label="Defender" sortKey="defender_name" sort={sort} onSortChange={onSortChange} />
            <SortableHeader label="Defender faction" sortKey="defender_faction_id" sort={sort} onSortChange={onSortChange} />
            <SortableHeader label="Result" sortKey="result" sort={sort} onSortChange={onSortChange} />
            <SortableHeader label="Respect" sortKey="respect_gain" sort={sort} onSortChange={onSortChange} />
          </tr>
        </thead>
        <tbody>
          {attacks.map((attack) => (
            <tr key={attack.id} className={`attack-row ${attack.classification}`}>
              <td>{formatDate(attack.started)}</td>
              <td>{classificationLabel(attack.classification)}</td>
              <td>{attack.attacker_name ?? `#${attack.attacker_id ?? "-"}`}</td>
              <td>{attack.defender_name ?? `#${attack.defender_id ?? "-"}`}</td>
              <td>{attack.defender_faction_id ?? "-"}</td>
              <td>{attack.result ?? "-"}</td>
              <td>{formatNumber(attack.respect_gain ?? 0)}</td>
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

function AttackBreakdown({ member }: { member: MemberStats }) {
  const leaves = Math.max(
    0,
    member.attacks_vs_enemy_successful -
      member.hospitalizations_vs_enemy -
      member.mugs_vs_enemy,
  );
  const hasBreakdown =
    member.hospitalizations_vs_enemy > 0 ||
    member.mugs_vs_enemy > 0 ||
    (leaves > 0 && leaves !== member.attacks_vs_enemy_successful);

  if (!hasBreakdown) {
    return <>{formatNumber(member.attacks_vs_enemy_successful)}</>;
  }

  return (
    <span
      className="tooltip-value"
      title={`Hospitalizations: ${formatNumber(member.hospitalizations_vs_enemy)} | Mugs: ${formatNumber(member.mugs_vs_enemy)} | Leaves: ${formatNumber(leaves)}`}
    >
      {formatNumber(member.attacks_vs_enemy_successful)}
    </span>
  );
}

function DefendBreakdown({ member }: { member: MemberStats }) {
  const defendsOther = Number(member.defends_other ?? 0);
  const defendsLost = memberDefendsLost(member);

  if (member.defends_total === 0) {
    return <>0</>;
  }

  return (
    <span
      className="tooltip-value"
      title={`Lost: ${formatNumber(defendsLost)} | Won: ${formatNumber(member.defends_won)} | Other: ${formatNumber(defendsOther)}`}
    >
      {formatNumber(member.defends_total)}
    </span>
  );
}
