import React from "react";
import { CalendarClock, Swords, Target } from "lucide-react";
import { getStats, MemberStats, WarType } from "../api";
import { MetricCard, PanelHeader } from "../components/Common";
import { MemberTable } from "../components/MemberTables";
import { downloadCsv, sanitizeCsvFilename } from "../utils/csv";
import { formatNumber } from "../utils/format";
import {
  displayMember,
  memberDefendsLost,
  memberNonHospitalizedDefendsLost,
  memberNonHospitalizedRespectLost,
  MemberSort,
  sortMembers,
  sumMembers,
} from "../utils/members";

export function MembersOverview({ isAdmin }: { isAdmin: boolean }) {
  const [warType, setWarType] = React.useState<WarType>("all");
  const [currentMembersOnly, setCurrentMembersOnly] = React.useState(false);
  const [stats, setStats] = React.useState<Awaited<ReturnType<typeof getStats>> | null>(null);
  const [sort, setSort] = React.useState<MemberSort>({
    key: "attacks_vs_enemy_successful",
    direction: "desc",
  });
  const [error, setError] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);

      try {
        const response = await getStats(warType, { currentMembersOnly });
        if (!cancelled) {
          setStats(response);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [currentMembersOnly, warType]);

  const members = sortMembers(stats?.members ?? [], sort);

  return (
    <>
      {error ? <div className="error-panel">{error}</div> : null}
      <section className="hero-panel compact-hero-panel">
        <div>
          <p className="eyebrow">{warType === "all" ? "All records" : warType}</p>
          <h2>Member performance</h2>
          <p>
            Combined member results across the selected record type
            {currentMembersOnly ? " for current faction members." : "."}
          </p>
        </div>
      </section>

      <section className="status-grid war-status-grid">
        <MetricCard
          label="Respect gained"
          value={formatNumber(stats?.overall.total_respect_gain ?? 0)}
          icon={<Target size={18} />}
        />
        <MetricCard
          label="Successful attacks"
          value={formatNumber(sumMembers(members, "attacks_vs_enemy_successful"))}
          icon={<Swords size={18} />}
        />
        <section className="metric-card member-performance-filter-card">
          <div className="panel-kicker">
            <CalendarClock size={18} />
            <span>Wars</span>
          </div>
          <strong>{formatNumber(stats?.overall.total_wars ?? 0)}</strong>
          <label>
            <span>Record type</span>
            <select
              value={warType}
              aria-label="Filter member performance by war type"
              onChange={(event) => setWarType(event.target.value as WarType)}
            >
              <option value="all">All</option>
              <option value="real">Real wars</option>
              <option value="termed">Termed wars</option>
              <option value="event">Events</option>
            </select>
          </label>
          <label className="member-current-filter">
            <input
              type="checkbox"
              checked={currentMembersOnly}
              onChange={(event) => setCurrentMembersOnly(event.target.checked)}
            />
            <span>Current faction only</span>
          </label>
        </section>
      </section>

      <section className="panel table-panel">
        <PanelHeader
          title="Faction members breakdown"
          aside={isLoading ? "Loading" : `${members.length} members`}
          control={
            isAdmin ? (
              <>
                <span>{isLoading ? "Loading" : `${members.length} members`}</span>
                <button
                  type="button"
                  className="panel-action-button"
                  onClick={() => exportMembersOverviewCsv(members, warType)}
                >
                  CSV
                </button>
              </>
            ) : undefined
          }
        />
        <p className="panel-description">
          Combines member performance across the selected record type so longer-term activity can be compared.
          {currentMembersOnly ? " Departed members are hidden." : ""}
        </p>
        <MemberTable
          members={members}
          sort={sort}
          onSortChange={setSort}
          showTermedColumns={warType === "termed"}
          termedColumnVariant="overview"
        />
      </section>
    </>
  );
}

function exportMembersOverviewCsv(members: MemberStats[], warType: WarType) {
  const columns: Array<{
    label: string;
    value: (member: MemberStats) => string | number | null | undefined;
  }> = [
    { label: "Player name", value: (member) => displayMember(member) },
    { label: "Member ID", value: (member) => member.member_id },
    { label: "Wars participated", value: (member) => member.wars_participated },
    { label: "Attacks", value: (member) => member.attacks_vs_enemy_successful },
    { label: "Defends", value: (member) => member.defends_total },
    { label: "Defends lost", value: (member) => memberDefendsLost(member) },
    { label: "Non-hosp defends lost", value: (member) => memberNonHospitalizedDefendsLost(member) },
    ...(warType === "termed"
      ? []
      : [{ label: "Outside hits", value: (member: MemberStats) => member.outside_hits }]),
    { label: "Respect gained", value: (member) => member.respect_gained },
    { label: "Respect lost", value: (member) => member.respect_lost },
    { label: "Non-hosp respect lost", value: (member) => memberNonHospitalizedRespectLost(member) },
    { label: "Respect lost raw", value: (member) => member.respect_lost_raw },
    { label: "Assists", value: (member) => member.assists_vs_enemy },
    ...(warType === "termed"
      ? [{ label: "Percent limit", value: (member: MemberStats) => member.member_respect_limit_percent }]
      : [
          { label: "Friendly hosps", value: (member: MemberStats) => member.friendly_hosps },
          { label: "Retaliations", value: (member: MemberStats) => member.retaliations_vs_enemy },
        ]),
  ];

  downloadCsv(
    `member-performance-${sanitizeCsvFilename(warType)}.csv`,
    columns,
    members,
  );
}
