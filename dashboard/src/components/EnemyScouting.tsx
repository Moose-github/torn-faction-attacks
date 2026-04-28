import { RefreshCw } from "lucide-react";
import { EnemyScoutingResponse } from "../api";
import { formatNumber } from "../utils/format";
import { EmptyState, InlineMetric, PanelHeader } from "./Common";

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
  const members = scouting?.members ?? [];

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
          <div className="metric-list scouting-metrics">
            <InlineMetric label="Average level" value={scouting?.summary.average_level ?? 0} />
            <InlineMetric
              label="Average estimated stats"
              value={scouting?.summary.average_estimated_stats ?? 0}
              muted={scouting?.summary.average_estimated_stats === null}
            />
            <InlineMetric
              label="Missing estimates"
              value={scouting?.summary.missing_estimated_stats ?? 0}
            />
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Level</th>
                  <th>Position</th>
                  <th>Days in faction</th>
                  <th>Estimated stats</th>
                  <th>Revivable</th>
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
