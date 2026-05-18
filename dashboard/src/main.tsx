import React from "react";
import ReactDOM from "react-dom/client";
import {
  BarChart3,
  Dices,
  LogIn,
  Pill,
  Radar,
  ShieldCheck,
  Target,
  UserRound,
  Wrench,
} from "lucide-react";
import {
  authenticateTornKey,
  clearStoredAuthSession,
  getWar,
  getWarActivity,
  getWarChainBonuses,
  getWarMemberActivityHeatmap,
  getWarMemberAttacks,
  getWarReportDiscrepancies,
  getWars,
  AuthSession,
  getStoredAuthSession,
  refreshAuthSession,
  MemberAttack,
  ChainBonusAttack,
  MemberStats,
  ReportDiscrepanciesResponse,
  WarDetailResponse,
  WarActivityBucket,
  WarMemberActivityHeatmapResponse,
  WarSummary,
  WarType,
} from "./api";
import {
  EmptyState,
  PanelHeader,
} from "./components/Common";
import { Sidebar } from "./components/Sidebar";
import { MembersOverview } from "./views/MembersOverview";
import { WarDetailView } from "./views/WarDetailView";
import { WarRoom } from "./views/WarRoom";
import {
  MemberAttackSort,
  MemberSort,
} from "./utils/members";
import "./styles.css";

const ACTIVE_WAR_REFRESH_MS = 5 * 60_000;
const SLOW_WAR_REFRESH_MS = 5 * 60_000;
const PRACTICAL_FINISH_REFRESH_MS = 15 * 60_000;
const CHAIN_BONUS_REFRESH_MS = 15 * 60_000;

const AdminControls = React.lazy(() =>
  import("./views/AdminControls").then((module) => ({ default: module.AdminControls })),
);
const DiceGame = React.lazy(() =>
  import("./views/DiceGame").then((module) => ({ default: module.DiceGame })),
);
const LifestyleStats = React.lazy(() =>
  import("./views/LifestyleStats").then((module) => ({ default: module.LifestyleStats })),
);
const Miscellaneous = React.lazy(() =>
  import("./views/Miscellaneous").then((module) => ({ default: module.Miscellaneous })),
);

function App() {
  const [warType, setWarType] = React.useState<WarType>("all");
  const [view, setView] = React.useState<"war" | "warRoom" | "members" | "lifestyle" | "miscellaneous" | "diceGame" | "admin">("war");
  const [authSession, setAuthSession] = React.useState<AuthSession | null>(() =>
    getStoredAuthSession(),
  );
  const [wars, setWars] = React.useState<WarSummary[]>([]);
  const [selectedWarName, setSelectedWarName] = React.useState<string | null>(null);
  const [warDetail, setWarDetail] = React.useState<WarDetailResponse | null>(null);
  const [chainBonuses, setChainBonuses] = React.useState<ChainBonusAttack[]>([]);
  const [memberSort, setMemberSort] = React.useState<MemberSort>({
    key: "attacks_vs_enemy_successful",
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
  const [memberActivityHeatmap, setMemberActivityHeatmap] =
    React.useState<WarMemberActivityHeatmapResponse | null>(null);
  const [isLoadingMemberActivityHeatmap, setIsLoadingMemberActivityHeatmap] = React.useState(false);
  const [reportDiscrepancies, setReportDiscrepancies] = React.useState<ReportDiscrepanciesResponse | null>(null);
  const [isLoadingReportDiscrepancies, setIsLoadingReportDiscrepancies] = React.useState(false);
  const [collapsedPanels, setCollapsedPanels] = React.useState<Record<string, boolean>>({});
  const [selectedMember, setSelectedMember] = React.useState<MemberStats | null>(null);
  const [memberAttacks, setMemberAttacks] = React.useState<MemberAttack[]>([]);
  const [isLoadingMemberAttacks, setIsLoadingMemberAttacks] = React.useState(false);

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
    setChainBonuses([]);
}, [selectedWarName]);

  const selectedWar = warDetail?.war ?? wars.find((war) => war.name === selectedWarName) ?? null;
  const hasTornReport = Boolean(selectedWar?.torn_report_fetched_at);
  const isAdmin = authSession?.access_level === "admin";
  const isActivityPanelOpen =
    collapsedPanels.factionActivity === false || collapsedPanels.enemyActivity === false;
  const isMemberActivityPanelOpen = collapsedPanels.memberActivityHeatmap === false;
  const isReportValidationOpen = collapsedPanels.reportValidation === false;

  React.useEffect(() => {
    if (!authSession || view !== "war" || !selectedWarName || !selectedWar) {
      setChainBonuses([]);
      return;
    }

    let cancelled = false;
    const chainBonusWarName = selectedWarName;

    async function loadChainBonuses() {
      try {
        const response = await getWarChainBonuses(chainBonusWarName);
        if (!cancelled) {
          setChainBonuses(Array.isArray(response.chain_bonuses) ? response.chain_bonuses : []);
        }
      } catch {
        if (!cancelled) {
          setChainBonuses([]);
        }
      }
    }

    loadChainBonuses();

    if (selectedWar.official_end_time !== null || selectedWar.status === "ended") {
      return () => {
        cancelled = true;
      };
    }

    const timer = window.setInterval(loadChainBonuses, CHAIN_BONUS_REFRESH_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    authSession,
    selectedWar?.official_end_time,
    selectedWar?.status,
    selectedWarName,
    view,
  ]);

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

    const refreshMs = warSecondaryPanelRefreshInterval(selectedWar);
    const timer = window.setInterval(loadActivity, refreshMs);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    authSession,
    factionActivityWindow,
    isActivityPanelOpen,
    selectedWar?.official_end_time,
    selectedWar?.practical_finish_time,
    selectedWar?.status,
    selectedWarName,
    view,
  ]);

  React.useEffect(() => {
    if (!authSession || view !== "war" || !selectedWarName || !selectedWar || !isMemberActivityPanelOpen) {
      setMemberActivityHeatmap(null);
      return;
    }

    let cancelled = false;
    const heatmapWarName = selectedWarName;

    async function loadMemberActivityHeatmap() {
      setIsLoadingMemberActivityHeatmap(true);
      setError(null);

      try {
        const response = await getWarMemberActivityHeatmap(heatmapWarName);
        if (!cancelled) {
          setMemberActivityHeatmap(response);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setMemberActivityHeatmap(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingMemberActivityHeatmap(false);
        }
      }
    }

    loadMemberActivityHeatmap();

    if (selectedWar.official_end_time !== null || selectedWar.status === "ended") {
      return () => {
        cancelled = true;
      };
    }

    const refreshMs = warSecondaryPanelRefreshInterval(selectedWar);
    const timer = window.setInterval(loadMemberActivityHeatmap, refreshMs);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    authSession,
    isMemberActivityPanelOpen,
    selectedWar?.official_end_time,
    selectedWar?.practical_finish_time,
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
    const hiddenTermedSorts = ["outside_hits"];
    if (
      (selectedWar?.war_type !== "termed" && termedOnlySorts.includes(memberSort.key)) ||
      (selectedWar?.war_type === "termed" && hiddenTermedSorts.includes(memberSort.key))
    ) {
      setMemberSort({ key: "attacks_vs_enemy_successful", direction: "desc" });
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

        if (detailResponse.war.torn_report_fetched_at && isReportValidationOpen) {
          const discrepancies = await getWarReportDiscrepancies(selectedWarName);
          if (!cancelled) {
            setReportDiscrepancies(discrepancies);
          }
        } else if (!detailResponse.war.torn_report_fetched_at) {
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
    isReportValidationOpen,
  ]);

  React.useEffect(() => {
    let cancelled = false;

    async function loadReportDiscrepancies() {
      if (!authSession || !selectedWarName || !hasTornReport || !isReportValidationOpen) {
        if (!hasTornReport) {
          setReportDiscrepancies(null);
        }
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
  }, [authSession, hasTornReport, isReportValidationOpen, selectedWarName]);

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

  function togglePanel(panel: string) {
    setCollapsedPanels((current) => ({
      ...current,
      [panel]: !current[panel],
    }));
  }

  function changeView(nextView: "war" | "warRoom" | "members" | "lifestyle" | "miscellaneous" | "diceGame" | "admin") {
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
          miscIcon={<Target size={18} />}
          diceGameIcon={<Dices size={18} />}
          adminIcon={<Wrench size={18} />}
          isAdmin={isAdmin}
          onWarSelect={(name) => {
            setSelectedWarName(name);
            setView("war");
          }}
        />

        <section className="main-content">
          {view === "admin" ? (
            <LazyPage>
              <AdminControls />
            </LazyPage>
          ) : view === "diceGame" ? (
            <LazyPage>
              <DiceGame />
            </LazyPage>
          ) : view === "lifestyle" ? (
            <LazyPage>
              <LifestyleStats isAdmin={isAdmin} />
            </LazyPage>
          ) : view === "miscellaneous" ? (
            <LazyPage>
              <Miscellaneous />
            </LazyPage>
          ) : view === "members" ? (
            <MembersOverview isAdmin={isAdmin} />
          ) : view === "warRoom" ? (
            <WarRoom selectedWar={selectedWar} selectedWarName={selectedWarName} onError={setError} />
          ) : selectedWar ? (
            <WarDetailView
              activityBuckets={activityBuckets}
              chainBonuses={chainBonuses}
              collapsedPanels={collapsedPanels}
              factionActivityWindow={factionActivityWindow}
              isAdmin={isAdmin}
              isLoadingActivity={isLoadingActivity}
              isLoadingDetail={isLoadingDetail}
              isLoadingMemberActivityHeatmap={isLoadingMemberActivityHeatmap}
              isLoadingMemberAttacks={isLoadingMemberAttacks}
              isLoadingReportDiscrepancies={isLoadingReportDiscrepancies}
              memberActivityHeatmap={memberActivityHeatmap}
              memberAttackSort={memberAttackSort}
              memberAttacks={memberAttacks}
              memberSort={memberSort}
              onMemberActivityWindowChange={setFactionActivityWindow}
              onMemberAttackSortChange={setMemberAttackSort}
              onMemberSelect={setSelectedMember}
              onMemberSortChange={setMemberSort}
              onOpenWarRoom={() => changeView("warRoom")}
              onTogglePanel={togglePanel}
              reportDiscrepancies={reportDiscrepancies}
              selectedMember={selectedMember}
              selectedWar={selectedWar}
              warDetail={warDetail}
            />          ) : (
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

function LazyPage({ children }: { children: React.ReactNode }) {
  return (
    <React.Suspense fallback={<EmptyState text="Loading page" />}>
      {children}
    </React.Suspense>
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
      <ApiKeyUseNotice />
    </section>
  );
}

function ApiKeyUseNotice() {
  return (
    <section className="api-key-use-notice" aria-label="Torn API key use">
      <h2>Torn API key use</h2>
      <dl>
        <div>
          <dt>Data storage</dt>
          <dd>Temporary auth session for 12 hours.</dd>
        </div>
        <div>
          <dt>Data sharing</dt>
          <dd>Nobody. Your submitted key is sent only to Torn for sign-in validation.</dd>
        </div>
        <div>
          <dt>Purpose of use</dt>
          <dd>Verify your Torn identity, faction membership, and access level.</dd>
        </div>
        <div>
          <dt>Key storage</dt>
          <dd>Not stored. The app creates a temporary session token after successful sign-in.</dd>
        </div>
        <div>
          <dt>Key access level</dt>
          <dd>Public access is enough for everything.</dd>
        </div>
      </dl>
    </section>
  );
}

function warPageRefreshInterval(war: WarSummary): number | null {
  if (war.official_end_time !== null || war.status === "ended") {
    return null;
  }

  if (war.status === "scheduled") {
    return SLOW_WAR_REFRESH_MS;
  }

  if (war.practical_finish_time !== null) {
    return PRACTICAL_FINISH_REFRESH_MS;
  }

  if (war.status === "active") {
    return ACTIVE_WAR_REFRESH_MS;
  }

  return null;
}

function warSecondaryPanelRefreshInterval(war: WarSummary): number {
  return war.practical_finish_time !== null ? PRACTICAL_FINISH_REFRESH_MS : SLOW_WAR_REFRESH_MS;
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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);



