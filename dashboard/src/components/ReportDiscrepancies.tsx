import {
  ChainBonusAttack,
  MemberReportComparisonRow,
  ReportAttackReconciliation,
  ReportAttackReconciliationItem,
  ReportDiscrepanciesResponse,
} from "../api";
import { EmptyState } from "./Common";
import { ChainBonusList } from "./ChainBonuses";
import { formatDate, formatNumber } from "../utils/format";

const GROUP_DEFINITIONS = [
  {
    key: "after_practical_finish",
    category: "adjustment",
    title: "Hits after practical finish",
    detail:
      "These Buttgrass hits happened after the practical finish, so they may appear in Torn totals but not member performance.",
  },
  {
    key: "uncounted_enemy_results",
    category: "discrepancy",
    title: "Unknown attack results",
    detail:
      "These enemy-faction attacks have result values outside the known successful and unsuccessful lists.",
  },
  {
    key: "chain_bonus_adjustments",
    category: "adjustment",
    title: "Chain bonus respect adjusted",
    detail:
      "Chain bonus attacks count, but bonus respect is replaced with the member's average respect/hit.",
  },
  {
    key: "outside_official_window",
    category: "adjustment",
    title: "Hits outside official window",
    detail: "These linked Buttgrass attacks fall outside Torn's official war window.",
  },
];

type ReportDiscrepancyDefinition = (typeof GROUP_DEFINITIONS)[number];

export type ReportAdjustmentTotals = {
  attackDelta: number;
  respectDelta: number;
};

export function ReportDiscrepancyPanel({
  response,
}: {
  response: ReportDiscrepanciesResponse | null;
}) {
  if (!response) {
    return <EmptyState text="No discrepancy data loaded" />;
  }

  const groups = visibleGroupDefinitions(response);
  const adjustmentGroups = groups.filter((definition) => definition.category === "adjustment");
  const unresolvedGroups = groups.filter((definition) => definition.category === "discrepancy");
  const hasMemberMismatches = Boolean(
    response.member_report_comparison?.available &&
      response.member_report_comparison.mismatches.length > 0,
  );
  const hasAdjustments = adjustmentGroups.length > 0;
  const hasUnresolved = unresolvedGroups.length > 0 || hasMemberMismatches;

  if (!hasAdjustments && !hasUnresolved) {
    return <EmptyState text="No discrepancy breakdown items found." />;
  }

  return (
    <div className="discrepancy-groups">
      {hasAdjustments ? (
        <section className="discrepancy-section">
          <div className="discrepancy-section-header">
            <div>
              <h3>Dashboard adjustments</h3>
              <p>Known transformations from Torn raw report totals into dashboard totals.</p>
            </div>
            <strong>{formatAdjustmentTotals(reportAdjustmentTotals(response))}</strong>
          </div>
          {adjustmentGroups.map((definition) => renderDiscrepancyGroup(definition, response))}
        </section>
      ) : null}

      {hasUnresolved ? (
        <section className="discrepancy-section">
          <div className="discrepancy-section-header">
            <div>
              <h3>Unresolved discrepancies</h3>
              <p>Differences that remain after known dashboard adjustments.</p>
            </div>
            <strong>{discrepancyAside(response)}</strong>
          </div>
          <MemberReportComparison response={response} />
          <AttackReconciliationInvestigation reconciliation={response.attack_reconciliation ?? null} />
          {unresolvedGroups.map((definition) => renderDiscrepancyGroup(definition, response))}
        </section>
      ) : null}
    </div>
  );
}

function renderDiscrepancyGroup(
  definition: ReportDiscrepancyDefinition,
  response: ReportDiscrepanciesResponse,
) {
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
}

function AttackReconciliationInvestigation({
  reconciliation,
}: {
  reconciliation: ReportAttackReconciliation | null;
}) {
  if (!reconciliation) {
    return null;
  }

  const groupedItems = groupReconciliationItemsByMember(reconciliation.items);
  const aside = reconciliation.status === "failed"
    ? "Failed"
    : `${formatNumber(reconciliation.findings_count)} findings`;

  return (
    <section className="discrepancy-group attack-reconciliation-group">
      <div className="discrepancy-group-header">
        <div>
          <h3>Attack investigation</h3>
          <p>
            Compares Torn's official-window outgoing attacks with local attack rows for mismatched members.
          </p>
        </div>
        <strong>{aside}</strong>
      </div>

      <div className="attack-reconciliation-meta">
        <span>{formatNumber(reconciliation.comparable_torn_attacks)} Torn attacks checked</span>
        <span>{formatNumber(reconciliation.local_attacks_checked)} local rows checked</span>
        {reconciliation.truncated ? <span>Fetch truncated</span> : null}
      </div>

      {reconciliation.status === "failed" ? (
        <EmptyState text={reconciliation.error ?? "Attack investigation failed"} />
      ) : groupedItems.length === 0 ? (
        <EmptyState text="No attack-level findings found for the current discrepancy." />
      ) : (
        groupedItems.map((group) => (
          <section className="attack-reconciliation-member" key={group.memberId}>
            <div className="attack-reconciliation-member-header">
              <h4>{group.memberName ?? `#${group.memberId}`}</h4>
              <span>{formatNumber(group.items.length)} findings</span>
            </div>
            <div className="table-scroll">
              <table className="discrepancy-table attack-reconciliation-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Finding</th>
                    <th>Attack</th>
                    <th>Defender</th>
                    <th>Result</th>
                    <th>Respect</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {group.items.map((item) => (
                    <AttackReconciliationRow item={item} key={item.id} />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}
    </section>
  );
}

function AttackReconciliationRow({ item }: { item: ReportAttackReconciliationItem }) {
  return (
    <tr>
      <td>{formatDate(item.started)}</td>
      <td>
        <span className={`attack-reconciliation-badge ${classificationTone(item.classification)}`}>
          {classificationLabel(item.classification)}
        </span>
      </td>
      <td>{attackLink(item)}</td>
      <td>{item.defender_name ?? (item.defender_id === null ? "-" : `#${item.defender_id}`)}</td>
      <td>{item.result ?? "-"}</td>
      <td>{item.respect_gain === null ? "-" : formatNumber(item.respect_gain)}</td>
      <td>{item.reason}</td>
    </tr>
  );
}

function attackLink(item: ReportAttackReconciliationItem) {
  if (item.attack_code) {
    return (
      <a
        className="table-link"
        href={`https://www.torn.com/loader.php?sid=attackLog&ID=${encodeURIComponent(item.attack_code)}`}
        target="_blank"
        rel="noreferrer"
      >
        {item.attack_code}
      </a>
    );
  }

  return item.attack_id === null ? "-" : `#${item.attack_id}`;
}

function groupReconciliationItemsByMember(items: ReportAttackReconciliationItem[]) {
  const groups = new Map<number, {
    memberId: number;
    memberName: string | null;
    items: ReportAttackReconciliationItem[];
  }>();

  for (const item of items) {
    const group = groups.get(item.member_id) ?? {
      memberId: item.member_id,
      memberName: item.member_name,
      items: [],
    };
    group.memberName = group.memberName ?? item.member_name;
    group.items.push(item);
    groups.set(item.member_id, group);
  }

  return [...groups.values()].sort((a, b) =>
    (a.memberName ?? "").localeCompare(b.memberName ?? "") || a.memberId - b.memberId
  );
}

function classificationLabel(classification: string): string {
  switch (classification) {
    case "missing_from_db":
      return "Missing";
    case "present_unlinked":
      return "Unlinked";
    case "present_excluded":
      return "Excluded";
    case "field_mismatch":
      return "Changed";
    case "local_only":
      return "Local only";
    case "report_total_gap":
      return "Report gap";
    case "attack_log_extra":
      return "Log extra";
    default:
      return classification.split("_").join(" ");
  }
}

function classificationTone(classification: string): string {
  if (classification === "missing_from_db" || classification === "present_unlinked") {
    return "danger";
  }

  if (classification === "present_excluded" || classification === "field_mismatch") {
    return "warn";
  }

  if (classification === "report_total_gap" || classification === "attack_log_extra") {
    return "warn";
  }

  return "neutral";
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
  const attackDiff = memberComparison?.available ? memberComparison.totals.attack_diff : 0;
  const respectDiff = memberComparison?.available ? memberComparison.totals.respect_diff : 0;
  const unknownAttacks = response.groups.uncounted_enemy_results?.count ?? 0;
  const unknownLabel = unknownAttacks > 0 ? ` / ${formatNumber(unknownAttacks)} unknown` : "";

  return `${formatSignedNumber(attackDiff)} attacks / ${formatSignedNumber(respectDiff)} respect${unknownLabel}`;
}

export function reportAdjustmentTotals(
  response: ReportDiscrepanciesResponse | null,
): ReportAdjustmentTotals {
  if (!response) {
    return { attackDelta: 0, respectDelta: 0 };
  }

  return visibleGroupDefinitions(response).reduce(
    (totals, definition) => {
      if (definition.category !== "adjustment") {
        return totals;
      }

      const group = response.groups[definition.key];

      if (definition.key === "after_practical_finish") {
        totals.attackDelta -= group?.count ?? 0;
        totals.respectDelta -= group?.respect_gain ?? 0;
      } else if (definition.key === "outside_official_window") {
        totals.attackDelta += group?.count ?? 0;
        totals.respectDelta += group?.respect_gain ?? 0;
      } else if (definition.key === "chain_bonus_adjustments") {
        totals.respectDelta -= group?.respect_gain ?? 0;
      }

      return totals;
    },
    { attackDelta: 0, respectDelta: 0 },
  );
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

function formatAdjustmentTotals(totals: ReportAdjustmentTotals): string {
  return `${formatSignedNumber(totals.attackDelta)} attacks / ${formatSignedNumber(totals.respectDelta)} respect`;
}

function formatSignedNumber(value: number): string {
  if (value === 0) {
    return "0";
  }

  return value > 0 ? `+${formatNumber(value)}` : formatNumber(value);
}
