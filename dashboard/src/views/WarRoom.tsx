import React from "react";
import { Plane } from "lucide-react";
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
import { CollapsiblePanel, EmptyState, PanelHeader } from "../components/Common";
import { EnemyScoutingPanel } from "../components/EnemyScouting";
import { formatLongDateTime, formatNumber, formatRelativeTime, formatTime } from "../utils/format";

const WAR_ROOM_HEATMAP_REFRESH_MS = 15 * 60_000;
const WAR_ROOM_LIVE_SCOUTING_REFRESH_MS = 60_000;
const WAR_ROOM_PUSH_HISTORY_REFRESH_MS = 5 * 60_000;
const BUSINESS_CLASS_RESOLUTION_GRACE_SECONDS = 5 * 60;

export function WarRoom({
  selectedWar,
  selectedWarName,
  onError,
}: {
  selectedWar: WarSummary | null;
  selectedWarName: string | null;
  onError: (message: string | null) => void;
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
    const timer = window.setInterval(async () => {
      try {
        const [comparisonResponse, heatmapResponse] = await Promise.all([
          getScoutingComparison(selectedWarName),
          isActivityHeatmapsOpen ? getWarActivityHeatmap(selectedWarName, selectedWar.id) : Promise.resolve(null),
        ]);

        if (!cancelled) {
          setScoutingComparison(comparisonResponse);
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
  }, [canLoadScouting, isActivityHeatmapsOpen, isWarLive, selectedWar?.id, selectedWarName]);

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
        </div>
        <WarStartCountdown
          startTime={selectedWar.official_start_time ?? selectedWar.practical_start_time}
        />
      </section>

      <section className="content-grid">
        {isMemberTrackingActive ? (
          <EnemyStatusSummaryPanel
            members={enemyScouting?.members ?? []}
            statusCheckedAt={enemyScouting?.summary.status_checked_at ?? null}
            isLoading={isLoadingEnemyScouting}
          />
        ) : null}

        <EnemyPushPressurePanel
          data={pushPressure}
          isLoading={isLoadingPushPressure}
        />

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

        <CollapsiblePanel
          title="Activity heatmaps"
          aside={isLoadingActivityHeatmap ? "Loading" : "15 minute samples"}
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

        <RevivableMembersPanel
          homeMembers={scoutingComparison?.home.members ?? []}
          enemyMembers={scoutingComparison?.enemy.members ?? []}
          enemyName={selectedWar.name}
          isCollecting={isMemberTrackingActive}
          collapsed={collapsedPanels.revivableMembers ?? true}
          onToggle={() => togglePanel("revivableMembers")}
        />

        <EnemyTravelPanel
          members={enemyScouting?.members ?? []}
          statusCheckedAt={enemyScouting?.summary.status_checked_at ?? null}
          isLoading={isLoadingEnemyScouting}
          isCollecting={isMemberTrackingActive}
          collapsed={collapsedPanels.enemyTravel ?? false}
          onToggle={() => togglePanel("enemyTravel")}
        />

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

function EnemyStatusSummaryPanel({
  members,
  statusCheckedAt,
  isLoading,
}: {
  members: EnemyFactionMember[];
  statusCheckedAt: number | null;
  isLoading: boolean;
}) {
  const summary = summarizeEnemyStatuses(members);
  const checkedLabel = statusCheckedAt ? `Checked ${formatRelativeTime(statusCheckedAt)}` : "Not checked";

  return (
    <section className="panel enemy-status-summary-panel">
      <PanelHeader title="Enemy status summary" aside={isLoading ? "Loading" : checkedLabel} />
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
}: {
  data: EnemyPushPressureResponse | null;
  isLoading: boolean;
}) {
  const latest = data?.latest ?? null;
  const history = data?.history ?? [];
  const aside = isLoading
    ? "Loading"
    : latest
      ? `${pushPressureLevelLabel(latest.pressure_level)} · ${formatRelativeTime(latest.bucket_start)}`
      : "No samples";
  const reasons = latest ? pushPressureReasons(latest) : [];

  return (
    <section className="panel enemy-push-pressure-panel">
      <PanelHeader title="Enemy push pressure (WIP)" aside={aside} />
      {latest ? (
        <>
          <div className={`push-pressure-status ${pushPressureTone(latest.pressure_level)}`}>
            <div>
              <span>Current pressure</span>
              <strong>{pushPressureLevelLabel(latest.pressure_level)}</strong>
            </div>
            <div>
              <span>Score</span>
              <strong>{formatNumber(latest.pressure_score)}</strong>
            </div>
            <div>
              <span>Online</span>
              <strong>{formatNumber(latest.online_count)}</strong>
            </div>
            <div>
              <span>Active 5m</span>
              <strong>{formatNumber(latest.recently_active_count)}</strong>
            </div>
            <div>
              <span>Enemy attacks 5m</span>
              <strong>{formatNumber(latest.enemy_attacks_last_5m)}</strong>
            </div>
          </div>
          {reasons.length > 0 ? (
            <div className="push-pressure-reasons">
              {reasons.map((reason) => (
                <span key={reason}>{reason}</span>
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
    </section>
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

function pushPressureReasons(latest: EnemyPushPressureResponse["latest"]): string[] {
  if (!latest) {
    return [];
  }

  const reasons: string[] = [];
  if (latest.online_delta_10m > 0) {
    reasons.push(`+${formatNumber(latest.online_delta_10m)} online in 10m`);
  }
  if (latest.offline_idle_to_online_count > 0) {
    reasons.push(`${formatNumber(latest.offline_idle_to_online_count)} moved Offline/Idle -> Online`);
  }
  if (latest.recently_active_delta_10m > 0) {
    reasons.push(`+${formatNumber(latest.recently_active_delta_10m)} active in 5m vs 10m ago`);
  }
  if (latest.activity_above_baseline !== null && latest.activity_above_baseline > 0) {
    reasons.push(`${formatNumber(Math.round(latest.activity_above_baseline))} above usual time-slot activity`);
  }
  if (latest.enemy_attacks_last_5m > 0) {
    reasons.push(`${formatNumber(latest.enemy_attacks_last_5m)} enemy attacks in last 5m`);
  }
  return reasons;
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

function EnemyTravelPanel({
  members,
  statusCheckedAt,
  isLoading,
  isCollecting,
  collapsed,
  onToggle,
}: {
  members: EnemyFactionMember[];
  statusCheckedAt: number | null;
  isLoading: boolean;
  isCollecting: boolean;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const nowSeconds = Math.floor(useCurrentTime() / 1000);
  const travelers = isCollecting
    ? members
        .filter((member) => member.status_state === "Traveling")
        .sort((a, b) => {
          const arrivalDiff =
            Number(a.estimated_arrival_at ?? Number.MAX_SAFE_INTEGER) -
            Number(b.estimated_arrival_at ?? Number.MAX_SAFE_INTEGER);
          return arrivalDiff !== 0 ? arrivalDiff : a.name.localeCompare(b.name);
        })
    : [];
  const abroadMembers = isCollecting
    ? members
        .filter((member) => member.status_state === "Abroad")
        .sort((a, b) => formatAbroadLocation(a).localeCompare(formatAbroadLocation(b)) || a.name.localeCompare(b.name))
    : [];
  const checkedLabel = statusCheckedAt ? `Checked ${formatRelativeTime(statusCheckedAt)}` : "Not checked";
  const travelSummary = `${travelers.length} traveling | ${abroadMembers.length} abroad | ${checkedLabel}`;

  return (
    <CollapsiblePanel
      title="Enemy travel tracker"
      aside={isCollecting ? (isLoading ? "Loading" : travelSummary) : "Not gathering"}
      collapsed={collapsed}
      onToggle={onToggle}
      className="enemy-travel-panel table-panel"
    >
      <p className="panel-description">
        Tracks enemy members currently shown by Torn as traveling, with arrival estimates from route and plane type.
        <br />
        Torn reports both Standard and Business Class flights as airliner, so those estimates are shown as a range.
      </p>
      {!isCollecting ? (
        <EmptyState text="Enemy travel information is not currently being gathered. Collection starts two hours before official war start and stops at practical finish." />
      ) : travelers.length === 0 && abroadMembers.length === 0 ? (
        <EmptyState text="No enemy travelers or abroad members cached" />
      ) : (
        <div className="enemy-travel-sections">
          {travelers.length > 0 ? (
            <div className="table-scroll">
              <table className="enemy-travel-table">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Route</th>
                    <th>Departure</th>
                    <th>Travel time</th>
                    <th>Arrival</th>
                    <th>Travel type</th>
                  </tr>
                </thead>
                <tbody>
                  {travelers.map((member) => (
                    <tr key={member.member_id}>
                      <td>
                        <TravelMemberLink member={member} />
                      </td>
                      <td>{formatTravelRoute(member)}</td>
                      <td title={formatTravelStartWindow(member)}>{renderDepartureWindow(member, nowSeconds)}</td>
                      <td title={formatTravelDurationTooltip(member, nowSeconds)}>{renderTravelDuration(member, nowSeconds)}</td>
                      <td title={formatArrivalTooltip(member, nowSeconds)}>{renderArrivalRange(member, nowSeconds)}</td>
                      <td>
                        <span className="plane-type" title={formatPlaneTypeTooltip(member, nowSeconds)}>
                          <Plane size={14} />
                          {renderTravelType(member, nowSeconds)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {abroadMembers.length > 0 ? (
            <section className="enemy-abroad-section">
              <h3>Currently abroad</h3>
              <p className="panel-description">
                Uses the current trip travel type to show the minimum return time if they leave immediately.
              </p>
              <div className="table-scroll">
                <table className="enemy-travel-table">
                  <thead>
                    <tr>
                      <th>Member</th>
                      <th>Location</th>
                      <th>Outbound type</th>
                      <th>Minimum return</th>
                    </tr>
                  </thead>
                  <tbody>
                    {abroadMembers.map((member) => (
                      <tr key={member.member_id}>
                        <td>
                          <TravelMemberLink member={member} />
                        </td>
                        <td>{formatAbroadLocation(member)}</td>
                        <td>
                          <span className="plane-type" title={formatAbroadTravelTypeTooltip(member)}>
                            <Plane size={14} />
                            {formatAbroadTravelType(member)}
                          </span>
                        </td>
                        <td title={member.return_travel_time_note ?? undefined}>
                          {formatMinimumReturnTime(member)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </div>
      )}
    </CollapsiblePanel>
  );
}

function TravelMemberLink({ member }: { member: EnemyFactionMember }) {
  return (
    <a
      href={`https://www.torn.com/profiles.php?XID=${member.member_id}`}
      target="_blank"
      rel="noreferrer"
      title={`Open ${member.name} on Torn`}
    >
      {member.name}
    </a>
  );
}

function formatTravelRoute(member: EnemyFactionMember): string {
  if (!member.travel_origin || !member.travel_destination) {
    return member.status_description ?? "Route unknown";
  }

  const origin = member.travel_origin;
  const destination = member.travel_destination;
  return `${origin} -> ${destination}`;
}

function renderArrivalRange(member: EnemyFactionMember, nowSeconds: number): React.ReactNode {
  if (isAmbiguousAirliner(member)) {
    const possibilities = displayedAmbiguousAirlinerTravelPossibilities(member, nowSeconds);
    if (possibilities) {
      return <StackedTravelOptions values={possibilities.map((option) => option.arrival)} />;
    }
  }

  return formatArrivalRange(member);
}

function formatArrivalRange(member: EnemyFactionMember): string {
  const earliest = member.estimated_arrival_earliest ?? null;
  const latest = member.estimated_arrival_latest ?? null;
  if (earliest && latest) {
    return earliest === latest ? formatTime(earliest) : `${formatTime(earliest)}-${formatTime(latest)}`;
  }

  if (member.estimated_arrival_at) {
    return `Approx ${formatTime(member.estimated_arrival_at)}`;
  }

  return "ETA unknown";
}

function renderDepartureWindow(member: EnemyFactionMember, nowSeconds: number): React.ReactNode {
  if (isAmbiguousAirliner(member)) {
    const possibilities = displayedAmbiguousAirlinerTravelPossibilities(member, nowSeconds);
    if (possibilities) {
      return <StackedTravelOptions values={possibilities.map((option) => option.departure)} />;
    }
  }

  return formatDepartureWindow(member);
}

function formatDepartureWindow(member: EnemyFactionMember): string {
  const startedAfter = member.travel_started_after ?? null;
  const startedBefore = member.travel_started_before ?? null;
  if (startedAfter && startedBefore) {
    return startedAfter === startedBefore
      ? formatTime(startedBefore)
      : `${formatTime(startedAfter)}-${formatTime(startedBefore)}`;
  }

  if (startedBefore) {
    return `By ${formatTime(startedBefore)}`;
  }

  return "Unknown";
}

function renderTravelDuration(member: EnemyFactionMember, nowSeconds: number): React.ReactNode {
  if (isAmbiguousAirliner(member)) {
    const possibilities = displayedAmbiguousAirlinerTravelPossibilities(member, nowSeconds);
    if (possibilities) {
      return <StackedTravelOptions values={possibilities.map((option) => option.duration)} />;
    }
  }

  return formatTravelDuration(member);
}

function formatTravelDuration(member: EnemyFactionMember): string {
  const startedBefore = member.travel_started_before ?? null;
  const latestArrival = member.estimated_arrival_latest ?? null;
  if (startedBefore && latestArrival && latestArrival >= startedBefore) {
    return formatTravelDurationValue(latestArrival - startedBefore);
  }

  const startedAfter = member.travel_started_after ?? null;
  const earliestArrival = member.estimated_arrival_earliest ?? null;
  if (startedAfter && earliestArrival && earliestArrival >= startedAfter) {
    return formatTravelDurationValue(earliestArrival - startedAfter);
  }

  return "Unknown";
}

function formatTravelDurationTooltip(member: EnemyFactionMember, nowSeconds: number): string {
  if (ambiguousAirlinerResolvedAsStandard(member, nowSeconds)) {
    return "Airliner shown as Standard because the Business Class arrival window has passed.";
  }

  return member.travel_time_note ?? member.travel_type_note ?? formatPlaneType(member.plane_image_type);
}

function formatTravelDurationValue(seconds: number): string {
  const totalMinutes = Math.max(0, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0 && minutes > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (hours > 0) {
    return `${hours}h`;
  }

  return `${minutes}m`;
}

function formatTravelStartWindow(member: EnemyFactionMember): string {
  if (member.travel_started_after && member.travel_started_before) {
    return `Travel started between ${formatTime(member.travel_started_after)} and ${formatTime(member.travel_started_before)}`;
  }

  if (member.travel_started_before) {
    return `Travel first seen by ${formatTime(member.travel_started_before)}`;
  }

  return member.status_description ?? "Travel timing unknown";
}

function formatArrivalTooltip(member: EnemyFactionMember, nowSeconds: number): string {
  if (isAmbiguousAirliner(member)) {
    const possibleArrivals = formatAmbiguousAirlinerArrivalTooltip(member, nowSeconds);
    if (possibleArrivals) {
      return possibleArrivals;
    }
  }

  return member.arrival_note ?? member.status_description ?? "Travel arrival estimate";
}

function formatAmbiguousAirlinerArrivalTooltip(member: EnemyFactionMember, nowSeconds: number): string | null {
  const possibilities = displayedAmbiguousAirlinerTravelPossibilities(member, nowSeconds);
  if (!possibilities) {
    return null;
  }

  return possibilities.map((option) => `${option.label}: ${option.arrival}`).join("\n");
}

function isAmbiguousAirliner(member: EnemyFactionMember): boolean {
  return member.travel_type === "Business Class/Standard";
}

function renderTravelType(member: EnemyFactionMember, nowSeconds: number): React.ReactNode {
  if (isAmbiguousAirliner(member)) {
    const possibilities = displayedAmbiguousAirlinerTravelPossibilities(member, nowSeconds);
    if (possibilities) {
      return <StackedTravelOptions values={possibilities.map((option) => option.label)} />;
    }
  }

  return member.travel_type ?? "Unknown";
}

function formatPlaneTypeTooltip(member: EnemyFactionMember, nowSeconds: number): string {
  if (ambiguousAirlinerResolvedAsStandard(member, nowSeconds)) {
    return "Airliner; Business Class arrival window has passed, so this is treated as Standard.";
  }

  return member.travel_type_note ?? member.plane_type_label ?? formatPlaneType(member.plane_image_type);
}

function formatPlaneType(value: string | null | undefined): string {
  if (!value) {
    return "Unknown";
  }

  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
}

function formatAbroadLocation(member: EnemyFactionMember): string {
  const tripDestination = member.travel_trip_destination ?? null;
  if (tripDestination) {
    return tripDestination;
  }

  const description = member.status_description ?? null;
  if (!description) {
    return "Unknown";
  }

  const trimmed = description.trim();
  const match =
    /^In (.+)$/i.exec(trimmed) ??
    /^Abroad in (.+)$/i.exec(trimmed) ??
    /^Currently in (.+)$/i.exec(trimmed);

  return match?.[1]?.trim() || trimmed;
}

function formatAbroadTravelType(member: EnemyFactionMember): string {
  return member.return_travel_type ?? member.travel_trip_type ?? "Unknown";
}

function formatAbroadTravelTypeTooltip(member: EnemyFactionMember): string {
  if (member.travel_trip_inferred_at) {
    return `Travel type inferred ${formatRelativeTime(member.travel_trip_inferred_at)}`;
  }

  if (member.travel_trip_type === "Business Class/Standard") {
    return "Torn reports both Business Class and Standard as airliner; minimum return uses Business Class.";
  }

  return member.travel_trip_type ?? "Travel type unknown";
}

function formatMinimumReturnTime(member: EnemyFactionMember): string {
  const seconds = member.return_travel_time_seconds ?? null;
  if (seconds === null) {
    return "Unknown";
  }

  return formatTravelDurationValue(seconds);
}

function ambiguousAirlinerTravelPossibilities(member: EnemyFactionMember): Array<{
  label: "Business Class" | "Standard";
  departure: string;
  duration: string;
  arrival: string;
  latestArrival: number;
}> | null {
  const startedAfter = member.travel_started_after ?? null;
  const startedBefore = member.travel_started_before ?? null;
  const earliestArrival = member.estimated_arrival_earliest ?? null;
  const latestArrival = member.estimated_arrival_latest ?? null;

  if (!startedAfter || !startedBefore || !earliestArrival || !latestArrival) {
    return null;
  }

  const businessClassDuration = earliestArrival - startedAfter;
  const standardDuration = latestArrival - startedBefore;
  if (businessClassDuration < 0 || standardDuration < 0) {
    return null;
  }

  return [
    {
      label: "Business Class",
      departure: formatTimeWindow(startedAfter, startedBefore),
      duration: formatTravelDurationValue(businessClassDuration),
      arrival: formatTimeWindow(startedAfter + businessClassDuration, startedBefore + businessClassDuration),
      latestArrival: startedBefore + businessClassDuration,
    },
    {
      label: "Standard",
      departure: formatTimeWindow(startedAfter, startedBefore),
      duration: formatTravelDurationValue(standardDuration),
      arrival: formatTimeWindow(startedAfter + standardDuration, startedBefore + standardDuration),
      latestArrival: startedBefore + standardDuration,
    },
  ];
}

function displayedAmbiguousAirlinerTravelPossibilities(
  member: EnemyFactionMember,
  nowSeconds: number,
): ReturnType<typeof ambiguousAirlinerTravelPossibilities> {
  const possibilities = ambiguousAirlinerTravelPossibilities(member);
  if (!possibilities) {
    return null;
  }

  return ambiguousAirlinerResolvedAsStandard(member, nowSeconds)
    ? possibilities.filter((option) => option.label === "Standard")
    : possibilities;
}

function ambiguousAirlinerResolvedAsStandard(member: EnemyFactionMember, nowSeconds: number): boolean {
  const businessClass = ambiguousAirlinerTravelPossibilities(member)?.find(
    (option) => option.label === "Business Class",
  );
  if (!businessClass) {
    return false;
  }

  return nowSeconds > businessClass.latestArrival + BUSINESS_CLASS_RESOLUTION_GRACE_SECONDS;
}

function StackedTravelOptions({ values }: { values: string[] }) {
  return (
    <span className="stacked-travel-options">
      {values.map((value, index) => (
        <span key={`${value}-${index}`}>{value}</span>
      ))}
    </span>
  );
}

function formatTimeWindow(start: number, end: number): string {
  return start === end ? formatTime(start) : `${formatTime(start)}-${formatTime(end)}`;
}

type ScoutingComparisonMetric = "ff_battlestats" | "bsp_battlestats" | "networth";

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
  isCollecting,
  collapsed,
  onToggle,
}: {
  homeMembers: EnemyFactionMember[];
  enemyMembers: EnemyFactionMember[];
  enemyName: string;
  isCollecting: boolean;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const revivableCount =
    isCollecting ? countRevivableMembers(homeMembers) + countRevivableMembers(enemyMembers) : 0;

  return (
    <CollapsiblePanel
      title="Revivable members"
      aside={isCollecting ? `${revivableCount} revivable` : "Not gathering"}
      collapsed={collapsed}
      onToggle={onToggle}
      className="revivable-panel"
    >
      <p className="panel-description">
        Lists faction members currently marked revivable by Torn. This is gathered from two hours before official start until practical finish.
      </p>
      {isCollecting ? (
        <div className="revivable-grid">
          <RevivableMemberList factionName="Buttgrass" members={homeMembers} />
          <RevivableMemberList factionName={enemyName} members={enemyMembers} />
        </div>
      ) : (
        <EmptyState text="Revivable member information is not currently being gathered. Collection starts two hours before official war start and stops at practical finish." />
      )}
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

function WarStartCountdown({ startTime }: { startTime: number | null }) {
  const now = useCurrentTime();
  const remainingSeconds = Math.max(0, Number(startTime ?? 0) - Math.floor(now / 1000));

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

function isWarRoomMemberTrackingActive(war: WarSummary, nowSeconds: number): boolean {
  const start = war.official_start_time ?? war.practical_start_time;
  if (!start) {
    return false;
  }

  const updateFrom = start - 2 * 60 * 60;
  const updateUntil = war.practical_finish_time;
  return nowSeconds >= updateFrom && (updateUntil === null || nowSeconds <= updateUntil);
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

