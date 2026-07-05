import React from "react";
import { CalendarClock, CheckCircle2, ChevronDown, ChevronRight, Radar, Swords, Target, TriangleAlert } from "lucide-react";
import {
  ChainBonusAttack,
  MemberAttack,
  MemberStats,
  ReportDiscrepanciesResponse,
  WarActivityBucket,
  WarDetailResponse,
  WarMemberCombatHeatmapResponse,
  WarSummary,
} from "../api";
import { ActivityChart, AttackChart, MemberPointGraphs } from "../components/Charts";
import { ChainBonusList } from "../components/ChainBonuses";
import { CollapsiblePanel, InlineMetric, MetricCard, PanelHeader } from "../components/Common";
import { MemberCombatHeatmap } from "../components/MemberCombatHeatmap";
import { MemberAttackList, MemberTable } from "../components/MemberTables";
import {
  discrepancyAside,
  reportAdjustmentTotals,
  ReportDiscrepancyPanel,
} from "../components/ReportDiscrepancies";
import {
  detailNumber,
  formatLongDateTime,
  formatNumber,
  formatWarDateRange,
} from "../utils/format";
import { downloadCsv, sanitizeCsvFilename } from "../utils/csv";
import { formatCountdownDuration, useCurrentTimeMs } from "../utils/time";
import {
  displayMember,
  displayWarStatus,
  MemberAttackSort,
  MemberSort,
  memberDefendsLost,
  memberNonHospitalizedDefendsLost,
  memberNonHospitalizedRespectLost,
  memberSortLabel,
  sortMemberAttacks,
  sortMembers,
  sumMembers,
  warOutcome,
} from "../utils/members";

type WarDetailViewProps = {
  activityBuckets: WarActivityBucket[];
  chainBonuses: ChainBonusAttack[];
  collapsedPanels: Record<string, boolean>;
  factionActivityWindow: "practical" | "official";
  isAdmin: boolean;
  isLoadingActivity: boolean;
  isLoadingDetail: boolean;
  isLoadingMemberCombatHeatmap: boolean;
  isLoadingMemberAttacks: boolean;
  isLoadingReportDiscrepancies: boolean;
  memberCombatHeatmap: WarMemberCombatHeatmapResponse | null;
  memberAttackSort: MemberAttackSort;
  memberAttacks: MemberAttack[];
  memberSort: MemberSort;
  onMemberActivityWindowChange: (window: "practical" | "official") => void;
  onMemberAttackSortChange: (sort: MemberAttackSort) => void;
  onMemberSelect: (member: MemberStats | null) => void;
  onMemberSortChange: (sort: MemberSort) => void;
  onOpenWarRoom: () => void;
  onTogglePanel: (panel: string) => void;
  reportDiscrepancies: ReportDiscrepanciesResponse | null;
  selectedMember: MemberStats | null;
  selectedWar: WarSummary;
  warDetail: WarDetailResponse | null;
};

function ActivityWindowToggle({
  value,
  onChange,
  label,
}: {
  value: "practical" | "official";
  onChange: (window: "practical" | "official") => void;
  label: string;
}) {
  return (
    <div className="panel-toggle-row" aria-label={label}>
      <button
        type="button"
        className={value === "practical" ? "toggle-chip active" : "toggle-chip"}
        onClick={() => onChange("practical")}
      >
        Practical
      </button>
      <button
        type="button"
        className={value === "official" ? "toggle-chip active" : "toggle-chip"}
        onClick={() => onChange("official")}
      >
        Official
      </button>
    </div>
  );
}

export function WarDetailView({
  activityBuckets,
  chainBonuses,
  collapsedPanels,
  factionActivityWindow,
  isAdmin,
  isLoadingActivity,
  isLoadingDetail,
  isLoadingMemberCombatHeatmap,
  isLoadingMemberAttacks,
  isLoadingReportDiscrepancies,
  memberCombatHeatmap,
  memberAttackSort,
  memberAttacks,
  memberSort,
  onMemberActivityWindowChange,
  onMemberAttackSortChange,
  onMemberSelect,
  onMemberSortChange,
  onOpenWarRoom,
  onTogglePanel,
  reportDiscrepancies,
  selectedMember,
  selectedWar,
  warDetail,
}: WarDetailViewProps) {
  const memberAttackPanelRef = React.useRef<HTMLElement | null>(null);
  const reportDiscrepancyCollapsed = collapsedPanels.reportDiscrepancies ?? true;
  const reportDiscrepancyAside = isLoadingReportDiscrepancies
    ? "Loading"
    : reportDiscrepancies
      ? discrepancyAside(reportDiscrepancies)
      : "Open to load";
  const members = sortMembers(warDetail?.members ?? [], memberSort);
  const sortedMemberAttacks = sortMemberAttacks(memberAttacks, memberAttackSort);
  const hasTornReport = Boolean(selectedWar.torn_report_fetched_at);
  const derivedRespectGained = detailNumber(
    warDetail?.summary?.total_respect_gain,
    selectedWar.total_respect_gain,
  );
  const derivedRespectLost = detailNumber(
    warDetail?.summary?.total_respect_lost,
    selectedWar.total_respect_lost,
  );
  const derivedSuccessfulAttacks = sumMembers(members, "attacks_vs_enemy_successful");
  const derivedEnemySuccessfulAttacks = members.reduce(
    (total, member) => total + memberDefendsLost(member),
    0,
  );
  const officialRespectGained = selectedWar.official_home_score ?? derivedRespectGained;
  const memberActionTotal =
    derivedSuccessfulAttacks +
    sumMembers(members, "assists_vs_enemy") +
    sumMembers(members, "outside_hits") +
    sumMembers(members, "friendly_hosps") +
    sumMembers(members, "defends_total");
  const hasWarData =
    selectedWar.status !== "scheduled" &&
    (memberActionTotal > 0 ||
      officialRespectGained > 0 ||
      derivedRespectGained > 0 ||
      derivedRespectLost > 0 ||
      chainBonuses.length > 0 ||
      hasTornReport);
  const showFactionActivity = hasWarData;
  const showEnemyActivity = hasWarData;
  const showMemberCombatHeatmap = hasWarData;
  const showMemberBreakdown = hasWarData && memberActionTotal > 0;
  const isScheduledWar = selectedWar.status === "scheduled";
  const hasReportAdjustmentData = Boolean(reportDiscrepancies);
  const reportAdjustments = reportAdjustmentTotals(reportDiscrepancies);
  const reportValidationRows = hasTornReport
    ? buildReportValidationRows({
        factionAttacks: {
          derived: derivedSuccessfulAttacks,
          report: selectedWar.official_home_attacks,
          adjustment: reportAdjustments.attackDelta,
        },
        factionRespect: {
          derived: derivedRespectGained,
          report: selectedWar.official_home_score,
          adjustment: reportAdjustments.respectDelta,
        },
        enemyAttacks: {
          derived: derivedEnemySuccessfulAttacks,
          report: selectedWar.official_enemy_attacks,
        },
        enemyScore: {
          derived: derivedRespectLost,
          report: selectedWar.official_enemy_score,
        },
      })
    : [];
  const reportMismatchCount = reportValidationRows.filter((row) => !row.matches).length;
  const reportValidationAside = isLoadingReportDiscrepancies && !hasReportAdjustmentData
    ? "Loading adjustments"
    : reportMismatchCount === 0
    ? "All totals match"
    : `${reportMismatchCount} mismatched ${reportMismatchCount === 1 ? "measure" : "measures"}`;

  React.useEffect(() => {
    if (!selectedMember || memberAttacks.length === 0 || isLoadingMemberAttacks) {
      return;
    }

    memberAttackPanelRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, [isLoadingMemberAttacks, memberAttacks.length, selectedMember]);

  return (
    <>
              <section className="hero-panel war-hero-panel">
                <div>
                  <p className="eyebrow war-meta-line">
                    <span>{displayWarStatus(selectedWar)}</span>
                  </p>
                  <div className="war-title-row">
                    <h2>
                      {selectedWar.name}
                      {selectedWar.torn_war_id ? (
                        <span className="war-title-id">{selectedWar.torn_war_id}</span>
                      ) : null}
                    </h2>
                    <span>{formatWarType(selectedWar)}</span>
                  </div>
                  <div className="war-time-lines">
                    <WarTimeLine
                      label={isScheduledWar ? "Buttgrass start time" : "Buttgrass times"}
                      value={
                        isScheduledWar
                          ? formatLongDateTime(selectedWar.practical_start_time)
                          : formatWarDateRange(selectedWar.practical_start_time, selectedWar.practical_finish_time)
                      }
                    />
                    <WarTimeLine
                      label={isScheduledWar ? "Torn official start time" : "Torn official times"}
                      value={
                        isScheduledWar
                          ? formatLongDateTime(selectedWar.official_start_time ?? selectedWar.practical_start_time)
                          : formatWarDateRange(
                              selectedWar.official_start_time ?? selectedWar.practical_start_time,
                              selectedWar.official_end_time,
                            )
                      }
                    />
                  </div>
                </div>
                {selectedWar.war_type === "termed" ? (
                  <TermProgress
                    war={selectedWar}
                    observedRespect={officialRespectGained}
                  />
                ) : null}
              </section>

              {hasWarData ? (
                <section className="status-grid war-status-grid">
                  <MetricCard
                    label="Respect gained"
                    value={formatNumber(officialRespectGained)}
                    icon={<Target size={18} />}
                  />
                  <MetricCard
                    label="Successful attacks"
                    value={formatNumber(derivedSuccessfulAttacks)}
                    icon={<Swords size={18} />}
                  />
                  <MetricCard
                    label="Victory / loss"
                    value={warOutcome(selectedWar, derivedRespectGained, derivedRespectLost)}
                    icon={<CalendarClock size={18} />}
                    fitValue
                  />
                </section>
              ) : null}

              {!hasWarData ? (
                <UpcomingWarEmptyPanel
                  war={selectedWar}
                  onOpenWarRoom={onOpenWarRoom}
                />
              ) : null}

              {hasWarData ? (
                <section className="content-grid">
                  <section className="panel chart-panel">
                    <PanelHeader
                      title={memberSortLabel(memberSort.key)}
                      aside={isLoadingDetail ? "Loading" : "Top 10 members"}
                    />
                    <AttackChart
                      members={members.slice(0, 10)}
                      metricKey={memberSort.key}
                      metricLabel={memberSortLabel(memberSort.key)}
                    />
                  </section>

                  <section className="panel">
                    <PanelHeader title="War totals" />
                    <div className="metric-list">
                      <InlineMetric label="Respect gained" value={officialRespectGained} />
                      <InlineMetric label="Successful attacks" value={derivedSuccessfulAttacks} />
                      <InlineMetric label="Assists" value={sumMembers(members, "assists_vs_enemy")} />
                      <InlineMetric label="Retaliations" value={sumMembers(members, "retaliations_vs_enemy")} />
                    </div>
                  </section>

                  {chainBonuses.length > 0 ? (
                    <section className="panel">
                      <PanelHeader title="Chain bonuses" aside={`${chainBonuses.length} hits`} />
                      <ChainBonusList attacks={chainBonuses} compact />
                    </section>
                  ) : null}
                </section>
              ) : null}

              {hasWarData && hasTornReport ? (
                <CollapsiblePanel
                  title="Torn report validation"
                  aside={reportValidationAside}
                  collapsed={collapsedPanels.reportValidation ?? true}
                  onToggle={() => onTogglePanel("reportValidation")}
                  className="table-panel"
                >
                  <div className={reportMismatchCount === 0 ? "report-validation-summary matched" : "report-validation-summary mismatched"}>
                    <div className="report-validation-summary-status">
                      {reportMismatchCount === 0 ? <CheckCircle2 size={18} /> : <TriangleAlert size={18} />}
                      <strong>{reportMismatchCount === 0 ? "Official report reconciles to dashboard totals" : "Official report needs review"}</strong>
                    </div>
                    <span>
                      {hasReportAdjustmentData
                        ? reportMismatchCount === 0
                          ? "Torn raw totals line up after known dashboard adjustments."
                          : "The remaining delta is not explained by known dashboard adjustments."
                        : "Adjustment-aware reconciliation will appear once the breakdown data loads."}
                    </span>
                  </div>
                  <div className="table-scroll">
                    <table className="report-validation-table">
                      <thead>
                        <tr>
                          <th>Measure</th>
                          <th>Status</th>
                          <th>Dashboard derived</th>
                          <th>Torn raw</th>
                          <th>Dashboard adjustments</th>
                          <th>Expected dashboard</th>
                          <th>Delta</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reportValidationRows.map((row) => (
                          <tr key={row.label} className={row.matches ? "report-validation-row matched" : "report-validation-row mismatched"}>
                            <td>{row.label}</td>
                            <td>
                              <span className={row.matches ? "report-validation-status matched" : "report-validation-status mismatched"}>
                                {row.matches ? "Match" : "Mismatch"}
                              </span>
                            </td>
                            <td>{formatNumber(row.derived)}</td>
                            <td>{formatNumber(row.report)}</td>
                            <td>{formatSignedDelta(row.adjustment)}</td>
                            <td>{formatNumber(row.expected)}</td>
                            <td>{formatSignedDelta(row.difference)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <section className="nested-discrepancy-panel">
                    <div className="nested-discrepancy-header">
                      <button
                        type="button"
                        className="collapse-button nested-collapse-button"
                        onClick={() => onTogglePanel("reportDiscrepancies")}
                      >
                        <span>
                          {reportDiscrepancyCollapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                        </span>
                        <strong>Report discrepancy breakdown</strong>
                      </button>
                      <span>{reportDiscrepancyAside}</span>
                    </div>
                    {reportDiscrepancyCollapsed ? null : (
                      <div className="nested-discrepancy-content">
                        <p className="panel-description">
                          Breaks down attack and respect adjustments behind differences from Torn's official ranked war report.
                        </p>
                        <ReportDiscrepancyPanel response={reportDiscrepancies} />
                      </div>
                    )}
                  </section>
                </CollapsiblePanel>
              ) : null}

              {showMemberBreakdown ? (
                <CollapsiblePanel
                  title="Tacenda's point graphs"
                  aside="Member comparisons"
                  collapsed={collapsedPanels.memberPointGraphs ?? true}
                  onToggle={() => onTogglePanel("memberPointGraphs")}
                  className="member-point-graphs-panel"
                >
                  <p className="panel-description">
                    Tacenda's point graphs to compare various member performance metrics, some more useful than others.
                  </p>
                  <MemberPointGraphs
                    members={members}
                    showTermedGraph={selectedWar.war_type === "termed"}
                  />
                </CollapsiblePanel>
              ) : null}

              {showFactionActivity ? (
                <CollapsiblePanel
                  title="Buttgrass attacks over time"
                  aside={isLoadingActivity && collapsedPanels.factionActivity === false ? "Loading" : undefined}
                  collapsed={collapsedPanels.factionActivity ?? true}
                  onToggle={() => onTogglePanel("factionActivity")}
                  className="activity-panel"
                >
                  <ActivityWindowToggle
                    value={factionActivityWindow}
                    onChange={onMemberActivityWindowChange}
                    label="Buttgrass activity time range"
                  />
                  <p className="panel-description">
                    Shows Buttgrass attack activity across the selected time range, grouped into successful
                    attacks, assists, and outside hits.
                  </p>
                  <ActivityChart buckets={activityBuckets} keys={["enemy_success", "enemy_assist", "outside"]} />
                </CollapsiblePanel>
              ) : null}

              {showEnemyActivity ? (
                <CollapsiblePanel
                  title={`${selectedWar.name} attacks over time`}
                  aside={isLoadingActivity && collapsedPanels.enemyActivity === false ? "Loading" : undefined}
                  collapsed={collapsedPanels.enemyActivity ?? true}
                  onToggle={() => onTogglePanel("enemyActivity")}
                  className="activity-panel"
                >
                  <ActivityWindowToggle
                    value={factionActivityWindow}
                    onChange={onMemberActivityWindowChange}
                    label={`${selectedWar.name} activity time range`}
                  />
                  <p className="panel-description">
                    Shows enemy attacks against Buttgrass over time, split by lost, won, and other defend outcomes.
                  </p>
                  <ActivityChart buckets={activityBuckets} keys={["defend_lost", "defend_won", "defend_other"]} />
                </CollapsiblePanel>
              ) : null}

              {showMemberCombatHeatmap ? (
                <CollapsiblePanel
                  title="Member combat heatmap"
                  aside={isLoadingMemberCombatHeatmap && collapsedPanels.memberCombatHeatmap === false ? "Loading" : "15 minute buckets"}
                  collapsed={collapsedPanels.memberCombatHeatmap ?? true}
                  onToggle={() => onTogglePanel("memberCombatHeatmap")}
                  className="member-combat-panel"
                >
                  <p className="panel-description">
                    Shows member attacks, outside hits, defends lost, and respect by 15-minute war bucket.
                    Drag cells, rows, or time columns to total a selection.
                  </p>
                  <MemberCombatHeatmap
                    heatmap={memberCombatHeatmap}
                    isLoading={isLoadingMemberCombatHeatmap}
                  />
                </CollapsiblePanel>
              ) : null}

              {showMemberBreakdown ? (
                <CollapsiblePanel
                  title="Faction members breakdown"
                  collapsed={collapsedPanels.memberBreakdown ?? false}
                  onToggle={() => onTogglePanel("memberBreakdown")}
                  className="table-panel"
                  control={
                    isAdmin ? (
                      <button
                        type="button"
                        className="panel-action-button"
                        onClick={() => exportMembersCsv(members, selectedWar)}
                      >
                        CSV
                      </button>
                    ) : undefined
                  }
                >
                  <p className="panel-description">
                    Summarises each faction member's war performance. Click a member name to see their attacks.
                  </p>
                  <MemberTable
                    members={members}
                    sort={memberSort}
                    onSortChange={onMemberSortChange}
                    showTermedColumns={selectedWar.war_type === "termed"}
                    showRowNumbers
                    selectedMemberId={selectedMember?.member_id ?? null}
                    onMemberSelect={onMemberSelect}
                  />
                </CollapsiblePanel>
              ) : null}

              {showMemberBreakdown && selectedMember ? (
                <section className="panel table-panel" ref={memberAttackPanelRef}>
                  <PanelHeader
                    title={`${displayMember(selectedMember)} attacks`}
                    aside={isLoadingMemberAttacks ? "Loading" : `${memberAttacks.length} attacks`}
                    control={
                      isAdmin ? (
                        <button
                          type="button"
                          className="panel-action-button"
                          onClick={() => exportMemberAttacksCsv(sortedMemberAttacks, selectedWar, selectedMember)}
                        >
                          CSV
                        </button>
                      ) : undefined
                    }
                  />
                  <p className="panel-description">
                    Lists this member's counted attacks and defends, with row colour showing how each action was classified.
                  </p>
                  <MemberAttackList
                    attacks={sortedMemberAttacks}
                    sort={memberAttackSort}
                    onSortChange={onMemberAttackSortChange}
                  />
                </section>
              ) : null}
    </>
  );
}

function formatWarType(war: WarSummary): string {
  return war.war_type === "termed"
    ? "Termed war"
    : war.war_type === "event"
      ? "Event"
      : "Real war";
}

function exportMembersCsv(members: MemberStats[], war: WarSummary | null) {
  if (!war) {
    return;
  }

  const termed = war.war_type === "termed";
  const columns: Array<{
    label: string;
    value: (member: MemberStats) => string | number | null | undefined;
  }> = termed
    ? [
        { label: "Player name", value: (member) => displayMember(member) },
        { label: "Member ID", value: (member) => member.member_id },
        { label: "Attacks", value: (member) => member.attacks_vs_enemy_successful },
        { label: "Defends", value: (member) => member.defends_total },
        { label: "Defends lost", value: (member) => memberDefendsLost(member) },
        { label: "Non-hosp defends lost", value: (member) => memberNonHospitalizedDefendsLost(member) },
        { label: "Respect gained", value: (member) => formatCsvDecimal(member.respect_gained) },
        { label: "Respect lost", value: (member) => formatCsvDecimal(member.respect_lost) },
        { label: "Non-hosp respect lost", value: (member) => formatCsvDecimal(memberNonHospitalizedRespectLost(member)) },
        { label: "Respect lost raw", value: (member) => formatCsvDecimal(member.respect_lost_raw) },
        { label: "Assists", value: (member) => member.assists_vs_enemy },
        { label: "Average fair fight", value: (member) => formatCsvDecimal(member.average_fair_fight) },
        { label: "Percent limit", value: (member) => formatCsvDecimal(member.member_respect_limit_percent) },
      ]
    : [
        { label: "Player name", value: (member) => displayMember(member) },
        { label: "Member ID", value: (member) => member.member_id },
        { label: "Attacks", value: (member) => member.attacks_vs_enemy_successful },
        { label: "Defends", value: (member) => member.defends_total },
        { label: "Defends lost", value: (member) => memberDefendsLost(member) },
        { label: "Non-hosp defends lost", value: (member) => memberNonHospitalizedDefendsLost(member) },
        { label: "Outside hits", value: (member) => member.outside_hits },
        { label: "Respect gained", value: (member) => formatCsvDecimal(member.respect_gained) },
        { label: "Respect lost", value: (member) => formatCsvDecimal(member.respect_lost) },
        { label: "Non-hosp respect lost", value: (member) => formatCsvDecimal(memberNonHospitalizedRespectLost(member)) },
        { label: "Respect lost raw", value: (member) => formatCsvDecimal(member.respect_lost_raw) },
        { label: "Assists", value: (member) => member.assists_vs_enemy },
        { label: "Average fair fight", value: (member) => formatCsvDecimal(member.average_fair_fight) },
        { label: "Friendly hosps", value: (member) => member.friendly_hosps },
        { label: "Retaliations", value: (member) => member.retaliations_vs_enemy },
      ];
  downloadCsv(`${sanitizeCsvFilename(war.name)}-members.csv`, columns, members);
}

function formatCsvDecimal(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return "";
  }

  return Number(value).toFixed(2);
}

type ReportValidationRow = {
  label: string;
  derived: number;
  report: number;
  adjustment: number;
  expected: number;
  difference: number;
  matches: boolean;
};

function buildReportValidationRows(values: {
  factionAttacks: { derived: number; report: number | null; adjustment?: number };
  factionRespect: { derived: number; report: number | null; adjustment?: number };
  enemyAttacks: { derived: number; report: number | null; adjustment?: number };
  enemyScore: { derived: number; report: number | null; adjustment?: number };
}): ReportValidationRow[] {
  return [
    reportValidationRow("Faction attacks", values.factionAttacks, 0),
    reportValidationRow("Faction respect", values.factionRespect, 0.1),
    reportValidationRow("Enemy attacks", values.enemyAttacks, 0),
    reportValidationRow("Enemy score", values.enemyScore, 0.1),
  ];
}

function reportValidationRow(
  label: string,
  value: { derived: number; report: number | null; adjustment?: number },
  tolerance: number,
): ReportValidationRow {
  const report = Number(value.report ?? 0);
  const adjustment = value.adjustment ?? 0;
  const expected = report + adjustment;
  const difference = value.derived - expected;

  return {
    label,
    derived: value.derived,
    report,
    adjustment,
    expected,
    difference,
    matches: Math.abs(difference) <= tolerance,
  };
}

function formatSignedDelta(value: number): string {
  if (value === 0) {
    return "0";
  }

  return value > 0 ? `+${formatNumber(value)}` : formatNumber(value);
}

function exportMemberAttacksCsv(
  attacks: MemberAttack[],
  war: WarSummary | null,
  member: MemberStats | null,
) {
  if (!war || !member) {
    return;
  }

  const columns: Array<{
    label: string;
    value: (attack: MemberAttack) => string | number | null | undefined;
  }> = [
    { label: "Player name", value: () => displayMember(member) },
    { label: "Member ID", value: () => member.member_id },
    { label: "Time", value: (attack) => attack.started },
    { label: "Type", value: (attack) => attack.classification },
    { label: "Attacker", value: (attack) => attack.attacker_name ?? attack.attacker_id },
    { label: "Defender", value: (attack) => attack.defender_name ?? attack.defender_id },
    { label: "Defender faction", value: (attack) => attack.defender_faction_id },
    { label: "Result", value: (attack) => attack.result },
    { label: "Respect", value: (attack) => attack.respect_gain },
  ];
  downloadCsv(
    `${sanitizeCsvFilename(war.name)}-${sanitizeCsvFilename(displayMember(member))}-attacks.csv`,
    columns,
    attacks,
  );
}

function WarTimeLine({ label, value }: { label: string; value: string }) {
  return (
    <p className="war-time-line">
      <span>{label}</span>
      <strong>{value}</strong>
    </p>
  );
}

function TermProgress({
  war,
  observedRespect,
}: {
  war: WarSummary;
  observedRespect: number;
}) {
  if (!war.faction_respect_limit) {
    return null;
  }

  const observed = observedRespect;
  const progress = Math.min(100, (observed / war.faction_respect_limit) * 100);

  return (
    <div className="progress-block hero-progress">
      <div className="progress-track">
        <span style={{ width: `${progress}%` }} />
      </div>
      <small>
        {formatNumber(observed)} / {formatNumber(war.faction_respect_limit)} respect
      </small>
    </div>
  );
}

function UpcomingWarEmptyPanel({
  war,
  onOpenWarRoom,
}: {
  war: WarSummary;
  onOpenWarRoom: () => void;
}) {
  const nowMs = useCurrentTimeMs();
  const startTime = war.official_start_time ?? war.practical_start_time;
  const remainingSeconds = Math.max(0, Number(startTime ?? 0) - Math.floor(nowMs / 1000));

  return (
    <section className="panel upcoming-war-panel">
      <PanelHeader title="War starts in" aside={formatCountdownDuration(remainingSeconds)} />
      <p className="panel-description">
        Performance panels will appear once attacks or official report data exists. Use the War room for scouting,
        stat comparison, and activity heatmaps before the war starts.
      </p>
      <button type="button" className="icon-text-button" onClick={onOpenWarRoom}>
        <Radar size={15} />
        Open War room
      </button>
    </section>
  );
}
