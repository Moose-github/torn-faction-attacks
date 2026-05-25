import React from "react";
import { CalendarClock, ChevronDown, ChevronRight, Radar, Swords, Target } from "lucide-react";
import {
  ChainBonusAttack,
  MemberAttack,
  MemberStats,
  ReportDiscrepanciesResponse,
  WarActivityBucket,
  WarDetailResponse,
  WarMemberActivityHeatmapResponse,
  WarSummary,
} from "../api";
import { ActivityChart, AttackChart, MemberPointGraphs } from "../components/Charts";
import { ChainBonusList } from "../components/ChainBonuses";
import { CollapsiblePanel, InlineMetric, MetricCard, PanelHeader } from "../components/Common";
import { MemberActivityHeatmap } from "../components/MemberActivityHeatmap";
import { MemberAttackList, MemberTable } from "../components/MemberTables";
import {
  discrepancyAside,
  formatReportComparison,
  ReportDiscrepancyPanel,
} from "../components/ReportDiscrepancies";
import {
  detailNumber,
  formatLongDateTime,
  formatNumber,
  formatWarDateRange,
} from "../utils/format";
import { downloadCsv, sanitizeCsvFilename } from "../utils/csv";
import { formatDuration, useCurrentTime } from "../utils/time";
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
  isLoadingMemberActivityHeatmap: boolean;
  isLoadingMemberAttacks: boolean;
  isLoadingReportDiscrepancies: boolean;
  memberActivityHeatmap: WarMemberActivityHeatmapResponse | null;
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
  isLoadingMemberActivityHeatmap,
  isLoadingMemberAttacks,
  isLoadingReportDiscrepancies,
  memberActivityHeatmap,
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
  const showMemberActivityHeatmap = hasWarData;
  const showMemberBreakdown = hasWarData && memberActionTotal > 0;
  const isScheduledWar = selectedWar.status === "scheduled";

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
                  collapsed={collapsedPanels.reportValidation ?? true}
                  onToggle={() => onTogglePanel("reportValidation")}
                  className="table-panel"
                >
                  <p className="panel-description">
                    Compares dashboard totals with Torn's official ranked war report.
                  </p>
                  <div className="table-scroll">
                    <table className="report-validation-table">
                      <thead>
                        <tr>
                          <th>Measure</th>
                          <th>Dashboard derived</th>
                          <th>Torn report</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>Faction attacks</td>
                          <td>{formatNumber(derivedSuccessfulAttacks)}</td>
                          <td>{formatReportComparison(selectedWar.official_home_attacks, derivedSuccessfulAttacks)}</td>
                        </tr>
                        <tr>
                          <td>Faction respect</td>
                          <td>{formatNumber(derivedRespectGained)}</td>
                          <td>{formatReportComparison(selectedWar.official_home_score, derivedRespectGained)}</td>
                        </tr>
                        <tr>
                          <td>Enemy attacks</td>
                          <td>{formatNumber(derivedEnemySuccessfulAttacks)}</td>
                          <td>{formatReportComparison(selectedWar.official_enemy_attacks, derivedEnemySuccessfulAttacks)}</td>
                        </tr>
                        <tr>
                          <td>Enemy score</td>
                          <td>{formatNumber(derivedRespectLost)}</td>
                          <td>{formatReportComparison(selectedWar.official_enemy_score, derivedRespectLost)}</td>
                        </tr>
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

              {showMemberActivityHeatmap ? (
                <CollapsiblePanel
                  title="Member activity heatmap"
                  aside={isLoadingMemberActivityHeatmap && collapsedPanels.memberActivityHeatmap === false ? "Loading" : "15 minute buckets"}
                  collapsed={collapsedPanels.memberActivityHeatmap ?? true}
                  onToggle={() => onTogglePanel("memberActivityHeatmap")}
                  className="member-activity-panel"
                >
                  <p className="panel-description">
                    Shows member attacks, outside hits, defends lost, and respect by 15-minute war bucket.
                    Drag cells, rows, or time columns to total a selection.
                  </p>
                  <MemberActivityHeatmap
                    heatmap={memberActivityHeatmap}
                    isLoading={isLoadingMemberActivityHeatmap}
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
  const now = useCurrentTime();
  const startTime = war.official_start_time ?? war.practical_start_time;
  const remainingSeconds = Math.max(0, Number(startTime ?? 0) - Math.floor(now / 1000));

  return (
    <section className="panel upcoming-war-panel">
      <PanelHeader title="War starts in" aside={formatDuration(remainingSeconds)} />
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
