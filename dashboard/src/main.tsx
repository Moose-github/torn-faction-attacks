import React from "react";
import ReactDOM from "react-dom/client";
import {
  BarChart3,
  CalendarClock,
  LogIn,
  Pill,
  Radar,
  ShieldCheck,
  Swords,
  Target,
  UserRound,
  Wrench,
} from "lucide-react";
import {
  authenticateTornKey,
  clearStoredAuthSession,
  getWar,
  getWarActivity,
  getWarMemberAttacks,
  getWarReportDiscrepancies,
  getWars,
  AuthSession,
  getStoredAuthSession,
  refreshAuthSession,
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
import { LifestyleStats } from "./views/LifestyleStats";
import { MembersOverview } from "./views/MembersOverview";
import { WarRoom } from "./views/WarRoom";
import {
  detailNumber,
  formatLongDateTime,
  formatNumber,
  formatWarDateRange,
} from "./utils/format";
import { downloadCsv, sanitizeCsvFilename } from "./utils/csv";
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

const ACTIVE_WAR_REFRESH_MS = 60_000;
const SLOW_WAR_REFRESH_MS = 5 * 60_000;

function App() {
  const [warType, setWarType] = React.useState<WarType>("all");
  const [view, setView] = React.useState<"war" | "warRoom" | "members" | "lifestyle" | "admin">("war");
  const [authSession, setAuthSession] = React.useState<AuthSession | null>(() =>
    getStoredAuthSession(),
  );
  const [wars, setWars] = React.useState<WarSummary[]>([]);
  const [selectedWarName, setSelectedWarName] = React.useState<string | null>(null);
  const [warDetail, setWarDetail] = React.useState<WarDetailResponse | null>(null);
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
  const [factionActivityWindow, setFactionActivityWindow] = React.useState<"practical" | "official">("practical");
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

    async function refreshSession() {
      const session = await refreshAuthSession();
      if (!cancelled) {
        setAuthSession(session ?? getStoredAuthSession());
      }
    }

    refreshSession();
    return () => {
      cancelled = true;
    };
  }, [view]);

  React.useEffect(() => {
  let cancelled = false;

  async function loadWars() {
    if (!authSession) {
      setWars([]);
      setSelectedWarName(null);
      setIsLoadingWars(false);
      return;
    }

    setIsLoadingWars(true);
    setError(null);

    try {
      const warsResponse = await getWars(warType);

      if (cancelled) return;

      setWars(warsResponse.wars);

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
}, [authSession, warType]);

  React.useEffect(() => {
  let cancelled = false;

  async function loadWarDetail() {
    if (!authSession || !selectedWarName) {
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
}, [authSession, selectedWarName]);

  React.useEffect(() => {
    setSelectedMember(null);
    setMemberAttacks([]);
    setActivityBuckets([]);
}, [selectedWarName]);

  const selectedWar = warDetail?.war ?? wars.find((war) => war.name === selectedWarName) ?? null;
  const hasTornReport = Boolean(selectedWar?.torn_report_fetched_at);
  const isAdmin = authSession?.access_level === "admin";
  const isActivityPanelOpen =
    collapsedPanels.factionActivity === false || collapsedPanels.enemyActivity === false;

  React.useEffect(() => {
    if (!authSession || view !== "war" || !selectedWarName || !selectedWar || !isActivityPanelOpen) {
      return;
    }

    let cancelled = false;
    const activityWarName = selectedWarName;

    async function loadActivity() {
      setIsLoadingActivity(true);
      setError(null);

      try {
        const response = await getWarActivity(activityWarName, factionActivityWindow);
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

    if (selectedWar.official_end_time !== null || selectedWar.status === "ended") {
      return () => {
        cancelled = true;
      };
    }

    const timer = window.setInterval(loadActivity, SLOW_WAR_REFRESH_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    authSession,
    factionActivityWindow,
    isActivityPanelOpen,
    selectedWar?.official_end_time,
    selectedWar?.status,
    selectedWarName,
    view,
  ]);

  React.useEffect(() => {
    if (view === "admin" && !isAdmin) {
      setView("war");
    }
  }, [isAdmin, view]);

  React.useEffect(() => {
    const termedOnlySorts = ["average_fair_fight", "member_respect_limit_percent"];
    const hiddenTermedSorts = ["outside_attacks"];
    if (
      (selectedWar?.war_type !== "termed" && termedOnlySorts.includes(memberSort.key)) ||
      (selectedWar?.war_type === "termed" && hiddenTermedSorts.includes(memberSort.key))
    ) {
      setMemberSort({ key: "enemy_attacks_successful", direction: "desc" });
    }
  }, [memberSort.key, selectedWar?.war_type]);

  React.useEffect(() => {
    if (!authSession || view !== "war" || !selectedWarName || !selectedWar) {
      return;
    }

    const refreshMs = warPageRefreshInterval(selectedWar);
    if (refreshMs === null) {
      return;
    }

    let cancelled = false;
    const timer = window.setInterval(async () => {
      try {
        const [warsResponse, detailResponse] = await Promise.all([
          getWars(warType),
          getWar(selectedWarName),
        ]);

        if (cancelled) {
          return;
        }

        setWars(warsResponse.wars);
        setWarDetail(detailResponse);

        if (detailResponse.war.torn_report_fetched_at) {
          const discrepancies = await getWarReportDiscrepancies(selectedWarName);
          if (!cancelled) {
            setReportDiscrepancies(discrepancies);
          }
        } else {
          setReportDiscrepancies(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    }, refreshMs);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    selectedWar?.official_end_time,
    selectedWar?.practical_finish_time,
    selectedWar?.status,
    selectedWar?.war_type,
    selectedWarName,
    view,
    warType,
    authSession,
  ]);

  React.useEffect(() => {
    let cancelled = false;

    async function loadReportDiscrepancies() {
      if (!authSession || !selectedWarName || !hasTornReport) {
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
  }, [authSession, hasTornReport, selectedWarName]);

  React.useEffect(() => {
    let cancelled = false;

    async function loadMemberAttacks() {
      if (!authSession || !selectedWarName || !selectedMember) {
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
  }, [authSession, selectedWarName, selectedMember]);

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
  const memberActionTotal =
    derivedSuccessfulAttacks +
    sumMembers(members, "enemy_assists") +
    sumMembers(members, "outside_attacks") +
    sumMembers(members, "friendly_hospitals") +
    sumMembers(members, "defends_total");
  const hasWarData =
    selectedWar !== null &&
    selectedWar.status !== "scheduled" &&
    (memberActionTotal > 0 ||
      officialRespectGained > 0 ||
      derivedRespectGained > 0 ||
      derivedRespectLost > 0 ||
      chainBonuses.length > 0 ||
      hasTornReport);
  const showFactionActivity = hasWarData;
  const showEnemyActivity = hasWarData;
  const showMemberBreakdown = hasWarData && memberActionTotal > 0;
  const isScheduledWar = selectedWar?.status === "scheduled";

  function togglePanel(panel: string) {
    setCollapsedPanels((current) => ({
      ...current,
      [panel]: !current[panel],
    }));
  }

  function changeView(nextView: "war" | "warRoom" | "members" | "lifestyle" | "admin") {
    if (nextView === "admin" && !isAdmin) {
      return;
    }

    if (nextView === "warRoom" && wars[0]) {
      setSelectedWarName(wars[0].name);
    }

    setView(nextView);
  }

  function signOut() {
    clearStoredAuthSession();
    setAuthSession(null);
    setView("war");
    setError(null);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Buttgrass Inc</p>
          <h1>Buttgrass Dashboard</h1>
        </div>
        <div className="topbar-actions">
          {authSession ? (
            <>
              <span
                className="access-level-pill"
                title={`Signed in as ${authSession.access_level}`}
                aria-label={`Signed in as ${authSession.access_level}`}
              >
                {isAdmin ? <ShieldCheck size={15} /> : <UserRound size={15} />}
                {isAdmin ? "Admin" : "Member"}
              </span>
              <button type="button" className="panel-action-button" onClick={signOut}>
                Sign out
              </button>
            </>
          ) : null}
          <RefreshCountdowns />
        </div>
      </header>

      {error ? <div className="error-panel">{error}</div> : null}

      {!authSession ? (
        <MemberSignIn
          onSignedIn={(session) => {
            setAuthSession(session);
            setError(null);
          }}
        />
      ) : (

      <div className="dashboard-layout">
        <Sidebar
          warType={warType}
          onWarTypeChange={setWarType}
          view={view}
          onViewChange={changeView}
          wars={wars}
          selectedWarName={selectedWarName}
          isLoadingWars={isLoadingWars}
          warRoomIcon={<Radar size={18} />}
          memberIcon={<BarChart3 size={18} />}
          lifestyleIcon={<Pill size={18} />}
          adminIcon={<Wrench size={18} />}
          isAdmin={isAdmin}
          onWarSelect={(name) => {
            setSelectedWarName(name);
            setView("war");
          }}
        />

        <section className="main-content">
          {view === "admin" ? (
            <AdminControls />
          ) : view === "lifestyle" ? (
            <LifestyleStats isAdmin={isAdmin} />
          ) : view === "members" ? (
            <MembersOverview isAdmin={isAdmin} />
          ) : view === "warRoom" ? (
            <WarRoom selectedWar={selectedWar} selectedWarName={selectedWarName} onError={setError} />
          ) : selectedWar ? (
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
                  />
                </section>
              ) : null}

              {!hasWarData ? (
                <UpcomingWarEmptyPanel
                  war={selectedWar}
                  onOpenWarRoom={() => changeView("warRoom")}
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
                      <InlineMetric label="Assists" value={sumMembers(members, "enemy_assists")} />
                      <InlineMetric label="Retaliations" value={sumMembers(members, "enemy_retaliations")} />
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
                <>
                  <CollapsiblePanel
                    title="Torn report validation"
                    collapsed={collapsedPanels.reportValidation ?? true}
                    onToggle={() => togglePanel("reportValidation")}
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
                    title="Report discrepancy breakdown"
                    aside={isLoadingReportDiscrepancies ? "Loading" : discrepancyAside(reportDiscrepancies)}
                    collapsed={collapsedPanels.reportDiscrepancies ?? true}
                    onToggle={() => togglePanel("reportDiscrepancies")}
                    className="table-panel"
                  >
                    <p className="panel-description">
                      Breaks down attack and respect adjustments behind differences from Torn's official ranked war report.
                    </p>
                    <ReportDiscrepancyPanel response={reportDiscrepancies} />
                  </CollapsiblePanel>
                </>
              ) : null}

              {showFactionActivity ? (
                <CollapsiblePanel
                  title="Buttgrass attacks over time"
                  aside={isLoadingActivity && collapsedPanels.factionActivity === false ? "Loading" : undefined}
                  collapsed={collapsedPanels.factionActivity ?? true}
                  onToggle={() => togglePanel("factionActivity")}
                  className="activity-panel"
                >
                  <div className="panel-toggle-row" aria-label="Buttgrass activity time range">
                    <button
                      type="button"
                      className={factionActivityWindow === "practical" ? "toggle-chip active" : "toggle-chip"}
                      onClick={() => setFactionActivityWindow("practical")}
                    >
                      Practical
                    </button>
                    <button
                      type="button"
                      className={factionActivityWindow === "official" ? "toggle-chip active" : "toggle-chip"}
                      onClick={() => setFactionActivityWindow("official")}
                    >
                      Official
                    </button>
                  </div>
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
                  onToggle={() => togglePanel("enemyActivity")}
                  className="activity-panel"
                >
                  <p className="panel-description">
                    Shows enemy attacks against Buttgrass over time, split by whether the defend was won or lost.
                  </p>
                  <ActivityChart buckets={activityBuckets} keys={["defend_lost", "defend_won"]} />
                </CollapsiblePanel>
              ) : null}

              {showMemberBreakdown ? (
                <CollapsiblePanel
                  title="Faction members breakdown"
                  collapsed={collapsedPanels.memberBreakdown ?? false}
                  onToggle={() => togglePanel("memberBreakdown")}
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
                    onSortChange={setMemberSort}
                    showTermedColumns={selectedWar.war_type === "termed"}
                    selectedMemberId={selectedMember?.member_id ?? null}
                    onMemberSelect={setSelectedMember}
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
      )}
    </main>
  );
}

function MemberSignIn({ onSignedIn }: { onSignedIn: (session: AuthSession) => void }) {
  const [key, setKey] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [isSigningIn, setIsSigningIn] = React.useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSigningIn(true);

    try {
      onSignedIn(await authenticateTornKey(key));
      setKey("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSigningIn(false);
    }
  }

  return (
    <section className="panel auth-panel">
      <PanelHeader title="Faction sign in" />
      <form className="auth-form" onSubmit={handleSubmit}>
        <label>
          <span>Torn API key</span>
          <input
            type="password"
            value={key}
            autoComplete="off"
            onChange={(event) => setKey(event.target.value)}
            placeholder="Paste your Torn key"
          />
        </label>
        <button type="submit" className="icon-text-button" disabled={isSigningIn || key.trim().length === 0}>
          <LogIn size={15} />
          {isSigningIn ? "Signing in" : "Sign in"}
        </button>
      </form>
      {error ? <p className="form-error">{error}</p> : null}
    </section>
  );
}

function formatWarType(war: WarSummary): string {
  switch (war.war_type) {
    case "termed":
      return "Termed war";
    case "event":
      return "Event";
    default:
      return "Real war";
  }
}

function warPageRefreshInterval(war: WarSummary): number | null {
  if (war.official_end_time !== null || war.status === "ended") {
    return null;
  }

  if (war.status === "scheduled") {
    return SLOW_WAR_REFRESH_MS;
  }

  if (war.war_type === "termed" && war.practical_finish_time !== null) {
    return SLOW_WAR_REFRESH_MS;
  }

  if (war.status === "active") {
    return ACTIVE_WAR_REFRESH_MS;
  }

  return null;
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
        { label: "Member name", value: (member) => displayMember(member) },
        { label: "Member ID", value: (member) => member.member_id },
        { label: "Attacks", value: (member) => member.enemy_attacks_successful },
        { label: "Defends", value: (member) => member.defends_total },
        { label: "Respect gained", value: (member) => formatCsvDecimal(member.enemy_respect_gained) },
        { label: "Assists", value: (member) => member.enemy_assists },
        { label: "Average fair fight", value: (member) => formatCsvDecimal(member.average_fair_fight) },
        { label: "Percent limit", value: (member) => formatCsvDecimal(member.member_respect_limit_percent) },
      ]
    : [
        { label: "Member name", value: (member) => displayMember(member) },
        { label: "Member ID", value: (member) => member.member_id },
        { label: "Attacks", value: (member) => member.enemy_attacks_successful },
        { label: "Defends", value: (member) => member.defends_total },
        { label: "Respect gained", value: (member) => formatCsvDecimal(member.enemy_respect_gained) },
        { label: "Assists", value: (member) => member.enemy_assists },
        { label: "Average fair fight", value: (member) => formatCsvDecimal(member.average_fair_fight) },
        { label: "Friendly hosps", value: (member) => member.friendly_hospitals },
        { label: "Retaliations", value: (member) => member.enemy_retaliations },
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

function RefreshCountdowns() {
  const now = useCurrentTime();

  return (
    <div className="refresh-countdowns" aria-label="Refresh countdowns">
      <CountdownPill label="5 min" value={formatCountdown(nextBoundaryMs(now, 5))} />
      <CountdownPill label="15 min" value={formatCountdown(nextBoundaryMs(now, 15))} />
    </div>
  );
}

function CountdownPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="countdown-pill" title={`Next ${label} refresh`}>
      <strong>{value}</strong>
    </div>
  );
}

function useCurrentTime(): number {
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return now;
}

function nextBoundaryMs(now: number, intervalMinutes: number): number {
  const intervalMs = intervalMinutes * 60 * 1000;
  return intervalMs - (now % intervalMs);
}

function formatCountdown(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatDuration(totalSeconds: number): string {
  if (totalSeconds <= 0) {
    return "Started";
  }

  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  }

  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);



