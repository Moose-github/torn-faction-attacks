import React from "react";
import { Siren } from "lucide-react";
import {
  EnemyFactionMember,
  EnemyPushPressureResponse,
  EnemyScoutingResponse,
  FactionActivityHeatmapResponse,
  getEnemyPushPressure,
  getStoredAuthSession,
  getEnemyScouting,
  getScoutingComparison,
  getWarActivityHeatmap,
  refreshAuthSession,
  refreshEnemyScouting,
  ScoutingComparisonResponse,
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
import { formatLongDateTime, formatNumber, formatRelativeTime, formatTime } from "../utils/format";
import { isWarRoomMemberTrackingActive } from "../utils/warTracking";
import { ScoutingComparisonMetric } from "../../../shared/scoutingBuckets";

const WAR_ROOM_HEATMAP_REFRESH_MS = 15 * 60_000;
const WAR_ROOM_LIVE_SCOUTING_REFRESH_MS = 60_000;
const WAR_ROOM_PUSH_HISTORY_REFRESH_MS = 5 * 60_000;

type TrackingMode = "live" | "pre-live" | "inactive";

export function WarRoom({
  selectedWar,
  selectedWarName,
  onError,
  onOpenHospitalMonitor,
}: {
  selectedWar: WarSummary | null;
  selectedWarName: string | null;
  onError: (message: string | null) => void;
  onOpenHospitalMonitor: () => void;
}) {
  const [enemyScouting, setEnemyScouting] = React.useState<EnemyScoutingResponse | null>(null);
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
  const [pushPressure, setPushPressure] = React.useState<EnemyPushPressureResponse | null>(null);
  const [isLoadingPushPressure, setIsLoadingPushPressure] = React.useState(false);
  const [collapsedPanels, setCollapsedPanels] = React.useState<Record<string, boolean>>({
    activityHeatmaps: true,
    revivableMembers: true,
  });
  const canLoadScouting = Boolean(selectedWarName && selectedWar?.enemy_faction_id !== null);
  const isWarLive =
    selectedWar?.status === "active" &&
    selectedWar.official_end_time === null &&
    selectedWar.practical_finish_time === null;
  const now = useCurrentTime();
  const isMemberTrackingActive = selectedWar
    ? isWarRoomMemberTrackingActive(selectedWar, Math.floor(now / 1000))
    : false;
  const isActivityHeatmapsOpen = collapsedPanels.activityHeatmaps === false;
  const trackingMode: TrackingMode = isWarLive ? "live" : isMemberTrackingActive ? "pre-live" : "inactive";
  const trackingFreshness = trackingFreshnessForMode(trackingMode);
  const statusCheckedAt = enemyScouting?.summary.status_checked_at ?? null;
  const latestHeatmapSampledAt = getLatestHeatmapSampledAt(activityHeatmap);
  const pushPressureSampledAt = pushPressure?.latest?.bucket_start ?? null;
  const latestRevivableUpdatedAt = getLatestMemberUpdatedAt([
    ...(scoutingComparison?.home.members ?? []),
    ...(scoutingComparison?.enemy.members ?? []),
  ]);

  function togglePanel(panel: string) {
    setCollapsedPanels((current) => ({
      ...current,
      [panel]: !current[panel],
    }));
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
    if (!selectedWarName || !selectedWar || !canLoadScouting || !isWarLive) {
      return;
    }

    let cancelled = false;
    const shouldRefreshScoutingComparison = scoutingComparison?.comparison_stats_complete !== true;
    const timer = window.setInterval(async () => {
      try {
        const [comparisonResponse, heatmapResponse] = await Promise.all([
          shouldRefreshScoutingComparison ? getScoutingComparison(selectedWarName) : Promise.resolve(null),
          isActivityHeatmapsOpen ? getWarActivityHeatmap(selectedWarName, selectedWar.id) : Promise.resolve(null),
        ]);

        if (!cancelled) {
          if (comparisonResponse) {
            setScoutingComparison(comparisonResponse);
          }
          if (heatmapResponse) {
            setActivityHeatmap(heatmapResponse);
          }
        }
      } catch {
        if (!cancelled) {
          setActivityHeatmap(null);
        }
      }
    }, WAR_ROOM_HEATMAP_REFRESH_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    canLoadScouting,
    isActivityHeatmapsOpen,
    isWarLive,
    scoutingComparison?.comparison_stats_complete,
    selectedWar?.id,
    selectedWarName,
  ]);

  React.useEffect(() => {
    if (!selectedWarName || !canLoadScouting || !isWarLive) {
      return;
    }

    let cancelled = false;
    const timer = window.setInterval(async () => {
      try {
        const response = await getEnemyScouting(selectedWarName);
        const pressureResponse = await getEnemyPushPressure(selectedWarName, { includeHistory: false });
        if (!cancelled) {
          setEnemyScouting(response);
          setPushPressure((current) => ({
            ...pressureResponse,
            history: current?.history ?? pressureResponse.history,
          }));
        }
      } catch {
        if (!cancelled) {
          setEnemyScouting(null);
        }
      }
    }, WAR_ROOM_LIVE_SCOUTING_REFRESH_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [canLoadScouting, isWarLive, selectedWarName]);

  React.useEffect(() => {
    if (!selectedWarName || !canLoadScouting || !isWarLive) {
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
  }, [canLoadScouting, isWarLive, selectedWarName]);

  async function refreshSelectedEnemyScouting() {
    if (!selectedWarName || !selectedWar) {
      return;
    }

    setIsRefreshingEnemyScouting(true);
    onError(null);

    try {
      setEnemyScouting(await refreshEnemyScouting(selectedWarName));
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

  if (!selectedWar) {
    return (
      <section className="panel">
        <EmptyState text="No war selected" />
      </section>
    );
  }

  if (!canLoadScouting) {
    return (
      <section className="panel">
        <PanelHeader title="War room" />
        <EmptyState text="This war does not have an enemy faction to scout" />
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
        />
      </section>

      <section className="content-grid">
        <TrackingStatusPanel
          war={selectedWar}
          mode={trackingMode}
          enemyStatusCheckedAt={statusCheckedAt}
          pushPressureSampledAt={pushPressureSampledAt}
          heatmapSampledAt={latestHeatmapSampledAt}
          revivableUpdatedAt={latestRevivableUpdatedAt}
          heatmapOpen={isActivityHeatmapsOpen}
        />

        {isMemberTrackingActive ? (
          <>
            <HospitalMonitorLinkPanel
              isWarLive={isWarLive}
              onOpenHospitalMonitor={onOpenHospitalMonitor}
              trackingState={trackingFreshness.hospitalState}
              trackingCadence={trackingFreshness.hospitalCadence}
              trackingTone={trackingFreshness.hospitalTone}
              trackingDetail={trackingFreshness.hospitalDetail}
            />

            <EnemyStatusSummaryPanel
              members={enemyScouting?.members ?? []}
              statusCheckedAt={statusCheckedAt}
              isLoading={isLoadingEnemyScouting}
              trackingState={trackingFreshness.state}
              trackingCadence={trackingFreshness.enemyCadence}
              trackingTone={trackingFreshness.tone}
              trackingDetail={trackingFreshness.enemyDetail}
            />

            <EnemyPushPressurePanel
              data={pushPressure}
              isLoading={isLoadingPushPressure}
              collapsed={collapsedPanels.enemyPushPressure ?? false}
              onToggle={() => togglePanel("enemyPushPressure")}
              trackingState={trackingFreshness.state}
              trackingCadence={trackingFreshness.pushCadence}
              trackingTone={trackingFreshness.tone}
              trackingDetail={trackingFreshness.pushDetail}
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
            Compares cached faction member stats for Buttgrass and the enemy faction by member count in each range.
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
            onToggle={() => togglePanel("liveTrackingInactive")}
          />
        ) : null}

        <CollapsiblePanel
          title="Activity heatmaps"
          control={
            <FreshnessMeta
              state={isLoadingActivityHeatmap ? "Loading" : trackingFreshness.heatmapState}
              updatedAt={latestHeatmapSampledAt}
              cadence={trackingFreshness.heatmapCadence}
              detail={trackingFreshness.heatmapDetail}
              tone={trackingFreshness.heatmapTone}
            />
          }
          collapsed={collapsedPanels.activityHeatmaps ?? false}
          onToggle={() => togglePanel("activityHeatmaps")}
          className="heatmap-panel"
        >
          <p className="panel-description">
            Shows average daily activity patterns from Torn member last-action timestamps, scaled by faction average.
          </p>
          <div className="heatmap-stack">
            <FactionActivityHeatmap
              rows={activityHeatmap?.rows ?? []}
              factionId={activityHeatmap?.home_faction_id ?? null}
              label="Buttgrass"
              color="blue"
            />
            <FactionActivityHeatmap
              rows={activityHeatmap?.rows ?? []}
              factionId={selectedWar.enemy_faction_id}
              label={selectedWar.name}
              color="red"
            />
            <FactionActivityComparisonHeatmap
              rows={activityHeatmap?.rows ?? []}
              homeFactionId={activityHeatmap?.home_faction_id ?? null}
              enemyFactionId={selectedWar.enemy_faction_id}
              homeLabel="Buttgrass"
              enemyLabel={selectedWar.name}
            />
          </div>
        </CollapsiblePanel>

        <EnemyScoutingPanel
          scouting={enemyScouting}
          isLoading={isLoadingEnemyScouting}
          isRefreshing={isRefreshingEnemyScouting}
          canRefresh={canRefreshEnemyScouting}
          showStatusColumn={isMemberTrackingActive}
          onRefresh={refreshSelectedEnemyScouting}
        />
      </section>
    </>
  );
}

function LiveTrackingInactivePanel({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <CollapsiblePanel
      title="Live enemy tracking inactive"
      aside="Not gathering"
      collapsed={collapsed}
      onToggle={onToggle}
      className="live-tracking-inactive-panel"
    >
      <EmptyState text="Push pressure, travel tracking, revivable members, Enemy status and Hospital monitor are not currently being gathered. Collection starts two hours before official war start and stops at practical finish." />
    </CollapsiblePanel>
  );
}

function TrackingStatusPanel({
  war,
  mode,
  enemyStatusCheckedAt,
  pushPressureSampledAt,
  heatmapSampledAt,
  revivableUpdatedAt,
  heatmapOpen,
}: {
  war: WarSummary;
  mode: TrackingMode;
  enemyStatusCheckedAt: number | null;
  pushPressureSampledAt: number | null;
  heatmapSampledAt: number | null;
  revivableUpdatedAt: number | null;
  heatmapOpen: boolean;
}) {
  const freshness = trackingFreshnessForMode(mode);
  const windowLabel = formatTrackingWindow(war, mode);

  return (
    <section className="panel war-room-tracking-status-panel">
      <PanelHeader
        title="Tracking cadence"
        control={
          <FreshnessMeta
            state={freshness.state}
            cadence={freshness.summaryCadence}
            detail="Shows how often War Room data is gathered or refreshed for the selected war."
            tone={freshness.tone}
          />
        }
      />
      <p className="panel-description">{windowLabel}</p>
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
          updatedAt={pushPressureSampledAt}
          detail={freshness.pushDetail}
        />
        <TrackingStatusItem
          label="Activity heatmaps"
          value={heatmapOpen ? freshness.heatmapCadence : "Loads when opened"}
          updatedAt={heatmapSampledAt}
          detail={heatmapOpen ? freshness.heatmapDetail : "Heatmaps are lazy-loaded and refresh every 15 minutes while open during live tracking."}
        />
        <TrackingStatusItem
          label="Revivable members"
          value={freshness.revivableCadence}
          updatedAt={revivableUpdatedAt}
          detail={freshness.revivableDetail}
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
}

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
  return (
    <div className="tracking-status-item" title={detail}>
      <span>{label}</span>
      <strong>{value}</strong>
      {updatedAt === undefined ? null : (
        <small>{updatedAt ? `Updated ${formatRelativeTime(updatedAt)}` : "Not updated yet"}</small>
      )}
    </div>
  );
}

type TrackingFreshness = {
  state: string;
  tone: FreshnessTone;
  summaryCadence: string;
  enemyCadence: string;
  enemyDetail: string;
  pushCadence: string;
  pushDetail: string;
  heatmapState: string;
  heatmapTone: FreshnessTone;
  heatmapCadence: string;
  heatmapDetail: string;
  revivableState: string;
  revivableTone: FreshnessTone;
  revivableCadence: string;
  revivableDetail: string;
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
      summaryCadence: "1m live",
      enemyCadence: "Every 1m",
      enemyDetail: "Enemy status and travel are gathered by the worker every minute while the war is live. This page also refreshes the visible cache every minute.",
      pushCadence: "1m / 5m history",
      pushDetail: "Latest push pressure is refreshed every minute while live. The 24 hour pressure history is refreshed every 5 minutes.",
      heatmapState: "Sampling",
      heatmapTone: "live",
      heatmapCadence: "Every 15m",
      heatmapDetail: "Activity heatmaps sample Torn last-action data every 15 minutes during the tracking window and refresh here every 15 minutes while open.",
      revivableState: "Sampling",
      revivableTone: "live",
      revivableCadence: "Enemy 1m / Home 15m",
      revivableDetail: "Enemy revivable flags piggyback on the enemy status and travel refresh every minute while live. Home revivable flags come from the 15 minute member sample.",
      hospitalState: "Live",
      hospitalTone: "live",
      hospitalCadence: "Real time",
      hospitalDetail: "The Hospital monitor uses its own live Durable Object polling while the selected war is active.",
    };
  }

  if (mode === "pre-live") {
    return {
      state: "Pre-live",
      tone: "fresh",
      summaryCadence: "5m pre-live",
      enemyCadence: "Every 5m",
      enemyDetail: "Enemy status and travel are gathered every 5 minutes before the war becomes live.",
      pushCadence: "Every 5m",
      pushDetail: "Push pressure samples are fed by the same pre-live enemy tracking cadence.",
      heatmapState: "Sampling",
      heatmapTone: "fresh",
      heatmapCadence: "Every 15m",
      heatmapDetail: "Activity heatmaps are sampled by the 15 minute maintenance tick during the tracking window.",
      revivableState: "Sampling",
      revivableTone: "fresh",
      revivableCadence: "Enemy 5m / Home 15m",
      revivableDetail: "Enemy revivable flags piggyback on the pre-live enemy status and travel refresh every 5 minutes. Home revivable flags come from the 15 minute member sample.",
      hospitalState: "Waiting",
      hospitalTone: "paused",
      hospitalCadence: "Starts live",
      hospitalDetail: "Hospital monitoring becomes available when the selected war is active.",
    };
  }

  return {
    state: "Paused",
    tone: "paused",
    summaryCadence: "Not gathering",
    enemyCadence: "Paused",
    enemyDetail: "Enemy status and travel are not currently gathered for this war.",
    pushCadence: "Paused",
    pushDetail: "Push pressure is not currently sampled for this war.",
    heatmapState: "Paused",
    heatmapTone: "paused",
    heatmapCadence: "Paused",
    heatmapDetail: "Activity heatmaps are not sampled outside the tracking window.",
    revivableState: "Paused",
    revivableTone: "paused",
    revivableCadence: "Paused",
    revivableDetail: "Enemy and home revivable flags are not sampled outside the tracking window.",
    hospitalState: "Paused",
    hospitalTone: "paused",
    hospitalCadence: "Inactive",
    hospitalDetail: "Hospital monitoring is only available while the selected war is active.",
  };
}

function formatTrackingWindow(war: WarSummary, mode: TrackingMode): string {
  if (mode === "live") {
    return "Live tracking is active. Fast-changing enemy status, travel, and push pressure are refreshed every minute, while heavier history and heatmap views refresh less often.";
  }

  const officialStart = war.official_start_time ?? war.practical_start_time;
  const trackingStart = officialStart - 2 * 60 * 60;
  if (mode === "pre-live") {
    return `Pre-live tracking is active. It began at ${formatLongDateTime(trackingStart)} and will switch to the one minute live cadence when the war starts.`;
  }

  const finishTime = war.practical_finish_time ?? war.official_end_time ?? null;
  if (finishTime) {
    return `Live enemy tracking is paused because this war has finished. It stopped at practical finish: ${formatLongDateTime(finishTime)}.`;
  }

  return `Live enemy tracking has not started yet. It starts two hours before official start: ${formatLongDateTime(trackingStart)}.`;
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

function HospitalMonitorLinkPanel({
  isWarLive,
  onOpenHospitalMonitor,
  trackingState,
  trackingCadence,
  trackingTone,
  trackingDetail,
}: {
  isWarLive: boolean;
  onOpenHospitalMonitor: () => void;
  trackingState: string;
  trackingCadence: string;
  trackingTone: FreshnessTone;
  trackingDetail: string;
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
          />
        }
      />
      <p className="panel-description">
        {isWarLive
          ? "Watch enemy hospital status in real time while live enemy tracking is active."
          : "Hospital monitoring becomes live when the selected war is active."}
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

function EnemyStatusSummaryPanel({
  members,
  statusCheckedAt,
  isLoading,
  trackingState,
  trackingCadence,
  trackingTone,
  trackingDetail,
}: {
  members: EnemyFactionMember[];
  statusCheckedAt: number | null;
  isLoading: boolean;
  trackingState: string;
  trackingCadence: string;
  trackingTone: FreshnessTone;
  trackingDetail: string;
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
          />
        }
      />
      <div className="enemy-status-summary-grid">
        <StatusSummaryItem label="Okay" value={summary.okay} />
        <StatusSummaryItem label="Traveling" value={summary.traveling} tone="traveling" />
        <StatusSummaryItem label="Abroad" value={summary.abroad} tone="abroad" />
        <StatusSummaryItem label="Hospital" value={summary.hospital} tone="danger" />
        <StatusSummaryItem label="Jail" value={summary.jail} tone="danger" />
        <StatusSummaryItem label="Other" value={summary.other} tone="muted" />
        <StatusSummaryItem label="Unknown" value={summary.unknown} tone="muted" />
        <StatusSummaryItem label="Revivable" value={summary.revivable} tone="good" />
      </div>
    </section>
  );
}

function StatusSummaryItem({
  label,
  value,
  tone = "okay",
}: {
  label: string;
  value: number;
  tone?: "okay" | "traveling" | "abroad" | "danger" | "muted" | "good";
}) {
  return (
    <div className={`enemy-status-summary-item ${tone}`}>
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
}: {
  data: EnemyPushPressureResponse | null;
  isLoading: boolean;
  collapsed: boolean;
  onToggle: () => void;
  trackingState: string;
  trackingCadence: string;
  trackingTone: FreshnessTone;
  trackingDetail: string;
}) {
  const latest = data?.latest ?? null;
  const history = data?.history ?? [];
  const nowSeconds = Math.floor(useCurrentTime() / 1000);
  const contributions = latest ? pushPressureContributions(latest) : [];
  const positiveContributions = contributions.filter((contribution) => contribution.score > 0);
  const breakdownScore = contributions.reduce((total, contribution) => total + contribution.score, 0);
  const buildUpContributions = contributions.filter((contribution) => contribution.kind === "build-up");
  const buildUpScore = buildUpContributions.reduce((total, contribution) => total + contribution.score, 0);
  const attackContribution = contributions.find((contribution) => contribution.kind === "active-attack") ?? null;
  const sampleAgeSeconds = latest ? Math.max(0, nowSeconds - latest.bucket_start) : null;
  const sampleFreshness = sampleAgeSeconds === null
    ? null
    : sampleAgeSeconds <= 180
      ? "Fresh"
      : sampleAgeSeconds <= 300
        ? "Aging"
        : "Stale";

  return (
    <CollapsiblePanel
      title="Enemy push pressure (WIP)"
      control={
        <FreshnessMeta
          state={isLoading ? "Loading" : trackingState}
          updatedAt={latest?.bucket_start ?? null}
          cadence={trackingCadence}
          detail={latest ? `${trackingDetail} Latest pressure: ${pushPressureLevelLabel(latest.pressure_level)}.` : trackingDetail}
          tone={trackingTone}
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
              <strong title={`Sample bucket started ${formatRelativeTime(latest.bucket_start)}. Samples older than 3 minutes are aging; older than 5 minutes are stale.`}>
                {sampleFreshness}
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
  };

  for (const member of members) {
    if (member.is_revivable) {
      summary.revivable += 1;
    }

    const status = (member.status_state ?? "").toLowerCase();
    if (!status) {
      summary.unknown += 1;
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
    }
  }

  return summary;
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
        />
      }
      collapsed={collapsed}
      onToggle={onToggle}
      className="revivable-panel"
    >
      <p className="panel-description">
        Lists faction members currently marked revivable by Torn. Enemy revivable status follows enemy tracking; home revivable status updates every 15 minutes. {formatNumber(revivableCount)} currently cached.
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
        <p>No revivable members cached</p>
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

function WarStartCountdown({ war }: { war: WarSummary }) {
  const now = useCurrentTime();
  const startTime = war.official_start_time ?? war.practical_start_time;
  const isEnded = war.official_end_time !== null || war.status === "ended";
  const endTime = war.official_end_time ?? war.practical_finish_time;
  const remainingSeconds = Math.max(0, Number(startTime ?? 0) - Math.floor(now / 1000));

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
      <strong>{startTime ? formatDuration(remainingSeconds) : "-"}</strong>
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

function useCurrentTime(): number {
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return now;
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
