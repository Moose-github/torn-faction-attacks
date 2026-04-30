import React from "react";
import { CalendarClock, Swords, Target } from "lucide-react";
import { getStats, WarType } from "../api";
import { MetricCard, PanelHeader } from "../components/Common";
import { MemberTable } from "../components/MemberTables";
import { formatNumber } from "../utils/format";
import { MemberSort, sortMembers, sumMembers } from "../utils/members";

export function MembersOverview({ warType }: { warType: WarType }) {
  const [stats, setStats] = React.useState<Awaited<ReturnType<typeof getStats>> | null>(null);
  const [sort, setSort] = React.useState<MemberSort>({
    key: "enemy_attacks_successful",
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
        const response = await getStats(warType);
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
  }, [warType]);

  const members = sortMembers(stats?.members ?? [], sort);

  return (
    <>
      {error ? <div className="error-panel">{error}</div> : null}
      <section className="hero-panel compact-hero-panel">
        <div>
          <p className="eyebrow">{warType === "all" ? "All records" : warType}</p>
          <h2>Member performance</h2>
          <p>Combined member results across the selected record type.</p>
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
          value={formatNumber(sumMembers(members, "enemy_attacks_successful"))}
          icon={<Swords size={18} />}
        />
        <MetricCard
          label="Wars"
          value={formatNumber(stats?.overall.total_wars ?? 0)}
          icon={<CalendarClock size={18} />}
        />
      </section>

      <section className="panel table-panel">
        <PanelHeader
          title="Faction members breakdown"
          aside={isLoading ? "Loading" : `${members.length} members`}
        />
        <p className="panel-description">
          Combines member performance across the selected record type so longer-term activity can be compared.
        </p>
        <MemberTable members={members} sort={sort} onSortChange={setSort} />
      </section>
    </>
  );
}
