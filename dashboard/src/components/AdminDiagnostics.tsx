import React from "react";
import {
  getLatestIngestionRun,
  getAdminTornKeyPool,
  type IngestionRun,
  type AdminTornKeyPoolResponse,
} from "../api";
import { PanelHeader } from "./Common";
import { formatNumber } from "../utils/format";

export function AdminDiagnostics() {
  const [ingestionRun, setIngestionRun] = React.useState<IngestionRun | null>(null);
  const [tornKeyPool, setTornKeyPool] = React.useState<AdminTornKeyPoolResponse | null>(null);
  const [isLoadingIngestionRun, setIsLoadingIngestionRun] = React.useState(true);
  const [isLoadingTornKeyPool, setIsLoadingTornKeyPool] = React.useState(true);
  const [ingestionError, setIngestionError] = React.useState<string | null>(null);
  const [keysError, setKeysError] = React.useState<string | null>(null);

  async function loadLatestIngestionRun() {
    setIsLoadingIngestionRun(true);
    setIngestionError(null);
    try {
      setIngestionRun((await getLatestIngestionRun()).run);
    } catch (error) {
      setIngestionError(error instanceof Error ? error.message : "Unable to load refresh status.");
    } finally {
      setIsLoadingIngestionRun(false);
    }
  }

  async function loadTornKeyPool() {
    setIsLoadingTornKeyPool(true);
    setKeysError(null);
    try {
      setTornKeyPool(await getAdminTornKeyPool());
    } catch (error) {
      setKeysError(error instanceof Error ? error.message : "Unable to load saved keys.");
    } finally {
      setIsLoadingTornKeyPool(false);
    }
  }

  React.useEffect(() => {
    void loadLatestIngestionRun();
    void loadTornKeyPool();
  }, []);

  const tornKeyPoolStatus = isLoadingTornKeyPool ? "Loading" : tornKeyPool
    ? `${tornKeyPool.keys.filter(key => key.status === "active").length}/${tornKeyPool.keys.length} active`
    : "Unavailable";
  return <div className="admin-settings-content">
    <section className="panel admin-diagnostics-panel">
      <PanelHeader
        title="Latest data refresh"
        aside={isLoadingIngestionRun ? "Loading" : ingestionRun?.status ?? "No runs"}
      />
      {ingestionError ? <p role="alert" className="error-panel">{ingestionError}</p> : null}
      {ingestionRun ? (
        <div className="admin-metric-list">
          <MetricLine label="Started" value={formatIngestionTime(ingestionRun.started_at)} />
          <MetricLine label="Finished" value={formatIngestionTime(ingestionRun.finished_at)} />
          <MetricLine
            label="Total duration"
            value={formatDuration(ingestionRun.started_at, ingestionRun.finished_at)}
          />
          <MetricLine
            label="Torn/rankedwar checked"
            value={formatDuration(ingestionRun.started_at, ingestionRun.ranked_war_checked_at)}
          />
          <MetricLine
            label="Attacks fetched"
            value={formatDuration(ingestionRun.started_at, ingestionRun.attacks_fetch_finished_at)}
          />
          <MetricLine
            label="Stats ready"
            value={formatDuration(ingestionRun.started_at, ingestionRun.stats_finished_at)}
          />
          <MetricLine
            label="Fetched"
            value={`${ingestionRun.fetched_attacks} attacks across ${ingestionRun.fetched_pages} pages`}
          />
          {ingestionRun.error ? <MetricLine label="Error" value={ingestionRun.error} /> : null}
        </div>
      ) : (
        <p className="panel-description">{isLoadingIngestionRun ? "Loading refresh status." : ingestionError ? "Refresh status is unavailable." : "No ingestion run has been recorded yet."}</p>
      )}
      <button
        type="button"
        className="admin-button"
        disabled={isLoadingIngestionRun}
        onClick={loadLatestIngestionRun}
      >
        Refresh status
      </button>
    </section>
    <section className="panel admin-diagnostics-panel">
      <PanelHeader title="Saved Torn keys" aside={tornKeyPoolStatus} />
      {keysError ? <p role="alert" className="error-panel">{keysError}</p> : null}
      {tornKeyPool && tornKeyPool.keys.length > 0 ? (
        <div className="stock-status-table-wrap"><table className="stock-status-table">
          <thead>
            <tr>
              <th>Owner</th>
              <th>Status</th>
              <th>Access</th>
              <th>Faction access</th>
              <th>Features</th>
              <th>Max/min</th>
              <th>Last used</th>
              <th>Failures</th>
            </tr>
          </thead>
          <tbody>
            {tornKeyPool.keys.map((key) => (
              <tr key={key.id}>
                <td>
                  <strong>{key.owner_name ?? key.owner_torn_user_id ?? "Unknown"}</strong>
                  <small>{key.label ?? key.id}</small>
                </td>
                <td>{key.status}</td>
                <td>{formatKeyPoolAccess(key)}</td>
                <td>{formatBooleanAccess(key.faction_access)}</td>
                <td>{formatKeyPoolFeatures(key.allowed_features)}</td>
                <td>{key.max_requests_per_minute ?? "-"}</td>
                <td>{formatIngestionTime(key.last_used_at)}</td>
                <td>
                  {formatNumber(key.failure_count)}
                  {key.last_error ? <small>{key.last_error}</small> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      ) : (
        <p className="panel-description">
          {isLoadingTornKeyPool ? "Loading submitted Torn keys." : keysError ? "Saved keys are unavailable." : "No submitted Torn keys are available yet."}
        </p>
      )}
      <button
        type="button"
        className="admin-button"
        disabled={isLoadingTornKeyPool}
        onClick={loadTornKeyPool}
      >
        Refresh key pool
      </button>
    </section>
  </div>;
}
function MetricLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="admin-metric-line">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatIngestionTime(timestamp: number | null): string {
  if (!timestamp) {
    return "Not recorded";
  }

  return new Date(timestamp * 1000).toLocaleString();
}

function formatDuration(start: number | null, finish: number | null): string {
  if (!start || !finish) {
    return "Not recorded";
  }

  const durationMs = Math.max(0, (finish - start) * 1000);
  if (durationMs < 1000) {
    return "<1s";
  }

  const seconds = durationMs / 1000;
  return seconds < 60 ? `${seconds.toFixed(1)}s` : `${(seconds / 60).toFixed(1)}m`;
}

function formatKeyPoolFeatures(features: string[]): string {
  return features.length > 0
    ? features.map((feature) => feature.replace(/_/g, " ")).join(", ")
    : "-";
}

function formatKeyPoolAccess(key: {
  access_level: number | null;
  access_type: string | null;
}): string {
  if (key.access_type && key.access_level !== null) {
    return `${key.access_type} (${key.access_level})`;
  }
  if (key.access_type) {
    return key.access_type;
  }
  if (key.access_level !== null) {
    return String(key.access_level);
  }
  return "Unknown";
}

function formatBooleanAccess(value: boolean): string {
  return value ? "Yes" : "No";
}
