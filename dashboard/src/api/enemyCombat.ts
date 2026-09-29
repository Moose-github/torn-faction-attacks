import { getJson } from "./client";
import type { WarMemberCombatBucket, WarMemberCombatHeatmapResponse } from "./types";

export type WarEnemyCombatHeatmapResponse = Omit<WarMemberCombatHeatmapResponse, "buckets"> & {
  buckets: Array<WarMemberCombatBucket & { attacks_total: number }>;
};

export function getWarEnemyCombatHeatmap(warName: string, window: "practical" | "official") {
  return getJson<WarEnemyCombatHeatmapResponse>(
    `/api/wars/${encodeURIComponent(warName)}/enemy-combat-heatmap?window=${window}`,
  );
}
