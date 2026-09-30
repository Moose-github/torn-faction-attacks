import { startPolling, type PollContext } from "../utils/polling";
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
    setData(null);
    setLoading(true);
    async function load({ signal, isCurrent }: PollContext) {
      try {
        const response = await getWarEnemyCombatHeatmap(war.name, windowMode, signal);
        if (isCurrent() && !cancelled) { setData(response); setError(null); }
      } catch (err) {
        if (isCurrent() && !cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (isCurrent() && !cancelled) setLoading(false);
      }
    }
    const poll = startPolling(load, { intervalMs: war.official_end_time === null && war.status !== "ended"
      ? (war.practical_finish_time === null ? 5 * 60_000 : 15 * 60_000) : null });
    return () => { cancelled = true; poll.stop(); };
  }, [war.id, war.name, war.status, war.practical_finish_time, war.official_end_time, windowMode]);

  if (error) return <EmptyState text={`Unable to load enemy combat data: ${error}`} />;
  return <MemberCombatHeatmap heatmap={data} isLoading={loading} enemy />;
}
