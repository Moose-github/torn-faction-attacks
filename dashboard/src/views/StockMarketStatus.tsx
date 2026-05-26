import React from "react";
import {
  exportStockSnapshots,
  getStockIngestionStatus,
  getStockPaperStatus,
  resetStockPaperAccount,
  StockCoverage,
  StockIngestionStatusResponse,
  StockPaperStatusResponse,
  StockSnapshotExportRow,
} from "../api";
import { EmptyState, PanelHeader } from "../components/Common";
import {
  clearStockBacktestCache,
  getStockBacktestCacheMeta,
  readCachedStockSnapshots,
  saveStockSnapshotsToCache,
  StockBacktestCacheMeta,
} from "../utils/stockBacktestStorage";
import { formatLongDateTime, formatNumber, formatRelativeTime } from "../utils/format";

type StockMarketTab = "status" | "live" | "backtesting";

type LocalBacktestResult = {
  started_at: number;
  finished_at: number;
  starting_cash: number;
  final_equity: number;
  return_percent: number;
  max_drawdown_percent: number;
  trade_count: number;
  win_trade_count: number;
  realized_pnl: number;
  equity: Array<{ observed_at: number; total_equity: number }>;
  trades: Array<{
    stock_id: number;
    side: "buy" | "sell";
    shares: number;
    price: number;
    fee: number;
    realized_pnl: number | null;
    executed_at: number;
    reason: string;
  }>;
};

const BACKTEST_STARTING_CASH = 1_000_000_000;
const BACKTEST_LOOKBACK_SECONDS = 6 * 60 * 60;

export function StockMarketStatus() {
  const [activeTab, setActiveTab] = React.useState<StockMarketTab>("status");
  const [data, setData] = React.useState<StockIngestionStatusResponse | null>(null);
  const [paperData, setPaperData] = React.useState<StockPaperStatusResponse | null>(null);
  const [cacheMeta, setCacheMeta] = React.useState<StockBacktestCacheMeta | null>(null);
  const [backtestDays, setBacktestDays] = React.useState(7);
  const [backtestResult, setBacktestResult] = React.useState<LocalBacktestResult | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [paperAction, setPaperAction] = React.useState<"reset" | null>(null);
  const [syncState, setSyncState] = React.useState<{ active: boolean; rows: number; message: string }>({
    active: false,
    rows: 0,
    message: "Not synced this session",
  });
  const [isBacktesting, setIsBacktesting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function loadStatus() {
    setIsLoading(true);
    setError(null);

    try {
      const [ingestion, paper, meta] = await Promise.all([
        getStockIngestionStatus(),
        getStockPaperStatus(),
        getStockBacktestCacheMeta(),
      ]);
      setData(ingestion);
      setPaperData(paper);
      setCacheMeta(meta);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setData(null);
      setPaperData(null);
    } finally {
      setIsLoading(false);
    }
  }

  async function resetPaperBot() {
    setPaperAction("reset");
    setError(null);
    try {
      setPaperData(await resetStockPaperAccount());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPaperAction(null);
    }
  }

  async function syncBacktestData() {
    const newestSnapshot = data?.coverage.newest_snapshot_at;
    if (!newestSnapshot) {
      setError("No stock snapshots are available to sync yet.");
      return;
    }

    const endAt = newestSnapshot;
    const startAt = endAt - backtestDays * 24 * 60 * 60 - BACKTEST_LOOKBACK_SECONDS;
    let afterAt: number | undefined;
    let afterStockId: number | undefined;
    let totalRows = 0;

    setSyncState({ active: true, rows: 0, message: "Downloading stored snapshots" });
    setError(null);

    try {
      while (true) {
        const page = await exportStockSnapshots({
          startAt,
          endAt,
          afterAt,
          afterStockId,
        });
        await saveStockSnapshotsToCache(page.snapshots);
        totalRows += page.snapshots.length;
        setSyncState({ active: true, rows: totalRows, message: "Caching snapshots in this browser" });
        if (!page.next_cursor) {
          break;
        }
        afterAt = page.next_cursor.after_at;
        afterStockId = page.next_cursor.after_stock_id;
      }
      setCacheMeta(await getStockBacktestCacheMeta());
      setSyncState({ active: false, rows: totalRows, message: `Synced ${formatNumber(totalRows)} snapshots` });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSyncState({ active: false, rows: totalRows, message: "Sync failed" });
    }
  }

  async function clearBacktestData() {
    setError(null);
    setBacktestResult(null);
    setCacheMeta(await clearStockBacktestCache());
    setSyncState({ active: false, rows: 0, message: "Browser cache cleared" });
  }

  async function runLocalBacktest() {
    const newestSnapshot = data?.coverage.newest_snapshot_at ?? cacheMeta?.newest_observed_at;
    if (!newestSnapshot) {
      setError("Sync stock history before running a local backtest.");
      return;
    }

    const endAt = newestSnapshot;
    const startAt = endAt - backtestDays * 24 * 60 * 60;
    setIsBacktesting(true);
    setBacktestResult(null);
    setError(null);

    try {
      const snapshots = await readCachedStockSnapshots(startAt - BACKTEST_LOOKBACK_SECONDS, endAt);
      if (snapshots.length === 0) {
        throw new Error("No cached snapshots found for this backtest window. Sync data first.");
      }
      setBacktestResult(await runBacktestWorker(snapshots, startAt, endAt));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsBacktesting(false);
    }
  }

  React.useEffect(() => {
    loadStatus();
  }, []);

  const latestRun = data?.latest_run ?? null;
  const coverage = data?.coverage ?? emptyCoverage();
  const account = paperData?.account ?? null;
  const latestEquity = paperData?.latest_equity ?? null;

  return (
    <>
      {error ? <div className="error-panel">{error}</div> : null}

      <section className="hero-panel compact-hero-panel">
        <div>
          <p className="eyebrow">Admin</p>
          <h2>Stock market</h2>
          <p>Ingestion health, the 24/7 live paper bot, and local strategy backtesting.</p>
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

      <div className="stock-market-tabs" role="tablist" aria-label="Stock market sections">
        <TabButton active={activeTab === "status"} onClick={() => setActiveTab("status")}>Status</TabButton>
        <TabButton active={activeTab === "live"} onClick={() => setActiveTab("live")}>Live Paper Bot</TabButton>
        <TabButton active={activeTab === "backtesting"} onClick={() => setActiveTab("backtesting")}>Backtesting</TabButton>
      </div>

      {activeTab === "status" ? (
        <StatusTab data={data} latestRun={latestRun} coverage={coverage} isLoading={isLoading} />
      ) : activeTab === "live" ? (
        <LivePaperBotTab
          paperData={paperData}
          account={account}
          latestEquity={latestEquity}
          coverage={coverage}
          isLoading={isLoading}
          paperAction={paperAction}
          onReset={resetPaperBot}
        />
      ) : (
        <BacktestingTab
          backtestDays={backtestDays}
          setBacktestDays={setBacktestDays}
          cacheMeta={cacheMeta}
          coverage={coverage}
          syncState={syncState}
          isBacktesting={isBacktesting}
          backtestResult={backtestResult}
          onSync={syncBacktestData}
          onClear={clearBacktestData}
          onRun={runLocalBacktest}
        />
      )}
    </>
  );
}

function StatusTab({
  data,
  latestRun,
  coverage,
  isLoading,
}: {
  data: StockIngestionStatusResponse | null;
  latestRun: StockIngestionStatusResponse["latest_run"];
  coverage: StockCoverage;
  isLoading: boolean;
}) {
  return (
    <>
      <section className="status-grid stock-status-grid">
        <StatusMetric
          label="Latest run"
          value={latestRun ? statusLabel(latestRun.status) : "No runs"}
          detail={latestRun ? `${formatRelativeTime(latestRun.started_at)} | group ${latestRun.batch_group}` : "Waiting for cron"}
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
          <MetricLine label="Primary cadence" value={data?.primary_cadence ?? "1m all-stocks"} />
          <MetricLine label="Recovery cadence" value={data?.recovery_cadence ?? "30m stale-stock history fallback"} />
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
                    <td>{formatNumber(run.stocks_succeeded)}/{formatNumber(run.stocks_attempted)}</td>
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

function LivePaperBotTab({
  paperData,
  account,
  latestEquity,
  coverage,
  isLoading,
  paperAction,
  onReset,
}: {
  paperData: StockPaperStatusResponse | null;
  account: StockPaperStatusResponse["account"];
  latestEquity: StockPaperStatusResponse["latest_equity"];
  coverage: StockCoverage;
  isLoading: boolean;
  paperAction: "reset" | null;
  onReset: () => void;
}) {
  return (
    <>
      <section className="panel">
        <PanelHeader
          title="Live paper bot"
          aside={account ? `${statusLabel(account.status)} | ${account.strategy_key}` : "Not started"}
        />
        <div className="panel-actions-row stock-paper-actions">
          <button
            type="button"
            className="panel-action-button secondary"
            disabled={isLoading || paperAction !== null}
            onClick={onReset}
          >
            {paperAction === "reset" ? "Resetting" : "Reset paper account"}
          </button>
        </div>

        <section className="status-grid stock-status-grid paper-status-grid">
          <StatusMetric
            label="Total equity"
            value={formatMoney(latestEquity?.total_equity ?? account?.cash_balance ?? null)}
            detail={formatReturn(latestEquity?.total_equity ?? account?.cash_balance ?? null, account?.starting_cash ?? paperData?.defaults.starting_cash)}
          />
          <StatusMetric
            label="Cash"
            value={formatMoney(latestEquity?.cash_balance ?? account?.cash_balance ?? null)}
            detail={`Reserve ${formatPercent(account?.min_cash_reserve_fraction ?? paperData?.defaults.min_cash_reserve_fraction ?? 0.05)}`}
          />
          <StatusMetric
            label="Holdings"
            value={formatMoney(latestEquity?.holdings_value ?? 0)}
            detail={`${formatNumber(paperData?.positions.length ?? 0)} open positions`}
          />
        </section>

        {!account ? (
          <EmptyState text={isLoading ? "Loading paper bot status" : "No live paper account yet. Cron or reset will create one."} />
        ) : (
          <div className="admin-metric-list">
            <MetricLine label="Starting bankroll" value={formatMoney(account.starting_cash)} />
            <MetricLine label="Last decision" value={formatLongDateTime(account.last_decision_at)} />
            <MetricLine label="Latest stock snapshot" value={formatLongDateTime(coverage.newest_snapshot_at)} />
            <MetricLine label="Decision cadence" value="5m" />
            <MetricLine label="Buy fee" value={formatPercent(account.buy_fee_rate)} />
            <MetricLine label="Sell fee" value={formatPercent(account.sell_fee_rate)} />
            <MetricLine label="Max open positions" value={formatNumber(account.max_open_positions)} />
            <MetricLine label="Max position size" value={formatPercent(account.max_position_fraction)} />
          </div>
        )}
      </section>

      <section className="panel table-panel">
        <PanelHeader title="Current paper positions" aside={`${formatNumber(paperData?.positions.length ?? 0)} open`} />
        {!paperData || paperData.positions.length === 0 ? (
          <EmptyState text={isLoading ? "Loading positions" : "No simulated holdings"} />
        ) : (
          <StockPositionsTable paperData={paperData} />
        )}
      </section>

      <section className="panel table-panel">
        <PanelHeader title="Recent paper trades" aside={`${formatNumber(paperData?.recent_trades.length ?? 0)} shown`} />
        {!paperData || paperData.recent_trades.length === 0 ? (
          <EmptyState text={isLoading ? "Loading paper trades" : "No simulated trades yet"} />
        ) : (
          <StockTradesTable trades={paperData.recent_trades} />
        )}
      </section>
    </>
  );
}

function BacktestingTab({
  backtestDays,
  setBacktestDays,
  cacheMeta,
  coverage,
  syncState,
  isBacktesting,
  backtestResult,
  onSync,
  onClear,
  onRun,
}: {
  backtestDays: number;
  setBacktestDays: (value: number) => void;
  cacheMeta: StockBacktestCacheMeta | null;
  coverage: StockCoverage;
  syncState: { active: boolean; rows: number; message: string };
  isBacktesting: boolean;
  backtestResult: LocalBacktestResult | null;
  onSync: () => void;
  onClear: () => void;
  onRun: () => void;
}) {
  return (
    <>
      <section className="panel stock-backtest-intro">
        <PanelHeader title="Backtesting" aside="Local simulation only" />
        <p className="panel-description">
          Run historical simulations in this browser using cached Torn stock data. These tests do not affect the live paper bot,
          do not place real Torn trades, and only use your device CPU after the stock history is synced.
        </p>
        <section className="status-grid stock-status-grid paper-status-grid">
          <StatusMetric label="Data source" value="Browser cache" detail="Synced from D1 snapshot exports" />
          <StatusMetric label="Simulation mode" value="Local only" detail="Runs in this device's browser worker" />
          <StatusMetric label="Live bot impact" value="None" detail="No live paper account changes" />
        </section>
      </section>

      <section className="panel">
        <PanelHeader title="1. Sync data" aside={syncState.message} />
        <div className="admin-metric-list">
          <MetricLine label="Server newest snapshot" value={formatLongDateTime(coverage.newest_snapshot_at)} />
          <MetricLine label="Cached oldest snapshot" value={formatLongDateTime(cacheMeta?.oldest_observed_at ?? null)} />
          <MetricLine label="Cached newest snapshot" value={formatLongDateTime(cacheMeta?.newest_observed_at ?? null)} />
          <MetricLine label="Cached rows" value={formatNumber(cacheMeta?.snapshot_count ?? 0)} />
          <MetricLine label="Session sync rows" value={formatNumber(syncState.rows)} />
        </div>
        <div className="panel-actions-row">
          <button type="button" className="panel-action-button" disabled={syncState.active} onClick={onSync}>
            {syncState.active ? "Syncing stock history" : "Sync latest stock history"}
          </button>
          <button type="button" className="panel-action-button secondary" disabled={syncState.active} onClick={onClear}>
            Clear browser cache
          </button>
        </div>
      </section>

      <section className="panel">
        <PanelHeader title="2. Configure test" aside="Fees included" />
        <div className="stock-backtest-controls">
          <label>
            <span>Days to test</span>
            <input
              type="number"
              min={1}
              max={31}
              value={backtestDays}
              onChange={(event) => setBacktestDays(clampNumber(Number(event.target.value), 1, 31))}
            />
          </label>
          <MetricLine label="Starting cash" value={formatMoney(BACKTEST_STARTING_CASH)} />
          <MetricLine label="Buy fee" value="0%" />
          <MetricLine label="Sell fee" value="0.1%" />
          <MetricLine label="Risk limits" value="5 positions | 25% max | 5% reserve" />
        </div>
      </section>

      <section className="panel">
        <PanelHeader title="3. Run backtest" aside={isBacktesting ? "Running locally" : "Ready"} />
        <p className="panel-description">
          This uses cached snapshots and your browser CPU. Keep this tab open while the worker runs.
        </p>
        <div className="panel-actions-row">
          <button type="button" className="panel-action-button primary-action" disabled={isBacktesting || syncState.active} onClick={onRun}>
            {isBacktesting ? "Running local backtest" : "Run local backtest"}
          </button>
        </div>
      </section>

      <section className="panel">
        <PanelHeader title="4. Review results" aside={backtestResult ? `${formatSignedPercent(backtestResult.return_percent)} return` : "No run yet"} />
        {!backtestResult ? (
          <EmptyState text="Run a local backtest to see return, drawdown, and simulated trades." />
        ) : (
          <div className="admin-metric-list">
            <MetricLine label="Window" value={`${formatLongDateTime(backtestResult.started_at)} - ${formatLongDateTime(backtestResult.finished_at)}`} />
            <MetricLine label="Final equity" value={formatMoney(backtestResult.final_equity)} />
            <MetricLine label="Return" value={formatSignedPercent(backtestResult.return_percent)} />
            <MetricLine label="Max drawdown" value={formatSignedPercent(backtestResult.max_drawdown_percent)} />
            <MetricLine label="Trades" value={formatNumber(backtestResult.trade_count)} />
            <MetricLine label="Winning sells" value={formatNumber(backtestResult.win_trade_count)} />
            <MetricLine label="Realized P/L" value={formatMoney(backtestResult.realized_pnl)} />
          </div>
        )}
      </section>

      {backtestResult ? (
        <section className="panel table-panel">
          <PanelHeader title="Local backtest trades" aside={`${formatNumber(backtestResult.trades.length)} shown`} />
          <div className="table-scroll">
            <table className="stock-status-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Side</th>
                  <th>Stock</th>
                  <th>Shares</th>
                  <th>Price</th>
                  <th>Fee</th>
                  <th>P/L</th>
                </tr>
              </thead>
              <tbody>
                {backtestResult.trades.map((trade, index) => (
                  <tr key={`${trade.executed_at}-${trade.stock_id}-${trade.side}-${index}`}>
                    <td>{formatLongDateTime(trade.executed_at)}</td>
                    <td>{statusLabel(trade.side)}</td>
                    <td>Stock {trade.stock_id}</td>
                    <td>{formatNumber(trade.shares)}</td>
                    <td>{formatMoney(trade.price)}</td>
                    <td>{formatMoney(trade.fee)}</td>
                    <td>{trade.realized_pnl === null ? "-" : formatMoney(trade.realized_pnl)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}

function StockPositionsTable({ paperData }: { paperData: StockPaperStatusResponse }) {
  return (
    <div className="table-scroll">
      <table className="stock-status-table">
        <thead>
          <tr>
            <th>Stock</th>
            <th>Shares</th>
            <th>Entry</th>
            <th>Latest</th>
            <th>Value</th>
            <th>P/L</th>
          </tr>
        </thead>
        <tbody>
          {paperData.positions.map((position) => (
            <tr key={position.stock_id}>
              <td>{stockLabel(position)}</td>
              <td>{formatNumber(position.shares)}</td>
              <td>{formatMoney(position.average_entry_price)}</td>
              <td>{formatMoney(position.latest_price)}</td>
              <td>{formatMoney(position.market_value)}</td>
              <td>{formatMoney(position.unrealized_pnl)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StockTradesTable({ trades }: { trades: StockPaperStatusResponse["recent_trades"] }) {
  return (
    <div className="table-scroll">
      <table className="stock-status-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Side</th>
            <th>Stock</th>
            <th>Shares</th>
            <th>Price</th>
            <th>Value</th>
            <th>Fee</th>
            <th>P/L</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((trade) => (
            <tr key={trade.id}>
              <td>{formatLongDateTime(trade.executed_at)}</td>
              <td>{statusLabel(trade.side)}</td>
              <td>{stockLabel(trade)}</td>
              <td>{formatNumber(trade.shares)}</td>
              <td>{formatMoney(trade.price)}</td>
              <td>{formatMoney(trade.gross_value)}</td>
              <td>{formatMoney(trade.fee)}</td>
              <td>{trade.realized_pnl === null ? "-" : formatMoney(trade.realized_pnl)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className={`stock-market-tab ${active ? "active" : ""}`} onClick={onClick}>
      {children}
    </button>
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

function runBacktestWorker(
  snapshots: StockSnapshotExportRow[],
  startAt: number,
  endAt: number,
): Promise<LocalBacktestResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../workers/stockBacktestWorker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<{ type: string; result?: LocalBacktestResult; error?: string }>) => {
      worker.terminate();
      if (event.data.type === "complete" && event.data.result) {
        resolve(event.data.result);
      } else {
        reject(new Error(event.data.error ?? "Local backtest failed"));
      }
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message));
    };
    worker.postMessage({
      type: "run",
      snapshots,
      startAt,
      endAt,
      startingCash: BACKTEST_STARTING_CASH,
    });
  });
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

function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "-";
  }

  return `$${formatNumber(value)}`;
}

function formatPercent(value: number): string {
  return `${formatNumber(value * 100)}%`;
}

function formatSignedPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "-";
  }
  return `${value >= 0 ? "+" : ""}${formatNumber(value)}%`;
}

function formatReturn(value: number | null | undefined, startingCash: number | null | undefined): string {
  if (!value || !startingCash) {
    return "Waiting for equity snapshot";
  }

  return `${formatSignedPercent(((value - startingCash) / startingCash) * 100)} return`;
}

function stockLabel(stock: { stock_id: number; acronym: string | null; name: string | null }): string {
  return stock.acronym ?? stock.name ?? `Stock ${stock.stock_id}`;
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, Math.floor(value)));
}
