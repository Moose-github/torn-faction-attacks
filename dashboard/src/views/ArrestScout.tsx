import React from "react";
import { RefreshCw, Search, ShieldCheck, TimerReset, UserSearch } from "lucide-react";
import {
  getArrestScoutSnapshot,
  getArrestScoutFactionHof,
  getArrestScoutFutureTargets,
  getArrestScoutSnapshots,
  scanArrestScout,
  type ArrestScoutFactionHofFaction,
  type ArrestScoutFutureTarget,
  type ArrestScoutResult,
  type ArrestScoutScanResponse,
  type ArrestScoutSnapshot,
} from "../api";
import { EmptyState, MetricCard, PanelHeader } from "../components/Common";
import { formatNumber, formatRelativeTime } from "../utils/format";

const DEFAULT_LOOKBACK_DAYS = "7";
const DEFAULT_MIN_COUNTERFEITING_DELTA = "500";
const DEFAULT_MIN_FRAUD_DELTA = "500";
const DEFAULT_HOF_LIMIT = "100";
const DEFAULT_HOF_OFFSET = "0";

export function ArrestScout() {
  const [targetIds, setTargetIds] = React.useState("");
  const [scanSource, setScanSource] = React.useState<"manual" | "faction" | "future_targets_due">("manual");
  const [sourceFactionId, setSourceFactionId] = React.useState("");
  const [lookbackDays, setLookbackDays] = React.useState(DEFAULT_LOOKBACK_DAYS);
  const [minCounterfeitingDelta, setMinCounterfeitingDelta] = React.useState(DEFAULT_MIN_COUNTERFEITING_DELTA);
  const [minFraudDelta, setMinFraudDelta] = React.useState(DEFAULT_MIN_FRAUD_DELTA);
  const [hofCategory, setHofCategory] = React.useState("rank");
  const [hofLimit, setHofLimit] = React.useState(DEFAULT_HOF_LIMIT);
  const [hofOffset, setHofOffset] = React.useState(DEFAULT_HOF_OFFSET);
  const [hofFactions, setHofFactions] = React.useState<ArrestScoutFactionHofFaction[]>([]);
  const [scanResult, setScanResult] = React.useState<ArrestScoutScanResponse | null>(null);
  const [snapshots, setSnapshots] = React.useState<ArrestScoutSnapshot[]>([]);
  const [futureTargets, setFutureTargets] = React.useState<ArrestScoutFutureTarget[]>([]);
  const [selectedSnapshot, setSelectedSnapshot] = React.useState<ArrestScoutSnapshot | null>(null);
  const [selectedSnapshotResults, setSelectedSnapshotResults] = React.useState<ArrestScoutResult[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isLoadingFactionHof, setIsLoadingFactionHof] = React.useState(false);
  const [isLoadingSnapshotResults, setIsLoadingSnapshotResults] = React.useState(false);
  const [isScanning, setIsScanning] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const parsedTargetIds = React.useMemo(() => parseTargetIds(targetIds), [targetIds]);
  const currentTargets = scanResult?.current_targets ?? [];
  const latestFutureTargets = scanResult?.future_targets ?? [];
  const inactiveCount = scanResult?.inactive_count ?? 0;
  const ignoredCount = scanResult?.ignored_count ?? 0;
  const errorCount = scanResult?.error_count ?? 0;

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

  async function runConfiguredScan(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (scanSource === "manual" && parsedTargetIds.length === 0) {
      setError("Add at least one valid target user ID.");
      return;
    }
    const factionId = positiveInteger(sourceFactionId, 0);
    if (scanSource === "faction" && factionId <= 0) {
      setError("Add a valid faction ID.");
      return;
    }

    await runScan(
      scanSource === "manual"
        ? { source: "manual", target_user_ids: parsedTargetIds }
        : scanSource === "faction"
          ? { source: "faction", source_faction_id: factionId }
          : { source: "future_targets_due" },
    );
  }

  async function runScan(
    input:
      | { source: "manual"; target_user_ids: number[] }
      | { source: "faction"; source_faction_id: number }
      | { source: "future_targets_due" },
  ) {
    setIsScanning(true);
    setError(null);

    try {
      const response = await scanArrestScout({
        source: input.source,
        target_user_ids: input.source === "manual" ? input.target_user_ids : undefined,
        source_faction_id: input.source === "faction" ? input.source_faction_id : undefined,
        lookback_days: positiveInteger(lookbackDays, 7),
        min_counterfeiting_delta: positiveInteger(minCounterfeitingDelta, 500),
        min_fraud_delta: positiveInteger(minFraudDelta, 500),
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

  async function loadFactionHof(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoadingFactionHof(true);
    setError(null);

    try {
      const response = await getArrestScoutFactionHof({
        cat: hofCategory.trim() || "rank",
        limit: positiveInteger(hofLimit, 100),
        offset: nonNegativeInteger(hofOffset, 0),
      });
      setHofFactions(response.factions);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoadingFactionHof(false);
    }
  }

  async function scanHofFaction(faction: ArrestScoutFactionHofFaction) {
    setScanSource("faction");
    setSourceFactionId(String(faction.faction_id));
    await runScan({ source: "faction", source_faction_id: faction.faction_id });
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
            title="Scan setup"
            aside={scanSource === "manual" ? `${parsedTargetIds.length} parsed` : sourceLabel(scanSource)}
          />
          <form className="trade-scout-form" onSubmit={runConfiguredScan}>
            <label>
              <span>Scan source</span>
              <select value={scanSource} onChange={(event) => setScanSource(event.target.value as typeof scanSource)}>
                <option value="manual">Manual target IDs</option>
                <option value="faction">Faction members</option>
                <option value="future_targets_due">Due future targets</option>
              </select>
            </label>
            {scanSource === "manual" ? (
              <label className="trade-scout-items-field">
                <span>Target IDs</span>
                <textarea
                  value={targetIds}
                  onChange={(event) => setTargetIds(event.target.value)}
                  placeholder="3238283, 123456"
                />
              </label>
            ) : null}
            {scanSource === "faction" ? (
              <label>
                <span>Faction ID</span>
                <input
                  inputMode="numeric"
                  value={sourceFactionId}
                  onChange={(event) => setSourceFactionId(event.target.value)}
                  placeholder="8803"
                />
              </label>
            ) : null}
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
            <label>
              <span>Minimum fraud increase</span>
              <input
                inputMode="numeric"
                value={minFraudDelta}
                onChange={(event) => setMinFraudDelta(event.target.value)}
              />
            </label>
            <div className="trade-scout-form-actions">
              <button type="submit" className="panel-action-button primary-action" disabled={isScanning}>
                {isScanning ? <RefreshCw size={14} className="spinning-icon" /> : <Search size={14} />}
                {isScanning ? scanningLabel(scanSource) : actionLabel(scanSource)}
              </button>
            </div>
          </form>
        </section>

        <section className="panel trade-scout-form-panel">
          <PanelHeader
            title="Faction HoF"
            aside={isLoadingFactionHof ? "Loading" : `${formatNumber(hofFactions.length)} factions`}
          />
          <form className="trade-scout-form" onSubmit={loadFactionHof}>
            <label>
              <span>Category</span>
              <input value={hofCategory} onChange={(event) => setHofCategory(event.target.value)} />
            </label>
            <label>
              <span>Limit</span>
              <input inputMode="numeric" value={hofLimit} onChange={(event) => setHofLimit(event.target.value)} />
            </label>
            <label>
              <span>Offset</span>
              <input inputMode="numeric" value={hofOffset} onChange={(event) => setHofOffset(event.target.value)} />
            </label>
            <div className="trade-scout-form-actions">
              <button type="submit" className="panel-action-button" disabled={isLoadingFactionHof}>
                {isLoadingFactionHof ? <RefreshCw size={14} className="spinning-icon" /> : <Search size={14} />}
                {isLoadingFactionHof ? "Loading" : "Load factions"}
              </button>
            </div>
          </form>
          {hofFactions.length === 0 ? (
            <EmptyState text={isLoadingFactionHof ? "Loading factions" : "No faction HoF rows loaded"} />
          ) : (
            <div className="table-scroll">
              <table className="trade-scout-table">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Faction</th>
                    <th>Value</th>
                    <th>Members</th>
                    <th>Respect</th>
                    <th>Scan</th>
                  </tr>
                </thead>
                <tbody>
                  {hofFactions.map((faction) => (
                    <tr key={faction.faction_id}>
                      <td>{nullableNumber(faction.rank)}</td>
                      <td>{factionCell(faction)}</td>
                      <td>{nullableNumber(faction.value)}</td>
                      <td>{nullableNumber(faction.members)}</td>
                      <td>{nullableNumber(faction.respect)}</td>
                      <td>
                        <button
                          type="button"
                          className="panel-action-button"
                          disabled={isScanning}
                          onClick={() => scanHofFaction(faction)}
                        >
                          {isScanning ? <RefreshCw size={13} className="spinning-icon" /> : <Search size={13} />}
                          Scan
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
                    <th>Fraud</th>
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
                      <td>{nullableNumber(target.last_fraud_delta)}</td>
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
                        <small>
                          {snapshotSourceLabel(snapshot)} - min C {formatNumber(snapshot.min_counterfeiting_delta)}
                          {" / F "}
                          {formatNumber(snapshot.min_fraud_delta)}
                        </small>
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
                <th>Fraud delta</th>
                <th>Criminal offenses</th>
                <th>Jailed delta</th>
                <th>Skills</th>
                <th>Classification</th>
              </tr>
            </thead>
            <tbody>
              {results.map((result) => (
                <tr key={result.id}>
                  <td>{targetCell(result.target_user_id, result.name)}</td>
                  <td>{formatNumber(result.score)}</td>
                  <td>{nullableNumber(result.counterfeiting_delta)}</td>
                  <td>{nullableNumber(result.fraud_delta)}</td>
                  <td>{nullableNumber(result.criminaloffenses_delta)}</td>
                  <td>{nullableNumber(result.jailed_delta)}</td>
                  <td>
                    <strong>{nullableNumber(result.current_forgeryskill)} / {nullableNumber(result.current_scammingskill)}</strong>
                    <small>forgery / scamming</small>
                  </td>
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
                <th>Fraud</th>
                <th>Criminal offenses</th>
                <th>Jailed</th>
                <th>Skills</th>
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
                    <strong>{nullableNumber(result.fraud_delta)}</strong>
                    <small>{nullableNumber(result.historical_fraud)} to {nullableNumber(result.current_fraud)}</small>
                  </td>
                  <td>
                    <strong>{nullableNumber(result.criminaloffenses_delta)}</strong>
                    <small>{nullableNumber(result.historical_criminaloffenses)} to {nullableNumber(result.current_criminaloffenses)}</small>
                  </td>
                  <td>
                    <strong>{nullableNumber(result.jailed_delta)}</strong>
                    <small>{nullableNumber(result.historical_jailed)} to {nullableNumber(result.current_jailed)}</small>
                  </td>
                  <td>
                    <strong>{nullableNumber(result.current_forgeryskill)} / {nullableNumber(result.current_scammingskill)}</strong>
                    <small>forgery / scamming</small>
                  </td>
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

function factionCell(faction: ArrestScoutFactionHofFaction): React.ReactNode {
  return (
    <>
      <a href={`https://www.torn.com/factions.php?step=profile&ID=${faction.faction_id}`} target="_blank" rel="noreferrer">
        {faction.name ?? faction.faction_id}
      </a>
      {faction.name ? <small>{faction.faction_id}</small> : null}
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

function nonNegativeInteger(value: string, fallback: number): number {
  const parsed = Math.floor(Number(value));
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
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

function sourceLabel(value: string): string {
  if (value === "faction") return "Faction";
  if (value === "future_targets_due") return "Due targets";
  return "Manual";
}

function actionLabel(value: string): string {
  if (value === "faction") return "Scan faction";
  if (value === "future_targets_due") return "Recheck due";
  return "Scan targets";
}

function scanningLabel(value: string): string {
  if (value === "future_targets_due") return "Rechecking";
  return "Scanning";
}

function snapshotSourceLabel(snapshot: ArrestScoutSnapshot): string {
  if (snapshot.source_type === "faction" && snapshot.source_faction_id) {
    return `faction ${snapshot.source_faction_id}`;
  }
  return snapshot.source_type;
}

function notesLabel(value: string): string {
  try {
    const notes = JSON.parse(value);
    return Array.isArray(notes) && notes.length > 0 ? notes.join(", ") : "-";
  } catch {
    return value || "-";
  }
}
