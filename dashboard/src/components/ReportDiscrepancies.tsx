import { ChainBonusAttack, MemberReportComparisonRow, ReportDiscrepanciesResponse } from "../api";
import { EmptyState } from "./Common";
import { ChainBonusList } from "./ChainBonuses";
import { formatDate, formatNumber } from "../utils/format";

const GROUP_DEFINITIONS = [
  {
    key: "after_practical_finish",
    title: "Hits after practical finish",
    detail:
      "These Buttgrass hits happened after the practical finish, so they may appear in Torn totals but not member performance.",
  },
  {
    key: "uncounted_enemy_results",
    title: "Unknown attack results",
    detail:
      "These enemy-faction attacks have result values outside the known successful and unsuccessful lists.",
  },
  {
    key: "chain_bonus_adjustments",
    title: "Chain bonus respect adjusted",
    detail:
      "Chain bonus attacks count, but bonus respect is replaced with the member's average respect/hit.",
  },
  {
    key: "outside_official_window",
    title: "Hits outside official window",
    detail: "These linked Buttgrass attacks fall outside Torn's official war window.",
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
  const hasMemberMismatches = Boolean(
    response.member_report_comparison?.available &&
      response.member_report_comparison.mismatches.length > 0,
  );

  if (groups.length === 0 && !hasMemberMismatches) {
    return <EmptyState text="No discrepancy breakdown items found." />;
  }

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
              <strong>{discrepancyGroupSummary(definition.key, count, group?.respect_gain ?? 0)}</strong>
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

  if (!comparison?.available || comparison.mismatches.length === 0) {
    return null;
  }

  return (
    <section className="discrepancy-group">
      <div className="discrepancy-group-header">
        <div>
          <h3>Official member totals</h3>
          <p>
            Compares each member's dashboard totals with Torn's official member totals.
          </p>
        </div>
        <strong>
          {formatSignedNumber(comparison.totals.attack_diff)} attacks /{" "}
          {formatSignedNumber(comparison.totals.respect_diff)} respect
        </strong>
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

  const memberComparison = response.member_report_comparison;
  const memberAttackDiff = memberComparison?.available ? memberComparison.totals.attack_diff : 0;
  const memberRespectDiff = memberComparison?.available ? memberComparison.totals.respect_diff : 0;

  const { attackDiff, respectDiff } = visibleGroupDefinitions(response).reduce(
    (totals, definition) => {
      const group = response.groups[definition.key];

      if (definition.key === "after_practical_finish") {
        totals.attackDiff -= group?.count ?? 0;
        totals.respectDiff -= group?.respect_gain ?? 0;
      } else if (definition.key === "chain_bonus_adjustments") {
        totals.respectDiff -= group?.respect_gain ?? 0;
      }

      return totals;
    },
    { attackDiff: memberAttackDiff, respectDiff: memberRespectDiff },
  );

  return `${formatSignedNumber(attackDiff)} attacks / ${formatSignedNumber(respectDiff)} respect`;
}

function visibleGroupDefinitions(response: ReportDiscrepanciesResponse) {
  return GROUP_DEFINITIONS.filter((definition) => (response.groups[definition.key]?.count ?? 0) > 0);
}

function discrepancyGroupSummary(key: string, count: number, respectGain: number): string {
  if (key === "chain_bonus_adjustments") {
    return `${formatNumber(count)} chain hits / ${formatNumber(respectGain)} respect removed`;
  }

  if (key === "after_practical_finish") {
    return `${formatNumber(count)} attacks / ${formatNumber(respectGain)} respect removed`;
  }

  return `${formatNumber(count)} attacks`;
}

function formatSignedNumber(value: number): string {
  if (value === 0) {
    return "0";
  }

  return value > 0 ? `+${formatNumber(value)}` : formatNumber(value);
}
