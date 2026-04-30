import React from "react";
import {
  EnemyFactionMember,
  EnemyScoutingResponse,
  FactionActivityHeatmapResponse,
  getStoredAuthSession,
  getEnemyScouting,
  getScoutingComparison,
  getWarActivityHeatmap,
  refreshAuthSession,
  refreshEnemyScouting,
  ScoutingComparisonResponse,
  WarSummary,
} from "../api";
import { FactionActivityHeatmap, ScoutingComparisonChart } from "../components/Charts";
import { CollapsiblePanel, EmptyState, PanelHeader } from "../components/Common";
import { EnemyScoutingPanel } from "../components/EnemyScouting";
import { formatLongDateTime } from "../utils/format";

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
  const [isLoadingScoutingComparison, setIsLoadingScoutingComparison] = React.useState(false);
  const [activityHeatmap, setActivityHeatmap] =
    React.useState<FactionActivityHeatmapResponse | null>(null);
  const [isLoadingActivityHeatmap, setIsLoadingActivityHeatmap] = React.useState(false);
  const [collapsedPanels, setCollapsedPanels] = React.useState<Record<string, boolean>>({
    revivableMembers: true,
  });
  const canLoadScouting = Boolean(selectedWarName && selectedWar?.enemy_faction_id !== null);

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
      if (!selectedWarName || !canLoadScouting) {
        setActivityHeatmap(null);
        return;
      }

      setIsLoadingActivityHeatmap(true);

      try {
        const response = await getWarActivityHeatmap(selectedWarName);
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
  }, [canLoadScouting, selectedWarName]);

  async function refreshSelectedEnemyScouting() {
    if (!selectedWarName) {
      return;
    }

    setIsRefreshingEnemyScouting(true);
    onError(null);

    try {
      setEnemyScouting(await refreshEnemyScouting(selectedWarName));
      setScoutingComparison(await getScoutingComparison(selectedWarName));
      setActivityHeatmap(await getWarActivityHeatmap(selectedWarName));
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
        <CollapsiblePanel
          title="Faction stats comparison"
          aside={isLoadingScoutingComparison ? "Loading" : "Estimated stats"}
          collapsed={collapsedPanels.scoutingComparison ?? false}
          onToggle={() => togglePanel("scoutingComparison")}
          className="scouting-comparison-panel"
        >
          <p className="panel-description">
            Compares cached estimated battle stats for Buttgrass and the enemy faction by member count in each range.
          </p>
          <ScoutingComparisonChart
            homeMembers={scoutingComparison?.home.members ?? []}
            enemyMembers={scoutingComparison?.enemy.members ?? []}
            enemyName={selectedWar.name}
          />
        </CollapsiblePanel>

        <CollapsiblePanel
          title="Faction activity heatmaps"
          aside={isLoadingActivityHeatmap ? "Loading" : "15 minute samples"}
          collapsed={collapsedPanels.activityHeatmaps ?? false}
          onToggle={() => togglePanel("activityHeatmaps")}
          className="heatmap-panel"
        >
          <p className="panel-description">
            Tracks how many members were recently active in each 15 minute window, based on Torn member last action timestamps.
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
          </div>
        </CollapsiblePanel>

        <RevivableMembersPanel
          homeMembers={scoutingComparison?.home.members ?? []}
          enemyMembers={scoutingComparison?.enemy.members ?? []}
          enemyName={selectedWar.name}
          collapsed={collapsedPanels.revivableMembers ?? true}
          onToggle={() => togglePanel("revivableMembers")}
        />

        <EnemyScoutingPanel
          scouting={enemyScouting}
          isLoading={isLoadingEnemyScouting}
          isRefreshing={isRefreshingEnemyScouting}
          canRefresh={canRefreshEnemyScouting}
          onRefresh={refreshSelectedEnemyScouting}
        />
      </section>
    </>
  );
}

function RevivableMembersPanel({
  homeMembers,
  enemyMembers,
  enemyName,
  collapsed,
  onToggle,
}: {
  homeMembers: EnemyFactionMember[];
  enemyMembers: EnemyFactionMember[];
  enemyName: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const revivableCount =
    countRevivableMembers(homeMembers) + countRevivableMembers(enemyMembers);

  return (
    <CollapsiblePanel
      title="Revivable members"
      aside={`${revivableCount} revivable`}
      collapsed={collapsed}
      onToggle={onToggle}
      className="revivable-panel"
    >
      <p className="panel-description">
        Lists cached faction members currently marked revivable by Torn, refreshed from the 15 minute activity samples.
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

