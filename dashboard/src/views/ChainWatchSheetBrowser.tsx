import React from "react";
import { watchDate, type ChainWatchHistoryResponse, type ChainWatchSheet } from "../../../shared/chainWatchSchedule";
import { getChainWatchHistory } from "../api/chainWatchSchedule";

export function ChainWatchSheetBrowser({ watchId, sheets, sheetId, onSheetChange, busy, refreshKey }: {
  watchId: string | null; sheets: ChainWatchSheet[]; sheetId: string;
  onSheetChange: (id: string) => void; busy: boolean; refreshKey: number;
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
  return <section className="panel watch-sheet-browser" aria-label="Browse chain watch sheets">
    <h3>Browse sheets</h3>
    <div className="watch-browser-fields">
      <label>Watch
        <select value={watches.some(watch => watch.id === watchId) ? watchId! : ""}
          disabled={busy || !history || watches.length === 0}
          onChange={event => window.location.assign(event.target.value ? `/chain-watch?watch=${encodeURIComponent(event.target.value)}` : "/chain-watch")}>
          <option value="">{!history ? "Loading watches…" : watches.length ? "Current / latest watch" : "No watches yet"}</option>
          {watches.map(watch => {
            const finished = !watch.is_open || (watch.finish_at !== null && watch.finish_at <= history!.now);
            const status = finished ? "Finished" : watch.start_at > history!.now ? "Scheduled" : "Active";
            return <option key={watch.id} value={watch.id}>{watch.name} · {watchDate(watch.start_at)} · {status}</option>;
          })}
        </select>
      </label>
      <label>Sheet date (UTC)
        <select value={sheetId} disabled={busy || sheets.length === 0} onChange={event => onSheetChange(event.target.value)}>
          <option value="">All sheets</option>
          {sheets.map(sheet => <option key={sheet.id} value={sheet.id}>{watchDate(sheet.start_at)}</option>)}
        </select>
      </label>
    </div>
    {error ? <p className="watch-browser-error" role="alert">Could not load the watch list. {error} <button type="button" className="panel-action-button" onClick={() => setRetry(value => value + 1)}>Retry</button></p> : null}
  </section>;
}
