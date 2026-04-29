import React from "react";
import {
  EnemyScoutingResponse,
  FactionActivityHeatmapResponse,
  getEnemyScouting,
  getScoutingComparison,
  getWarActivityHeatmap,
  refreshEnemyScouting,
  ScoutingComparisonResponse,
  WarSummary,
} from "../api";
import { FactionActivityHeatmap, ScoutingComparisonChart } from "../components/Charts";
import { EmptyState, PanelHeader } from "../components/Common";
import { EnemyScoutingPanel } from "../components/EnemyScouting";

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
  const [isLoadingEnemyScouting, setIsLoadingEnemyScouting] = React.useState(false);
  const [isRefreshingEnemyScouting, setIsRefreshingEnemyScouting] = React.useState(false);
  const [scoutingComparison, setScoutingComparison] =
    React.useState<ScoutingComparisonResponse | null>(null);
  const [isLoadingScoutingComparison, setIsLoadingScoutingComparison] = React.useState(false);
  const [activityHeatmap, setActivityHeatmap] =
    React.useState<FactionActivityHeatmapResponse | null>(null);
  const [isLoadingActivityHeatmap, setIsLoadingActivityHeatmap] = React.useState(false);
  const canLoadScouting = Boolean(selectedWarName && selectedWar?.enemy_faction_id !== null);

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
    <section className="content-grid">
      <EnemyScoutingPanel
        scouting={enemyScouting}
        isLoading={isLoadingEnemyScouting}
        isRefreshing={isRefreshingEnemyScouting}
        onRefresh={refreshSelectedEnemyScouting}
      />

      <section className="panel chart-panel scouting-comparison-panel">
        <PanelHeader
          title="Faction stats comparison"
          aside={isLoadingScoutingComparison ? "Loading" : "Estimated stats"}
        />
        <p className="panel-description">
          Compares cached estimated battle stats for Buttgrass and the enemy faction by member count in each range.
        </p>
        <ScoutingComparisonChart
          homeMembers={scoutingComparison?.home.members ?? []}
          enemyMembers={scoutingComparison?.enemy.members ?? []}
          enemyName={selectedWar.name}
        />
      </section>

      <section className="panel heatmap-panel">
        <PanelHeader
          title="Faction activity heatmaps"
          aside={isLoadingActivityHeatmap ? "Loading" : "15 minute samples"}
        />
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
      </section>
    </section>
  );
}
