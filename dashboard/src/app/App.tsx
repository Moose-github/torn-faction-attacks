import React from "react";
import {
  BarChart3,
  CircleDollarSign,
  Dices,
  Gauge,
  House,
  LogIn,
  Moon,
  Pill,
  Radar,
  ShoppingCart,
  ShieldCheck,
  Settings as SettingsIcon,
  Sun,
  Target,
  TrendingUp,
  UserRound,
  Wrench,
} from "lucide-react";
import {
  authenticateTornKey,
  clearStoredAuthSession,
  getWar,
  getWarActivity,
  getWarChainBonuses,
  getWarMemberCombatHeatmap,
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
  WarMemberCombatHeatmapResponse,
  type GlobalWarState,
  WarSummary,
  WarType,
} from "../api";
import {
  EmptyState,
  PanelHeader,
} from "../components/Common";
import { Sidebar } from "../components/Sidebar";
import { DashboardHome } from "../views/DashboardHome";
import {
  MemberAttackSort,
  MemberSort,
} from "../utils/members";
import {
  isAdminOnlyView,
  parseAppRoute,
  pathForView,
} from "../routes";
import {
  initialThemeMode,
  persistThemeMode,
  type ThemeMode,
} from "./theme";
import { useCurrentTimeMs } from "../utils/time";
import type { AppView } from "../routes";

const ACTIVE_WAR_REFRESH_MS = 60_000;
const SLOW_WAR_REFRESH_MS = 5 * 60_000;
const PRACTICAL_FINISH_REFRESH_MS = 15 * 60_000;

const AdminControls = React.lazy(() =>
  import("../views/AdminControls").then((module) => ({ default: module.AdminControls })),
);
const DiceGame = React.lazy(() =>
  import("../views/DiceGame").then((module) => ({ default: module.DiceGame })),
);
const DataHealthPage = React.lazy(() =>
  import("../views/DataHealthCommandCenter").then((module) => ({ default: module.DataHealthPage })),
);
const LifestyleStats = React.lazy(() =>
  import("../views/LifestyleStats").then((module) => ({ default: module.LifestyleStats })),
);
const MembersOverview = React.lazy(() =>
  import("../views/MembersOverview").then((module) => ({ default: module.MembersOverview })),
);
const Miscellaneous = React.lazy(() =>
  import("../views/Miscellaneous").then((module) => ({ default: module.Miscellaneous })),
);
const SettingsPage = React.lazy(() =>
  import("../views/Settings").then((module) => ({ default: module.Settings })),
);
const StockMarketStatus = React.lazy(() =>
  import("../views/StockMarketStatus").then((module) => ({ default: module.StockMarketStatus })),
);
const StockInvestments = React.lazy(() =>
  import("../views/StockInvestments").then((module) => ({ default: module.StockInvestments })),
);
const TradeScout = React.lazy(() =>
  import("../views/TradeScout").then((module) => ({ default: module.TradeScout })),
);
const ArrestScout = React.lazy(() =>
  import("../views/ArrestScout").then((module) => ({ default: module.ArrestScout })),
);
const WarPayouts = React.lazy(() =>
  import("../views/WarPayouts").then((module) => ({ default: module.WarPayouts })),
);
const EnemyHospitalMonitor = React.lazy(() =>
  import("../views/EnemyHospitalMonitor").then((module) => ({ default: module.EnemyHospitalMonitor })),
);
const WarDetailView = React.lazy(() =>
  import("../views/WarDetailView").then((module) => ({ default: module.WarDetailView })),
);
const WarRoom = React.lazy(() =>
  import("../views/WarRoom").then((module) => ({ default: module.WarRoom })),
);

export function App() {
  const initialRoute = React.useMemo(() => parseAppRoute(window.location.pathname), []);
  const [themeMode, setThemeMode] = React.useState<ThemeMode>(() => initialThemeMode());
  const [warType, setWarType] = React.useState<WarType>("all");
  const [view, setView] = React.useState<AppView>(initialRoute.view);
  const [routedWarName, setRoutedWarName] = React.useState<string | null>(initialRoute.warName);
  const [authSession, setAuthSession] = React.useState<AuthSession | null>(() =>
    getStoredAuthSession(),
  );
  const [wars, setWars] = React.useState<WarSummary[]>([]);
  const [warState, setWarState] = React.useState<GlobalWarState>("none");
  const [activeWarId, setActiveWarId] = React.useState<number | null>(null);
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
  const [memberCombatHeatmap, setMemberCombatHeatmap] =
    React.useState<WarMemberCombatHeatmapResponse | null>(null);
  const [isLoadingMemberCombatHeatmap, setIsLoadingMemberCombatHeatmap] = React.useState(false);
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
    persistThemeMode(themeMode);
  }, [themeMode]);

  React.useEffect(() => {
    function applyBrowserRoute() {
      const route = parseAppRoute(window.location.pathname);
      setView(route.view);
      setRoutedWarName(route.warName);
      if (route.view === "war" && route.warName) {
        setSelectedWarName(route.warName);
      }
    }

    window.addEventListener("popstate", applyBrowserRoute);
    return () => {
      window.removeEventListener("popstate", applyBrowserRoute);
    };
  }, []);

  React.useEffect(() => {
  let cancelled = false;

  async function loadWars() {
    if (!authSession) {
      setWars([]);
      setWarState("none");
      setActiveWarId(null);
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
      setWarState(warsResponse.war_state);
      setActiveWarId(warsResponse.active_war_id);

      setSelectedWarName((currentSelectedWarName) => {
        if (routedWarName && warsResponse.wars.some((war) => war.name === routedWarName)) {
          return routedWarName;
        }

        const selectedStillVisible = warsResponse.wars.some(
          (war) => war.name === currentSelectedWarName,
        );

        return selectedStillVisible
          ? currentSelectedWarName
          : preferredWarName(warsResponse.wars, warsResponse.active_war_id) ??
            warsResponse.wars[0]?.name ??
            null;
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
}, [authSession, routedWarName, warType]);

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
    setReportDiscrepancies(null);
}, [selectedWarName]);

  const selectedWar = warDetail?.war ?? wars.find((war) => war.name === selectedWarName) ?? null;
  const activeWar = findGlobalWar(wars, selectedWar, activeWarId, warState === "current");
  const hasTornReport = Boolean(selectedWar?.torn_report_fetched_at);
  const isAdmin = authSession?.access_level === "admin";
  const isActivityPanelOpen =
    collapsedPanels.factionActivity === false || collapsedPanels.enemyActivity === false;
  const isMemberCombatPanelOpen = collapsedPanels.memberCombatHeatmap === false;
  const isReportValidationPanelOpen = collapsedPanels.reportValidation === false;
  const isReportDiscrepancyPanelOpen = collapsedPanels.reportDiscrepancies === false;
  const shouldLoadReportDiscrepancies =
    isReportValidationPanelOpen || isReportDiscrepancyPanelOpen;

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

    const timer = window.setInterval(loadChainBonuses, warSecondaryPanelRefreshInterval(selectedWar));

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
    if (!authSession || view !== "war" || !selectedWarName || !selectedWar || !isMemberCombatPanelOpen) {
      setMemberCombatHeatmap(null);
      return;
    }

    let cancelled = false;
    const heatmapWarName = selectedWarName;

    async function loadMemberCombatHeatmap() {
      setIsLoadingMemberCombatHeatmap(true);
      setError(null);

      try {
        const response = await getWarMemberCombatHeatmap(heatmapWarName);
        if (!cancelled) {
          setMemberCombatHeatmap(response);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setMemberCombatHeatmap(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingMemberCombatHeatmap(false);
        }
      }
    }

    loadMemberCombatHeatmap();

    if (selectedWar.official_end_time !== null || selectedWar.status === "ended") {
      return () => {
        cancelled = true;
      };
    }

    const refreshMs = warMemberCombatHeatmapRefreshInterval(selectedWar);
    const timer = window.setInterval(loadMemberCombatHeatmap, refreshMs);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    authSession,
    isMemberCombatPanelOpen,
    selectedWar?.official_end_time,
    selectedWar?.practical_finish_time,
    selectedWar?.status,
    selectedWarName,
    view,
  ]);

  React.useEffect(() => {
    if (isAdminOnlyView(view) && !isAdmin) {
      goToPath(pathForView("dashboard"), true);
      setView("dashboard");
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

    const refreshMs = warPageRefreshInterval(selectedWar, activeWarId, warState);
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
        setWarState(warsResponse.war_state);
        setActiveWarId(warsResponse.active_war_id);
        setWarDetail(detailResponse);

        if (detailResponse.war.torn_report_fetched_at && shouldLoadReportDiscrepancies) {
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
    activeWarId,
    selectedWar?.official_end_time,
    selectedWar?.practical_finish_time,
    selectedWar?.status,
    selectedWar?.war_type,
    selectedWarName,
    view,
    warType,
    authSession,
    shouldLoadReportDiscrepancies,
    warState,
  ]);

  React.useEffect(() => {
    let cancelled = false;

    async function loadReportDiscrepancies() {
      if (!authSession || !selectedWarName || !hasTornReport || !shouldLoadReportDiscrepancies) {
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
  }, [authSession, hasTornReport, shouldLoadReportDiscrepancies, selectedWarName]);

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
    const refreshMs = isGlobalCurrentWar(selectedWar, activeWarId, warState) ? ACTIVE_WAR_REFRESH_MS : null;
    if (refreshMs === null) {
      return () => {
        cancelled = true;
      };
    }

    const timer = window.setInterval(loadMemberAttacks, refreshMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeWarId, authSession, selectedMember, selectedWar?.id, selectedWarName, warState]);

  function togglePanel(panel: string) {
    setCollapsedPanels((current) => ({
      ...current,
      [panel]: !current[panel],
    }));
  }

  function goToPath(path: string, replace = false) {
    if (window.location.pathname === path) {
      return;
    }

    if (replace) {
      window.history.replaceState(null, "", path);
    } else {
      window.history.pushState(null, "", path);
    }
  }

  function changeView(nextView: AppView) {
    if (isAdminOnlyView(nextView) && !isAdmin) {
      return;
    }

    if ((nextView === "dashboard" || nextView === "warRoom") && wars[0]) {
      setSelectedWarName(preferredWarName(wars, activeWarId) ?? wars[0].name);
    }

    setRoutedWarName(null);
    setView(nextView);
    goToPath(pathForView(nextView, nextView === "war" ? selectedWarName : null));
  }

  function selectWar(name: string) {
    setRoutedWarName(name);
    setSelectedWarName(name);
    setView("war");
    goToPath(pathForView("war", name));
  }

  function signOut() {
    clearStoredAuthSession();
    setAuthSession(null);
    setView("dashboard");
    setRoutedWarName(null);
    goToPath(pathForView("dashboard"), true);
    setError(null);
  }

  return (
    <main className={authSession ? "app-shell" : "app-shell app-shell-auth"}>
      <header className="topbar">
        <div>
          <p className="eyebrow">Buttgrass Inc</p>
          <h1>Buttgrass Dashboard</h1>
        </div>
        <div className="topbar-actions">
          {authSession ? <RefreshCountdowns /> : null}
          {authSession ? (
            <span
              className="access-level-pill"
              title={`Signed in as ${authSession.access_level}`}
              aria-label={`Signed in as ${authSession.access_level}`}
            >
              {isAdmin ? <ShieldCheck size={15} /> : <UserRound size={15} />}
              {isAdmin ? "Admin" : "Member"}
            </span>
          ) : null}
          <button
            type="button"
            className="theme-toggle-button"
            onClick={() => setThemeMode((current) => (current === "dark" ? "light" : "dark"))}
            title={themeMode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            aria-label={themeMode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {themeMode === "dark" ? <Sun size={15} /> : <Moon size={15} />}
            <span>{themeMode === "dark" ? "Light" : "Dark"}</span>
          </button>
          {authSession ? (
            <button type="button" className="panel-action-button" onClick={signOut}>
              Sign out
            </button>
          ) : null}
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
          dashboardIcon={<House size={18} />}
          warRoomIcon={<Radar size={18} />}
          memberIcon={<BarChart3 size={18} />}
          lifestyleIcon={<Pill size={18} />}
          miscIcon={<Target size={18} />}
          tradeScoutIcon={<ShoppingCart size={18} />}
          arrestScoutIcon={<ShieldCheck size={18} />}
          warPayoutsIcon={<CircleDollarSign size={18} />}
          stockMarketIcon={<TrendingUp size={18} />}
          dataHealthIcon={<Gauge size={18} />}
          settingsIcon={<SettingsIcon size={18} />}
          diceGameIcon={<Dices size={18} />}
          adminIcon={<Wrench size={18} />}
          isAdmin={isAdmin}
          onWarSelect={selectWar}
        />

        <section className="main-content">
          {view === "dashboard" ? (
            <DashboardHome
              activeWar={activeWar}
              activeWarId={activeWarId}
              isAdmin={isAdmin}
              isLoadingWars={isLoadingWars}
              selectedWar={selectedWar}
              warState={warState}
              wars={wars}
              onOpenView={changeView}
              onOpenWar={selectWar}
            />
          ) : view === "admin" ? (
            <LazyPage>
              <AdminControls />
            </LazyPage>
          ) : view === "diceGame" ? (
            <LazyPage>
              <DiceGame />
            </LazyPage>
          ) : view === "lifestyle" ? (
            <LazyPage>
              <LifestyleStats currentUserId={authSession.user.id} isAdmin={isAdmin} />
            </LazyPage>
          ) : view === "miscellaneous" ? (
            <LazyPage>
              <Miscellaneous />
            </LazyPage>
          ) : view === "tradeScout" ? (
            <LazyPage>
              <TradeScout isAdmin={isAdmin} />
            </LazyPage>
          ) : view === "arrestScout" ? (
            <LazyPage>
              <ArrestScout />
            </LazyPage>
          ) : view === "warPayouts" ? (
            <LazyPage>
              <WarPayouts />
            </LazyPage>
          ) : view === "stockMarketStatus" ? (
            <LazyPage>
              <StockMarketStatus />
            </LazyPage>
          ) : view === "stockInvestments" ? (
            <LazyPage>
              <StockInvestments />
            </LazyPage>
          ) : view === "dataHealth" ? (
            <LazyPage>
              <DataHealthPage isAdmin={isAdmin} onOpenView={changeView} />
            </LazyPage>
          ) : view === "settings" ? (
            <LazyPage>
              <SettingsPage authSession={authSession} />
            </LazyPage>
          ) : view === "members" ? (
            <LazyPage>
              <MembersOverview isAdmin={isAdmin} />
            </LazyPage>
          ) : view === "hospitalMonitor" ? (
            <LazyPage>
              <EnemyHospitalMonitor activeWar={activeWar} />
            </LazyPage>
          ) : view === "warRoom" ? (
            <LazyPage>
              <WarRoom
                selectedWar={selectedWar}
                selectedWarName={selectedWarName}
                activeWarId={activeWarId}
                warState={warState}
                onError={setError}
                onOpenHospitalMonitor={() => changeView("hospitalMonitor")}
              />
            </LazyPage>
          ) : selectedWar ? (
            <LazyPage>
              <WarDetailView
                activityBuckets={activityBuckets}
                chainBonuses={chainBonuses}
                collapsedPanels={collapsedPanels}
                factionActivityWindow={factionActivityWindow}
                isAdmin={isAdmin}
                isLoadingActivity={isLoadingActivity}
                isLoadingDetail={isLoadingDetail}
                isLoadingMemberCombatHeatmap={isLoadingMemberCombatHeatmap}
                isLoadingMemberAttacks={isLoadingMemberAttacks}
                isLoadingReportDiscrepancies={isLoadingReportDiscrepancies}
                memberCombatHeatmap={memberCombatHeatmap}
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
              />
            </LazyPage>
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

function warPageRefreshInterval(
  war: WarSummary,
  activeWarId: number | null,
  warState: GlobalWarState,
): number | null {
  if (isGlobalCurrentWar(war, activeWarId, warState)) {
    return ACTIVE_WAR_REFRESH_MS;
  }

  if (warState === "practically_finished" && war.id === activeWarId) {
    return PRACTICAL_FINISH_REFRESH_MS;
  }

  if (war.official_end_time !== null || war.status === "ended") {
    return null;
  }

  if (war.status === "scheduled") {
    return SLOW_WAR_REFRESH_MS;
  }

  if (war.practical_finish_time !== null) {
    return PRACTICAL_FINISH_REFRESH_MS;
  }

  return war.status === "active" || war.status === "scheduled" ? SLOW_WAR_REFRESH_MS : null;
}

function warSecondaryPanelRefreshInterval(war: WarSummary): number {
  if (war.practical_finish_time !== null) {
    return PRACTICAL_FINISH_REFRESH_MS;
  }

  return war.status === "active" ? ACTIVE_WAR_REFRESH_MS : SLOW_WAR_REFRESH_MS;
}

function warMemberCombatHeatmapRefreshInterval(war: WarSummary): number {
  return war.practical_finish_time !== null ? PRACTICAL_FINISH_REFRESH_MS : SLOW_WAR_REFRESH_MS;
}

function isGlobalCurrentWar(
  war: WarSummary | null,
  activeWarId: number | null,
  warState: GlobalWarState,
): boolean {
  return warState === "current" && activeWarId !== null && war?.id === activeWarId;
}

function findGlobalWar(
  wars: WarSummary[],
  selectedWar: WarSummary | null,
  activeWarId: number | null,
  shouldUseGlobalWar: boolean,
): WarSummary | null {
  if (!shouldUseGlobalWar || activeWarId === null) {
    return null;
  }

  return wars.find((war) => war.id === activeWarId) ??
    (selectedWar?.id === activeWarId ? selectedWar : null);
}

function preferredWarName(wars: WarSummary[], activeWarId: number | null): string | null {
  if (activeWarId === null) {
    return null;
  }

  return wars.find((war) => war.id === activeWarId)?.name ?? null;
}

function RefreshCountdowns() {
  const nowMs = useCurrentTimeMs();

  return (
    <div className="refresh-countdowns" aria-label="Refresh countdowns">
      <CountdownPill label="1 min" value={formatCountdown(nextBoundaryMs(nowMs, 1))} />
      <CountdownPill label="5 min" value={formatCountdown(nextBoundaryMs(nowMs, 5))} />
      <CountdownPill label="15 min" value={formatCountdown(nextBoundaryMs(nowMs, 15))} />
    </div>
  );
}

function CountdownPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="countdown-pill" title={`Next ${label} refresh`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
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

