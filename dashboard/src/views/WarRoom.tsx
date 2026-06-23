import React from "react";
import { ArrowDown, ArrowUp, Plus, Siren, Trash2 } from "lucide-react";
import {
  addEnemyBigHitter,
  EnemyFactionMember,
  EnemyBigHittersResponse,
  EnemyHitStatTrend,
  EnemyPushPressureResponse,
  EnemyScoutingResponse,
  FactionActivityHeatmapResponse,
  ChainWatchResponse,
  EnemyMemberActivityHeatmapResponse,
  getChainWatch,
  getEnemyBigHitters,
  getEnemyMemberActivityHeatmap,
  getEnemyPushPressure,
  getStoredAuthSession,
  getEnemyScouting,
  getScoutingComparison,
  getWarActivityHeatmap,
  removeEnemyBigHitter,
  refreshAuthSession,
  refreshEnemyScouting,
  ScoutingComparisonResponse,
  updateChainWatch,
  type GlobalWarState,
  WarSummary,
} from "../api";
import {
  FactionActivityComparisonHeatmap,
  FactionActivityHeatmap,
  ScoutingComparisonChart,
} from "../components/Charts";
import { CollapsiblePanel, EmptyState, FreshnessMeta, FreshnessTone, PanelHeader } from "../components/Common";
import { EnemyScoutingPanel } from "../components/EnemyScouting";
import { EnemyTravelPanel } from "../components/EnemyTravelPanel";
import { StickyTable } from "../components/StickyTable";
import { formatLongDateTime, formatNumber, formatRelativeTime, formatTime } from "../utils/format";
import { formatCountdownDuration, useCurrentTimeMs } from "../utils/time";
import { isWarRoomMemberTrackingActive } from "../utils/warTracking";
import { ScoutingComparisonMetric } from "../../../shared/scoutingBuckets";

const WAR_ROOM_HEATMAP_REFRESH_MS = 15 * 60_000;
const WAR_ROOM_PUSH_HISTORY_REFRESH_MS = 5 * 60_000;
const WAR_ROOM_MEMBER_TRACKING_REFRESH_MS = 30_000;
const WAR_ROOM_CHAIN_WATCH_REFRESH_MS = 15_000;

type TrackingMode = "live" | "pre-live" | "inactive";
type ActivityHeatmapMode = "faction" | "bigHitters" | "selectedPlayers";

export function WarRoom({
  selectedWar,
  selectedWarName,
  activeWarId,
  warState,
  onError,
  onOpenHospitalMonitor,
}: {
  selectedWar: WarSummary | null;
  selectedWarName: string | null;
  activeWarId: number | null;
  warState: GlobalWarState;
  onError: (message: string | null) => void;
  onOpenHospitalMonitor: () => void;
}) {
  const [enemyScouting, setEnemyScouting] = React.useState<EnemyScoutingResponse | null>(null);
  const [enemyBigHitters, setEnemyBigHitters] = React.useState<EnemyBigHittersResponse | null>(null);
  const [isLoadingEnemyBigHitters, setIsLoadingEnemyBigHitters] = React.useState(false);
  const [isUpdatingEnemyBigHitters, setIsUpdatingEnemyBigHitters] = React.useState(false);
  const [selectedBigHitterMemberId, setSelectedBigHitterMemberId] = React.useState("");
  const [canRefreshEnemyScouting, setCanRefreshEnemyScouting] = React.useState(
    () => getStoredAuthSession()?.access_level === "admin",
  );
  const [isLoadingEnemyScouting, setIsLoadingEnemyScouting] = React.useState(false);
  const [isRefreshingEnemyScouting, setIsRefreshingEnemyScouting] = React.useState(false);
  const [scoutingComparison, setScoutingComparison] =
    React.useState<ScoutingComparisonResponse | null>(null);
  const [scoutingComparisonMetric, setScoutingComparisonMetric] =
    React.useState<ScoutingComparisonMetric>("ff_battlestats");
  const [isLoadingScoutingComparison, setIsLoadingScoutingComparison] = React.useState(false);
  const [activityHeatmap, setActivityHeatmap] =
    React.useState<FactionActivityHeatmapResponse | null>(null);
  const [isLoadingActivityHeatmap, setIsLoadingActivityHeatmap] = React.useState(false);
  const [activityHeatmapMode, setActivityHeatmapMode] = React.useState<ActivityHeatmapMode>("faction");
  const [enemyMemberActivityHeatmap, setEnemyMemberActivityHeatmap] =
    React.useState<EnemyMemberActivityHeatmapResponse | null>(null);
  const [isLoadingEnemyMemberActivityHeatmap, setIsLoadingEnemyMemberActivityHeatmap] = React.useState(false);
  const [selectedActivityMemberIds, setSelectedActivityMemberIds] = React.useState<number[]>([]);
  const [pushPressure, setPushPressure] = React.useState<EnemyPushPressureResponse | null>(null);
  const [isLoadingPushPressure, setIsLoadingPushPressure] = React.useState(false);
  const [chainWatch, setChainWatch] = React.useState<ChainWatchResponse | null>(null);
  const [isLoadingChainWatch, setIsLoadingChainWatch] = React.useState(false);
  const [isTogglingChainWatch, setIsTogglingChainWatch] = React.useState(false);
  const [collapsedPanels, setCollapsedPanels] = React.useState<Record<string, boolean>>({
    activityHeatmaps: true,
    chainWatch: true,
    enemyHitTrends: true,
    enemyPushPressure: true,
    revivableMembers: true,
  });
  const trackingCadenceRef = React.useRef<HTMLElement | null>(null);
  const canLoadScouting = Boolean(selectedWarName && selectedWar?.enemy_faction_id !== null);
  const isSelectedGlobalWar = activeWarId !== null && selectedWar?.id === activeWarId;
  const isWarLive = warState === "current" && isSelectedGlobalWar;
  const nowMs = useCurrentTimeMs();
  const isMemberTrackingActive = selectedWar && isSelectedGlobalWar
    ? isWarRoomMemberTrackingActive(selectedWar, Math.floor(nowMs / 1000))
    : false;
  const isActivityHeatmapsOpen = collapsedPanels.activityHeatmaps === false;
  const bigHitterActivityMemberIds = React.useMemo(
    () => (enemyBigHitters?.big_hitters ?? []).map((member) => member.member_id),
    [enemyBigHitters],
  );
  const activeEnemyActivityMemberIds =
    activityHeatmapMode === "bigHitters" ? bigHitterActivityMemberIds : selectedActivityMemberIds;
  const activeEnemyActivityMemberKey = activeEnemyActivityMemberIds.join(",");
  const trackingMode: TrackingMode = isWarLive ? "live" : isMemberTrackingActive ? "pre-live" : "inactive";
  const trackingFreshness = trackingFreshnessForMode(trackingMode);
  const statusCheckedAt = enemyScouting?.summary.status_checked_at ?? null;
  const latestHeatmapSampledAt = getLatestHeatmapSampledAt(activityHeatmap);
  const pushPressureUpdatedAt = pushPressure?.latest?.created_at ?? null;
  const latestRevivableMemberUpdatedAt = getLatestMemberUpdatedAt([
    ...(scoutingComparison?.home.members ?? []),
    ...(scoutingComparison?.enemy.members ?? []),
  ]);
  const latestRevivableUpdatedAt =
    isMemberTrackingActive
      ? scoutingComparison?.war.status_checked_at ?? latestRevivableMemberUpdatedAt
      : latestRevivableMemberUpdatedAt;

  function togglePanel(panel: string) {
    setCollapsedPanels((current) => ({
      ...current,
      [panel]: !current[panel],
    }));
  }

  function scrollToTrackingCadence() {
    trackingCadenceRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  React.useEffect(() => {
    let cancelled = false;

    async function refreshAuth() {
      const session = await refreshAuthSession();
      if (!cancelled) {
        setCanRefreshEnemyScouting(session?.access_level === "admin");
      }
    }

    refreshAuth();
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    setActivityHeatmapMode("faction");
    setSelectedActivityMemberIds([]);
    setEnemyMemberActivityHeatmap(null);
  }, [selectedWarName]);

  React.useEffect(() => {
    let cancelled = false;

    async function loadEnemyScouting() {
      if (!selectedWarName || !canLoadScouting) {
        setEnemyScouting(null);
        return;
      }

      setIsLoadingEnemyScouting(true);

      try {
        const response = await getEnemyScouting(selectedWarName);
        if (!cancelled) {
          setEnemyScouting(response);
        }
      } catch {
        if (!cancelled) {
          setEnemyScouting(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingEnemyScouting(false);
        }
      }
    }

    loadEnemyScouting();
    return () => {
      cancelled = true;
    };
  }, [canLoadScouting, selectedWarName]);

  React.useEffect(() => {
    let cancelled = false;

    async function loadEnemyBigHitters() {
      if (!selectedWarName || !canLoadScouting) {
        setEnemyBigHitters(null);
        setSelectedBigHitterMemberId("");
        return;
      }

      setIsLoadingEnemyBigHitters(true);

      try {
        const response = await getEnemyBigHitters(selectedWarName);
        if (!cancelled) {
          setEnemyBigHitters(response);
        }
      } catch {
        if (!cancelled) {
          setEnemyBigHitters(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingEnemyBigHitters(false);
        }
      }
    }

    loadEnemyBigHitters();
    return () => {
      cancelled = true;
    };
  }, [canLoadScouting, selectedWarName]);

  React.useEffect(() => {
    let cancelled = false;

    async function loadChainWatch() {
      if (!selectedWarName || !selectedWar) {
        setChainWatch(null);
        return;
      }

      setIsLoadingChainWatch(true);

      try {
        const response = await getChainWatch(selectedWarName);
        if (!cancelled) {
          setChainWatch(response);
        }
      } catch {
        if (!cancelled) {
          setChainWatch(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingChainWatch(false);
        }
      }
    }

    loadChainWatch();
    return () => {
      cancelled = true;
    };
  }, [selectedWar?.id, selectedWarName]);

  React.useEffect(() => {
    if (!selectedWarName || !selectedWar || !isWarLive) {
      return;
    }

    let cancelled = false;
    const timer = window.setInterval(async () => {
      try {
        const response = await getChainWatch(selectedWarName);
        if (!cancelled) {
          setChainWatch(response);
        }
      } catch {
        if (!cancelled) {
          setChainWatch(null);
        }
      }
    }, WAR_ROOM_CHAIN_WATCH_REFRESH_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [isWarLive, selectedWar?.id, selectedWarName]);

  React.useEffect(() => {
    let cancelled = false;

    async function loadPushPressure() {
      if (!selectedWarName || !canLoadScouting) {
        setPushPressure(null);
        return;
      }

      setIsLoadingPushPressure(true);

      try {
        const response = await getEnemyPushPressure(selectedWarName);
        if (!cancelled) {
          setPushPressure(response);
        }
      } catch {
        if (!cancelled) {
          setPushPressure(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingPushPressure(false);
        }
      }
    }

    loadPushPressure();
    return () => {
      cancelled = true;
    };
  }, [canLoadScouting, selectedWarName]);

  React.useEffect(() => {
    let cancelled = false;

    async function loadScoutingComparison() {
      if (!selectedWarName || !canLoadScouting) {
        setScoutingComparison(null);
        return;
      }

      setIsLoadingScoutingComparison(true);

      try {
        const response = await getScoutingComparison(selectedWarName);
        if (!cancelled) {
          setScoutingComparison(response);
        }
      } catch {
        if (!cancelled) {
          setScoutingComparison(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingScoutingComparison(false);
        }
      }
    }

    loadScoutingComparison();
    return () => {
      cancelled = true;
    };
  }, [canLoadScouting, selectedWarName]);

  React.useEffect(() => {
    let cancelled = false;

    async function loadActivityHeatmap() {
      if (!selectedWarName || !selectedWar || !canLoadScouting || !isActivityHeatmapsOpen) {
        setActivityHeatmap(null);
        return;
      }

      setIsLoadingActivityHeatmap(true);

      try {
        const response = await getWarActivityHeatmap(selectedWarName, selectedWar.id);
        if (!cancelled) {
          setActivityHeatmap(response);
        }
      } catch {
        if (!cancelled) {
          setActivityHeatmap(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingActivityHeatmap(false);
        }
      }
    }

    loadActivityHeatmap();
    return () => {
      cancelled = true;
    };
  }, [canLoadScouting, isActivityHeatmapsOpen, selectedWar?.id, selectedWarName]);

  React.useEffect(() => {
    let cancelled = false;

    async function loadEnemyMemberActivityHeatmap() {
      if (
        !selectedWarName ||
        !canLoadScouting ||
        !isActivityHeatmapsOpen ||
        activityHeatmapMode === "faction" ||
        activeEnemyActivityMemberIds.length === 0
      ) {
        setEnemyMemberActivityHeatmap(null);
        setIsLoadingEnemyMemberActivityHeatmap(false);
        return;
      }

      setIsLoadingEnemyMemberActivityHeatmap(true);

      try {
        const response = await getEnemyMemberActivityHeatmap(selectedWarName, {
          memberIds: activeEnemyActivityMemberIds,
        });
        if (!cancelled) {
          setEnemyMemberActivityHeatmap(response);
        }
      } catch {
        if (!cancelled) {
          setEnemyMemberActivityHeatmap(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingEnemyMemberActivityHeatmap(false);
        }
      }
    }

    loadEnemyMemberActivityHeatmap();
    return () => {
      cancelled = true;
    };
  }, [
    activeEnemyActivityMemberKey,
    activityHeatmapMode,
    canLoadScouting,
    isActivityHeatmapsOpen,
    selectedWarName,
  ]);

  React.useEffect(() => {
    if (!selectedWarName || !selectedWar || !canLoadScouting || !isWarLive) {
      return;
    }

    let cancelled = false;
    const shouldRefreshScoutingComparison = scoutingComparison?.comparison_stats_complete !== true;
    const timer = window.setInterval(async () => {
      try {
        const [comparisonResponse, heatmapResponse, memberHeatmapResponse] = await Promise.all([
          shouldRefreshScoutingComparison ? getScoutingComparison(selectedWarName) : Promise.resolve(null),
          isActivityHeatmapsOpen ? getWarActivityHeatmap(selectedWarName, selectedWar.id) : Promise.resolve(null),
          isActivityHeatmapsOpen &&
          activityHeatmapMode !== "faction" &&
          activeEnemyActivityMemberIds.length > 0
            ? getEnemyMemberActivityHeatmap(selectedWarName, { memberIds: activeEnemyActivityMemberIds })
            : Promise.resolve(null),
        ]);

        if (!cancelled) {
          if (comparisonResponse) {
            setScoutingComparison(comparisonResponse);
          }
          if (heatmapResponse) {
            setActivityHeatmap(heatmapResponse);
          }
          if (memberHeatmapResponse) {
            setEnemyMemberActivityHeatmap(memberHeatmapResponse);
          }
        }
      } catch {
        if (!cancelled) {
          setActivityHeatmap(null);
          setEnemyMemberActivityHeatmap(null);
        }
      }
    }, WAR_ROOM_HEATMAP_REFRESH_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    canLoadScouting,
    activeEnemyActivityMemberKey,
    activityHeatmapMode,
    isActivityHeatmapsOpen,
    isWarLive,
    scoutingComparison?.comparison_stats_complete,
    selectedWar?.id,
    selectedWarName,
  ]);

  React.useEffect(() => {
    if (!selectedWarName || !canLoadScouting || !isMemberTrackingActive) {
      return;
    }

    let cancelled = false;
    const warName = selectedWarName;

    async function refreshMemberTrackingData() {
      const [comparisonResult, scoutingResult, pressureResult] = await Promise.allSettled([
        getScoutingComparison(warName),
        getEnemyScouting(warName),
        getEnemyPushPressure(warName, { includeHistory: false }),
      ]);

      if (cancelled) {
        return;
      }

      if (comparisonResult.status === "fulfilled") {
        setScoutingComparison(comparisonResult.value);
      } else {
        setScoutingComparison(null);
      }

      if (scoutingResult.status === "fulfilled") {
        setEnemyScouting(scoutingResult.value);
      } else {
        setEnemyScouting(null);
      }

      if (pressureResult.status === "fulfilled") {
        setPushPressure((current) => ({
          ...pressureResult.value,
          history: current?.history ?? pressureResult.value.history,
        }));
      } else {
        setPushPressure((current) =>
          current
            ? {
                ...current,
                latest: null,
              }
            : null,
        );
      }
    }

    refreshMemberTrackingData();
    const timer = window.setInterval(refreshMemberTrackingData, WAR_ROOM_MEMBER_TRACKING_REFRESH_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [canLoadScouting, isMemberTrackingActive, selectedWarName]);

  React.useEffect(() => {
    if (!selectedWarName || !canLoadScouting || !isMemberTrackingActive) {
      return;
    }

    let cancelled = false;
    const timer = window.setInterval(async () => {
      try {
        const response = await getEnemyPushPressure(selectedWarName);
        if (!cancelled) {
          setPushPressure(response);
        }
      } catch {
        if (!cancelled) {
          setPushPressure(null);
        }
      }
    }, WAR_ROOM_PUSH_HISTORY_REFRESH_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [canLoadScouting, isMemberTrackingActive, selectedWarName]);

  async function refreshSelectedEnemyScouting() {
    if (!selectedWarName || !selectedWar) {
      return;
    }

    setIsRefreshingEnemyScouting(true);
    onError(null);

    try {
      setEnemyScouting(await refreshEnemyScouting(selectedWarName));
      setEnemyBigHitters(await getEnemyBigHitters(selectedWarName));
      setScoutingComparison(await getScoutingComparison(selectedWarName));
      if (isActivityHeatmapsOpen) {
        setActivityHeatmap(await getWarActivityHeatmap(selectedWarName, selectedWar.id));
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRefreshingEnemyScouting(false);
    }
  }

  async function addSelectedBigHitter() {
    if (!selectedWarName || !selectedBigHitterMemberId) {
      return;
    }

    const memberId = Number(selectedBigHitterMemberId);
    if (!Number.isInteger(memberId) || memberId <= 0) {
      return;
    }

    setIsUpdatingEnemyBigHitters(true);
    onError(null);

    try {
      setEnemyBigHitters(await addEnemyBigHitter(selectedWarName, memberId));
      setSelectedBigHitterMemberId("");
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsUpdatingEnemyBigHitters(false);
    }
  }

  async function removeSelectedBigHitter(memberId: number) {
    if (!selectedWarName) {
      return;
    }

    setIsUpdatingEnemyBigHitters(true);
    onError(null);

    try {
      setEnemyBigHitters(await removeEnemyBigHitter(selectedWarName, memberId));
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsUpdatingEnemyBigHitters(false);
    }
  }

  function addSelectedActivityMember(memberId: number) {
    if (!Number.isInteger(memberId) || memberId <= 0) {
      return;
    }

    setSelectedActivityMemberIds((current) =>
      current.includes(memberId) ? current : [...current, memberId],
    );
  }

  function removeSelectedActivityMember(memberId: number) {
    setSelectedActivityMemberIds((current) => current.filter((id) => id !== memberId));
  }

  if (!selectedWar) {
    return (
      <section className="panel">
        <PanelHeader title="War room" />
        <EmptyState text="Select a recorded war to open the War room" />
      </section>
    );
  }

  async function toggleChainWatch() {
    if (!selectedWarName || !chainWatch) {
      return;
    }

    setIsTogglingChainWatch(true);
    onError(null);

    try {
      const response = await updateChainWatch(selectedWarName, chainWatch.state?.enabled !== 1);
      setChainWatch(response);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsTogglingChainWatch(false);
    }
  }

  if (!canLoadScouting) {
    return (
      <section className="panel">
        <PanelHeader title="War room" />
        <EmptyState text="This war does not have an enemy faction linked, so scouting and tracking are unavailable." />
      </section>
    );
  }

  return (
    <>
      <section className="hero-panel war-room-hero-panel">
        <div>
          <p className="eyebrow">War room</p>
          <div className="war-title-row">
            <h2>{selectedWar.name}</h2>
            <span>{formatWarRoomType(selectedWar)}</span>
          </div>
          <p>
            Official start:{" "}
            <strong>
              {formatLongDateTime(selectedWar.official_start_time ?? selectedWar.practical_start_time)}
            </strong>
          </p>
          {selectedWar.official_start_time !== null &&
          selectedWar.official_start_time !== selectedWar.practical_start_time ? (
            <p>
              Practical start: <strong>{formatLongDateTime(selectedWar.practical_start_time)}</strong>
            </p>
          ) : null}
        </div>
        <WarStartCountdown
          war={selectedWar}
          isSelectedGlobalWar={isSelectedGlobalWar}
          warState={warState}
        />
      </section>

      <section className="content-grid">
        {isMemberTrackingActive ? (
          <>
            <EnemyStatusSummaryPanel
              members={enemyScouting?.members ?? []}
              statusCheckedAt={statusCheckedAt}
              isLoading={isLoadingEnemyScouting}
              trackingState={trackingFreshness.state}
              trackingCadence={trackingFreshness.enemyCadence}
              trackingTone={trackingFreshness.tone}
              trackingDetail={trackingFreshness.enemyDetail}
              onShowTrackingDetails={scrollToTrackingCadence}
            />

            <HospitalMonitorLinkPanel
              isWarLive={isWarLive}
              onOpenHospitalMonitor={onOpenHospitalMonitor}
              trackingState={trackingFreshness.hospitalState}
              trackingCadence={trackingFreshness.hospitalCadence}
              trackingTone={trackingFreshness.hospitalTone}
              trackingDetail={trackingFreshness.hospitalDetail}
              onShowTrackingDetails={scrollToTrackingCadence}
            />

            <EnemyPushPressurePanel
              data={pushPressure}
              isLoading={isLoadingPushPressure}
              collapsed={collapsedPanels.enemyPushPressure ?? true}
              onToggle={() => togglePanel("enemyPushPressure")}
              trackingState={trackingFreshness.state}
              trackingCadence={trackingFreshness.pushCadence}
              trackingTone={trackingFreshness.tone}
              trackingDetail={trackingFreshness.pushDetail}
              onShowTrackingDetails={scrollToTrackingCadence}
            />

            <RevivableMembersPanel
              homeMembers={scoutingComparison?.home.members ?? []}
              enemyMembers={scoutingComparison?.enemy.members ?? []}
              enemyName={selectedWar.name}
              collapsed={collapsedPanels.revivableMembers ?? true}
              onToggle={() => togglePanel("revivableMembers")}
              updatedAt={latestRevivableUpdatedAt}
              trackingState={trackingFreshness.revivableState}
              trackingCadence={trackingFreshness.revivableCadence}
              trackingTone={trackingFreshness.revivableTone}
              trackingDetail={trackingFreshness.revivableDetail}
              onShowTrackingDetails={scrollToTrackingCadence}
            />

            <EnemyTravelPanel
              members={enemyScouting?.members ?? []}
              statusCheckedAt={statusCheckedAt}
              isLoading={isLoadingEnemyScouting}
              collapsed={collapsedPanels.enemyTravel ?? false}
              onToggle={() => togglePanel("enemyTravel")}
              trackingState={trackingFreshness.state}
              trackingCadence={trackingFreshness.enemyCadence}
              trackingTone={trackingFreshness.tone}
              trackingDetail={trackingFreshness.enemyDetail}
              onShowTrackingDetails={scrollToTrackingCadence}
            />
          </>
        ) : null}

        <CollapsiblePanel
          title="Stats comparison"
          aside={isLoadingScoutingComparison ? "Loading" : scoutingComparisonMetricLabel(scoutingComparisonMetric)}
          collapsed={collapsedPanels.scoutingComparison ?? false}
          onToggle={() => togglePanel("scoutingComparison")}
          className="scouting-comparison-panel"
        >
          <p className="panel-description">
            Compares the latest stored member stats for Buttgrass and the enemy faction by member count in each range.
          </p>
          <div className="panel-toggle-row" aria-label="Stats comparison metric">
            <button
              type="button"
              className={scoutingComparisonMetric === "ff_battlestats" ? "toggle-chip active" : "toggle-chip"}
              onClick={() => setScoutingComparisonMetric("ff_battlestats")}
            >
              FF stats
            </button>
            <button
              type="button"
              className={scoutingComparisonMetric === "bsp_battlestats" ? "toggle-chip active" : "toggle-chip"}
              onClick={() => setScoutingComparisonMetric("bsp_battlestats")}
            >
              BSP stats
            </button>
            <button
              type="button"
              className={scoutingComparisonMetric === "networth" ? "toggle-chip active" : "toggle-chip"}
              onClick={() => setScoutingComparisonMetric("networth")}
            >
              Networth
            </button>
          </div>
          <ScoutingComparisonChart
            homeMembers={scoutingComparison?.home.members ?? []}
            enemyMembers={scoutingComparison?.enemy.members ?? []}
            enemyName={selectedWar.name}
            metric={scoutingComparisonMetric}
            metricLabel={scoutingComparisonMetricLabel(scoutingComparisonMetric).toLowerCase()}
          />
        </CollapsiblePanel>

        {!isMemberTrackingActive ? (
          <LiveTrackingInactivePanel
            collapsed={collapsedPanels.liveTrackingInactive ?? true}
            warState={isSelectedGlobalWar ? warState : "none"}
            onToggle={() => togglePanel("liveTrackingInactive")}
          />
        ) : null}

        <CollapsiblePanel
          title="Activity heatmaps"
          aside={
            isLoadingActivityHeatmap || isLoadingEnemyMemberActivityHeatmap
              ? "Loading"
              : heatmapHeaderAside(trackingMode)
          }
          collapsed={collapsedPanels.activityHeatmaps ?? false}
          onToggle={() => togglePanel("activityHeatmaps")}
          className="heatmap-panel"
        >
          <EnemyActivityHeatmapPanel
            activityHeatmap={activityHeatmap}
            enemyMemberActivityHeatmap={enemyMemberActivityHeatmap}
            enemyName={selectedWar.name}
            enemyFactionId={selectedWar.enemy_faction_id}
            mode={activityHeatmapMode}
            onModeChange={setActivityHeatmapMode}
            bigHitterIds={bigHitterActivityMemberIds}
            selectedMemberIds={selectedActivityMemberIds}
            scoutingMembers={enemyScouting?.members ?? []}
            onAddSelectedMember={addSelectedActivityMember}
            onRemoveSelectedMember={removeSelectedActivityMember}
            isLoadingMemberHeatmap={isLoadingEnemyMemberActivityHeatmap}
          />
        </CollapsiblePanel>

        <EnemyScoutingPanel
          scouting={enemyScouting}
          isLoading={isLoadingEnemyScouting}
          isRefreshing={isRefreshingEnemyScouting}
          canRefresh={canRefreshEnemyScouting}
          showStatusColumn={isMemberTrackingActive}
          onRefresh={refreshSelectedEnemyScouting}
        />

        <EnemyBigHittersPanel
          roster={enemyBigHitters}
          scoutingMembers={enemyScouting?.members ?? []}
          isLoading={isLoadingEnemyBigHitters}
          isUpdating={isUpdatingEnemyBigHitters}
          canEdit={canRefreshEnemyScouting}
          selectedMemberId={selectedBigHitterMemberId}
          onSelectedMemberIdChange={setSelectedBigHitterMemberId}
          onAdd={addSelectedBigHitter}
          onRemove={removeSelectedBigHitter}
        />

        <EnemyHitTrendWatchPanel
          trends={scoutingComparison?.hit_stats?.trends ?? []}
          health={scoutingComparison?.hit_stats?.health ?? null}
          isLoading={isLoadingScoutingComparison}
          collapsed={collapsedPanels.enemyHitTrends ?? true}
          onToggle={() => togglePanel("enemyHitTrends")}
        />

        <ChainWatchPanel
          data={chainWatch}
          nowMs={nowMs}
          isLoading={isLoadingChainWatch}
          trackingMode={trackingMode}
          trackingState={trackingFreshness.chainWatchState}
          trackingCadence={trackingFreshness.chainWatchCadence}
          trackingTone={trackingFreshness.chainWatchTone}
          trackingDetail={trackingFreshness.chainWatchDetail}
          canToggle={canRefreshEnemyScouting}
          isToggling={isTogglingChainWatch}
          collapsed={collapsedPanels.chainWatch ?? true}
          onCollapseToggle={() => togglePanel("chainWatch")}
          onEnabledToggle={toggleChainWatch}
        />

        <TrackingStatusPanel
          ref={trackingCadenceRef}
          war={selectedWar}
          mode={trackingMode}
          enemyStatusCheckedAt={statusCheckedAt}
          pushPressureUpdatedAt={pushPressureUpdatedAt}
          heatmapSampledAt={latestHeatmapSampledAt}
          revivableUpdatedAt={latestRevivableUpdatedAt}
          chainWatchUpdatedAt={chainWatch?.state?.last_checked_at ?? null}
          heatmapOpen={isActivityHeatmapsOpen}
        />
      </section>
    </>
  );
}

function LiveTrackingInactivePanel({
  collapsed,
  warState,
  onToggle,
}: {
  collapsed: boolean;
  warState: GlobalWarState;
  onToggle: () => void;
}) {
  return (
    <CollapsiblePanel
      title="War-room tracking paused"
      aside="Paused"
      collapsed={collapsed}
      onToggle={onToggle}
      className="live-tracking-inactive-panel"
    >
      <EmptyState text={pausedTrackingMessage(warState)} />
    </CollapsiblePanel>
  );
}

function pausedTrackingMessage(warState: GlobalWarState): string {
  if (warState === "practically_finished") {
    return "Push pressure, travel tracking, revivable members, enemy status, and Hospital monitor stopped at practical finish while we wait for Torn's official end.";
  }
  if (warState === "upcoming") {
    return "Push pressure, travel tracking, revivable members, and enemy status start two hours before official start. Hospital monitor starts when the war becomes current.";
  }
  return "Push pressure, travel tracking, revivable members, enemy status, and Hospital monitor are paused because there is no current tracking window.";
}

function ChainWatchPanel({
  data,
  nowMs,
  isLoading,
  trackingMode,
  trackingState,
  trackingCadence,
  trackingTone,
  trackingDetail,
  canToggle,
  isToggling,
  collapsed,
  onCollapseToggle,
  onEnabledToggle,
}: {
  data: ChainWatchResponse | null;
  nowMs: number;
  isLoading: boolean;
  trackingMode: TrackingMode;
  trackingState: string;
  trackingCadence: string;
  trackingTone: FreshnessTone;
  trackingDetail: string;
  canToggle: boolean;
  isToggling: boolean;
  collapsed: boolean;
  onCollapseToggle: () => void;
  onEnabledToggle: () => void;
}) {
  const state = data?.state ?? null;
  const nowSeconds = Math.floor(nowMs / 1000);
  const remainingSeconds = state?.timeout_at ? Math.max(0, state.timeout_at - nowSeconds) : null;
  const enabled = state?.enabled === 1;
  const sourceLabel = chainWatchSourceLabel(state?.source ?? null);
  const alertEligible = data?.computed.alert_eligible ?? false;
  const liveStatus = isLoading
    ? "Loading"
    : !state
      ? "No state"
      : enabled
        ? remainingSeconds === 0
          ? "Dropped"
          : "Watching"
        : "Disabled";
  const tone: FreshnessTone = !enabled
    ? "paused"
    : remainingSeconds === 0
      ? "stale"
      : alertEligible
        ? "live"
        : "fresh";
  const isLiveTracking = trackingMode === "live";
  const status = isLiveTracking ? liveStatus : trackingState;
  const metaTone = isLiveTracking ? tone : trackingTone;
  const cadence = isLiveTracking ? sourceLabel : trackingCadence;
  const detail = isLiveTracking ? "Tracks our faction chain timeout during current wars." : trackingDetail;

  return (
    <CollapsiblePanel
      title="Chain Watch"
      collapsed={collapsed}
      onToggle={onCollapseToggle}
      className="chain-watch-panel"
      control={
        <FreshnessMeta
          state={status}
          updatedAt={isLiveTracking ? state?.last_checked_at ?? null : undefined}
          cadence={cadence}
          detail={detail}
          tone={metaTone}
        />
      }
    >
      {!isLiveTracking ? (
        <EmptyState text={trackingDetail} />
      ) : (
        <>
          <div className="chain-watch-grid">
            <div className="chain-watch-primary">
              <span>Current chain</span>
              <strong>{state?.current_chain !== null && state?.current_chain !== undefined ? formatNumber(state.current_chain) : "-"}</strong>
            </div>
            <div className="chain-watch-primary">
              <span>Time left</span>
              <strong>{remainingSeconds === null ? "-" : remainingSeconds <= 0 ? "Dropped" : formatCountdownDuration(remainingSeconds)}</strong>
            </div>
            <ChainWatchDetail label="Next check" value={state?.scheduled_alarm_at ? formatLongDateTime(state.scheduled_alarm_at) : "-"} />
            <ChainWatchDetail label="Last hit" value={formatChainWatchLastHit(state)} />
            <ChainWatchDetail label="Alert eligible" value={alertEligible ? "Above 100" : "No"} />
            <ChainWatchDetail label="Last alert" value={formatChainWatchLastAlert(state)} />
          </div>
          {state?.last_error ? <p className="chain-watch-error">{state.last_error}</p> : null}
          {canToggle ? (
            <button
              type="button"
              className="panel-action-button chain-watch-toggle"
              onClick={onEnabledToggle}
              disabled={isToggling || isLoading || !state}
            >
              {isToggling ? "Saving" : enabled ? "Disable Chain Watch" : "Enable Chain Watch"}
            </button>
          ) : null}
        </>
      )}
    </CollapsiblePanel>
  );
}

function ChainWatchDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="chain-watch-detail">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function chainWatchSourceLabel(source: string | null | undefined): string {
  if (source === "live_confirm") {
    return "Live confirm";
  }
  if (source === "stale") {
    return "Stored stale";
  }
  if (source === "dropped") {
    return "Dropped";
  }
  return "Stored attacks";
}

function formatChainWatchLastHit(state: ChainWatchResponse["state"] | null): string {
  if (!state?.last_hit_at) {
    return "-";
  }

  const attacker = state.last_hit_attacker_name ?? "Unknown";
  const defender = state.last_hit_defender_name ?? "Unknown";
  return `${attacker} v ${defender}`;
}

function formatChainWatchLastAlert(state: ChainWatchResponse["state"] | null): string {
  if (!state) {
    return "-";
  }
  if (state.drop_sent_at) {
    return `Dropped ${formatRelativeTime(state.drop_sent_at)}`;
  }
  if (state.warning_30_sent_at) {
    return `30s ${formatRelativeTime(state.warning_30_sent_at)}`;
  }
  if (state.warning_60_sent_at) {
    return `60s ${formatRelativeTime(state.warning_60_sent_at)}`;
  }
  return "-";
}

const TrackingStatusPanel = React.forwardRef<HTMLElement, {
  war: WarSummary;
  mode: TrackingMode;
  enemyStatusCheckedAt: number | null;
  pushPressureUpdatedAt: number | null;
  heatmapSampledAt: number | null;
  revivableUpdatedAt: number | null;
  chainWatchUpdatedAt: number | null;
  heatmapOpen: boolean;
}>(function TrackingStatusPanel({
  war,
  mode,
  enemyStatusCheckedAt,
  pushPressureUpdatedAt,
  heatmapSampledAt,
  revivableUpdatedAt,
  chainWatchUpdatedAt,
  heatmapOpen,
}, ref) {
  const freshness = trackingFreshnessForMode(mode);
  const windowLabel = formatTrackingWindow(war, mode);

  return (
    <section ref={ref} className="panel war-room-tracking-status-panel">
      <PanelHeader title="Tracking cadence" />
      <p className="panel-description">
        {windowLabel} These rows show how often each War Room section updates for the selected war.
      </p>
      <div className="tracking-status-grid">
        <TrackingStatusItem
          label="Enemy status and travel"
          value={freshness.enemyCadence}
          updatedAt={enemyStatusCheckedAt}
          detail={freshness.enemyDetail}
        />
        <TrackingStatusItem
          label="Push pressure"
          value={freshness.pushCadence}
          updatedAt={pushPressureUpdatedAt}
          detail={freshness.pushDetail}
        />
        <TrackingStatusItem
          label="Activity heatmaps"
          value={freshness.heatmapCadence}
          updatedAt={heatmapSampledAt}
          detail={heatmapOpen ? freshness.heatmapDetail : freshness.heatmapClosedDetail}
        />
        <TrackingStatusItem
          label="Revivable members"
          value={freshness.revivableCadence}
          updatedAt={revivableUpdatedAt}
          detail={freshness.revivableDetail}
        />
        <TrackingStatusItem
          label="Chain Watch"
          value={freshness.chainWatchCadence}
          updatedAt={chainWatchUpdatedAt}
          detail={freshness.chainWatchDetail}
        />
        <TrackingStatusItem
          label="Hospital monitor"
          value={freshness.hospitalCadence}
          updatedAt={undefined}
          detail={freshness.hospitalDetail}
        />
      </div>
    </section>
  );
});

function TrackingStatusItem({
  label,
  value,
  updatedAt,
  detail,
}: {
  label: string;
  value: string;
  updatedAt?: number | null;
  detail: string;
}) {
  const updatedLabel = updatedAt === undefined
    ? "Runs in the live monitor"
    : updatedAt
      ? `Last updated ${formatRelativeTime(updatedAt)}`
      : "No update yet";

  return (
    <div className="tracking-status-item">
      <div className="tracking-status-item-header">
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <small>{updatedLabel}</small>
      <p>{detail}</p>
    </div>
  );
}

function heatmapHeaderAside(mode: TrackingMode): string {
  return mode === "inactive" ? "View only" : "Every 15m";
}

type TrackingFreshness = {
  state: string;
  tone: FreshnessTone;
  enemyCadence: string;
  enemyDetail: string;
  pushCadence: string;
  pushDetail: string;
  heatmapState: string;
  heatmapTone: FreshnessTone;
  heatmapCadence: string;
  heatmapDetail: string;
  heatmapClosedDetail: string;
  revivableState: string;
  revivableTone: FreshnessTone;
  revivableCadence: string;
  revivableDetail: string;
  chainWatchState: string;
  chainWatchTone: FreshnessTone;
  chainWatchCadence: string;
  chainWatchDetail: string;
  hospitalState: string;
  hospitalTone: FreshnessTone;
  hospitalCadence: string;
  hospitalDetail: string;
};

function trackingFreshnessForMode(mode: TrackingMode): TrackingFreshness {
  if (mode === "live") {
    return {
      state: "Live",
      tone: "live",
      enemyCadence: "Every 1m",
      enemyDetail: "Updates every minute on the current-war enemy tracking cadence.",
      pushCadence: "1m / 5m history",
      pushDetail: "Current pressure updates every minute on the current-war enemy tracking cadence. The 24 hour history updates every 5 minutes.",
      heatmapState: "Sampling",
      heatmapTone: "live",
      heatmapCadence: "Every 15m",
      heatmapDetail: "Updates every 15 minutes while current-war tracking is live and this section is open.",
      heatmapClosedDetail: "Loads when opened, then updates every 15 minutes while current-war tracking is live.",
      revivableState: "Sampling",
      revivableTone: "live",
      revivableCadence: "Enemy 1m / Home 15m",
      revivableDetail: "Enemy revivable status updates every minute on the current-war enemy tracking cadence. Home revivable status updates every 15 minutes.",
      chainWatchState: "Live",
      chainWatchTone: "live",
      chainWatchCadence: "15s / alarms",
      chainWatchDetail: "Updates from the live chain monitor while this is the current war.",
      hospitalState: "Live",
      hospitalTone: "live",
      hospitalCadence: "Real time",
      hospitalDetail: "Updates from the Hospital monitor while this is the current war.",
    };
  }

  if (mode === "pre-live") {
    return {
      state: "Pre-war",
      tone: "fresh",
      enemyCadence: "Every 5m",
      enemyDetail: "Updates every 5 minutes on the pre-war enemy tracking cadence.",
      pushCadence: "Every 5m",
      pushDetail: "Updates every 5 minutes on the pre-war enemy tracking cadence.",
      heatmapState: "Sampling",
      heatmapTone: "fresh",
      heatmapCadence: "Every 15m",
      heatmapDetail: "Updates every 15 minutes during the tracking window while this section is open.",
      heatmapClosedDetail: "Loads when opened, then updates every 15 minutes during the tracking window.",
      revivableState: "Sampling",
      revivableTone: "fresh",
      revivableCadence: "Enemy 5m / Home 15m",
      revivableDetail: "Enemy revivable status updates every 5 minutes on the pre-war enemy tracking cadence. Home revivable status updates every 15 minutes.",
      chainWatchState: "Waiting",
      chainWatchTone: "paused",
      chainWatchCadence: "Starts live",
      chainWatchDetail: "Starts when the selected war becomes current.",
      hospitalState: "Waiting",
      hospitalTone: "paused",
      hospitalCadence: "Starts live",
      hospitalDetail: "Starts when the selected war becomes current.",
    };
  }

  return {
    state: "Paused",
    tone: "paused",
    enemyCadence: "Paused",
    enemyDetail: "Paused outside the selected war's tracking window.",
    pushCadence: "Paused",
    pushDetail: "Paused outside the selected war's tracking window.",
    heatmapState: "Paused",
    heatmapTone: "paused",
    heatmapCadence: "Paused",
    heatmapDetail: "Paused outside the selected war's tracking window.",
    heatmapClosedDetail: "Paused outside the selected war's tracking window. Heatmaps remain available to view until the next tracking window starts.",
    revivableState: "Paused",
    revivableTone: "paused",
    revivableCadence: "Paused",
    revivableDetail: "Paused outside the selected war's tracking window.",
    chainWatchState: "Paused",
    chainWatchTone: "paused",
    chainWatchCadence: "Paused",
    chainWatchDetail: "Paused outside the selected war's tracking window.",
    hospitalState: "Paused",
    hospitalTone: "paused",
    hospitalCadence: "Paused",
    hospitalDetail: "Paused until the selected war becomes current.",
  };
}

function formatTrackingWindow(war: WarSummary, mode: TrackingMode): string {
  if (mode === "live") {
    return "Current-war tracking is live. Fast-changing enemy status, travel, and push pressure update about every minute, while heavier history and heatmap views update less often.";
  }

  const officialStart = war.official_start_time ?? war.practical_start_time;
  const trackingStart = officialStart - 2 * 60 * 60;
  if (mode === "pre-live") {
    return `Pre-war tracking is active. It began at ${formatLongDateTime(trackingStart)} and will switch to one minute updates when the war starts.`;
  }

  const finishTime = war.practical_finish_time ?? war.official_end_time ?? null;
  if (finishTime) {
    return `Tracking is paused because this war is practically finished. It stopped at practical finish: ${formatLongDateTime(finishTime)}.`;
  }

  return `Tracking has not started yet. It starts two hours before official start: ${formatLongDateTime(trackingStart)}.`;
}

function getLatestHeatmapSampledAt(activityHeatmap: FactionActivityHeatmapResponse | null): number | null {
  if (!activityHeatmap || activityHeatmap.rows.length === 0) {
    return null;
  }

  return Math.max(...activityHeatmap.rows.map((row) => row.sampled_at));
}

function getLatestMemberUpdatedAt(members: EnemyFactionMember[]): number | null {
  const updatedAtValues = members
    .map((member) => member.updated_at)
    .filter((updatedAt) => Number.isFinite(updatedAt) && updatedAt > 0);

  return updatedAtValues.length > 0 ? Math.max(...updatedAtValues) : null;
}

function EnemyActivityHeatmapPanel({
  activityHeatmap,
  enemyMemberActivityHeatmap,
  enemyName,
  enemyFactionId,
  mode,
  onModeChange,
  bigHitterIds,
  selectedMemberIds,
  scoutingMembers,
  onAddSelectedMember,
  onRemoveSelectedMember,
  isLoadingMemberHeatmap,
}: {
  activityHeatmap: FactionActivityHeatmapResponse | null;
  enemyMemberActivityHeatmap: EnemyMemberActivityHeatmapResponse | null;
  enemyName: string;
  enemyFactionId: number | null;
  mode: ActivityHeatmapMode;
  onModeChange: (mode: ActivityHeatmapMode) => void;
  bigHitterIds: number[];
  selectedMemberIds: number[];
  scoutingMembers: EnemyFactionMember[];
  onAddSelectedMember: (memberId: number) => void;
  onRemoveSelectedMember: (memberId: number) => void;
  isLoadingMemberHeatmap: boolean;
}) {
  const selectedMemberSet = new Set(selectedMemberIds);
  const selectableMembers = scoutingMembers
    .filter((member) => !selectedMemberSet.has(member.member_id))
    .sort((a, b) => bestBattleStats(b) - bestBattleStats(a) || a.name.localeCompare(b.name));
  const selectedMembers = selectedMemberIds
    .map((memberId) => scoutingMembers.find((member) => member.member_id === memberId))
    .filter((member): member is EnemyFactionMember => Boolean(member));
  const memberRows = React.useMemo(
    () => aggregateEnemyMemberActivityRows(enemyMemberActivityHeatmap, enemyFactionId),
    [enemyFactionId, enemyMemberActivityHeatmap],
  );
  const bigHitterSummary = React.useMemo(
    () => summarizeEnemyMembers(scoutingMembers, bigHitterIds),
    [bigHitterIds, scoutingMembers],
  );
  const selectedSummary = React.useMemo(
    () => summarizeEnemyMembers(scoutingMembers, selectedMemberIds),
    [scoutingMembers, selectedMemberIds],
  );

  return (
    <>
      <p className="panel-description">
        Shows when each faction is usually active, based on Torn last-action times and scaled against faction average.
      </p>
      <div className="panel-toggle-row" aria-label="Activity heatmap mode">
        <button
          type="button"
          className={mode === "faction" ? "toggle-chip active" : "toggle-chip"}
          onClick={() => onModeChange("faction")}
        >
          Faction
        </button>
        <button
          type="button"
          className={mode === "bigHitters" ? "toggle-chip active" : "toggle-chip"}
          onClick={() => onModeChange("bigHitters")}
        >
          Big hitters
        </button>
        <button
          type="button"
          className={mode === "selectedPlayers" ? "toggle-chip active" : "toggle-chip"}
          onClick={() => onModeChange("selectedPlayers")}
        >
          Selected players
        </button>
      </div>

      {mode === "faction" ? (
        <div className="heatmap-stack">
          <FactionActivityHeatmap
            rows={activityHeatmap?.rows ?? []}
            factionId={activityHeatmap?.home_faction_id ?? null}
            label="Buttgrass"
            color="blue"
          />
          <FactionActivityHeatmap
            rows={activityHeatmap?.rows ?? []}
            factionId={enemyFactionId}
            label={enemyName}
            color="red"
          />
          <FactionActivityComparisonHeatmap
            rows={activityHeatmap?.rows ?? []}
            homeFactionId={activityHeatmap?.home_faction_id ?? null}
            enemyFactionId={enemyFactionId}
            homeLabel="Buttgrass"
            enemyLabel={enemyName}
          />
        </div>
      ) : null}

      {mode === "bigHitters" ? (
        <EnemyMemberActivityHeatmapView
          label="Big hitters"
          memberCount={bigHitterIds.length}
          rows={memberRows}
          factionId={enemyFactionId}
          summary={bigHitterSummary}
          emptyText={
            bigHitterIds.length === 0
              ? "No big hitters selected"
              : isLoadingMemberHeatmap
                ? "Loading big hitter activity"
                : "No big hitter heatmap samples yet"
          }
        />
      ) : null}

      {mode === "selectedPlayers" ? (
        <div className="selected-player-heatmap-mode">
          <div className="enemy-player-select-row">
            <select
              defaultValue=""
              onChange={(event) => {
                const memberId = Number(event.currentTarget.value);
                event.currentTarget.value = "";
                onAddSelectedMember(memberId);
              }}
              disabled={selectableMembers.length === 0}
              aria-label="Enemy activity heatmap member"
            >
              <option value="">Add player</option>
              {selectableMembers.map((member) => (
                <option key={member.member_id} value={member.member_id}>
                  {member.name} ({formatBattleStats(bestBattleStats(member))})
                </option>
              ))}
            </select>
            {selectedMembers.length > 0 ? (
              <div className="selected-player-chips">
                {selectedMembers.map((member) => (
                  <button
                    key={member.member_id}
                    type="button"
                    className="selected-player-chip"
                    onClick={() => onRemoveSelectedMember(member.member_id)}
                    title={`Remove ${member.name}`}
                  >
                    {member.name}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <EnemyMemberActivityHeatmapView
            label="Selected players"
            memberCount={selectedMemberIds.length}
            rows={memberRows}
            factionId={enemyFactionId}
            summary={selectedSummary}
            emptyText={
              selectedMemberIds.length === 0
                ? "No players selected"
                : isLoadingMemberHeatmap
                  ? "Loading selected player activity"
                  : "No selected player heatmap samples yet"
            }
          />
        </div>
      ) : null}
    </>
  );
}

function EnemyMemberActivityHeatmapView({
  label,
  memberCount,
  rows,
  factionId,
  summary,
  emptyText,
}: {
  label: string;
  memberCount: number;
  rows: FactionActivityHeatmapResponse["rows"];
  factionId: number | null;
  summary: EnemyMemberActivitySummary;
  emptyText: string;
}) {
  if (memberCount === 0 || rows.length === 0 || factionId === null) {
    return <EmptyState text={emptyText} />;
  }

  return (
    <div className="enemy-member-activity-mode">
      <div className="enemy-member-activity-summary" aria-label={`${label} current status`}>
        <span>Total {formatNumber(summary.total)}</span>
        <span>Online {formatNumber(summary.online)}</span>
        <span>Recent {formatNumber(summary.recentlyActive)}</span>
        <span>Hospital {formatNumber(summary.hospitalized)}</span>
        <span>Travel {formatNumber(summary.traveling)}</span>
      </div>
      <div className="heatmap-stack heatmap-stack-single">
        <FactionActivityHeatmap
          rows={rows}
          factionId={factionId}
          label={label}
          color="red"
        />
      </div>
    </div>
  );
}

type EnemyMemberActivitySummary = {
  total: number;
  online: number;
  recentlyActive: number;
  hospitalized: number;
  traveling: number;
};

function aggregateEnemyMemberActivityRows(
  heatmap: EnemyMemberActivityHeatmapResponse | null,
  factionId: number | null,
): FactionActivityHeatmapResponse["rows"] {
  if (!heatmap || factionId === null) {
    return [];
  }

  const buckets = new Map<string, FactionActivityHeatmapResponse["rows"][number]>();
  for (const row of heatmap.rows) {
    const intervalIndex = Number(row.interval_index);
    if (!Number.isInteger(intervalIndex) || intervalIndex < 0 || intervalIndex >= 96) {
      continue;
    }

    const key = `${row.date}:${intervalIndex}`;
    const existing = buckets.get(key) ?? {
      faction_id: factionId,
      date: row.date,
      interval_index: intervalIndex,
      active_count: 0,
      total_count: 0,
      sampled_at: row.sampled_at,
    };
    existing.active_count += row.is_recently_active ? 1 : 0;
    existing.total_count += 1;
    existing.sampled_at = Math.max(existing.sampled_at, row.sampled_at);
    buckets.set(key, existing);
  }

  return [...buckets.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || a.interval_index - b.interval_index,
  );
}

function summarizeEnemyMembers(
  members: EnemyFactionMember[],
  memberIds: number[],
): EnemyMemberActivitySummary {
  const memberSet = new Set(memberIds);
  const selected = members.filter((member) => memberSet.has(member.member_id));
  const nowSeconds = Math.floor(Date.now() / 1000);

  return {
    total: memberIds.length,
    online: selected.filter((member) => member.last_action_status?.toLowerCase() === "online").length,
    recentlyActive: selected.filter((member) =>
      Number(member.last_action_timestamp ?? 0) > 0 &&
      nowSeconds - Number(member.last_action_timestamp) <= 5 * 60,
    ).length,
    hospitalized: selected.filter((member) => member.status_state === "Hospital").length,
    traveling: selected.filter((member) =>
      member.status_state === "Traveling" || member.status_state === "Abroad",
    ).length,
  };
}

function HospitalMonitorLinkPanel({
  isWarLive,
  onOpenHospitalMonitor,
  trackingState,
  trackingCadence,
  trackingTone,
  trackingDetail,
  onShowTrackingDetails,
}: {
  isWarLive: boolean;
  onOpenHospitalMonitor: () => void;
  trackingState: string;
  trackingCadence: string;
  trackingTone: FreshnessTone;
  trackingDetail: string;
  onShowTrackingDetails: () => void;
}) {
  return (
    <section className="panel war-room-hospital-monitor-panel">
      <PanelHeader
        icon={<Siren size={18} />}
        title="Hospital monitor"
        control={
          <FreshnessMeta
            state={trackingState}
            cadence={trackingCadence}
            detail={trackingDetail}
            tone={trackingTone}
            onClick={onShowTrackingDetails}
          />
        }
      />
      <p className="panel-description">
        {isWarLive
          ? "Watch enemy hospital status in real time while the war is active."
          : "Hospital monitoring becomes live when the selected war is current."}
      </p>
      <button
        type="button"
        className="panel-action-button war-room-monitor-link"
        onClick={onOpenHospitalMonitor}
        disabled={!isWarLive}
      >
        <Siren size={15} />
        {isWarLive ? "Open monitor" : "Monitor unavailable"}
      </button>
    </section>
  );
}

function EnemyBigHittersPanel({
  roster,
  scoutingMembers,
  isLoading,
  isUpdating,
  canEdit,
  selectedMemberId,
  onSelectedMemberIdChange,
  onAdd,
  onRemove,
}: {
  roster: EnemyBigHittersResponse | null;
  scoutingMembers: EnemyFactionMember[];
  isLoading: boolean;
  isUpdating: boolean;
  canEdit: boolean;
  selectedMemberId: string;
  onSelectedMemberIdChange: (memberId: string) => void;
  onAdd: () => void;
  onRemove: (memberId: number) => void;
}) {
  const bigHitters = roster?.big_hitters ?? [];
  const bigHitterIds = new Set(bigHitters.map((member) => member.member_id));
  const candidates = scoutingMembers
    .filter((member) => !bigHitterIds.has(member.member_id))
    .sort((a, b) => bestBattleStats(b) - bestBattleStats(a) || a.name.localeCompare(b.name));
  const selectedCandidate = candidates.find((member) => String(member.member_id) === selectedMemberId);

  return (
    <section className="panel enemy-big-hitters-panel">
      <PanelHeader
        title="Enemy big hitters"
        aside={isLoading ? "Loading" : `${formatNumber(bigHitters.length)} members`}
        control={
          canEdit ? (
            <div className="enemy-big-hitter-controls">
              <select
                value={selectedMemberId}
                onChange={(event) => onSelectedMemberIdChange(event.target.value)}
                disabled={isUpdating || candidates.length === 0}
                aria-label="Enemy big hitter member"
              >
                <option value="">Add member</option>
                {candidates.map((member) => (
                  <option key={member.member_id} value={member.member_id}>
                    {member.name} ({formatBattleStats(bestBattleStats(member))})
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="icon-text-button"
                onClick={onAdd}
                disabled={isUpdating || !selectedCandidate}
                title="Add selected enemy member"
              >
                <Plus size={15} />
                Add
              </button>
            </div>
          ) : undefined
        }
      />
      <p className="panel-description">
        One-time roster initially seeded at {formatBattleStats(roster?.threshold ?? 5_000_000_000)} or higher, then maintained manually.
      </p>
      {bigHitters.length === 0 ? (
        <EmptyState text={isLoading ? "Loading big hitters" : "No enemy big hitters selected"} />
      ) : (
        <StickyTable renderHeader={() => (
          <tr>
            <th>Member</th>
            <th>Best stats</th>
            <th>FF stats</th>
            <th>BSP stats</th>
            <th>Status</th>
            <th>Added</th>
            {canEdit ? <th aria-label="Actions" /> : null}
          </tr>
        )}>
          {bigHitters.map((member) => (
            <tr key={member.member_id}>
              <td>
                <a
                  href={`https://www.torn.com/profiles.php?XID=${member.member_id}`}
                  target="_blank"
                  rel="noreferrer"
                  title="Open Torn profile"
                >
                  {member.member_name}
                </a>
              </td>
              <td>{formatBattleStats(bestBattleStats(member))}</td>
              <td>{formatNullableBattleStats(member.ff_battlestats)}</td>
              <td>{formatNullableBattleStats(member.bsp_battlestats)}</td>
              <td title={member.last_action_timestamp ? `Last action ${formatRelativeTime(member.last_action_timestamp)}` : undefined}>
                {member.status_state ?? member.last_action_status ?? "-"}
              </td>
              <td>{formatRelativeTime(member.created_at)}</td>
              {canEdit ? (
                <td>
                  <button
                    type="button"
                    className="icon-text-button danger"
                    onClick={() => onRemove(member.member_id)}
                    disabled={isUpdating}
                    title={`Remove ${member.member_name}`}
                  >
                    <Trash2 size={15} />
                    Remove
                  </button>
                </td>
              ) : null}
            </tr>
          ))}
        </StickyTable>
      )}
    </section>
  );
}

function bestBattleStats(member: {
  ff_battlestats: number | null;
  bsp_battlestats: number | null;
}): number {
  return Math.max(member.ff_battlestats ?? 0, member.bsp_battlestats ?? 0);
}

function formatBattleStats(value: number): string {
  return value > 0 ? formatNumber(value) : "-";
}

function formatNullableBattleStats(value: number | null): string {
  return value === null ? "-" : formatNumber(value);
}

function EnemyHitTrendWatchPanel({
  trends,
  health,
  isLoading,
  collapsed,
  onToggle,
}: {
  trends: EnemyHitStatTrend[];
  health: NonNullable<ScoutingComparisonResponse["hit_stats"]>["health"] | null;
  isLoading: boolean;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const [sort, setSort] = React.useState<EnemyHitTrendSort>({
    key: "priority",
    direction: "desc",
  });
  const aside = isLoading
    ? "Loading"
    : health
      ? `${formatNumber(health.completed)}/${formatNumber(health.total)} snapshots`
      : "Pending";
  const sortedTrends = React.useMemo(() => sortEnemyHitTrends(trends, sort), [trends, sort]);
  const renderHeader = () => (
    <tr>
      <EnemyHitTrendSortableHeader label="Member" sortKey="member_name" sort={sort} onSortChange={setSort} />
      <EnemyHitTrendSortableHeader label="Priority" sortKey="priority" sort={sort} onSortChange={setSort} />
      <EnemyHitTrendSortableHeader
        label="Ranked Hits/wk"
        sortKey="rankedwarhits_per_week"
        sort={sort}
        onSortChange={setSort}
      />
      <EnemyHitTrendSortableHeader label="Retals/wk" sortKey="retals_per_week" sort={sort} onSortChange={setSort} />
      <EnemyHitTrendSortableHeader
        label="Special Ammo/wk"
        sortKey="specialammoused_per_week"
        sort={sort}
        onSortChange={setSort}
      />
      <EnemyHitTrendSortableHeader
        label="Gun/Melee/Temp"
        sortKey="hit_mix_per_week"
        sort={sort}
        onSortChange={setSort}
        title="Gun hits = attack hits minus melee hits and temp hits. Melee hits = piercing, slashing, clubbing, mechanical, and hand-to-hand hits. Sorting uses total gun, melee, and temp activity."
      />
    </tr>
  );

  return (
    <CollapsiblePanel
      title="Members to watch"
      aside={aside}
      collapsed={collapsed}
      onToggle={onToggle}
      className="enemy-hit-trends-panel"
    >
      <p className="panel-description">
        Uses current and 4 previous weekly snapshots to show averaged enemy stats.
      </p>
      {health ? (
        <div className="enemy-hit-trend-health" aria-label="Enemy hit trend fill status">
          <span title="Historical hit-stat snapshots loaded">
            Loaded {formatNumber(health.completed)}
          </span>
          <span title="Historical hit-stat snapshots still waiting for fetch">
            Pending {formatNumber(health.pending)}
          </span>
          <span title="Historical hit-stat snapshots still retryable before the retry cap">
            Retryable {formatNumber(health.retryable)}
          </span>
          <span title="Historical hit-stat snapshots that reached the retry cap">
            Failed {formatNumber(health.failed)}
          </span>
        </div>
      ) : null}
      {trends.length === 0 ? (
        <EmptyState text={isLoading ? "Loading hit trends" : "Hit trend data is still filling"} />
      ) : (
        <StickyTable className="enemy-hit-trend-table" renderHeader={renderHeader}>
          {sortedTrends.map((trend) => (
            <tr key={trend.member_id}>
              <td>
                <a
                  href={`https://www.torn.com/profiles.php?XID=${trend.member_id}`}
                  target="_blank"
                  rel="noreferrer"
                  title={`Open ${trend.member_name} on Torn. Trend uses ${formatNumber(trend.snapshot_count)} snapshots from ${trend.oldest_snapshot_date} to ${trend.latest_snapshot_date}.`}
                >
                  {trend.member_name}
                </a>
              </td>
              <td>
                <span className={`watch-priority-badge ${trend.priority}`}>
                  {watchPriorityLabel(trend.priority)}
                </span>
              </td>
              <td>
                <TrendTooltipValue title={hitStatSnapshotTitle(trend, "rankedwarhits")}>
                  {formatTrendRate(trend.rankedwarhits_per_week)}
                </TrendTooltipValue>
              </td>
              <td>
                <TrendTooltipValue title={hitStatSnapshotTitle(trend, "retals")}>
                  {formatTrendRate(trend.retals_per_week)}
                </TrendTooltipValue>
              </td>
              <td>
                <TrendTooltipValue title={hitStatSnapshotTitle(trend, "specialammoused")}>
                  {formatTrendRate(trend.specialammoused_per_week)}
                </TrendTooltipValue>
              </td>
              <td>
                <TrendTooltipValue title={hitTypeRatioTitle(trend)}>
                  {formatHitTypeRatio(trend)}
                </TrendTooltipValue>
              </td>
            </tr>
          ))}
        </StickyTable>
      )}
    </CollapsiblePanel>
  );
}

type EnemyHitTrendSortKey =
  | "member_name"
  | "priority"
  | "rankedwarhits_per_week"
  | "retals_per_week"
  | "specialammoused_per_week"
  | "hit_mix_per_week";

type EnemyHitTrendSort = {
  key: EnemyHitTrendSortKey;
  direction: "asc" | "desc";
};

function sortEnemyHitTrends(trends: EnemyHitStatTrend[], sort: EnemyHitTrendSort): EnemyHitStatTrend[] {
  const direction = sort.direction === "desc" ? -1 : 1;

  return [...trends].sort((left, right) => {
    const leftValue = enemyHitTrendSortValue(left, sort.key);
    const rightValue = enemyHitTrendSortValue(right, sort.key);
    let comparison = 0;

    if (typeof leftValue === "string" || typeof rightValue === "string") {
      comparison = String(leftValue).localeCompare(String(rightValue));
    } else {
      comparison = leftValue - rightValue;
    }

    if (comparison !== 0) {
      return comparison * direction;
    }

    if (sort.key === "priority") {
      const rankedComparison = right.rankedwarhits_per_week - left.rankedwarhits_per_week;
      if (rankedComparison !== 0) {
        return rankedComparison;
      }

      const retalComparison = right.retals_per_week - left.retals_per_week;
      if (retalComparison !== 0) {
        return retalComparison;
      }

      const specialAmmoComparison = right.specialammoused_per_week - left.specialammoused_per_week;
      if (specialAmmoComparison !== 0) {
        return specialAmmoComparison;
      }
    }

    return left.member_name.localeCompare(right.member_name);
  });
}

function enemyHitTrendSortValue(
  trend: EnemyHitStatTrend,
  key: EnemyHitTrendSortKey,
): string | number {
  if (key === "member_name") {
    return trend.member_name.toLowerCase();
  }

  if (key === "priority") {
    return enemyHitTrendPriorityValue(trend.priority);
  }

  if (key === "hit_mix_per_week") {
    return trend.gunhits_per_week + trend.meleehits_per_week + trend.temphits_per_week;
  }

  return Number(trend[key] ?? 0);
}

function enemyHitTrendPriorityValue(priority: EnemyHitStatTrend["priority"]): number {
  if (priority === "high") {
    return 3;
  }
  if (priority === "medium") {
    return 2;
  }
  return 1;
}

function EnemyHitTrendSortableHeader({
  label,
  sortKey,
  sort,
  onSortChange,
  title,
}: {
  label: React.ReactNode;
  sortKey: EnemyHitTrendSortKey;
  sort: EnemyHitTrendSort;
  onSortChange: (sort: EnemyHitTrendSort) => void;
  title?: string;
}) {
  const isActive = sort.key === sortKey;
  const nextDirection = isActive && sort.direction === "desc" ? "asc" : "desc";

  return (
    <th title={title}>
      <button
        type="button"
        className={isActive ? "sort-button active" : "sort-button"}
        onClick={() => onSortChange({ key: sortKey, direction: nextDirection })}
      >
        {label}
        {isActive ? (
          sort.direction === "desc" ? <ArrowDown size={14} /> : <ArrowUp size={14} />
        ) : null}
      </button>
    </th>
  );
}

function TrendTooltipValue({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string | undefined;
}) {
  if (!title) {
    return <>{children}</>;
  }

  return (
    <span className="tooltip-value" title={title}>
      {children}
    </span>
  );
}

function watchPriorityLabel(priority: EnemyHitStatTrend["priority"]): string {
  if (priority === "high") {
    return "High";
  }
  if (priority === "medium") {
    return "Medium";
  }
  return "Low";
}

function formatTrendRate(value: number): string {
  if (!Number.isFinite(value)) {
    return "-";
  }
  if (Math.abs(value) >= 10) {
    return formatNumber(Math.round(value));
  }
  return value.toFixed(1);
}

function formatHitTypeRatio(trend: Pick<
  EnemyHitStatTrend,
  "gunhits_per_week" | "meleehits_per_week" | "temphits_per_week"
>): string {
  return [
    trend.gunhits_per_week,
    trend.meleehits_per_week,
    trend.temphits_per_week,
  ].map(formatTrendRate).join("/");
}

function hitTypeRatioTitle(trend: EnemyHitStatTrend): string | undefined {
  const values = [
    trend.oldest_gunhits,
    trend.oldest_meleehits,
    trend.oldest_temphits,
    trend.latest_gunhits,
    trend.latest_meleehits,
    trend.latest_temphits,
  ];
  if (!values.every(Number.isFinite)) {
    return undefined;
  }

  const oldest = [
    trend.oldest_gunhits,
    trend.oldest_meleehits,
    trend.oldest_temphits,
  ].map(formatNumber).join("/");
  const latest = [
    trend.latest_gunhits,
    trend.latest_meleehits,
    trend.latest_temphits,
  ].map(formatNumber).join("/");

  return [
    `Average per week: ${formatHitTypeRatio(trend)}`,
    `${trend.oldest_snapshot_date}: ${oldest}`,
    `${trend.latest_snapshot_date}: ${latest}`,
  ].join("\n");
}

function hitStatSnapshotTitle(
  trend: EnemyHitStatTrend,
  stat: "rankedwarhits" | "retals" | "specialammoused",
): string | undefined {
  const snapshots = trend.snapshots?.filter((snapshot) => Number.isFinite(snapshot[stat])) ?? [];
  if (snapshots.length === 0) {
    return undefined;
  }

  return snapshots
    .map((snapshot) => `${snapshot.snapshot_date}: ${formatNumber(Number(snapshot[stat]))}`)
    .join("\n");
}

function EnemyStatusSummaryPanel({
  members,
  statusCheckedAt,
  isLoading,
  trackingState,
  trackingCadence,
  trackingTone,
  trackingDetail,
  onShowTrackingDetails,
}: {
  members: EnemyFactionMember[];
  statusCheckedAt: number | null;
  isLoading: boolean;
  trackingState: string;
  trackingCadence: string;
  trackingTone: FreshnessTone;
  trackingDetail: string;
  onShowTrackingDetails: () => void;
}) {
  const summary = summarizeEnemyStatuses(members);

  return (
    <section className="panel enemy-status-summary-panel">
      <PanelHeader
        title="Enemy status summary"
        control={
          <FreshnessMeta
            state={isLoading ? "Loading" : trackingState}
            updatedAt={statusCheckedAt}
            cadence={trackingCadence}
            detail={trackingDetail}
            tone={trackingTone}
            onClick={onShowTrackingDetails}
          />
        }
      />
      <div className="enemy-status-summary-grid">
        <StatusSummaryItem label="Okay" value={summary.okay} />
        <StatusSummaryItem label="Traveling" value={summary.traveling} tone="traveling" />
        <StatusSummaryItem label="Abroad" value={summary.abroad} tone="abroad" />
        <StatusSummaryItem label="Hospital" value={summary.hospital} tone="danger" />
        <StatusSummaryItem label="Jail" value={summary.jail} tone="danger" />
        <StatusSummaryItem label="Other" value={summary.other} tone="muted" tooltip={formatStatusSummaryTooltip(summary.otherMembers)} />
        <StatusSummaryItem label="Unknown" value={summary.unknown} tone="muted" tooltip={formatStatusSummaryTooltip(summary.unknownMembers)} />
        <StatusSummaryItem label="Revivable" value={summary.revivable} tone="good" />
      </div>
    </section>
  );
}

function StatusSummaryItem({
  label,
  value,
  tooltip,
  tone = "okay",
}: {
  label: string;
  value: number;
  tooltip?: string;
  tone?: "okay" | "traveling" | "abroad" | "danger" | "muted" | "good";
}) {
  return (
    <div className={`enemy-status-summary-item ${tone}`} title={tooltip}>
      <span>{label}</span>
      <strong>{formatNumber(value)}</strong>
    </div>
  );
}

function EnemyPushPressurePanel({
  data,
  isLoading,
  collapsed,
  onToggle,
  trackingState,
  trackingCadence,
  trackingTone,
  trackingDetail,
  onShowTrackingDetails,
}: {
  data: EnemyPushPressureResponse | null;
  isLoading: boolean;
  collapsed: boolean;
  onToggle: () => void;
  trackingState: string;
  trackingCadence: string;
  trackingTone: FreshnessTone;
  trackingDetail: string;
  onShowTrackingDetails: () => void;
}) {
  const latest = data?.latest ?? null;
  const history = data?.history ?? [];
  const nowSeconds = Math.floor(useCurrentTimeMs() / 1000);
  const contributions = latest ? pushPressureContributions(latest) : [];
  const positiveContributions = contributions.filter((contribution) => contribution.score > 0);
  const breakdownScore = contributions.reduce((total, contribution) => total + contribution.score, 0);
  const buildUpContributions = contributions.filter((contribution) => contribution.kind === "build-up");
  const buildUpScore = buildUpContributions.reduce((total, contribution) => total + contribution.score, 0);
  const attackContribution = contributions.find((contribution) => contribution.kind === "active-attack") ?? null;
  const updatedAgeSeconds = latest ? Math.max(0, nowSeconds - latest.created_at) : null;
  const updateFreshness = updatedAgeSeconds === null
    ? null
    : updatedAgeSeconds <= 180
      ? "Fresh"
      : updatedAgeSeconds <= 300
        ? "Aging"
        : "Stale";

  return (
    <CollapsiblePanel
      title="Enemy push pressure (WIP)"
      control={
        <FreshnessMeta
          state={isLoading ? "Loading" : trackingState}
          updatedAt={latest?.created_at ?? null}
          cadence={trackingCadence}
          detail={latest ? `${trackingDetail} Latest pressure: ${pushPressureLevelLabel(latest.pressure_level)}.` : trackingDetail}
          tone={trackingTone}
          onClick={onShowTrackingDetails}
        />
      }
      collapsed={collapsed}
      onToggle={onToggle}
      className="enemy-push-pressure-panel"
    >
      {latest ? (
        <>
          <div className={`push-pressure-status ${pushPressureTone(latest.pressure_level)}`}>
            <div>
              <span>Current pressure</span>
              <strong title={pushPressureLevelTooltip(latest.pressure_level, latest.pressure_score, latest.enemy_attacks_last_5m)}>
                {pushPressureLevelLabel(latest.pressure_level)}
              </strong>
            </div>
            <div>
              <span>Score</span>
              <strong title={`Stored score ${formatNumber(latest.pressure_score)}; visible breakdown total ${formatNumber(breakdownScore)}.`}>
                {formatNumber(latest.pressure_score)}
              </strong>
            </div>
            <div>
              <span>Build-up score</span>
              <strong title={`Mobilization plus current-activity signals. Online now: ${formatNumber(latest.online_count)}. Active in last 5m: ${formatNumber(latest.recently_active_count)}.`}>
                {buildUpScore > 0 ? `+${formatNumber(buildUpScore)}` : "0"}
              </strong>
            </div>
            <div>
              <span>Attack score</span>
              <strong title={attackContribution?.tooltip}>
                {attackContribution && attackContribution.score > 0 ? `+${formatNumber(attackContribution.score)}` : "0"}
              </strong>
            </div>
            <div>
              <span>Sample</span>
              <strong title={`Last calculated ${formatRelativeTime(latest.created_at)}. Pressure bucket started ${formatRelativeTime(latest.bucket_start)} for history/reference alignment. Updates older than 3 minutes are aging; older than 5 minutes are stale.`}>
                {updateFreshness}
              </strong>
            </div>
          </div>
          <div className="push-pressure-breakdown">
            <div className="push-pressure-breakdown-header">
              <strong>Score breakdown</strong>
              <span title="The pressure score is the sum of these contribution scores. Current activity uses the stronger of cluster activity and baseline activity, so those two do not double count.">
                {formatNumber(breakdownScore)} calculated
              </span>
            </div>
            <PushPressureContributionGroup
              title="Build-up signals"
              description="Login movement and unusual current activity before attacks begin."
              contributions={buildUpContributions}
            />
          </div>
          {positiveContributions.length > 0 ? (
            <div className="push-pressure-reasons" aria-label="Active pressure contributors">
              {positiveContributions.map((contribution) => (
                <span key={contribution.key} title={contribution.tooltip}>
                  {contribution.reason}
                </span>
              ))}
            </div>
          ) : (
            <p className="panel-description">No strong build-up signals in the current sample.</p>
          )}
          <PushPressureSparkline rows={history} />
        </>
      ) : (
        <EmptyState text={isLoading ? "Loading push pressure" : "No push pressure samples yet"} />
      )}
    </CollapsiblePanel>
  );
}

function PushPressureSparkline({
  rows,
}: {
  rows: EnemyPushPressureResponse["history"];
}) {
  if (rows.length === 0) {
    return null;
  }

  const width = 640;
  const height = 86;
  const padding = 8;
  const latest = rows[rows.length - 1];
  const start = latest.bucket_start - 24 * 60 * 60;
  const maxScore = Math.max(10, ...rows.map((row) => row.pressure_score));
  const points = rows
    .map((row) => {
      const x = padding + ((row.bucket_start - start) / (24 * 60 * 60)) * (width - padding * 2);
      const y = height - padding - (row.pressure_score / maxScore) * (height - padding * 2);
      return `${Math.max(padding, Math.min(width - padding, x)).toFixed(1)},${Math.max(padding, Math.min(height - padding, y)).toFixed(1)}`;
    })
    .join(" ");

  return (
    <div className="push-pressure-sparkline" aria-label="24 hour enemy push pressure sparkline">
      <div className="push-pressure-sparkline-labels">
        <span>24h pressure</span>
        <span>{formatTime(latest.bucket_start)}</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img">
        <line x1={padding} x2={width - padding} y1={height - padding} y2={height - padding} />
        <line x1={padding} x2={width - padding} y1={height / 2} y2={height / 2} />
        <polyline points={points} />
      </svg>
    </div>
  );
}

type PushPressureContribution = {
  key: string;
  kind: "build-up" | "active-attack";
  label: string;
  score: number;
  detail: string;
  reason: string;
  tooltip: string;
};

function PushPressureContributionGroup({
  title,
  description,
  contributions,
}: {
  title: string;
  description: string;
  contributions: PushPressureContribution[];
}) {
  const score = contributions.reduce((total, contribution) => total + contribution.score, 0);

  return (
    <section className="push-pressure-contribution-group">
      <div className="push-pressure-contribution-group-header">
        <div>
          <strong>{title}</strong>
          <small>{description}</small>
        </div>
        <span title={`Total contribution from ${title.toLowerCase()}: ${formatNumber(score)}.`}>
          {score > 0 ? `+${formatNumber(score)}` : "0"}
        </span>
      </div>
      <div className="push-pressure-contribution-list">
        {contributions.map((contribution) => (
          <div
            key={contribution.key}
            className={contribution.score > 0 ? "push-pressure-contribution active" : "push-pressure-contribution"}
            title={contribution.tooltip}
          >
            <span>{contribution.label}</span>
            <strong>{contribution.score > 0 ? `+${formatNumber(contribution.score)}` : "0"}</strong>
            <small>{contribution.detail}</small>
          </div>
        ))}
      </div>
    </section>
  );
}

function pushPressureContributions(latest: EnemyPushPressureResponse["latest"]): PushPressureContribution[] {
  if (!latest) {
    return [];
  }

  const onlineDeltaScore = Math.max(0, latest.online_delta_10m);
  const recentlyActiveDeltaScore = Math.max(0, latest.recently_active_delta_10m);
  const movedOnlineScore = latest.offline_idle_to_online_count * 2;
  const mobilizationScore = Math.max(onlineDeltaScore, recentlyActiveDeltaScore, movedOnlineScore);
  const mobilizationSource =
    mobilizationScore === movedOnlineScore && movedOnlineScore > 0
      ? "moved-online"
      : mobilizationScore === recentlyActiveDeltaScore && recentlyActiveDeltaScore > 0
        ? "recent-activity"
        : "online";
  const enemyAttackScore = latest.enemy_attacks_last_5m * 3;
  const activeClusterThreshold = Math.max(4, Math.ceil(latest.total_members * 0.12));
  const activeClusterScore = Math.max(0, latest.recently_active_count - activeClusterThreshold);
  const baselineScore =
    latest.activity_above_baseline === null ? 0 : Math.max(0, Math.floor(latest.activity_above_baseline));
  const currentActivityScore = Math.max(activeClusterScore, baselineScore);
  const currentActivitySource =
    baselineScore >= activeClusterScore && latest.activity_above_baseline !== null
      ? "baseline"
      : "cluster";
  const baselineDetail = latest.baseline_active_count === null
    ? "No time-slot baseline yet"
    : `${formatNumber(Math.round(latest.activity_above_baseline ?? 0))} above usual ${formatNumber(Math.round(latest.baseline_active_count))}`;

  return [
    {
      key: "mobilization",
      kind: "build-up",
      label: "Mobilization",
      score: mobilizationScore,
      detail: mobilizationDetail(mobilizationSource, latest),
      reason: mobilizationReason(mobilizationSource, latest, mobilizationScore),
      tooltip: `Score = max(online change, recent activity change, moved online). Online change = ${formatNumber(onlineDeltaScore)} from delta ${signedFormat(latest.online_delta_10m)}. Recent activity change = ${formatNumber(recentlyActiveDeltaScore)} from delta ${signedFormat(latest.recently_active_delta_10m)}. Moved online = ${formatNumber(latest.offline_idle_to_online_count)} x 2 = ${formatNumber(movedOnlineScore)}. Used ${formatNumber(mobilizationScore)}.`,
    },
    {
      key: "current-activity",
      kind: "build-up",
      label: "Current activity",
      score: currentActivityScore,
      detail: currentActivitySource === "baseline"
        ? baselineDetail
        : `${formatNumber(latest.recently_active_count)} active; threshold ${formatNumber(activeClusterThreshold)}`,
      reason: currentActivitySource === "baseline"
        ? `${formatNumber(Math.round(latest.activity_above_baseline ?? 0))} above usual time-slot activity`
        : `${formatNumber(latest.recently_active_count)} active in last 5m`,
      tooltip: `Score = max(active cluster score, baseline score). Active cluster score = max(0, ${formatNumber(latest.recently_active_count)} active - threshold ${formatNumber(activeClusterThreshold)}) = ${formatNumber(activeClusterScore)}. Baseline score = ${latest.activity_above_baseline === null ? "0 because no baseline exists" : `max(0, floor(${formatNumber(latest.activity_above_baseline)} above baseline)) = ${formatNumber(baselineScore)}`}. Used ${currentActivitySource} score: ${formatNumber(currentActivityScore)}.`,
    },
    {
      key: "enemy-attacks",
      kind: "active-attack",
      label: "Enemy attacks",
      score: enemyAttackScore,
      detail: `${formatNumber(latest.enemy_attacks_last_5m)} x 3`,
      reason: `${formatNumber(latest.enemy_attacks_last_5m)} enemy attacks in last 5m`,
      tooltip: `Score = enemy attacks against us in the last 5 minutes x 3. ${formatNumber(latest.enemy_attacks_last_5m)} attacks x 3 = ${formatNumber(enemyAttackScore)}. Level is forced to Happening currently at 6+ attacks, or at 3+ attacks when score is at least 13.`,
    },
  ];
}

function mobilizationDetail(
  source: "online" | "recent-activity" | "moved-online",
  latest: NonNullable<EnemyPushPressureResponse["latest"]>,
): string {
  if (source === "moved-online") {
    return `${formatNumber(latest.offline_idle_to_online_count)} moved online x 2`;
  }
  if (source === "recent-activity") {
    return `${signedFormat(latest.recently_active_delta_10m)} active 5m vs 10m ago`;
  }
  return `${signedFormat(latest.online_delta_10m)} online vs 10m ago`;
}

function mobilizationReason(
  source: "online" | "recent-activity" | "moved-online",
  latest: NonNullable<EnemyPushPressureResponse["latest"]>,
  score: number,
): string {
  if (source === "moved-online") {
    return `${formatNumber(latest.offline_idle_to_online_count)} moved Offline/Idle -> Online`;
  }
  if (source === "recent-activity") {
    return `+${formatNumber(score)} active in 5m vs 10m ago`;
  }
  return `+${formatNumber(score)} online in 10m`;
}

function signedFormat(value: number): string {
  if (value > 0) {
    return `+${formatNumber(value)}`;
  }
  return formatNumber(value);
}

function pushPressureLevelLabel(level: string): string {
  if (level === "underway") {
    return "Happening currently";
  }
  if (level === "likely") {
    return "Likely soon";
  }
  if (level === "building") {
    return "Building";
  }
  return "Quiet";
}

function pushPressureLevelTooltip(level: string, score: number, enemyAttacksLast5m: number): string {
  const current = `Current score: ${formatNumber(score)}. Enemy attacks in last 5m: ${formatNumber(enemyAttacksLast5m)}.`;
  if (level === "underway") {
    return `${current} Happening currently triggers when enemy attacks in 5m are at least 6, or when attacks are at least 3 and score is at least 13.`;
  }
  if (level === "likely") {
    return `${current} Likely soon triggers when score is at least 20 and the active-attack rule has not already marked it as happening.`;
  }
  if (level === "building") {
    return `${current} Building triggers when score is at least 7 and below likely/active-attack thresholds.`;
  }
  return `${current} Quiet means score is below 7 and active-attack thresholds are not met.`;
}

function pushPressureTone(level: string): string {
  if (level === "underway") {
    return "high";
  }
  if (level === "likely") {
    return "high";
  }
  if (level === "building") {
    return "medium";
  }
  return "low";
}

function summarizeEnemyStatuses(members: EnemyFactionMember[]) {
  const summary = {
    okay: 0,
    traveling: 0,
    abroad: 0,
    hospital: 0,
    jail: 0,
    other: 0,
    unknown: 0,
    revivable: 0,
    otherMembers: [] as EnemyFactionMember[],
    unknownMembers: [] as EnemyFactionMember[],
  };

  for (const member of members) {
    if (member.is_revivable) {
      summary.revivable += 1;
    }

    const status = (member.status_state ?? "").toLowerCase();
    if (!status) {
      summary.unknown += 1;
      summary.unknownMembers.push(member);
    } else if (status === "okay") {
      summary.okay += 1;
    } else if (status === "traveling") {
      summary.traveling += 1;
    } else if (status === "abroad") {
      summary.abroad += 1;
    } else if (status === "hospital") {
      summary.hospital += 1;
    } else if (status === "jail") {
      summary.jail += 1;
    } else {
      summary.other += 1;
      summary.otherMembers.push(member);
    }
  }

  return summary;
}

function formatStatusSummaryTooltip(members: EnemyFactionMember[]): string | undefined {
  if (members.length === 0) {
    return undefined;
  }

  return members
    .map((member) => `${member.name}: ${formatMemberStatusDetail(member)}`)
    .join("\n");
}

function formatMemberStatusDetail(member: EnemyFactionMember): string {
  const state = member.status_state?.trim() || "Unknown";
  const description = member.status_description?.trim();
  return description ? `${state} - ${description}` : state;
}

function scoutingComparisonMetricLabel(metric: ScoutingComparisonMetric): string {
  if (metric === "networth") {
    return "Networth";
  }

  return metric === "bsp_battlestats" ? "BSP stats" : "FF stats";
}

function RevivableMembersPanel({
  homeMembers,
  enemyMembers,
  enemyName,
  collapsed,
  onToggle,
  updatedAt,
  trackingState,
  trackingCadence,
  trackingTone,
  trackingDetail,
  onShowTrackingDetails,
}: {
  homeMembers: EnemyFactionMember[];
  enemyMembers: EnemyFactionMember[];
  enemyName: string;
  collapsed: boolean;
  onToggle: () => void;
  updatedAt: number | null;
  trackingState: string;
  trackingCadence: string;
  trackingTone: FreshnessTone;
  trackingDetail: string;
  onShowTrackingDetails: () => void;
}) {
  const revivableCount = countRevivableMembers(homeMembers) + countRevivableMembers(enemyMembers);

  return (
    <CollapsiblePanel
      title="Revivable members"
      control={
        <FreshnessMeta
          state={trackingState}
          updatedAt={updatedAt}
          cadence={trackingCadence}
          detail={trackingDetail}
          tone={trackingTone}
          onClick={onShowTrackingDetails}
        />
      }
      collapsed={collapsed}
      onToggle={onToggle}
      className="revivable-panel"
    >
      <p className="panel-description">
        Lists faction members currently marked revivable by Torn. Enemy revivable status follows enemy tracking; home revivable status updates every 15 minutes. {formatNumber(revivableCount)} currently shown.
      </p>
      <div className="revivable-grid">
        <RevivableMemberList factionName="Buttgrass" members={homeMembers} />
        <RevivableMemberList factionName={enemyName} members={enemyMembers} />
      </div>
    </CollapsiblePanel>
  );
}

function countRevivableMembers(members: EnemyFactionMember[]): number {
  return members.filter((member) => Boolean(member.is_revivable)).length;
}

function RevivableMemberList({
  factionName,
  members,
}: {
  factionName: string;
  members: EnemyFactionMember[];
}) {
  const revivableMembers = members
    .filter((member) => Boolean(member.is_revivable))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="revivable-list">
      <div className="revivable-list-header">
        <strong>{factionName}</strong>
        <span>{revivableMembers.length}</span>
      </div>
      {revivableMembers.length === 0 ? (
        <p>No revivable members shown</p>
      ) : (
        <div className="revivable-members">
          {revivableMembers.map((member) => (
            <a
              key={member.member_id}
              href={`https://www.torn.com/profiles.php?XID=${member.member_id}`}
              target="_blank"
              rel="noreferrer"
              title={`Open ${member.name} on Torn`}
            >
              {member.name}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function WarStartCountdown({
  war,
  isSelectedGlobalWar,
  warState,
}: {
  war: WarSummary;
  isSelectedGlobalWar: boolean;
  warState: GlobalWarState;
}) {
  const nowMs = useCurrentTimeMs();
  const startTime = war.official_start_time ?? war.practical_start_time;
  const isEnded = war.official_end_time !== null || war.status === "ended";
  const isPracticallyFinished =
    isSelectedGlobalWar && warState === "practically_finished" && war.practical_finish_time !== null;
  const endTime = war.official_end_time ?? war.practical_finish_time;
  const remainingSeconds = Math.max(0, Number(startTime ?? 0) - Math.floor(nowMs / 1000));

  if (isPracticallyFinished) {
    return (
      <div className="war-room-countdown war-room-countdown-ended">
        <span>Practically finished</span>
        <strong>{war.practical_finish_time ? formatLongDateTime(war.practical_finish_time) : "Finished"}</strong>
      </div>
    );
  }

  if (isEnded) {
    return (
      <div className="war-room-countdown war-room-countdown-ended">
        <span>War ended</span>
        <strong>{endTime ? formatLongDateTime(endTime) : "Ended"}</strong>
      </div>
    );
  }

  return (
    <div className="war-room-countdown">
      <span>Official start</span>
      <strong>{startTime ? formatCountdownDuration(remainingSeconds) : "-"}</strong>
    </div>
  );
}

function formatWarRoomType(war: WarSummary): string {
  return war.war_type === "termed"
    ? "Termed war"
    : war.war_type === "event"
      ? "Event"
      : "Real war";
}
