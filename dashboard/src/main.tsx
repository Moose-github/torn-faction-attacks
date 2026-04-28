import React from "react";
import ReactDOM from "react-dom/client";
import { BarChart3, CalendarClock, Swords, Target, Wrench } from "lucide-react";
import {
  getStats,
  getWar,
  getWarActivity,
  getWarMemberAttacks,
  getWarReportDiscrepancies,
  getWars,
  MemberAttack,
  MemberStats,
  ReportDiscrepanciesResponse,
  WarDetailResponse,
  WarActivityBucket,
  WarSummary,
  WarType,
} from "./api";
import { ActivityChart, AttackChart } from "./components/Charts";
import { ChainBonusList } from "./components/ChainBonuses";
import {
  CollapsiblePanel,
  EmptyState,
  InlineMetric,
  MetricCard,
  PanelHeader,
} from "./components/Common";
import { MemberAttackList, MemberTable } from "./components/MemberTables";
import {
  discrepancyAside,
  formatReportComparison,
  ReportDiscrepancyPanel,
} from "./components/ReportDiscrepancies";
import { Sidebar } from "./components/Sidebar";
import { AdminControls } from "./views/AdminControls";
import { MembersOverview } from "./views/MembersOverview";
import { detailNumber, formatNumber, formatWarDateRange } from "./utils/format";
import {
  displayMember,
  displayWarStatus,
  MemberAttackSort,
  MemberSort,
  memberSortLabel,
  sortMembers,
  sortMemberAttacks,
  sumMembers,
  warOutcome,
} from "./utils/members";
import "./styles.css";

function App() {
  const [warType, setWarType] = React.useState<WarType>("all");
  const [view, setView] = React.useState<"war" | "members" | "admin">("war");
  const [wars, setWars] = React.useState<WarSummary[]>([]);
  const [selectedWarName, setSelectedWarName] = React.useState<string | null>(null);
  const [warDetail, setWarDetail] = React.useState<WarDetailResponse | null>(null);
  const [overallWars, setOverallWars] = React.useState(0);
  const [memberSort, setMemberSort] = React.useState<MemberSort>({
    key: "enemy_attacks_successful",
    direction: "desc",
  });
  const [memberAttackSort, setMemberAttackSort] = React.useState<MemberAttackSort>({
    key: "started",
    direction: "desc",
  });
  const [error, setError] = React.useState<string | null>(null);
  const [isLoadingWars, setIsLoadingWars] = React.useState(true);
  const [isLoadingDetail, setIsLoadingDetail] = React.useState(false);
  const [activityBuckets, setActivityBuckets] = React.useState<WarActivityBucket[]>([]);
  const [isLoadingActivity, setIsLoadingActivity] = React.useState(false);
  const [reportDiscrepancies, setReportDiscrepancies] = React.useState<ReportDiscrepanciesResponse | null>(null);
  const [isLoadingReportDiscrepancies, setIsLoadingReportDiscrepancies] = React.useState(false);
  const [collapsedPanels, setCollapsedPanels] = React.useState<Record<string, boolean>>({});
  const [selectedMember, setSelectedMember] = React.useState<MemberStats | null>(null);
  const [memberAttacks, setMemberAttacks] = React.useState<MemberAttack[]>([]);
  const [isLoadingMemberAttacks, setIsLoadingMemberAttacks] = React.useState(false);
  const memberAttackPanelRef = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
  let cancelled = false;

  async function loadWars() {
    setIsLoadingWars(true);
    setError(null);

    try {
      const [warsResponse, statsResponse] = await Promise.all([
        getWars(warType),
        getStats(warType),
      ]);

      if (cancelled) return;

      setWars(warsResponse.wars);
      setOverallWars(statsResponse.overall.total_wars);

      setSelectedWarName((currentSelectedWarName) => {
        const selectedStillVisible = warsResponse.wars.some(
          (war) => war.name === currentSelectedWarName,
        );

        return selectedStillVisible
          ? currentSelectedWarName
          : warsResponse.wars[0]?.name ?? null;
      });
    } catch (err) {
      if (!cancelled) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (!cancelled) {
        setIsLoadingWars(false);
      }
    }
  }

  loadWars();

  return () => {
    cancelled = true;
  };
}, [warType]);

  React.useEffect(() => {
  let cancelled = false;

  async function loadWarDetail() {
    if (!selectedWarName) {
      setWarDetail(null);
      return;
    }

    setWarDetail(null);
    setIsLoadingDetail(true);
    setError(null);

    try {
      const detail = await getWar(selectedWarName);
      if (!cancelled) {
        setWarDetail(detail);
      }
    } catch (err) {
      if (!cancelled) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (!cancelled) {
        setIsLoadingDetail(false);
      }
    }
  }

  loadWarDetail();

  return () => {
    cancelled = true;
  };
}, [selectedWarName]);

  React.useEffect(() => {
    let cancelled = false;

    async function loadActivity() {
      if (!selectedWarName) {
        setActivityBuckets([]);
        return;
      }

      setIsLoadingActivity(true);
      setError(null);

      try {
        const response = await getWarActivity(selectedWarName);
        if (!cancelled) {
          setActivityBuckets(Array.isArray(response.buckets) ? response.buckets : []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) {
          setIsLoadingActivity(false);
        }
      }
    }

    loadActivity();
    return () => {
      cancelled = true;
    };
  }, [selectedWarName]);

  React.useEffect(() => {
    setSelectedMember(null);
    setMemberAttacks([]);
  }, [selectedWarName]);

  const selectedWar = warDetail?.war ?? wars.find((war) => war.name === selectedWarName) ?? null;
  const hasTornReport = Boolean(selectedWar?.torn_report_fetched_at);
  const selectedWarTitle = splitGeneratedWarTitle(selectedWar?.name ?? "");

  React.useEffect(() => {
    let cancelled = false;

    async function loadReportDiscrepancies() {
      if (!selectedWarName || !hasTornReport) {
        setReportDiscrepancies(null);
        return;
      }

      setIsLoadingReportDiscrepancies(true);
      setError(null);

      try {
        const response = await getWarReportDiscrepancies(selectedWarName);
        if (!cancelled) {
          setReportDiscrepancies(response);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) {
          setIsLoadingReportDiscrepancies(false);
        }
      }
    }

    loadReportDiscrepancies();
    return () => {
      cancelled = true;
    };
  }, [hasTornReport, selectedWarName]);

  React.useEffect(() => {
    let cancelled = false;

    async function loadMemberAttacks() {
      if (!selectedWarName || !selectedMember) {
        setMemberAttacks([]);
        return;
      }

      setIsLoadingMemberAttacks(true);
      setError(null);

      try {
        const response = await getWarMemberAttacks(selectedWarName, selectedMember.member_id);
        if (!cancelled) {
          setMemberAttacks(response.attacks);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) {
          setIsLoadingMemberAttacks(false);
        }
      }
    }

    loadMemberAttacks();
    return () => {
      cancelled = true;
    };
  }, [selectedWarName, selectedMember]);

  React.useEffect(() => {
    if (!selectedMember || memberAttacks.length === 0 || isLoadingMemberAttacks) {
      return;
    }

    memberAttackPanelRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, [isLoadingMemberAttacks, memberAttacks.length, selectedMember]);

  const members = sortMembers(warDetail?.members ?? [], memberSort);
  const sortedMemberAttacks = sortMemberAttacks(memberAttacks, memberAttackSort);
  const chainBonuses = warDetail?.chain_bonuses ?? [];
  const derivedRespectGained = detailNumber(
    warDetail?.summary?.total_respect_gain,
    selectedWar?.total_respect_gain,
  );
  const derivedRespectLost = detailNumber(
    warDetail?.summary?.total_respect_lost,
    selectedWar?.total_respect_lost,
  );
  const derivedSuccessfulAttacks = sumMembers(members, "enemy_attacks_successful");
  const officialRespectGained = selectedWar?.official_home_score ?? derivedRespectGained;

  function togglePanel(panel: string) {
    setCollapsedPanels((current) => ({
      ...current,
      [panel]: !current[panel],
    }));
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Buttgrass Inc - test01</p>
          <h1>Torn faction attacks</h1>
        </div>
      </header>

      {error ? <div className="error-panel">{error}</div> : null}

      <div className="dashboard-layout">
        <Sidebar
          warType={warType}
          onWarTypeChange={setWarType}
          view={view}
          onViewChange={setView}
          wars={wars}
          selectedWarName={selectedWarName}
          isLoadingWars={isLoadingWars}
          memberIcon={<BarChart3 size={18} />}
          adminIcon={<Wrench size={18} />}
          onWarSelect={(name) => {
            setSelectedWarName(name);
            setView("war");
          }}
        />

        <section className="main-content">
          {view === "admin" ? (
            <AdminControls />
          ) : view === "members" ? (
            <MembersOverview warType={warType} />
          ) : selectedWar ? (
            <>
              <section className="hero-panel war-hero-panel">
                <div>
                  <p className="eyebrow war-meta-line">
                    <span>{displayWarStatus(selectedWar)}</span>
                  </p>
                  <div className="war-title-row">
                    <h2>
                      {selectedWarTitle.name}
                      {selectedWarTitle.tornWarId ? (
                        <span className="war-title-id">{selectedWarTitle.tornWarId}</span>
                      ) : null}
                    </h2>
                    <span>{formatWarType(selectedWar)}</span>
                  </div>
                  <div className="war-time-lines">
                    <WarTimeLine
                      label="Buttgrass times"
                      value={formatWarDateRange(selectedWar.practical_start_time, selectedWar.practical_finish_time)}
                    />
                    <WarTimeLine
                      label="Torn official times"
                      value={formatWarDateRange(
                        selectedWar.official_start_time ?? selectedWar.practical_start_time,
                        selectedWar.official_end_time,
                      )}
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
                />
              </section>

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
                    <InlineMetric label="Assists" value={sumMembers(members, "enemy_assists")} />
                  </div>
                </section>

                <section className="panel">
                  <PanelHeader title="Chain bonuses" aside="Top 5" />
                  <ChainBonusList attacks={chainBonuses} compact />
                </section>
              </section>

              {hasTornReport ? (
                <>
                  <CollapsiblePanel
                    title="Torn report validation"
                    collapsed={collapsedPanels.reportValidation ?? true}
                    onToggle={() => togglePanel("reportValidation")}
                    className="table-panel"
                  >
                    <p className="panel-description">
                      Compares dashboard-derived attacks and adjusted respect against Torn's official ranked war report.
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
                            <td>-</td>
                            <td>{formatNumber(selectedWar.official_enemy_attacks ?? 0)}</td>
                          </tr>
                          <tr>
                            <td>Enemy score</td>
                            <td>-</td>
                            <td>{formatNumber(selectedWar.official_enemy_score ?? 0)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </CollapsiblePanel>
                  <CollapsiblePanel
                    title="Report discrepancy drilldown"
                    aside={isLoadingReportDiscrepancies ? "Loading" : discrepancyAside(reportDiscrepancies)}
                    collapsed={collapsedPanels.reportDiscrepancies ?? true}
                    onToggle={() => togglePanel("reportDiscrepancies")}
                    className="table-panel"
                  >
                    <p className="panel-description">
                      Breaks down the specific attacks that explain differences between member-performance
                      rules and Torn's official ranked war report.
                    </p>
                    <ReportDiscrepancyPanel response={reportDiscrepancies} />
                  </CollapsiblePanel>
                </>
              ) : null}

              <CollapsiblePanel
                title="Buttgrass attacks over time"
                collapsed={collapsedPanels.factionActivity ?? true}
                onToggle={() => togglePanel("factionActivity")}
                className="activity-panel"
              >
                <p className="panel-description">
                  Shows Buttgrass attack activity across the war window, grouped into successful attacks,
                  assists, and outside hits.
                </p>
                <ActivityChart buckets={activityBuckets} keys={["enemy_success", "enemy_assist", "outside"]} />
              </CollapsiblePanel>

              <CollapsiblePanel
                title={`${selectedWar.name} attacks over time`}
                collapsed={collapsedPanels.enemyActivity ?? true}
                onToggle={() => togglePanel("enemyActivity")}
                className="activity-panel"
              >
                <p className="panel-description">
                  Shows enemy attacks against Buttgrass over time, split by whether the defend was won or lost.
                </p>
                <ActivityChart buckets={activityBuckets} keys={["defend_lost", "defend_won"]} />
              </CollapsiblePanel>

              <CollapsiblePanel
                title="Faction members breakdown"
                collapsed={collapsedPanels.memberBreakdown ?? false}
                onToggle={() => togglePanel("memberBreakdown")}
                className="table-panel"
              >
                <p className="panel-description">
                  Summarises each faction member's war performance, including enemy attacks, outside hits,
                  friendly hosps, defends, and adjusted respect.
                </p>
                <MemberTable
                  members={members}
                  sort={memberSort}
                  onSortChange={setMemberSort}
                  selectedMemberId={selectedMember?.member_id ?? null}
                  onMemberSelect={setSelectedMember}
                />
              </CollapsiblePanel>

              {selectedMember ? (
                <section className="panel table-panel" ref={memberAttackPanelRef}>
                  <PanelHeader
                    title={`${displayMember(selectedMember)} attacks`}
                    aside={isLoadingMemberAttacks ? "Loading" : `${memberAttacks.length} rows`}
                  />
                  <p className="panel-description">
                    Lists this member's individual attacks and defends during the counted war period, with row
                    colour showing how each action was classified.
                  </p>
                  <MemberAttackList
                    attacks={sortedMemberAttacks}
                    sort={memberAttackSort}
                    onSortChange={setMemberAttackSort}
                  />
                </section>
              ) : null}
            </>
          ) : (
            <section className="panel">
              <EmptyState text="No wars to show" />
            </section>
          )}
        </section>
      </div>
    </main>
  );
}

function formatWarType(war: WarSummary): string {
  switch (war.war_type) {
    case "termed":
      return "Termed war";
    case "other":
      return "Other event";
    default:
      return "Real war";
  }
}

function splitGeneratedWarTitle(name: string): { name: string; tornWarId: string | null } {
  const match = /^(.*) (\d{5})$/.exec(name.trim());

  if (!match) {
    return { name, tornWarId: null };
  }

  return {
    name: match[1],
    tornWarId: match[2],
  };
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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);


