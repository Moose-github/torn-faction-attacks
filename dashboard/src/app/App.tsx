import { useAuth } from "../auth/AuthProvider";
import { startPolling, type PollContext } from "../utils/polling";
import { ChainWatchLiveProvider } from "../hooks/ChainWatchLiveProvider";
import React from "react";
import {
  BarChart3,
  BookOpen,
  CircleDollarSign,
  Crosshair,
  Gauge,
  House,
  LogIn,
  Pill,
  Radar,
  ShoppingCart,
  ShieldCheck,
  Settings as SettingsIcon,
  Target,
  TrendingUp,
  UserRound,
  Wrench,
} from "lucide-react";
import {
  getGlobalWarState,
  getWar,
  getWarActivity,
  getWarChainBonuses,
  getWarMemberCombatHeatmap,
  getWarMemberAttacks,
  getWarReportDiscrepancies,
  getWars,
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
  retiredPageRedirect,
} from "../routes";
import {
  initialThemeMode,
  persistThemeMode,
  type ThemeMode,
} from "./theme";
import {
  initialTimeZoneMode,
  persistTimeZoneMode,
  type TimeZoneMode,
} from "./timeZone";
import { useCurrentTimeMs } from "../utils/time";
import type { AppView } from "../routes";
import { resolveWarPhase } from "../../../shared/warPhase";

const ACTIVE_WAR_REFRESH_MS = 60_000;
const SLOW_WAR_REFRESH_MS = 5 * 60_000;
const PRACTICAL_FINISH_REFRESH_MS = 15 * 60_000;
const GLOBAL_WAR_STATE_REFRESH_MS = 60_000;

const AdminControls = React.lazy(() =>
  import("../views/AdminControls").then((module) => ({ default: module.AdminControls })),
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
const FactionArmory = React.lazy(() =>
  import("../views/FactionArmory").then((module) => ({ default: module.FactionArmory })),
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
const BookStrategy = React.lazy(() =>
  import("../views/BookStrategy").then((module) => ({ default: module.BookStrategy })),
);
const HalloweenProfit = React.lazy(() =>
  import("../views/HalloweenProfit").then((module) => ({ default: module.HalloweenProfit })),
);
const StatEnhancerRange = React.lazy(() =>
  import("../views/StatEnhancerRange").then((module) => ({ default: module.StatEnhancerRange })),
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
const Retaliations = React.lazy(() =>
  import("../views/Retaliations").then((module) => ({ default: module.Retaliations })),
);
const ChainWatchSchedule = React.lazy(() =>
  import("../views/ChainWatchSchedule").then((module) => ({ default: module.ChainWatchSchedule })),
);

export function App() {
  const { scope } = useAuth();
  return <AppContents key={scope} />;
}

function AppContents() {
  const { session: authSession, signOut: endSession, refreshError } = useAuth();
  const initialRoute = React.useMemo(() => parseAppRoute(window.location.pathname), []);
  const [themeMode, setThemeMode] = React.useState<ThemeMode>(() => initialThemeMode());
  const [timeZoneMode, setTimeZoneMode] = React.useState<TimeZoneMode>(() => initialTimeZoneMode());
  const [warType, setWarType] = React.useState<WarType>("all");
  const [view, setView] = React.useState<AppView>(initialRoute.view);
  const [routedWarName, setRoutedWarName] = React.useState<string | null>(initialRoute.warName);
  const [wars, setWars] = React.useState<WarSummary[]>([]);
  const [warState, setWarState] = React.useState<GlobalWarState>("none");
  const warsRequestId = React.useRef(0);
  const detailRequestId = React.useRef(0);
  const [activeWarId, setActiveWarId] = React.useState<number | null>(null);
  const [globalWar, setGlobalWar] = React.useState<WarSummary | null>(null);
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
  const [collapsedPanels, setCollapsedPanels] = React.useState<Record<string, boolean>>({ memberBreakdown: true });
  const [selectedMember, setSelectedMember] = React.useState<MemberStats | null>(null);
  const [memberAttacks, setMemberAttacks] = React.useState<MemberAttack[]>([]);
  const [isLoadingMemberAttacks, setIsLoadingMemberAttacks] = React.useState(false);
  const [isRecordedWarsOpen, setIsRecordedWarsOpen] = React.useState(false);
  const shouldLoadFullWars = Boolean(authSession) && shouldLoadFullWarList(view, isRecordedWarsOpen);

  React.useEffect(() => {
    persistThemeMode(themeMode);
  }, [themeMode]);

  React.useEffect(() => {
    persistTimeZoneMode(timeZoneMode);
  }, [timeZoneMode]);

  React.useEffect(() => {
    function applyBrowserRoute() {
      const redirect = retiredPageRedirect(window.location.pathname);
      if (redirect !== null) {
        window.history.replaceState(null, "", redirect);
      }
      const route = parseAppRoute(window.location.pathname);
      setView(route.view);
      setRoutedWarName(route.warName);
      if (route.view === "war" && route.warName) {
        setSelectedWarName(route.warName);
      }
    }

    applyBrowserRoute();
    window.addEventListener("popstate", applyBrowserRoute);
    return () => {
      window.removeEventListener("popstate", applyBrowserRoute);
    };
  }, []);

  React.useEffect(() => {
    let cancelled = false;

    async function loadWars() {
      const requestId = ++warsRequestId.current;
      if (!authSession) {
        setWars([]);
        setWarState("none");
        setActiveWarId(null);
        setGlobalWar(null);
        setSelectedWarName(null);
        setIsLoadingWars(false);
        return;
      }

      if (!shouldLoadFullWars) {
        setWars([]);
        setIsLoadingWars(false);
        return;
      }

      setIsLoadingWars(true);
      setError(null);

      try {
        const warsResponse = await getWars(warType);

        if (cancelled || requestId !== warsRequestId.current) return;

        setWars(warsResponse.wars);
        setWarState(warsResponse.war_state);
        setActiveWarId(warsResponse.active_war_id);
        if (warsResponse.war_state === "none") {
          setGlobalWar(null);
        } else {
          const activeWarSummary = warsResponse.active_war_id === null
            ? null
            : warsResponse.wars.find((war) => war.id === warsResponse.active_war_id) ?? null;
          if (activeWarSummary) {
            setGlobalWar(activeWarSummary);
          }
        }

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
        if (!cancelled && requestId === warsRequestId.current) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled && requestId === warsRequestId.current) {
          setIsLoadingWars(false);
        }
      }
    }

    loadWars();
    window.addEventListener("practical-phases-changed", loadWars);
    return () => {
      cancelled = true;
      window.removeEventListener("practical-phases-changed", loadWars);
    };
  }, [authSession, routedWarName, shouldLoadFullWars, warType]);

  React.useEffect(() => {
    if (!authSession || shouldLoadFullWars) {
      return;
    }

    let cancelled = false;

    let latestRequest = 0;
    async function loadGlobalWarState({ signal, isCurrent }: PollContext) {
      const requestId = ++latestRequest;
      try {
        const response = await getGlobalWarState(signal);
        if (isCurrent() && !cancelled && requestId === latestRequest) {
          setWarState(response.war_state);
          setActiveWarId(response.active_war_id);
          setGlobalWar(response.active_war);
        }
      } catch (err) {
        if (isCurrent() && !cancelled && requestId === latestRequest) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    }

    const poll = startPolling(loadGlobalWarState, { intervalMs: GLOBAL_WAR_STATE_REFRESH_MS });
    window.addEventListener("practical-phases-changed", poll.invalidate);
    return () => {
      cancelled = true;
      poll.stop();
      window.removeEventListener("practical-phases-changed", poll.invalidate);
    };
  }, [authSession, shouldLoadFullWars]);

  React.useEffect(() => {
    let cancelled = false;

    async function loadWarDetail() {
      const requestId = ++detailRequestId.current;
      if (!authSession || (view !== "war" && view !== "warRoom") || !selectedWarName) {
        setWarDetail(null);
        setIsLoadingDetail(false);
        return;
      }

      setWarDetail(null);
      setIsLoadingDetail(true);
      setError(null);

      try {
        const detail = await getWar(selectedWarName);
        if (!cancelled && requestId === detailRequestId.current) {
          setWarDetail(detail);
        }
      } catch (err) {
        if (!cancelled && requestId === detailRequestId.current) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled && requestId === detailRequestId.current) {
          setIsLoadingDetail(false);
        }
      }
    }

    loadWarDetail();
    window.addEventListener("practical-phases-changed", loadWarDetail);
    return () => {
      cancelled = true;
      window.removeEventListener("practical-phases-changed", loadWarDetail);
    };
  }, [authSession, selectedWarName, view]);

  React.useEffect(() => {
    setSelectedMember(null);
    setMemberAttacks([]);
    setActivityBuckets([]);
    setChainBonuses([]);
    setReportDiscrepancies(null);
  }, [selectedWarName]);

  const selectedWar =
    (warDetail?.war.name === selectedWarName ? warDetail.war : null) ??
    wars.find((war) => war.name === selectedWarName) ??
    (globalWar?.name === selectedWarName ? globalWar : null);
  const globalStateWar = findGlobalWar(wars, selectedWar, globalWar, activeWarId, warState !== "none");
  const activeWar = isGlobalCurrentWar(globalStateWar, activeWarId, warState) ? globalStateWar : null;
  const hasTornReport = Boolean(selectedWar?.torn_report_fetched_at);
  const isAdmin = authSession?.access_level === "admin";
  const isActivityPanelOpen =
    collapsedPanels.factionActivity === false || collapsedPanels.enemyActivity === false;
  const isMemberCombatPanelOpen = collapsedPanels.memberCombatHeatmap === false;
  const memberCombatWindow = selectedWar?.war_type === "event" ? "practical" : factionActivityWindow;
  const shouldLoadReportDiscrepancies = hasTornReport;

  React.useEffect(() => {
    if (!authSession || view !== "war" || !selectedWarName || !selectedWar) {
      setChainBonuses([]);
      return;
    }

    let cancelled = false;
    const chainBonusWarName = selectedWarName;

    async function loadChainBonuses({ signal, isCurrent }: PollContext) {
      try {
        const response = await getWarChainBonuses(chainBonusWarName, signal);
        if (isCurrent() && !cancelled) {
          setChainBonuses(Array.isArray(response.chain_bonuses) ? response.chain_bonuses : []);
        }
      } catch {
        if (isCurrent() && !cancelled) {
          setChainBonuses([]);
        }
      }
    }

    const poll = startPolling(loadChainBonuses, {
      intervalMs: selectedWar.official_end_time !== null || selectedWar.status === "ended" ? null : warSecondaryPanelRefreshInterval(selectedWar),
    });

    return () => {
      cancelled = true;
      poll.stop();
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

    async function loadActivity({ signal, isCurrent }: PollContext) {
      setIsLoadingActivity(true);
      setError(null);

      try {
        const response = await getWarActivity(activityWarName, factionActivityWindow, signal);
        if (isCurrent() && !cancelled) {
          setActivityBuckets(Array.isArray(response.buckets) ? response.buckets : []);
        }
      } catch (err) {
        if (isCurrent() && !cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (isCurrent() && !cancelled) {
          setIsLoadingActivity(false);
        }
      }
    }

    const poll = startPolling(loadActivity, {
      intervalMs: selectedWar.official_end_time !== null || selectedWar.status === "ended" ? null : warSecondaryPanelRefreshInterval(selectedWar),
    });

    return () => {
      cancelled = true;
      poll.stop();
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

    async function loadMemberCombatHeatmap({ signal, isCurrent }: PollContext) {
      setIsLoadingMemberCombatHeatmap(true);
      setError(null);

      try {
        const response = await getWarMemberCombatHeatmap(heatmapWarName, memberCombatWindow, signal);
        if (isCurrent() && !cancelled) {
          setMemberCombatHeatmap(response);
        }
      } catch (err) {
        if (isCurrent() && !cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setMemberCombatHeatmap(null);
        }
      } finally {
        if (isCurrent() && !cancelled) {
          setIsLoadingMemberCombatHeatmap(false);
        }
      }
    }

    const poll = startPolling(loadMemberCombatHeatmap, {
      intervalMs: selectedWar.official_end_time !== null || selectedWar.status === "ended" ? null : warMemberCombatHeatmapRefreshInterval(selectedWar),
    });

    return () => {
      cancelled = true;
      poll.stop();
    };
  }, [
    authSession,
    isMemberCombatPanelOpen,
    memberCombatWindow,
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
    if (!authSession || (view !== "war" && view !== "warRoom") || !selectedWarName || !selectedWar) {
      return;
    }

    const refreshMs = view === "warRoom"
      ? GLOBAL_WAR_STATE_REFRESH_MS
      : warPageRefreshInterval(selectedWar, activeWarId, warState);
    if (refreshMs === null) {
      return;
    }

    let cancelled = false;
    const poll = startPolling(async ({ signal, isCurrent }) => {
      const warsId = ++warsRequestId.current;
      const detailId = ++detailRequestId.current;
      try {
        const [warsResponse, detailResponse] = await Promise.all([
          getWars(warType, signal),
          getWar(selectedWarName, signal),
        ]);

        if (!isCurrent() || cancelled || warsId !== warsRequestId.current || detailId !== detailRequestId.current) {
          return;
        }

        setWars(warsResponse.wars);
        setWarState(warsResponse.war_state);
        setActiveWarId(warsResponse.active_war_id);
        setWarDetail(detailResponse);
        setIsLoadingWars(false);
        setIsLoadingDetail(false);

        if (detailResponse.war.torn_report_fetched_at && shouldLoadReportDiscrepancies) {
          const discrepancies = await getWarReportDiscrepancies(selectedWarName, signal);
          if (isCurrent() && !cancelled && warsId === warsRequestId.current && detailId === detailRequestId.current) {
            setReportDiscrepancies(discrepancies);
          }
        } else if (!detailResponse.war.torn_report_fetched_at) {
          setReportDiscrepancies(null);
        }
      } catch (err) {
        if (isCurrent() && !cancelled && warsId === warsRequestId.current && detailId === detailRequestId.current) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    }, { intervalMs: refreshMs, immediate: false });

    return () => {
      cancelled = true;
      poll.stop();
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
      if (!authSession || view !== "war" || !selectedWarName || !hasTornReport || !shouldLoadReportDiscrepancies) {
        if (view !== "war" || !hasTornReport) {
          setReportDiscrepancies(null);
        }
        setIsLoadingReportDiscrepancies(false);
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
  }, [authSession, hasTornReport, shouldLoadReportDiscrepancies, selectedWarName, view]);

  React.useEffect(() => {
    let cancelled = false;

    async function loadMemberAttacks({ signal, isCurrent }: PollContext) {
      if (!authSession || view !== "war" || !selectedWarName || !selectedMember) {
        setMemberAttacks([]);
        setIsLoadingMemberAttacks(false);
        return;
      }

      setIsLoadingMemberAttacks(true);
      setError(null);

      try {
        const response = await getWarMemberAttacks(selectedWarName, selectedMember.member_id, signal);
        if (isCurrent() && !cancelled) {
          setMemberAttacks(response.attacks);
        }
      } catch (err) {
        if (isCurrent() && !cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (isCurrent() && !cancelled) {
          setIsLoadingMemberAttacks(false);
        }
      }
    }

    const poll = startPolling(loadMemberAttacks, {
      intervalMs: isGlobalCurrentWar(selectedWar, activeWarId, warState) ? ACTIVE_WAR_REFRESH_MS : null,
    });
    return () => {
      cancelled = true;
      poll.stop();
    };
  }, [activeWarId, authSession, selectedMember, selectedWar?.id, selectedWarName, view, warState]);

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

    if (nextView === "dashboard" || nextView === "warRoom") {
      const preferredName = preferredWarName(wars, activeWarId) ?? globalWar?.name ?? wars[0]?.name ?? null;
      if (preferredName) {
        setSelectedWarName(preferredName);
      }
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
    endSession();
    setView("dashboard");
    setRoutedWarName(null);
    goToPath(pathForView("dashboard"), true);
    setError(null);
  }

  function changeThemeMode(nextThemeMode: ThemeMode) {
    persistThemeMode(nextThemeMode);
    setThemeMode(nextThemeMode);
  }

  function changeTimeZoneMode(nextTimeZoneMode: TimeZoneMode) {
    persistTimeZoneMode(nextTimeZoneMode);
    setTimeZoneMode(nextTimeZoneMode);
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
          {authSession ? (
            <button
              type="button"
              className={view === "settings" ? "panel-action-button topbar-settings-button active" : "panel-action-button topbar-settings-button"}
              onClick={() => changeView("settings")}
              title="Open settings"
              aria-label="Open settings"
              aria-current={view === "settings" ? "page" : undefined}
            >
              <SettingsIcon size={15} />
              <span>Settings</span>
            </button>
          ) : null}
          {authSession ? (
            <button type="button" className="panel-action-button" onClick={signOut}>
              Sign out
            </button>
          ) : null}
        </div>
      </header>

      {error ? <div className="error-panel">{error}</div> : null}
      {authSession && refreshError ? <div className="error-panel" role="status">{refreshError}</div> : null}

      {!authSession ? (
        <MemberSignIn />
      ) : (

      <ChainWatchLiveProvider key={`${authSession.user.id}:${authSession.access_level}`}><div className="dashboard-layout">
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
          retaliationIcon={<Crosshair size={18} />}
          memberIcon={<BarChart3 size={18} />}
          lifestyleIcon={<Pill size={18} />}
          miscIcon={<Target size={18} />}
          tradeScoutIcon={<ShoppingCart size={18} />}
          arrestScoutIcon={<ShieldCheck size={18} />}
          bookStrategyIcon={<BookOpen size={18} />}
          warPayoutsIcon={<CircleDollarSign size={18} />}
          stockMarketIcon={<TrendingUp size={18} />}
          dataHealthIcon={<Gauge size={18} />}
          adminIcon={<Wrench size={18} />}
          isAdmin={isAdmin}
          onWarSelect={selectWar}
          onRecordedWarsOpenChange={setIsRecordedWarsOpen}
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
          ) : view === "bookStrategy" ? (
            <LazyPage>
              <BookStrategy />
            </LazyPage>
          ) : view === "halloweenProfit" ? (
            <LazyPage>
              <HalloweenProfit />
            </LazyPage>
          ) : view === "statEnhancerRange" ? (
            <LazyPage>
              <StatEnhancerRange />
            </LazyPage>
          ) : view === "warPayouts" ? (
            <LazyPage>
              <WarPayouts isLoadingWars={isLoadingWars} wars={wars} />
            </LazyPage>
          ) : view === "stockMarketStatus" ? (
            <LazyPage>
              <StockMarketStatus />
            </LazyPage>
          ) : view === "factionArmory" ? (
            <LazyPage>
              {isAdmin ? <FactionArmory /> : null}
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
              <SettingsPage
                authSession={authSession}
                themeMode={themeMode}
                timeZoneMode={timeZoneMode}
                onThemeModeChange={changeThemeMode}
                onTimeZoneModeChange={changeTimeZoneMode}
              />
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
          ) : view === "chainWatchSchedule" ? (
            <LazyPage>
              <ChainWatchSchedule currentUserId={authSession.user.id} isAdmin={isAdmin} />
            </LazyPage>
          ) : view === "retaliations" ? (
            <LazyPage>
              <Retaliations currentUserId={authSession.user.id} />
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
      </div></ChainWatchLiveProvider>
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

function MemberSignIn() {
  const { signIn } = useAuth();
  const [key, setKey] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [isSigningIn, setIsSigningIn] = React.useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSigningIn(true);

    try {
      await signIn(key);
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
          <dd>Public access is enough to sign in. Stock ROI portfolio imports require a Limited access key, entered separately on that page.</dd>
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
  if (war.war_type !== "event") {
    const state = resolveWarPhase(war, Math.floor(Date.now() / 1000), { activeWarId, warState });
    if (state.phase === "officially_ended") return null;
    if (state.isCurrent) return ACTIVE_WAR_REFRESH_MS;
    if (state.phase === "practically_finished") return PRACTICAL_FINISH_REFRESH_MS;
    return SLOW_WAR_REFRESH_MS;
  }
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
  if (war.war_type !== "event") {
    const { phase } = resolveWarPhase(war, Math.floor(Date.now() / 1000));
    return phase === "practically_finished" ? PRACTICAL_FINISH_REFRESH_MS
      : phase === "current" ? ACTIVE_WAR_REFRESH_MS : SLOW_WAR_REFRESH_MS;
  }
  if (war.practical_finish_time !== null) {
    return PRACTICAL_FINISH_REFRESH_MS;
  }

  return war.status === "active" ? ACTIVE_WAR_REFRESH_MS : SLOW_WAR_REFRESH_MS;
}

function warMemberCombatHeatmapRefreshInterval(war: WarSummary): number {
  if (war.war_type !== "event") {
    return resolveWarPhase(war, Math.floor(Date.now() / 1000)).phase === "practically_finished"
      ? PRACTICAL_FINISH_REFRESH_MS : SLOW_WAR_REFRESH_MS;
  }
  return war.practical_finish_time !== null ? PRACTICAL_FINISH_REFRESH_MS : SLOW_WAR_REFRESH_MS;
}

function isGlobalCurrentWar(
  war: WarSummary | null,
  activeWarId: number | null,
  warState: GlobalWarState,
): boolean {
  if (war?.war_type !== "event") {
    return resolveWarPhase(war, Math.floor(Date.now() / 1000), { activeWarId, warState }).isCurrent;
  }
  return warState === "current" && activeWarId !== null && war?.id === activeWarId;
}

function shouldLoadFullWarList(view: AppView, isRecordedWarsOpen: boolean): boolean {
  return view === "dashboard" ||
    view === "war" ||
    view === "warRoom" ||
    view === "warPayouts" ||
    isRecordedWarsOpen;
}

function findGlobalWar(
  wars: WarSummary[],
  selectedWar: WarSummary | null,
  globalWar: WarSummary | null,
  activeWarId: number | null,
  shouldUseGlobalWar: boolean,
): WarSummary | null {
  if (!shouldUseGlobalWar || activeWarId === null) {
    return null;
  }

  return wars.find((war) => war.id === activeWarId) ??
    (selectedWar?.id === activeWarId ? selectedWar : null) ??
    (globalWar?.id === activeWarId ? globalWar : null);
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

