import React from "react";
import { watchDate, type ChainWatchHistoryResponse } from "../../../shared/chainWatchSchedule";
import { getChainWatchHistory } from "../api/chainWatchSchedule";

export function ChainWatchSheetBrowser({ watchId, busy, refreshKey }: {
  watchId: string | null; busy: boolean; refreshKey: number;
}) {
  const [history, setHistory] = React.useState<ChainWatchHistoryResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [retry, setRetry] = React.useState(0);

  React.useEffect(() => {
    let disposed = false;
    let version = 0;
    async function refresh() {
      const request = ++version;
      try {
        const next = await getChainWatchHistory();
        if (disposed || request !== version) return;
        setHistory(next);
        setError(null);
      } catch (err) {
        if (!disposed && request === version) setError(err instanceof Error ? err.message : String(err));
      }
    }
    const wake = () => { if (!document.hidden) void refresh(); };
    void refresh();
    const timer = window.setInterval(wake, 60_000);
    window.addEventListener("focus", wake);
    return () => { disposed = true; window.clearInterval(timer); window.removeEventListener("focus", wake); };
  }, [refreshKey, retry]);

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
    {error ? <p className="watch-browser-error" role="alert">Could not load the chain list. {error} <button type="button" className="panel-action-button" onClick={() => setRetry(value => value + 1)}>Retry</button></p> : null}
  </div>;
}
