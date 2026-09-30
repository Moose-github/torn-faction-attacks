import React from "react";
import { usePollingResource } from "../hooks/usePollingResource";
import { watchDate } from "../../../shared/chainWatchSchedule";
import { getChainWatchHistory } from "../api/chainWatchSchedule";

export function ChainWatchSheetBrowser({ watchId, busy, refreshKey }: {
  watchId: string | null; busy: boolean; refreshKey: number;
}) {
  const { data: history, error, refresh, invalidate } = usePollingResource("chain-watch-history", getChainWatchHistory, {
    intervalMs: 60_000, pauseWhenHidden: true, refreshOnFocus: true,
  });

  const previousRefreshKey = React.useRef(refreshKey);
  React.useEffect(() => {
    if (previousRefreshKey.current !== refreshKey) invalidate();
    previousRefreshKey.current = refreshKey;
  }, [refreshKey, invalidate]);

  const watches = history?.watches ?? [];
  return <div className="watch-chain-selector">
    <label>Chain
      <select value={watches.some(watch => watch.id === watchId) ? watchId! : ""}
        disabled={busy || !history || watches.length === 0}
        onChange={event => window.location.assign(event.target.value ? `/chain-watch?watch=${encodeURIComponent(event.target.value)}` : "/chain-watch")}>
        <option value="">{!history ? "Loading chains…" : watches.length ? "Current / latest chain" : "No chains yet"}</option>
        {watches.map(watch => {
          const finished = !watch.is_open || (watch.finish_at !== null && watch.finish_at <= history!.now);
          const status = finished ? "Finished" : watch.start_at > history!.now ? "Scheduled" : "Active";
          return <option key={watch.id} value={watch.id}>{watch.name} · {watchDate(watch.start_at)} · {status}</option>;
        })}
      </select>
    </label>
    {error ? <p className="watch-browser-error" role="alert">Could not load the chain list. {error instanceof Error ? error.message : String(error)} <button type="button" className="panel-action-button" onClick={refresh}>Retry</button></p> : null}
  </div>;
}
