import React from "react";
import ReactDOM from "react-dom/client";
import {
  BarChart3,
  CircleDollarSign,
  Dices,
  LogIn,
  Moon,
  Pill,
  Radar,
  ShoppingCart,
  ShieldCheck,
  Sun,
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
import { EnemyHospitalMonitor } from "./views/EnemyHospitalMonitor";
import {
  MemberAttackSort,
  MemberSort,
} from "./utils/members";
import "./styles.css";

const ACTIVE_WAR_REFRESH_MS = 5 * 60_000;
const SLOW_WAR_REFRESH_MS = 5 * 60_000;
const PRACTICAL_FINISH_REFRESH_MS = 15 * 60_000;
const CHAIN_BONUS_REFRESH_MS = 15 * 60_000;
type AppView =
  | "war"
  | "warRoom"
  | "hospitalMonitor"
  | "members"
  | "lifestyle"
  | "miscellaneous"
  | "tradeScout"
  | "warPayouts"
  | "diceGame"
  | "admin";

const PAGE_PATHS: Record<Exclude<AppView, "war">, string> = {
  warRoom: "/war-room",
  hospitalMonitor: "/enemy-hospital-monitor",
  members: "/members",
  lifestyle: "/daily-averages",
  miscellaneous: "/miscellaneous",
  tradeScout: "/trade-scout",
  warPayouts: "/war-payouts",
  diceGame: "/dice-game",
  admin: "/admin",
};

type AppRoute = {
  view: AppView;
  warName: string | null;
};

type ThemeMode = "light" | "dark";
const THEME_STORAGE_KEY = "buttgrass-theme";

function parseAppRoute(pathname: string): AppRoute {
  const normalizedPath = pathname.replace(/\/+$/, "") || "/";
  const lowerPath = normalizedPath.toLowerCase();

  if (lowerPath.startsWith("/wars/")) {
    const rawWarName = normalizedPath.slice("/wars/".length);
    return {
      view: "war",
      warName: safeDecodePathPart(rawWarName),
    };
  }

  const matchedPage = Object.entries(PAGE_PATHS).find(([, path]) => path === lowerPath);
  if (matchedPage) {
    return {
      view: matchedPage[0] as AppView,
      warName: null,
    };
  }

  return {
    view: "war",
    warName: null,
  };
}

function safeDecodePathPart(value: string): string | null {
  if (!value) {
    return null;
  }

  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function pathForView(view: AppView, warName?: string | null): string {
  if (view === "war") {
    return warName ? `/wars/${encodeURIComponent(warName)}` : "/";
  }

  return PAGE_PATHS[view];
}

function isAdminOnlyView(view: AppView): boolean {
  return view === "admin" || view === "tradeScout" || view === "warPayouts";
}

function initialThemeMode(): ThemeMode {
  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (storedTheme === "light" || storedTheme === "dark") {
    return storedTheme;
  }

  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

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
const TradeScout = React.lazy(() =>
  import("./views/TradeScout").then((module) => ({ default: module.TradeScout })),
);
const WarPayouts = React.lazy(() =>
  import("./views/WarPayouts").then((module) => ({ default: module.WarPayouts })),
);

function App() {
  const initialRoute = React.useMemo(() => parseAppRoute(window.location.pathname), []);
  const [themeMode, setThemeMode] = React.useState<ThemeMode>(() => initialThemeMode());
  const [warType, setWarType] = React.useState<WarType>("all");
  const [view, setView] = React.useState<AppView>(initialRoute.view);
  const [routedWarName, setRoutedWarName] = React.useState<string | null>(initialRoute.warName);
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
    document.documentElement.dataset.theme = themeMode;
    window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
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
        if (routedWarName && warsResponse.wars.some((war) => war.name === routedWarName)) {
          return routedWarName;
        }

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
  const activeWar = wars.find(isLiveWar) ?? (selectedWar && isLiveWar(selectedWar) ? selectedWar : null);
  const hasTornReport = Boolean(selectedWar?.torn_report_fetched_at);
  const isAdmin = authSession?.access_level === "admin";
  const isActivityPanelOpen =
    collapsedPanels.factionActivity === false || collapsedPanels.enemyActivity === false;
  const isMemberActivityPanelOpen = collapsedPanels.memberActivityHeatmap === false;
  const isReportDiscrepancyPanelOpen = collapsedPanels.reportDiscrepancies === false;

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
    if (isAdminOnlyView(view) && !isAdmin) {
      goToPath(pathForView("war", selectedWarName), true);
      setView("war");
    }
  }, [isAdmin, selectedWarName, view]);

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

        if (detailResponse.war.torn_report_fetched_at && isReportDiscrepancyPanelOpen) {
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
    isReportDiscrepancyPanelOpen,
  ]);

  React.useEffect(() => {
    let cancelled = false;

    async function loadReportDiscrepancies() {
      if (!authSession || !selectedWarName || !hasTornReport || !isReportDiscrepancyPanelOpen) {
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
  }, [authSession, hasTornReport, isReportDiscrepancyPanelOpen, selectedWarName]);

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

    if (nextView === "warRoom" && wars[0]) {
      setSelectedWarName(wars[0].name);
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
    setView("war");
    setRoutedWarName(null);
    goToPath(pathForView("war"), true);
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
          <RefreshCountdowns />
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
          warRoomIcon={<Radar size={18} />}
          memberIcon={<BarChart3 size={18} />}
          lifestyleIcon={<Pill size={18} />}
          miscIcon={<Target size={18} />}
          tradeScoutIcon={<ShoppingCart size={18} />}
          warPayoutsIcon={<CircleDollarSign size={18} />}
          diceGameIcon={<Dices size={18} />}
          adminIcon={<Wrench size={18} />}
          isAdmin={isAdmin}
          onWarSelect={selectWar}
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
          ) : view === "tradeScout" ? (
            <LazyPage>
              <TradeScout isAdmin={isAdmin} />
            </LazyPage>
          ) : view === "warPayouts" ? (
            <LazyPage>
              <WarPayouts />
            </LazyPage>
          ) : view === "members" ? (
            <MembersOverview isAdmin={isAdmin} />
          ) : view === "hospitalMonitor" ? (
            <EnemyHospitalMonitor activeWar={activeWar} />
          ) : view === "warRoom" ? (
            <WarRoom
              selectedWar={selectedWar}
              selectedWarName={selectedWarName}
              onError={setError}
              onOpenHospitalMonitor={() => changeView("hospitalMonitor")}
            />
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

function isLiveWar(war: WarSummary): boolean {
  return (
    war.status === "active" &&
    war.enemy_faction_id !== null &&
    war.official_end_time === null &&
    war.practical_finish_time === null
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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);



