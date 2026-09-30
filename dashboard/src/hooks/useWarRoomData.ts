import React from "react";
import {
  getChainWatch, getEnemyPushPressure, getEnemyScouting, getScoutingComparison,
  getWarControl, getWarActivityHeatmap, getEnemyMemberActivityHeatmap,
} from "../api/war";
import type { EnemyPushPressureResponse, WarControlResponse } from "../api/types";
import { usePollingResource } from "./usePollingResource";

const TRACKING_MS = 30_000;
const HISTORY_MS = 5 * 60_000;
const HEATMAP_MS = 15 * 60_000;

/** History requests never replace fields owned by the faster live request. */
export function withHistory<T extends { history: unknown[] }>(latest: T | null, history: T | null): T | null {
  const current = latest ?? history;
  return current ? { ...current, history: history?.history ?? current.history } : null;
}

export function useWarRoomTracking(warName: string | null, phaseKey: string, enabled: boolean, tracking: boolean) {
  const key = `${warName}:${phaseKey}`;
  const options = { enabled, intervalMs: tracking ? TRACKING_MS : null };
  const scouting = usePollingResource(`scouting:${key}`, signal => getEnemyScouting(warName!, signal), options);
  const comparison = usePollingResource(`comparison:${key}`, signal => getScoutingComparison(warName!, signal), options);
  const pressureLatest = usePollingResource(`pressure-latest:${key}`, signal => getEnemyPushPressure(warName!, { includeHistory: false }, signal), options);
  const controlLatest = usePollingResource(`control-latest:${key}`, signal => getWarControl(warName!, { includeHistory: false }, signal), options);
  const historyOptions = { enabled, intervalMs: tracking ? HISTORY_MS : null };
  const pressureHistory = usePollingResource(`pressure-history:${key}`, signal => getEnemyPushPressure(warName!, {}, signal), historyOptions);
  const controlHistory = usePollingResource(`control-history:${key}`, signal => getWarControl(warName!, {}, signal), historyOptions);
  const pressure = withHistory(pressureLatest.data, pressureHistory.data);
  const control = withHistory(controlLatest.data, controlHistory.data);
  const setWarControl = React.useCallback((value: React.SetStateAction<WarControlResponse | null>) => {
    controlLatest.setData(value);
    // A mutation response may include history. Functional settings edits affect
    // both snapshots without copying a thin response over the stored history.
    controlHistory.setData(value);
  }, [controlLatest.setData, controlHistory.setData]);
  const failedLatest = <T extends EnemyPushPressureResponse | WarControlResponse>(value: T | null, error: unknown) =>
    value && error ? { ...value, latest: null } : value;
  return {
    enemyScouting: scouting.error ? null : scouting.data,
    isLoadingEnemyScouting: scouting.loading,
    setEnemyScouting: scouting.setData,
    scoutingComparison: comparison.error ? null : comparison.data,
    isLoadingScoutingComparison: comparison.loading,
    setScoutingComparison: comparison.setData,
    pushPressure: failedLatest(pressure, pressureLatest.error),
    isLoadingPushPressure: pressureLatest.loading && pressureHistory.loading,
    warControl: failedLatest(control, controlLatest.error),
    isLoadingWarControl: controlLatest.loading && controlHistory.loading,
    setWarControl,
  };
}

export function useWarChainWatch(warName: string | null, phaseKey: string, live: boolean) {
  const result = usePollingResource(`war-chain:${warName}:${phaseKey}`, signal => getChainWatch(warName!, signal), {
    enabled: Boolean(warName), intervalMs: live ? 15_000 : null,
  });
  return { chainWatch: result.error ? null : result.data, setChainWatch: result.setData, isLoadingChainWatch: result.loading };
}

export function useWarRoomHeatmaps(options: {
  warName: string | null; warId?: number; phaseKey: string; enabled: boolean; live: boolean;
  memberIds: number[]; memberMode: boolean;
}) {
  const { warName, warId, phaseKey, enabled, live, memberIds, memberMode } = options;
  const key = `${warName}:${warId}:${phaseKey}`;
  const intervalMs = live ? HEATMAP_MS : null;
  const faction = usePollingResource(`heatmap:${key}`, signal => getWarActivityHeatmap(warName!, warId, signal), { enabled, intervalMs });
  const members = usePollingResource(`member-heatmap:${key}:${memberIds.join(",")}`, signal => getEnemyMemberActivityHeatmap(warName!, { memberIds }, signal), {
    enabled: enabled && memberMode && memberIds.length > 0, intervalMs,
  });
  return {
    activityHeatmap: faction.error ? null : faction.data,
    isLoadingActivityHeatmap: faction.loading,
    setActivityHeatmap: faction.setData,
    enemyMemberActivityHeatmap: members.error ? null : members.data,
    isLoadingEnemyMemberActivityHeatmap: members.loading,
  };
}
