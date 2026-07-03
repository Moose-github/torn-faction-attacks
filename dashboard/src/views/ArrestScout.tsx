import React from "react";
import { RefreshCw, Search, ShieldCheck, TimerReset, UserSearch } from "lucide-react";
import {
  getArrestScoutSnapshot,
  getArrestScoutFutureTargets,
  getArrestScoutSnapshots,
  scanArrestScout,
  type ArrestScoutFutureTarget,
  type ArrestScoutResult,
  type ArrestScoutScanResponse,
  type ArrestScoutSnapshot,
} from "../api";
import { EmptyState, MetricCard, PanelHeader } from "../components/Common";
import { formatNumber, formatRelativeTime } from "../utils/format";

const TORN_KEY_STORAGE_KEY = "arrestScoutTornKey";
const DEFAULT_LOOKBACK_DAYS = "7";
const DEFAULT_MIN_COUNTERFEITING_DELTA = "500";

export function ArrestScout() {
  const [tornKey, setTornKey] = React.useState(() => window.localStorage.getItem(TORN_KEY_STORAGE_KEY) ?? "");
  const [targetIds, setTargetIds] = React.useState("");
  const [lookbackDays, setLookbackDays] = React.useState(DEFAULT_LOOKBACK_DAYS);
  const [minCounterfeitingDelta, setMinCounterfeitingDelta] = React.useState(DEFAULT_MIN_COUNTERFEITING_DELTA);
  const [scanResult, setScanResult] = React.useState<ArrestScoutScanResponse | null>(null);
  const [snapshots, setSnapshots] = React.useState<ArrestScoutSnapshot[]>([]);
  const [futureTargets, setFutureTargets] = React.useState<ArrestScoutFutureTarget[]>([]);
  const [selectedSnapshot, setSelectedSnapshot] = React.useState<ArrestScoutSnapshot | null>(null);
  const [selectedSnapshotResults, setSelectedSnapshotResults] = React.useState<ArrestScoutResult[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isLoadingSnapshotResults, setIsLoadingSnapshotResults] = React.useState(false);
  const [isScanning, setIsScanning] = React.useState(false);
  const [isRechecking, setIsRechecking] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const parsedTargetIds = React.useMemo(() => parseTargetIds(targetIds), [targetIds]);
  const currentTargets = scanResult?.current_targets ?? [];
  const latestFutureTargets = scanResult?.future_targets ?? [];
  const inactiveCount = scanResult?.inactive_count ?? 0;
  const ignoredCount = scanResult?.ignored_count ?? 0;
  const errorCount = scanResult?.error_count ?? 0;

  React.useEffect(() => {
    window.localStorage.setItem(TORN_KEY_STORAGE_KEY, tornKey);
  }, [tornKey]);

  React.useEffect(() => {
    void loadHistory();
  }, []);

  async function loadHistory() {
    setIsLoading(true);
    setError(null);

    try {
      const [snapshotResponse, futureResponse] = await Promise.all([
        getArrestScoutSnapshots(),
        getArrestScoutFutureTargets(),
      ]);
      setSnapshots(snapshotResponse.snapshots);
      setFutureTargets(futureResponse.future_targets);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }

  async function runManualScan(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tornKey.trim()) {
      setError("Enter your Torn API key before scanning.");
      return;
    }
    if (parsedTargetIds.length === 0) {
      setError("Add at least one valid target user ID.");
      return;
    }

    await runScan({
      source: "manual",
      target_user_ids: parsedTargetIds,
    });
  }

  async function recheckFutureTargets() {
    if (!tornKey.trim()) {
      setError("Enter your Torn API key before rechecking future targets.");
      return;
    }

    setIsRechecking(true);
    await runScan({ source: "future_targets_due" });
    setIsRechecking(false);
  }

  async function runScan(input: { source: "manual"; target_user_ids: number[] } | { source: "future_targets_due" }) {
    setIsScanning(true);
    setError(null);

    try {
      const response = await scanArrestScout({
        source: input.source,
        torn_key: tornKey.trim(),
        target_user_ids: input.source === "manual" ? input.target_user_ids : undefined,
        lookback_days: positiveInteger(lookbackDays, 7),
        min_counterfeiting_delta: positiveInteger(minCounterfeitingDelta, 500),
      });
      setScanResult(response);
      setSelectedSnapshot(null);
      setSelectedSnapshotResults(response.results);
      await loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await loadHistory();
    } finally {
      setIsScanning(false);
    }
  }

  async function loadSnapshotResults(snapshot: ArrestScoutSnapshot) {
    setIsLoadingSnapshotResults(true);
    setError(null);

    try {
      const response = await getArrestScoutSnapshot(snapshot.id);
      setSelectedSnapshot(response.snapshot);
      setSelectedSnapshotResults(response.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoadingSnapshotResults(false);
    }
  }

  return (
    <>
      {error ? <div className="error-panel">{error}</div> : null}

      <section className="hero-panel compact-hero-panel">
        <div>
          <p className="eyebrow">Arrest scout</p>
          <h2>
            Arrest scout
            <span className="data-wip-badge">WIP</span>
          </h2>
          <p>Find max-forgery targets with high recent counterfeiting growth and no jailed delta.</p>
        </div>
      </section>

      <section className="trade-scout-layout">
        <section className="trade-scout-summary-grid">
          <section className="metric-card trade-scout-key-panel">
            <PanelHeader title="Scanner key" aside="Local" />
            <label>
              <span>Torn API key</span>
              <input
                type="password"
                value={tornKey}
                autoComplete="off"
                onChange={(event) => setTornKey(event.target.value)}
                placeholder="Stored in this browser"
              />
            </label>
          </section>
          <MetricCard
            icon={<ShieldCheck size={16} />}
            label="Current targets"
            value={formatNumber(currentTargets.length)}
            detail={scanResult ? `${formatNumber(scanResult.checked_count)} checked` : "No scan yet"}
          />
          <MetricCard
            icon={<TimerReset size={16} />}
            label="Future targets"
            value={formatNumber(latestFutureTargets.length)}
            detail={`${formatNumber(futureTargets.length)} saved`}
          />
          <MetricCard
            icon={<UserSearch size={16} />}
            label="Other results"
            value={formatNumber(inactiveCount + ignoredCount + errorCount)}
            detail={`${formatNumber(errorCount)} errors`}
          />
        </section>

        <section className="panel trade-scout-form-panel">
          <PanelHeader
            title="Manual scan"
            aside={`${parsedTargetIds.length} parsed`}
          />
          <form className="trade-scout-form" onSubmit={runManualScan}>
            <label className="trade-scout-items-field">
              <span>Target IDs</span>
              <textarea
                value={targetIds}
                onChange={(event) => setTargetIds(event.target.value)}
                placeholder="3238283, 123456"
              />
            </label>
            <label>
              <span>Lookback days</span>
              <input inputMode="numeric" value={lookbackDays} onChange={(event) => setLookbackDays(event.target.value)} />
            </label>
            <label>
              <span>Minimum counterfeiting increase</span>
              <input
                inputMode="numeric"
                value={minCounterfeitingDelta}
                onChange={(event) => setMinCounterfeitingDelta(event.target.value)}
              />
            </label>
            <div className="trade-scout-form-actions">
              <button type="submit" className="panel-action-button primary-action" disabled={isScanning}>
                {isScanning && !isRechecking ? <RefreshCw size={14} className="spinning-icon" /> : <Search size={14} />}
                {isScanning && !isRechecking ? "Scanning" : "Scan targets"}
              </button>
              <button
                type="button"
                className="panel-action-button"
                onClick={recheckFutureTargets}
                disabled={isScanning}
              >
                {isRechecking ? <RefreshCw size={14} className="spinning-icon" /> : <TimerReset size={14} />}
                {isRechecking ? "Rechecking" : "Recheck due"}
              </button>
            </div>
          </form>
        </section>

        <ResultPanel title="Current targets" results={currentTargets} emptyText="No current targets in the latest scan" />
        <ResultPanel title="Future targets from scan" results={latestFutureTargets} emptyText="No future targets in the latest scan" />

        <section className="panel table-panel">
          <PanelHeader title="Saved future targets" aside={isLoading ? "Loading" : `${futureTargets.length}`} />
          {futureTargets.length === 0 ? (
            <EmptyState text={isLoading ? "Loading future targets" : "No saved future targets"} />
          ) : (
            <div className="table-scroll">
              <table className="trade-scout-table">
                <thead>
                  <tr>
                    <th>Target</th>
                    <th>Best score</th>
                    <th>Counterfeiting</th>
                    <th>Jailed</th>
                    <th>Next check</th>
                  </tr>
                </thead>
                <tbody>
                  {futureTargets.map((target) => (
                    <tr key={target.target_user_id}>
                      <td>{targetCell(target.target_user_id, target.name)}</td>
                      <td>{formatNumber(target.best_score)}</td>
                      <td>{nullableNumber(target.last_counterfeiting_delta)}</td>
                      <td>{nullableNumber(target.last_jailed_delta)}</td>
                      <td>{target.next_check_after ? formatRelativeTime(target.next_check_after) : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel table-panel">
          <PanelHeader title="Recent scans" aside={isLoading ? "Loading" : `${snapshots.length}`} />
          {snapshots.length === 0 ? (
            <EmptyState text={isLoading ? "Loading scans" : "No scans yet"} />
          ) : (
            <div className="table-scroll">
              <table className="trade-scout-table">
                <thead>
                  <tr>
                    <th>Scan</th>
                    <th>Status</th>
                    <th>Checked</th>
                    <th>Current</th>
                    <th>Future</th>
                    <th>Errors</th>
                    <th>Results</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshots.map((snapshot) => (
                    <tr key={snapshot.id}>
                      <td>
                        <strong>{formatRelativeTime(snapshot.scanned_at)}</strong>
                        <small>{snapshot.source_type} - min {formatNumber(snapshot.min_counterfeiting_delta)}</small>
                      </td>
                      <td>
                        <span className={`trade-quality-badge ${snapshot.status === "ok" ? "good" : "warn"}`}>
                          {snapshot.status}
                        </span>
                        {snapshot.error ? <small>{snapshot.error}</small> : null}
                      </td>
                      <td>{formatNumber(snapshot.checked_count)} / {formatNumber(snapshot.target_count)}</td>
                      <td>{formatNumber(snapshot.current_target_count)}</td>
                      <td>{formatNumber(snapshot.future_target_count)}</td>
                      <td>{formatNumber(snapshot.error_count)}</td>
                      <td>
                        <button
                          type="button"
                          className="panel-action-button"
                          onClick={() => loadSnapshotResults(snapshot)}
                          disabled={isLoadingSnapshotResults && selectedSnapshot?.id === snapshot.id}
                        >
                          {isLoadingSnapshotResults && selectedSnapshot?.id === snapshot.id ? (
                            <RefreshCw size={13} className="spinning-icon" />
                          ) : (
                            <Search size={13} />
                          )}
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <ScanResultsPanel
          snapshot={selectedSnapshot}
          results={selectedSnapshotResults}
          isLoading={isLoadingSnapshotResults}
        />
      </section>
    </>
  );
}

function ResultPanel({ title, results, emptyText }: { title: string; results: ArrestScoutResult[]; emptyText: string }) {
  return (
    <section className="panel table-panel">
      <PanelHeader title={title} aside={`${results.length}`} />
      {results.length === 0 ? (
        <EmptyState text={emptyText} />
      ) : (
        <div className="table-scroll">
          <table className="trade-scout-table">
            <thead>
              <tr>
                <th>Target</th>
                <th>Score</th>
                <th>Counterfeiting delta</th>
                <th>Jailed delta</th>
                <th>Forgery skill</th>
                <th>Classification</th>
              </tr>
            </thead>
            <tbody>
              {results.map((result) => (
                <tr key={result.id}>
                  <td>{targetCell(result.target_user_id, result.name)}</td>
                  <td>{formatNumber(result.score)}</td>
                  <td>{nullableNumber(result.counterfeiting_delta)}</td>
                  <td>{nullableNumber(result.jailed_delta)}</td>
                  <td>{nullableNumber(result.current_forgeryskill)}</td>
                  <td><span className="trade-quality-badge good">{classificationLabel(result.classification)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ScanResultsPanel({
  snapshot,
  results,
  isLoading,
}: {
  snapshot: ArrestScoutSnapshot | null;
  results: ArrestScoutResult[];
  isLoading: boolean;
}) {
  const title = snapshot ? "Selected scan results" : "Latest scan results";
  const aside = snapshot
    ? `${formatRelativeTime(snapshot.scanned_at)} - ${formatNumber(results.length)} rows`
    : `${formatNumber(results.length)} rows`;

  return (
    <section className="panel table-panel">
      <PanelHeader title={title} aside={isLoading ? "Loading" : aside} />
      {results.length === 0 ? (
        <EmptyState text={isLoading ? "Loading scan results" : "Select a recent scan to view all member results"} />
      ) : (
        <div className="table-scroll">
          <table className="trade-scout-table">
            <thead>
              <tr>
                <th>Target</th>
                <th>Class</th>
                <th>Score</th>
                <th>Counterfeiting</th>
                <th>Jailed</th>
                <th>Skill</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {results.map((result) => (
                <tr key={result.id}>
                  <td>{targetCell(result.target_user_id, result.name)}</td>
                  <td>
                    <span className={`trade-quality-badge ${classificationTone(result.classification)}`}>
                      {classificationLabel(result.classification)}
                    </span>
                  </td>
                  <td>{formatNumber(result.score)}</td>
                  <td>
                    <strong>{nullableNumber(result.counterfeiting_delta)}</strong>
                    <small>{nullableNumber(result.historical_counterfeiting)} to {nullableNumber(result.current_counterfeiting)}</small>
                  </td>
                  <td>
                    <strong>{nullableNumber(result.jailed_delta)}</strong>
                    <small>{nullableNumber(result.historical_jailed)} to {nullableNumber(result.current_jailed)}</small>
                  </td>
                  <td>{nullableNumber(result.current_forgeryskill)}</td>
                  <td>{notesLabel(result.notes_json)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function targetCell(targetUserId: number, name: string | null): React.ReactNode {
  return (
    <>
      <a href={`https://www.torn.com/profiles.php?XID=${targetUserId}`} target="_blank" rel="noreferrer">
        {name ?? targetUserId}
      </a>
      {name ? <small>{targetUserId}</small> : null}
    </>
  );
}

function parseTargetIds(value: string): number[] {
  return Array.from(new Set(
    value
      .split(/[\s,]+/)
      .map((item) => Number(item))
      .filter((item) => Number.isInteger(item) && item > 0),
  ));
}

function positiveInteger(value: string, fallback: number): number {
  const parsed = Math.floor(Number(value));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nullableNumber(value: number | null): string {
  return value === null ? "-" : formatNumber(value);
}

function classificationLabel(value: string): string {
  return value.replace(/_/g, " ");
}

function classificationTone(value: string): string {
  if (value === "current_target") return "good";
  if (value === "future_target") return "warn";
  if (value === "error") return "danger";
  return "";
}

function notesLabel(value: string): string {
  try {
    const notes = JSON.parse(value);
    return Array.isArray(notes) && notes.length > 0 ? notes.join(", ") : "-";
  } catch {
    return value || "-";
  }
}
