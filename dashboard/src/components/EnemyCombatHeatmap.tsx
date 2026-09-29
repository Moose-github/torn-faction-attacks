import React from "react";
import type { WarSummary } from "../api";
import { getWarEnemyCombatHeatmap, type WarEnemyCombatHeatmapResponse } from "../api/enemyCombat";
import { EmptyState } from "./Common";
import { MemberCombatHeatmap } from "./MemberCombatHeatmap";

export function EnemyCombatHeatmap({ war, windowMode }: {
  war: WarSummary;
  windowMode: "practical" | "official";
}) {
  const [data, setData] = React.useState<WarEnemyCombatHeatmapResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    setData(null);
    setLoading(true);
    async function load() {
      if (inFlight) return;
      inFlight = true;
      try {
        const response = await getWarEnemyCombatHeatmap(war.name, windowMode);
        if (!cancelled) { setData(response); setError(null); }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        inFlight = false;
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    const timer = war.official_end_time === null && war.status !== "ended"
      ? window.setInterval(load, war.practical_finish_time === null ? 5 * 60_000 : 15 * 60_000)
      : undefined;
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [war.id, war.name, war.status, war.practical_finish_time, war.official_end_time, windowMode]);

  if (error) return <EmptyState text={`Unable to load enemy combat data: ${error}`} />;
  return <MemberCombatHeatmap heatmap={data} isLoading={loading} enemy />;
}
