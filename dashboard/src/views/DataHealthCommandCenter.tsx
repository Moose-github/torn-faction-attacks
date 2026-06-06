import React from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock3,
  Database,
  Gauge,
  ServerCog,
  Settings2,
} from "lucide-react";
import {
  AdminDataHealthResponse,
  DataHealthSettings,
  DataHealthStatus,
  DataHealthSubsystem,
  DataHealthSummaryResponse,
  getAdminDataHealth,
  getDataHealthSummary,
  updateDataHealthSettings,
} from "../api";
import { EmptyState, PanelHeader } from "../components/Common";
import type { AppView } from "../routes";
import { formatLongDateTime, formatNumber, formatRelativeTime } from "../utils/format";

type DataHealthCommandCenterProps = {
  onOpenView: (view: AppView) => void;
  isAdmin: boolean;
};

const SETTING_FIELDS: Array<{
  key: keyof DataHealthSettings;
  label: string;
  unit: string;
}> = [
  { key: "ingestion_warn_seconds", label: "Ingestion warn age", unit: "sec" },
  { key: "ingestion_critical_seconds", label: "Ingestion critical age", unit: "sec" },
  { key: "maintenance_warn_seconds", label: "Maintenance warn age", unit: "sec" },
  { key: "maintenance_critical_seconds", label: "Maintenance critical age", unit: "sec" },
  { key: "daily_stats_lag_warn_days", label: "Daily stats warn lag", unit: "days" },
  { key: "daily_stats_lag_critical_days", label: "Daily stats critical lag", unit: "days" },
  { key: "stale_daily_members_warn", label: "Stale member warn count", unit: "members" },
  { key: "stale_daily_members_critical", label: "Stale member critical count", unit: "members" },
  { key: "api_error_rate_warn_percent", label: "API error warn rate", unit: "%" },
  { key: "api_error_rate_critical_percent", label: "API error critical rate", unit: "%" },
  { key: "api_rate_limited_warn", label: "API 429 warn count", unit: "calls" },
  { key: "api_rate_limited_critical", label: "API 429 critical count", unit: "calls" },
  { key: "stock_freshness_warn_seconds", label: "Stock warn age", unit: "sec" },
  { key: "stock_freshness_critical_seconds", label: "Stock critical age", unit: "sec" },
  { key: "stale_stocks_warn", label: "Stale stocks warn count", unit: "stocks" },
  { key: "stale_stocks_critical", label: "Stale stocks critical count", unit: "stocks" },
];

export function DataHealthPage({ onOpenView, isAdmin }: DataHealthCommandCenterProps) {
  const [data, setData] = React.useState<AdminDataHealthResponse | DataHealthSummaryResponse | null>(null);
  const [settingsForm, setSettingsForm] = React.useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function loadData() {
    setIsLoading(true);
    setError(null);
    try {
      const response = isAdmin ? await getAdminDataHealth() : await getDataHealthSummary();
      setData(response);
      if (isAdminDataHealthResponse(response)) {
        setSettingsForm(formFromSettings(response.settings));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }

  async function saveSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isAdminDataHealthResponse(data)) return;
    setIsSaving(true);
    setError(null);
    setNotice(null);
    try {
      const payload = settingsFromForm(settingsForm);
      await updateDataHealthSettings(payload);
      const response = await getAdminDataHealth();
      setData(response);
      setSettingsForm(formFromSettings(response.settings));
      setNotice("Data health thresholds saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  }

  React.useEffect(() => {
    loadData();
  }, [isAdmin]);

  const adminData = isAdminDataHealthResponse(data) ? data : null;

  return (
    <>
      {error ? <div className="error-panel">{error}</div> : null}
      {notice ? <div className="dashboard-suggestion-success">{notice}</div> : null}

      <DataHealthOverview data={data} isLoading={isLoading} onRefresh={loadData} />

      {adminData ? (
        <AdminDataHealthDiagnostics
          data={adminData}
          isSaving={isSaving}
          onOpenView={onOpenView}
          onSaveSettings={saveSettings}
          settingsForm={settingsForm}
          setSettingsForm={setSettingsForm}
        />
      ) : null}
    </>
  );
}

export const DataHealthCommandCenter = DataHealthPage;

function DataHealthOverview({
  data,
  isLoading,
  onRefresh,
}: {
  data: DataHealthSummaryResponse | null;
  isLoading: boolean;
  onRefresh: () => void;
}) {
  const subsystems = data?.subsystems ?? [];
  const criticalCount = subsystems.filter((subsystem) => subsystem.status === "critical").length;
  const warnCount = subsystems.filter((subsystem) => subsystem.status === "warn").length;

  return (
    <>
      <section className="hero-panel compact-hero-panel">
        <div>
          <p className="eyebrow">Operations</p>
          <h2>Data health</h2>
          <p>
            A quick read on whether the dashboard data is fresh enough to trust.
            Warnings usually mean a feed is delayed; critical means admins should investigate.
          </p>
        </div>
        <button
          type="button"
          className="panel-action-button"
          disabled={isLoading}
          onClick={onRefresh}
        >
          {isLoading ? "Refreshing" : "Refresh"}
        </button>
      </section>

      <section className="status-grid data-health-status-grid">
        <HealthMetric
          label="Overall"
          value={statusLabel(data?.overall_status ?? "unknown")}
          status={data?.overall_status ?? "unknown"}
          detail="Highest severity across every subsystem below."
        />
        <HealthMetric
          label="Critical"
          value={formatNumber(criticalCount)}
          status={criticalCount > 0 ? "critical" : "good"}
          detail="Checks that are failing, missing, or far outside their target freshness."
        />
        <HealthMetric
          label="Warnings"
          value={formatNumber(warnCount)}
          status={warnCount > 0 ? "warn" : "good"}
          detail="Checks that are still usable but may be stale or degraded."
        />
      </section>

      <section className="panel data-health-overview-panel">
        <PanelHeader
          icon={<Gauge size={17} />}
          title="Subsystems"
          aside={data ? `Generated ${formatRelativeTime(data.generated_at)}` : "Loading"}
        />
        <p className="panel-description data-health-panel-description">
          Each tile tracks one source of dashboard truth. Good means the latest signals are within target;
          warning or critical means the tile summary explains what is late, missing, or failing.
        </p>
        {subsystems.length === 0 ? (
          <EmptyState text={isLoading ? "Loading data health" : "No subsystem health available"} />
        ) : (
          <div className="data-health-subsystem-grid">
            {subsystems.map((subsystem) => (
              <SubsystemTile key={subsystem.key} subsystem={subsystem} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function AdminDataHealthDiagnostics({
  data,
  isSaving,
  onOpenView,
  onSaveSettings,
  settingsForm,
  setSettingsForm,
}: {
  data: AdminDataHealthResponse;
  isSaving: boolean;
  onOpenView: (view: AppView) => void;
  onSaveSettings: (event: React.FormEvent<HTMLFormElement>) => void;
  settingsForm: Record<string, string>;
  setSettingsForm: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}) {
  return (
    <>
      <section className="panel data-health-issues-panel">
        <PanelHeader
          icon={<AlertTriangle size={17} />}
          title="Issues"
          aside={`${formatNumber(data.issues.length)} open`}
        />
        <p className="panel-description data-health-panel-description">
          Admin-only triage list for the checks that are not good. Use the detail text to decide whether this is
          a transient delay or something that needs manual repair.
        </p>
        {data.issues.length === 0 ? (
          <EmptyState text="No data health issues detected" />
        ) : (
          <div className="data-health-issue-list">
            {data.issues.map((issue) => (
              <article key={`${issue.key}-${issue.title}`} className={`data-health-issue-row ${issue.status}`}>
                <span className={`data-health-status-chip ${issue.status}`}>{statusLabel(issue.status)}</span>
                <div>
                  <strong>{issue.subsystem}</strong>
                  <p>{issue.title}</p>
                  <small>{issue.detail}</small>
                </div>
                {issue.action_view ? (
                  <button
                    type="button"
                    className="panel-action-button"
                    onClick={() => onOpenView(issue.action_view as AppView)}
                  >
                    {issue.action_label ?? "Open"}
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="data-health-detail-grid">
        <DetailPanel
          icon={<Activity size={17} />}
          title="Ingestion"
          rows={[
            ["Status", data.details.ingestion_run?.status ?? "-"],
            ["Started", formatDate(data.details.ingestion_run?.started_at ?? null)],
            ["Finished", formatDate(data.details.ingestion_run?.finished_at ?? null)],
            ["Fetched attacks", formatNumber(data.details.ingestion_run?.fetched_attacks ?? 0)],
            ["Latest attack", formatDate(data.details.ingestion_run?.latest_attack_started ?? null)],
            ["Error", data.details.ingestion_run?.error ?? "-"],
          ]}
        />
        <DetailPanel
          icon={<ServerCog size={17} />}
          title="Maintenance"
          rows={[
            ["Status", data.details.maintenance_run?.status ?? "-"],
            ["Started", formatDate(data.details.maintenance_run?.started_at ?? null)],
            ["Finished", formatDate(data.details.maintenance_run?.finished_at ?? null)],
            ["Tasks", formatNumber(data.details.maintenance_run?.task_count ?? 0)],
            ["Changed rows", formatNumber(data.details.maintenance_run?.changed_rows ?? 0)],
            ["Failed tasks", formatNumber(data.details.maintenance_tasks.filter((task) => task.status === "error").length)],
          ]}
        />
        <DetailPanel
          icon={<BarChart3 size={17} />}
          title="Personal stats"
          rows={[
            ["Target date", data.details.daily_stats_attention.personalstats_target_date ?? "-"],
            ["Latest bucket", data.details.daily_stats_attention.latest_personalstats_bucket_date ?? "-"],
            ["Lag days", nullableNumber(data.details.daily_stats_attention.personalstats_lag_days)],
            ["Stale personalstats", formatNumber(data.details.daily_stats_attention.stale_personalstats)],
            ["Donator-day gaps", formatNumber(data.details.daily_stats_attention.missing_donator_days)],
          ]}
        />
        <DetailPanel
          icon={<Activity size={17} />}
          title="Gym stats"
          rows={[
            ["Target date", data.details.gym_stats_health.target_date ?? "-"],
            ["Latest snapshot", data.details.gym_stats_health.latest_gym_snapshot_date ?? "-"],
            ["Lag days", nullableNumber(data.details.gym_stats_health.gym_lag_days)],
            ["Stale members", formatNumber(data.details.gym_stats_health.stale_gym_members)],
          ]}
        />
        <DetailPanel
          icon={<Database size={17} />}
          title="Stock data"
          rows={[
            ["Latest run", data.details.stock_run?.status ?? "-"],
            ["Newest snapshot", formatDate(data.details.stock_coverage.newest_snapshot_at)],
            ["Coverage", `${formatNumber(data.details.stock_coverage.stocks_with_snapshots)}/${formatNumber(data.details.stock_coverage.total_stocks)}`],
            ["Stale stocks", formatNumber(data.details.stock_coverage.stale_stocks)],
            ["Last error", data.details.stock_last_error ?? "-"],
          ]}
        />
      </section>

      <section className="panel data-health-api-panel">
        <PanelHeader icon={<Clock3 size={17} />} title="Torn API usage" aside="Last hour" />
        <p className="panel-description data-health-panel-description">
          Recent Torn API call volume and failures. Spikes in errors or 429s can explain stale downstream data.
        </p>
        <div className="data-health-api-grid">
          <MetricLine label="Requests" value={formatNumber(data.details.api_usage.requests)} />
          <MetricLine label="Errors" value={formatNumber(data.details.api_usage.errors)} />
          <MetricLine label="429s" value={formatNumber(data.details.api_usage.rate_limited)} />
          <MetricLine
            label="Average latency"
            value={data.details.api_usage.avg_duration_ms === null ? "-" : `${formatNumber(data.details.api_usage.avg_duration_ms)}ms`}
          />
        </div>
        {data.details.api_features.length > 0 ? (
          <table className="stock-status-table data-health-table">
            <thead>
              <tr>
                <th>Feature</th>
                <th>Calls</th>
                <th>Errors</th>
                <th>429s</th>
                <th>Last call</th>
              </tr>
            </thead>
            <tbody>
              {data.details.api_features.map((feature) => (
                <tr key={feature.feature}>
                  <td>{feature.feature}</td>
                  <td>{formatNumber(feature.requests)}</td>
                  <td>{formatNumber(feature.errors)}</td>
                  <td>{formatNumber(feature.rate_limited)}</td>
                  <td>{formatDate(feature.last_requested_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState text="No Torn API calls recorded in the last hour" />
        )}
      </section>

      <section className="panel data-health-settings-panel">
        <PanelHeader icon={<Settings2 size={17} />} title="Health thresholds" aside="Global" />
        <p className="panel-description data-health-panel-description">
          Thresholds control when a check becomes a warning or critical. Lower values make the page more sensitive;
          higher values tolerate longer delays before alerting.
        </p>
        <form className="data-health-settings-form" onSubmit={onSaveSettings}>
          {SETTING_FIELDS.map((field) => (
            <label key={field.key}>
              <span>{field.label}</span>
              <div>
                <input
                  inputMode="decimal"
                  value={settingsForm[field.key] ?? ""}
                  onChange={(event) => setSettingsForm((current) => ({
                    ...current,
                    [field.key]: event.target.value,
                  }))}
                />
                <small>{field.unit}</small>
              </div>
            </label>
          ))}
          <button type="submit" className="panel-action-button primary-action" disabled={isSaving}>
            {isSaving ? "Saving" : "Save thresholds"}
          </button>
        </form>
      </section>
    </>
  );
}

function SubsystemTile({ subsystem }: { subsystem: DataHealthSubsystem }) {
  return (
    <article className={`data-health-subsystem-tile ${subsystem.status}`}>
      <div>
        <span className={`data-health-status-chip ${subsystem.status}`}>{statusLabel(subsystem.status)}</span>
        <strong>{subsystem.label}</strong>
      </div>
      <p>{subsystem.summary}</p>
      <small className="data-health-subsystem-description">{subsystemDescription(subsystem.key)}</small>
      <small>{subsystem.updated_at ? `Last signal ${formatRelativeTime(subsystem.updated_at)}` : "No timestamp recorded"}</small>
      <div className="data-health-tile-metrics">
        {subsystem.metrics.map((metric) => (
          <MetricLine key={`${subsystem.key}-${metric.label}`} label={metric.label} value={displayMetricValue(metric.value, metric.timestamp)} />
        ))}
      </div>
    </article>
  );
}

function DetailPanel({
  icon,
  title,
  rows,
}: {
  icon: React.ReactNode;
  title: string;
  rows: Array<[string, string]>;
}) {
  return (
    <section className="panel data-health-detail-panel">
      <PanelHeader icon={icon} title={title} />
      <div className="admin-metric-list">
        {rows.map(([label, value]) => (
          <MetricLine key={`${title}-${label}`} label={label} value={value} />
        ))}
      </div>
    </section>
  );
}

function HealthMetric({
  label,
  value,
  status,
  detail,
}: {
  label: string;
  value: string;
  status: DataHealthStatus;
  detail: string;
}) {
  return (
    <section className={`metric-card data-health-metric-card ${status}`}>
      <div className="panel-kicker">
        {status === "good" ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
        <span>{label}</span>
      </div>
      <strong>{value}</strong>
      <p>{detail}</p>
    </section>
  );
}

function MetricLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="dashboard-metric-line">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formFromSettings(settings: DataHealthSettings): Record<string, string> {
  return Object.fromEntries(
    SETTING_FIELDS.map((field) => [field.key, String(settings[field.key])]),
  );
}

function settingsFromForm(form: Record<string, string>): Partial<DataHealthSettings> {
  return Object.fromEntries(
    SETTING_FIELDS.map((field) => [field.key, Number(form[field.key])]),
  ) as Partial<DataHealthSettings>;
}

function statusLabel(status: DataHealthStatus): string {
  if (status === "critical") return "Critical";
  if (status === "warn") return "Warning";
  if (status === "good") return "Good";
  return "Unknown";
}

function formatDate(timestamp: number | null): string {
  return timestamp ? formatLongDateTime(timestamp) : "-";
}

function nullableNumber(value: number | null): string {
  return value === null ? "-" : formatNumber(value);
}

function displayMetricValue(value: string, timestamp: number | null | undefined): string {
  if (timestamp && value === String(timestamp)) {
    return formatRelativeTime(timestamp);
  }
  return value;
}

function subsystemDescription(key: string): string {
  if (key === "ingestion") return "Checks whether faction attack data is being imported on schedule.";
  if (key === "maintenance") return "Checks scheduled cleanup and repair jobs that keep derived data tidy.";
  if (key === "personal_stats") return "Checks daily personal-stat snapshots used by reports and trend views.";
  if (key === "gym_stats") return "Checks daily gym-stat snapshots used by member progress views.";
  if (key === "roster") return "Checks whether the current home roster and member metadata are present.";
  if (key === "torn_api") return "Checks recent Torn API failures and rate limits that can slow updates.";
  if (key === "stock_data") return "Checks stock profile and price snapshot freshness.";
  if (key === "war_reports") return "Checks ended wars that still need official Torn reports reconciled.";
  return "Checks one dashboard data source for freshness and coverage.";
}

function isAdminDataHealthResponse(
  data: AdminDataHealthResponse | DataHealthSummaryResponse | null,
): data is AdminDataHealthResponse {
  return Boolean(data && "settings" in data && "details" in data);
}
