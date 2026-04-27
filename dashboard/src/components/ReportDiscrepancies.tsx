import { ChainBonusAttack, ReportDiscrepanciesResponse } from "../api";
import { EmptyState } from "./Common";
import { ChainBonusList } from "./ChainBonuses";
import { formatDate, formatNumber } from "../utils/format";

export function ReportDiscrepancyPanel({
  response,
}: {
  response: ReportDiscrepanciesResponse | null;
}) {
  if (!response) {
    return <EmptyState text="No discrepancy data loaded" />;
  }

  const groups = [
    {
      key: "after_practical_finish",
      title: "Buttgrass hits after practical finish",
      detail: "These can appear in Torn's official totals but not member performance stats.",
    },
    {
      key: "uncounted_enemy_results",
      title: "Unknown attack results",
      detail:
        "These are Buttgrass attacks on the enemy faction with result values outside the known successful and unsuccessful lists.",
    },
    {
      key: "chain_bonus_adjustments",
      title: "Chain bonus respect adjusted",
      detail:
        "These chain bonus hits count as the member's normal average respect instead of the raw bonus-inflated respect.",
    },
    {
      key: "outside_official_window",
      title: "Outside official window",
      detail: "These linked attacks are before the start time or after Torn's official end.",
    },
  ];

  return (
    <div className="discrepancy-groups">
      {groups.map((definition) => {
        const group = response.groups[definition.key];
        const count = group?.count ?? 0;
        return (
          <section
            className={count === 0 ? "discrepancy-group discrepancy-group-empty" : "discrepancy-group"}
            key={definition.key}
          >
            <div className="discrepancy-group-header">
              <div>
                <h3>{definition.title}</h3>
                {count > 0 ? <p>{definition.detail}</p> : null}
              </div>
              <strong>{formatNumber(count)} rows</strong>
            </div>
            {count > 0 && group && group.attacks.length > 0 && definition.key === "chain_bonus_adjustments" ? (
              <ChainBonusList attacks={group.attacks as ChainBonusAttack[]} />
            ) : count > 0 && group && group.attacks.length > 0 ? (
              <div className="table-scroll">
                <table className="discrepancy-table">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Attacker</th>
                      <th>Defender</th>
                      <th>Result</th>
                      <th>Respect</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.attacks.map((attack) => (
                      <tr key={`${definition.key}-${attack.id}`}>
                        <td>{formatDate(attack.started)}</td>
                        <td>{attack.attacker_name ?? `#${attack.attacker_id ?? "-"}`}</td>
                        <td>{attack.defender_name ?? `#${attack.defender_id ?? "-"}`}</td>
                        <td>{attack.result ?? "-"}</td>
                        <td>{formatNumber(attack.respect_gain ?? 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

export function discrepancyAside(response: ReportDiscrepanciesResponse | null): string {
  if (!response) {
    return "No data";
  }

  const total = Object.values(response.groups).reduce((sum, group) => sum + group.count, 0);
  return `${formatNumber(total)} rows`;
}

export function formatReportComparison(reportValue: number | null, derivedValue: number): string {
  const report = Number(reportValue ?? 0);
  const difference = derivedValue - report;

  if (difference === 0) {
    return `${formatNumber(report)} (match)`;
  }

  return `${formatNumber(report)} (${formatNumber(difference)} diff)`;
}
