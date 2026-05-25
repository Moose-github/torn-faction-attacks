import React from "react";
import {
  getStockIngestionStatus,
  StockCoverage,
  StockIngestionStatusResponse,
} from "../api";
import { EmptyState, PanelHeader } from "../components/Common";
import { formatLongDateTime, formatNumber, formatRelativeTime } from "../utils/format";

export function StockMarketStatus() {
  const [data, setData] = React.useState<StockIngestionStatusResponse | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  async function loadStatus() {
    setIsLoading(true);
    setError(null);

    try {
      setData(await getStockIngestionStatus());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }

  React.useEffect(() => {
    loadStatus();
  }, []);

  const latestRun = data?.latest_run ?? null;
  const coverage = data?.coverage ?? emptyCoverage();

  return (
    <>
      {error ? <div className="error-panel">{error}</div> : null}

      <section className="hero-panel compact-hero-panel">
        <div>
          <p className="eyebrow">Admin</p>
          <h2>Stock market</h2>
          <p>Torn stock history ingestion status and coverage.</p>
        </div>
        <button
          type="button"
          className="panel-action-button"
          disabled={isLoading}
          onClick={loadStatus}
        >
          {isLoading ? "Refreshing" : "Refresh status"}
        </button>
      </section>

      <section className="status-grid stock-status-grid">
        <StatusMetric
          label="Latest run"
          value={latestRun ? statusLabel(latestRun.status) : "No runs"}
          detail={latestRun ? `${formatRelativeTime(latestRun.started_at)} · group ${latestRun.batch_group}` : "Waiting for cron"}
        />
        <StatusMetric
          label="Stock coverage"
          value={`${formatNumber(coverage.stocks_with_snapshots)}/${formatNumber(coverage.total_stocks)}`}
          detail={`${formatNumber(coverage.stale_stocks)} stale`}
        />
        <StatusMetric
          label="Newest point"
          value={coverage.newest_snapshot_at ? formatRelativeTime(coverage.newest_snapshot_at) : "-"}
          detail={coverage.newest_snapshot_at ? formatLongDateTime(coverage.newest_snapshot_at) : "No snapshots"}
        />
      </section>

      <section className="panel">
        <PanelHeader title="Latest batch" aside={latestRun ? statusLabel(latestRun.status) : "No runs"} />
        {!latestRun ? (
          <EmptyState text={isLoading ? "Loading stock ingestion status" : "No stock ingestion runs recorded"} />
        ) : (
          <div className="admin-metric-list">
            <MetricLine label="Started" value={formatLongDateTime(latestRun.started_at)} />
            <MetricLine label="Finished" value={formatLongDateTime(latestRun.finished_at)} />
            <MetricLine label="Duration" value={formatDuration(latestRun.started_at, latestRun.finished_at)} />
            <MetricLine label="Batch group" value={latestRun.batch_group} />
            <MetricLine label="Stocks attempted" value={formatNumber(latestRun.stocks_attempted)} />
            <MetricLine label="Stocks succeeded" value={formatNumber(latestRun.stocks_succeeded)} />
            <MetricLine label="Stocks failed" value={formatNumber(latestRun.stocks_failed)} />
            <MetricLine label="Points seen" value={formatNumber(latestRun.points_seen)} />
            <MetricLine label="Points written" value={formatNumber(latestRun.points_written)} />
            <MetricLine label="Recoverable gaps" value={formatNumber(latestRun.recoverable_gap_count)} />
            <MetricLine label="Unrecoverable gaps" value={formatNumber(latestRun.unrecoverable_gap_count)} />
            {latestRun.error ? <MetricLine label="Error" value={latestRun.error} /> : null}
          </div>
        )}
      </section>

      <section className="panel">
        <PanelHeader title="Coverage" aside={coverage.newest_snapshot_at ? `Updated ${formatRelativeTime(coverage.newest_snapshot_at)}` : "No data"} />
        <div className="admin-metric-list">
          <MetricLine label="Total stocks" value={formatNumber(coverage.total_stocks)} />
          <MetricLine label="Stocks with snapshots" value={formatNumber(coverage.stocks_with_snapshots)} />
          <MetricLine label="Stale stocks" value={formatNumber(coverage.stale_stocks)} />
          <MetricLine label="Oldest latest point" value={formatLongDateTime(coverage.oldest_snapshot_at)} />
          <MetricLine label="Newest latest point" value={formatLongDateTime(coverage.newest_snapshot_at)} />
          {data?.last_error ? <MetricLine label="Last error" value={data.last_error} /> : null}
        </div>
      </section>

      <section className="panel table-panel">
        <PanelHeader title="Recent runs" aside={`${formatNumber(data?.recent_runs.length ?? 0)} shown`} />
        {!data || data.recent_runs.length === 0 ? (
          <EmptyState text={isLoading ? "Loading recent runs" : "No recent stock runs"} />
        ) : (
          <div className="table-scroll">
            <table className="stock-status-table">
              <thead>
                <tr>
                  <th>Started</th>
                  <th>Status</th>
                  <th>Group</th>
                  <th>Stocks</th>
                  <th>Points</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {data.recent_runs.map((run) => (
                  <tr key={run.id}>
                    <td>{formatLongDateTime(run.started_at)}</td>
                    <td>{statusLabel(run.status)}</td>
                    <td>{run.batch_group}</td>
                    <td>
                      {formatNumber(run.stocks_succeeded)}/{formatNumber(run.stocks_attempted)}
                    </td>
                    <td>{formatNumber(run.points_written)}</td>
                    <td>{run.error ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function StatusMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="metric-card">
      <span className="panel-kicker">{label}</span>
      <strong className="metric-card-value">{value}</strong>
      <span className="metric-card-detail">{detail}</span>
    </div>
  );
}

function MetricLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="admin-metric-line">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function emptyCoverage(): StockCoverage {
  return {
    total_stocks: 0,
    stocks_with_snapshots: 0,
    oldest_snapshot_at: null,
    newest_snapshot_at: null,
    stale_stocks: 0,
  };
}

function statusLabel(value: string): string {
  if (!value) {
    return "-";
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatDuration(start: number | null, finish: number | null): string {
  if (!start || !finish) {
    return "Not recorded";
  }

  const seconds = Math.max(0, finish - start);
  if (seconds < 60) {
    return `${seconds}s`;
  }

  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
