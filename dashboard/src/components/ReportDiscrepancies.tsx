import { ChainBonusAttack, MemberReportComparisonRow, ReportDiscrepanciesResponse } from "../api";
import { EmptyState } from "./Common";
import { ChainBonusList } from "./ChainBonuses";
import { formatDate, formatNumber } from "../utils/format";

const GROUP_DEFINITIONS = [
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
    title: "Buttgrass hits outside official window",
    detail: "These linked Buttgrass attacks are before the start time or after Torn's official end.",
  },
];

export function ReportDiscrepancyPanel({
  response,
}: {
  response: ReportDiscrepanciesResponse | null;
}) {
  if (!response) {
    return <EmptyState text="No discrepancy data loaded" />;
  }

  const groups = visibleGroupDefinitions(response);

  return (
    <div className="discrepancy-groups">
      <MemberReportComparison response={response} />
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
              <strong>
                {formatNumber(count)} attacks
                {definition.key === "chain_bonus_adjustments" ||
                definition.key === "after_practical_finish"
                  ? ` / ${formatNumber(group?.respect_gain ?? 0)} removed`
                  : ""}
              </strong>
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

function MemberReportComparison({
  response,
}: {
  response: ReportDiscrepanciesResponse;
}) {
  const comparison = response.member_report_comparison;

  if (!comparison?.available) {
    return null;
  }

  return (
    <section className="discrepancy-group">
      <div className="discrepancy-group-header">
        <div>
          <h3>Official member totals</h3>
          <p>
            Compares Torn's official member attacks and score against local raw successful hits in the
            official war window.
          </p>
        </div>
        <strong>{formatNumber(comparison.mismatches.length)} members</strong>
      </div>
      <div className="table-scroll">
        <table className="discrepancy-table member-report-comparison-table">
          <thead>
            <tr>
              <th>Member</th>
              <th>Local attacks</th>
              <th>Torn attacks</th>
              <th>Diff</th>
              <th>Local raw respect</th>
              <th>Torn score</th>
              <th>Diff</th>
            </tr>
          </thead>
          <tbody>
            <MemberReportComparisonTotalsRow row={comparison.totals} />
            {comparison.mismatches.length > 0 ? (
              comparison.mismatches.map((row) => (
                <MemberReportComparisonDataRow row={row} key={row.member_id} />
              ))
            ) : (
              <tr>
                <td colSpan={7}>No member-level mismatches found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function MemberReportComparisonTotalsRow({
  row,
}: {
  row: NonNullable<ReportDiscrepanciesResponse["member_report_comparison"]>["totals"];
}) {
  return (
    <tr className="summary-row">
      <td>Totals</td>
      <td>{formatNumber(row.local_attacks)}</td>
      <td>{formatNumber(row.report_attacks)}</td>
      <td>{formatSignedNumber(row.attack_diff)}</td>
      <td>{formatNumber(row.local_raw_respect)}</td>
      <td>{formatNumber(row.report_score)}</td>
      <td>{formatSignedNumber(row.respect_diff)}</td>
    </tr>
  );
}

function MemberReportComparisonDataRow({
  row,
}: {
  row: MemberReportComparisonRow;
}) {
  return (
    <tr>
      <td>{row.member_name ?? `#${row.member_id}`}</td>
      <td>{formatNumber(row.local_attacks)}</td>
      <td>{formatNumber(row.report_attacks)}</td>
      <td>{formatSignedNumber(row.attack_diff)}</td>
      <td>{formatNumber(row.local_raw_respect)}</td>
      <td>{formatNumber(row.report_score)}</td>
      <td>{formatSignedNumber(row.respect_diff)}</td>
    </tr>
  );
}

export function discrepancyAside(response: ReportDiscrepanciesResponse | null): string {
  if (!response) {
    return "No data";
  }

  const { attacks, respectRemoved } = visibleGroupDefinitions(response).reduce(
    (totals, definition) => {
      const group = response.groups[definition.key];
      totals.attacks += group?.count ?? 0;

      if (
        definition.key === "chain_bonus_adjustments" ||
        definition.key === "after_practical_finish"
      ) {
        totals.respectRemoved += group?.respect_gain ?? 0;
      }

      return totals;
    },
    { attacks: 0, respectRemoved: 0 },
  );
  return `${formatNumber(attacks)} attacks / ${formatNumber(respectRemoved)} removed`;
}

function visibleGroupDefinitions(response: ReportDiscrepanciesResponse) {
  return GROUP_DEFINITIONS.filter((definition) => (response.groups[definition.key]?.count ?? 0) > 0);
}

export function formatReportComparison(reportValue: number | null, derivedValue: number): string {
  const report = Number(reportValue ?? 0);
  const difference = derivedValue - report;

  if (difference === 0) {
    return `${formatNumber(report)} (match)`;
  }

  return `${formatNumber(report)} (${formatNumber(difference)} diff)`;
}

function formatSignedNumber(value: number): string {
  if (value === 0) {
    return "0";
  }

  return value > 0 ? `+${formatNumber(value)}` : formatNumber(value);
}
