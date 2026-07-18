import React from "react";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Gauge,
  KeyRound,
  Radar,
  ServerCog,
  Settings2,
} from "lucide-react";
import {
  AdminDataHealthResponse,
  DataHealthKeyPoolSummary,
  DataHealthSettings,
  DataHealthStatus,
  DataHealthSubsystem,
  DataHealthSummaryResponse,
  EnemyScoutingCoverageRow,
  EnemyScoutingGapRow,
  getAdminDataHealth,
  getDataHealthSummary,
  MaintenanceTask,
  TornApiUsageCall,
  TornApiUsageKey,
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

const ADMIN_ONLY_SUBSYSTEM_KEYS = new Set(["maintenance", "key_health", "war_reports"]);
const PRECISE_RELATIVE_METRIC_LABELS = new Set(["Last poll", "Latest snapshot"]);
const DATA_HEALTH_REFRESH_MS = 30 * 1000;
const API_USAGE_WINDOW_OPTIONS = [
  { seconds: 60 * 60, label: "1h", summaryLabel: "1h" },
  { seconds: 24 * 60 * 60, label: "1 day", summaryLabel: "1 day" },
  { seconds: 7 * 24 * 60 * 60, label: "7 days", summaryLabel: "7 days" },
] as const;
const DEFAULT_API_USAGE_WINDOW_SECONDS = 60 * 60;

export function DataHealthPage({ onOpenView, isAdmin }: DataHealthCommandCenterProps) {
  const [data, setData] = React.useState<AdminDataHealthResponse | DataHealthSummaryResponse | null>(null);
  const [settingsForm, setSettingsForm] = React.useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [apiUsageWindowSeconds, setApiUsageWindowSeconds] = React.useState(DEFAULT_API_USAGE_WINDOW_SECONDS);
  const [isApiFeatureTableCollapsed, setIsApiFeatureTableCollapsed] = React.useState(true);

  async function loadData(
    windowSeconds = apiUsageWindowSeconds,
    includeApiUsageBreakdown = !isApiFeatureTableCollapsed,
  ) {
    setIsLoading(true);
    setError(null);
    try {
      const response = isAdmin
        ? await getAdminDataHealth(windowSeconds, includeApiUsageBreakdown)
        : await getDataHealthSummary();
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
      const response = await getAdminDataHealth(apiUsageWindowSeconds, !isApiFeatureTableCollapsed);
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
    const timer = window.setInterval(() => {
      loadData();
    }, DATA_HEALTH_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [isAdmin, apiUsageWindowSeconds, isApiFeatureTableCollapsed]);

  function handleApiUsageWindowChange(windowSeconds: number) {
    setApiUsageWindowSeconds(windowSeconds);
  }

  function handleApiFeatureTableToggle() {
    setIsApiFeatureTableCollapsed((current) => !current);
  }

  const adminData = isAdminDataHealthResponse(data) ? data : null;

  return (
    <>
      {error ? <div className="error-panel">{error}</div> : null}
      {notice ? <div className="dashboard-suggestion-success">{notice}</div> : null}

      <DataHealthOverview data={data} isLoading={isLoading} onOpenView={onOpenView} onRefresh={loadData} />

      {adminData ? (
        <AdminDataHealthDiagnostics
          data={adminData}
          apiUsageWindowSeconds={apiUsageWindowSeconds}
          isApiFeatureTableCollapsed={isApiFeatureTableCollapsed}
          isSaving={isSaving}
          onApiFeatureTableToggle={handleApiFeatureTableToggle}
          onApiUsageWindowChange={handleApiUsageWindowChange}
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
  onOpenView,
  onRefresh,
}: {
  data: DataHealthSummaryResponse | null;
  isLoading: boolean;
  onOpenView: (view: AppView) => void;
  onRefresh: () => void;
}) {
  const subsystems = memberVisibleSubsystems(data?.subsystems ?? []);
  const visibleOverallStatus = overallStatus(subsystems, data?.overall_status ?? "unknown");
  const criticalCount = subsystems.filter((subsystem) => subsystem.status === "critical").length;
  const warnCount = subsystems.filter((subsystem) => subsystem.status === "warn").length;

  return (
    <>
      <section className="hero-panel compact-hero-panel">
        <div>
          <p className="eyebrow">Operations</p>
          <h2>Data health</h2>
          <p>
            Checks whether the dashboard has fresh data to show. Warnings mean some data may be late,
            missing, or waiting on the next update.
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
          value={statusLabel(visibleOverallStatus)}
          status={visibleOverallStatus}
        />
        <HealthMetric
          label="Critical"
          value={formatNumber(criticalCount)}
          status={criticalCount > 0 ? "critical" : "good"}
          showIcon={criticalCount > 0}
        />
        <HealthMetric
          label="Warnings"
          value={formatNumber(warnCount)}
          status={warnCount > 0 ? "warn" : "good"}
          showIcon={warnCount > 0}
        />
      </section>

      <section className="panel data-health-overview-panel">
        <PanelHeader
          icon={<Gauge size={17} />}
          title="Subsystems"
          aside={data ? `Generated ${formatRelativeTime(data.generated_at)}` : "Loading"}
        />
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

      <KeyPoolPanel keyPool={data?.key_pool ?? null} onOpenView={onOpenView} />
    </>
  );
}

function KeyPoolPanel({
  keyPool,
  onOpenView,
}: {
  keyPool: DataHealthKeyPoolSummary | null;
  onOpenView: (view: AppView) => void;
}) {
  const windowLabel = formatApiUsageWindowSummaryLabel(keyPool?.window_seconds ?? 24 * 60 * 60);
  const keys = keyPool?.keys ?? [];

  return (
    <section className="panel data-health-key-pool-panel">
      <PanelHeader
        icon={<KeyRound size={17} />}
        title="Key Pool"
        aside={`Last ${windowLabel}`}
      />
      <p className="panel-description data-health-panel-description">
        Saved member keys help spread Torn API load across available keys.
      </p>
      {!keyPool ? (
        <EmptyState text="Loading key pool usage" />
      ) : (
        <>
          <div className="data-health-key-pool-stats">
            <KeyPoolStat label="Saved keys" value={formatNumber(keyPool.active_saved_keys)} />
            <KeyPoolStat label="Pool calls" value={`${formatNumber(keyPool.pool_requests)} / ${windowLabel}`} />
            <KeyPoolStat
              label="Pool share"
              value={keyPool.pool_share_percent === null ? "-" : `${formatNumber(keyPool.pool_share_percent)}%`}
            />
          </div>
          {keys.length > 0 ? (
            <>
              <div className="admin-table-toggle-row data-health-key-pool-table-header">
                <strong>Usage in last {windowLabel}</strong>
                <span>{formatNumber(keyPool.total_requests)} calls</span>
              </div>
              <table className="stock-status-table data-health-table data-health-key-pool-table">
                <thead>
                  <tr>
                    <th>Key name</th>
                    <th>Calls</th>
                    <th>Avg/min</th>
                    <th>Last used</th>
                  </tr>
                </thead>
                <tbody>
                  {keys.map((key) => (
                    <tr key={key.key_source}>
                      <td title={key.key_source}>{publicKeyPoolKeyLabel(key)}</td>
                      <td>{formatNumber(key.requests)}</td>
                      <td>{formatRate(key.calls_per_minute ?? 0)}</td>
                      <td>{formatRelativeTime(key.last_requested_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="data-health-key-pool-list">
                {keys.map((key) => (
                  <article key={key.key_source} title={key.key_source}>
                    <strong>{publicKeyPoolKeyLabel(key)}</strong>
                    <span>
                      {formatNumber(key.requests)} calls | {formatRate(key.calls_per_minute ?? 0)}/min | {formatRelativeTime(key.last_requested_at)}
                    </span>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <EmptyState text={`No key pool usage recorded in the last ${windowLabel}`} />
          )}
        </>
      )}
      <div className="data-health-key-pool-actions">
        <button
          type="button"
          className="panel-action-button primary-action"
          onClick={() => onOpenView("settings")}
        >
          <KeyRound size={14} />
          Submit key
        </button>
      </div>
    </section>
  );
}

function KeyPoolStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="data-health-key-pool-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function AdminDataHealthDiagnostics({
  data,
  apiUsageWindowSeconds,
  isApiFeatureTableCollapsed,
  isSaving,
  onApiFeatureTableToggle,
  onApiUsageWindowChange,
  onOpenView,
  onSaveSettings,
  settingsForm,
  setSettingsForm,
}: {
  data: AdminDataHealthResponse;
  apiUsageWindowSeconds: number;
  isApiFeatureTableCollapsed: boolean;
  isSaving: boolean;
  onApiFeatureTableToggle: () => void;
  onApiUsageWindowChange: (windowSeconds: number) => void;
  onOpenView: (view: AppView) => void;
  onSaveSettings: (event: React.FormEvent<HTMLFormElement>) => void;
  settingsForm: Record<string, string>;
  setSettingsForm: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}) {
  const adminSubsystems = adminOnlySubsystems(data.subsystems);
  const apiUsageWindowLabel = formatApiUsageWindowSummaryLabel(
    data.details.api_usage_window_seconds ?? data.details.api_usage.window_seconds ?? apiUsageWindowSeconds,
  );
  const keyHealthWindowLabel = formatApiUsageWindowSummaryLabel(data.details.api_key_health_window_seconds);
  return (
    <section className="data-health-admin-section" aria-labelledby="data-health-admin-title">
      <div className="data-health-section-header">
        <div>
          <p className="eyebrow">Admin</p>
          <h2 id="data-health-admin-title">Admin Diagnostics</h2>
        </div>
        <span className="admin-only-pill data-health-section-pill">Admin</span>
      </div>

      <section className="panel data-health-overview-panel">
        <PanelHeader
          icon={<ServerCog size={17} />}
          title="Admin subsystems"
          aside={`${formatNumber(adminSubsystems.length)} checks`}
        />
        <p className="panel-description data-health-panel-description">
          Internal operations checks for admins. These can affect upkeep and reporting workflows, but are hidden from the member overview.
        </p>
        {adminSubsystems.length === 0 ? (
          <EmptyState text="No admin subsystem health available" />
        ) : (
          <div className="data-health-subsystem-grid">
            {adminSubsystems.map((subsystem) => (
              <SubsystemTile key={subsystem.key} subsystem={subsystem} />
            ))}
          </div>
        )}
      </section>

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
                <div className="data-health-issue-content">
                  <strong>{issue.subsystem}</strong>
                  <p>{issue.title}</p>
                  {issue.key === "personal_stats" ? (
                    <PersonalStatsIssueDetail data={data} fallbackDetail={issue.detail} />
                  ) : (
                    <small>{issue.detail}</small>
                  )}
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

      <section className="data-health-drilldown-grid">
        <DailyStatsDrilldown data={data} onOpenView={onOpenView} />
        <EnemyScoutingDrilldown data={data} onOpenView={onOpenView} />
        <ApiJobFailuresDrilldown data={data} onOpenView={onOpenView} />
      </section>

      <section className="panel data-health-api-panel">
        <PanelHeader
          icon={<Clock3 size={17} />}
          title="Torn API usage"
          control={(
            <div className="admin-usage-window-control">
              <span>Last {apiUsageWindowLabel}</span>
              <select
                aria-label="Data health Torn API usage window"
                value={apiUsageWindowSeconds}
                onChange={(event) => onApiUsageWindowChange(Number(event.target.value))}
              >
                {API_USAGE_WINDOW_OPTIONS.map((option) => (
                  <option key={option.seconds} value={option.seconds}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        />
        <p className="panel-description data-health-panel-description">
          Recent Torn API call volume and failures. Spikes in errors or 429s can explain stale downstream data.
        </p>
        <div className="data-health-api-grid">
          <MetricLine label={`Requests in last ${apiUsageWindowLabel}`} value={formatNumber(data.details.api_usage.requests)} />
          <MetricLine label={`Errors in last ${apiUsageWindowLabel}`} value={formatNumber(data.details.api_usage.errors)} />
          <MetricLine label={`429s in last ${apiUsageWindowLabel}`} value={formatNumber(data.details.api_usage.rate_limited)} />
          <MetricLine
            label="Average latency"
            value={data.details.api_usage.avg_duration_ms === null ? "-" : `${formatNumber(data.details.api_usage.avg_duration_ms)}ms`}
          />
        </div>
        {data.details.api_key_health.length > 0 ? (
          <>
            <div className="admin-table-toggle-row">
              <strong>Key health</strong>
              <span>Last {keyHealthWindowLabel}</span>
            </div>
            <table className="stock-status-table data-health-table">
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Avg calls/min</th>
                  <th>Calls</th>
                  <th>Errors</th>
                  <th>429s</th>
                  <th>Avg</th>
                  <th>Last call</th>
                </tr>
              </thead>
              <tbody>
                {data.details.api_key_health.map((key) => (
                  <tr key={key.key_source}>
                    <td title={key.key_source}>{formatTornApiKeySource(key.key_source, key.key_label)}</td>
                    <td>{formatRate(key.calls_per_minute ?? 0)}</td>
                    <td>{formatNumber(key.requests)}</td>
                    <td>{formatNumber(key.errors)}</td>
                    <td>{formatNumber(key.rate_limited)}</td>
                    <td>{key.avg_duration_ms === null ? "-" : `${formatNumber(key.avg_duration_ms)}ms`}</td>
                    <td>{formatDate(key.last_requested_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : null}
        <div className="admin-table-toggle-row">
          <button
            type="button"
            className="collapse-button"
            aria-expanded={!isApiFeatureTableCollapsed}
            onClick={onApiFeatureTableToggle}
          >
            <span>{isApiFeatureTableCollapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}</span>
            <strong>Feature breakdown</strong>
          </button>
          <span>
            {isApiFeatureTableCollapsed
              ? "Collapsed"
              : `${formatNumber(data.details.api_features.length)} features`}
          </span>
        </div>
        {isApiFeatureTableCollapsed ? null : (
          data.details.api_features.length > 0 ? (
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
            <EmptyState text={`No Torn API calls recorded in the last ${apiUsageWindowLabel}`} />
          )
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
    </section>
  );
}

function PersonalStatsIssueDetail({
  data,
  fallbackDetail,
}: {
  data: AdminDataHealthResponse;
  fallbackDetail: string;
}) {
  const issueDate = personalStatsIssueDate(data);
  const gaps = data.details.personal_stats_coverage_gaps;
  const issueGaps = issueDate ? gaps.filter((member) => member.snapshot_date === issueDate) : [];

  return (
    <div className="data-health-issue-detail">
      {issueGaps.length > 0 ? (
        <div className="data-health-issue-members">
          {issueGaps.slice(0, 8).map((member) => (
            <span
              key={member.member_id}
              title={[
                member.recent_error,
                member.latest_personal_ready_date ? `Latest ready: ${member.latest_personal_ready_date}` : null,
                member.recent_status ? `Recent status: ${member.recent_status}` : null,
              ].filter(Boolean).join(" | ") || undefined}
            >
              <em>{member.member_name ?? `#${member.member_id}`}</em>
              <small>#{member.member_id}</small>
            </span>
          ))}
          {issueGaps.length > 8 ? <span>{formatNumber(issueGaps.length - 8)} more</span> : null}
        </div>
      ) : (
        <small>{fallbackDetail}</small>
      )}
    </div>
  );
}

function personalStatsIssueDate(data: AdminDataHealthResponse): string | null {
  const metric = data.subsystems.find((subsystem) => subsystem.key === "personal_stats")?.metrics
    .find((candidate) => {
      if (candidate.label === "Outstanding") return false;
      const [ready, total] = candidate.value.split("/").map(Number);
      return Number.isFinite(ready) && Number.isFinite(total) && ready < total;
    });
  return metric?.label ?? null;
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
      <div className="data-health-tile-metrics">
        {subsystem.metrics.map((metric) => (
          <MetricLine
            key={`${subsystem.key}-${metric.label}`}
            label={metric.label}
            title={metric.title ?? undefined}
            value={displayMetricValue(metric.value, metric.timestamp, metric.label)}
          />
        ))}
      </div>
    </article>
  );
}

function DailyStatsDrilldown({
  data,
  onOpenView,
}: {
  data: AdminDataHealthResponse;
  onOpenView: (view: AppView) => void;
}) {
  const attention = data.details.daily_stats_attention;
  const affectedMembers = attention.affected_members.slice(0, 12);
  const affectedCount = attention.stale_personalstats + attention.missing_donator_days;

  return (
    <section className="panel table-panel data-health-drilldown-panel">
      <PanelHeader
        icon={<BarChart3 size={17} />}
        title="Daily member stats"
        aside={affectedCount > 0 ? `${formatNumber(affectedCount)} issues` : "Complete"}
        control={
          <button type="button" className="panel-action-button" onClick={() => onOpenView("lifestyle")}>
            Open daily stats
          </button>
        }
      />
      <div className="data-health-drilldown-metrics">
        <MetricLine label="Target date" value={attention.personalstats_target_date ?? "-"} />
        <MetricLine label="Latest bucket" value={attention.latest_personalstats_bucket_date ?? "-"} />
        <MetricLine label="Lag days" value={nullableNumber(attention.personalstats_lag_days)} />
      </div>
      {affectedMembers.length === 0 ? (
        <EmptyState text="No stale daily stat members detected" />
      ) : (
        <div className="table-scroll">
          <table className="stock-status-table data-health-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Updated</th>
                <th>Issue</th>
              </tr>
            </thead>
            <tbody>
              {affectedMembers.map((member) => (
                <tr key={member.member_id}>
                  <td>{member.member_name ?? `#${member.member_id}`}</td>
                  <td>{formatDate(member.updated_at)}</td>
                  <td>{member.error ?? "Stats stale or incomplete"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function EnemyScoutingDrilldown({
  data,
  onOpenView,
}: {
  data: AdminDataHealthResponse;
  onOpenView: (view: AppView) => void;
}) {
  const coverage = data.details.enemy_scouting_coverage;
  const gaps = data.details.enemy_scouting_gaps;
  const totalMissing = gaps.length;

  return (
    <section className="panel table-panel data-health-drilldown-panel">
      <PanelHeader
        icon={<RadarIcon />}
        title="Enemy scouting coverage"
        aside={coverage.length > 0 ? `${formatNumber(totalMissing)} member gaps` : "No tracked enemy"}
        control={
          <button type="button" className="panel-action-button" onClick={() => onOpenView("warRoom")}>
            Open war room
          </button>
        }
      />
      {coverage.length === 0 ? (
        <EmptyState text="No current or upcoming enemy faction is being tracked" />
      ) : (
        <>
          <div className="data-health-coverage-list">
            {coverage.map((row) => (
              <EnemyCoverageSummary key={row.faction_id} row={row} />
            ))}
          </div>
          {gaps.length === 0 ? (
            <EmptyState text="Tracked enemy scouting coverage is complete" />
          ) : (
            <div className="table-scroll">
              <table className="stock-status-table data-health-table">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Faction</th>
                    <th>Level</th>
                    <th>Status</th>
                    <th>Missing</th>
                    <th>Networth attempts</th>
                  </tr>
                </thead>
                <tbody>
                  {gaps.map((member) => (
                    <tr key={`${member.faction_id}-${member.member_id}`}>
                      <td>{member.name}</td>
                      <td>{formatNumber(member.faction_id)}</td>
                      <td>{nullableNumber(member.level)}</td>
                      <td>{member.status_state ?? "-"}</td>
                      <td>{missingEnemyFields(member)}</td>
                      <td title={member.networth_error ?? undefined}>{networthAttemptLabel(member)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function EnemyCoverageSummary({ row }: { row: EnemyScoutingCoverageRow }) {
  return (
    <article className="data-health-coverage-row">
      <div>
        <strong>{row.war_names ?? `Faction ${row.faction_id}`}</strong>
        <span>Faction {formatNumber(row.faction_id)} | Updated {formatDate(row.status_checked_at ?? row.updated_at)}</span>
      </div>
      <div className="data-health-coverage-bars">
        <CoverageMetric label="FF" value={row.ff_stats_available} total={row.total_members} />
        <CoverageMetric label="BSP" value={row.bsp_stats_available} total={row.total_members} />
        <CoverageMetric label="Networth" value={row.networth_available} total={row.total_members} />
      </div>
      <small>
        Pending {formatNumber(row.networth_pending)} | Retryable {formatNumber(row.networth_retryable)} | Failed {formatNumber(row.networth_failed)}
      </small>
    </article>
  );
}

function CoverageMetric({
  label,
  value,
  total,
}: {
  label: string;
  value: number;
  total: number;
}) {
  const percent = total <= 0 ? 0 : Math.round((value / total) * 100);
  return (
    <span title={`${formatNumber(value)} of ${formatNumber(total)} members`}>
      <b>{label}</b>
      <em>{formatNumber(percent)}%</em>
    </span>
  );
}

function ApiJobFailuresDrilldown({
  data,
  onOpenView,
}: {
  data: AdminDataHealthResponse;
  onOpenView: (view: AppView) => void;
}) {
  const failedTasks = data.details.maintenance_tasks.filter((task) => task.status === "error");
  const failedCalls = data.details.api_recent_calls
    .filter((call) => !call.ok || Number(call.status ?? 0) >= 400)
    .slice(0, 8);
  const latestFailures = [
    data.details.ingestion_run?.status === "error" ? "Ingestion" : null,
    data.details.maintenance_run?.status === "error" ? "Maintenance" : null,
    ...failedTasks.map((task) => task.task_name),
  ].filter((value): value is string => Boolean(value));

  return (
    <section className="panel table-panel data-health-drilldown-panel">
      <PanelHeader
        icon={<ServerCog size={17} />}
        title="API and job failures"
        aside={latestFailures.length + failedCalls.length > 0 ? `${formatNumber(latestFailures.length + failedCalls.length)} shown` : "Clear"}
        control={
          <button type="button" className="panel-action-button" onClick={() => onOpenView("admin")}>
            Open admin
          </button>
        }
      />
      <div className="data-health-drilldown-metrics">
        <MetricLine label="Recent failed tasks" value={formatNumber(failedTasks.length)} />
        <MetricLine label="API errors" value={formatNumber(data.details.api_usage.errors)} />
        <MetricLine label="Rate limits" value={formatNumber(data.details.api_usage.rate_limited)} />
      </div>
      {latestFailures.length === 0 && failedCalls.length === 0 ? (
        <EmptyState text="No recent failed jobs or API calls detected" />
      ) : (
        <>
          {failedTasks.length > 0 ? <FailedTasksTable tasks={failedTasks} /> : null}
          {failedCalls.length > 0 ? <FailedApiCallsTable calls={failedCalls} /> : null}
        </>
      )}
    </section>
  );
}

function FailedTasksTable({ tasks }: { tasks: MaintenanceTask[] }) {
  return (
    <div className="table-scroll">
      <table className="stock-status-table data-health-table">
        <thead>
          <tr>
            <th>Task</th>
            <th>Started</th>
            <th>Error</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <tr key={task.id}>
              <td>{task.task_name}</td>
              <td>{formatDate(task.started_at)}</td>
              <td>{task.error ?? "Task failed"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FailedApiCallsTable({ calls }: { calls: TornApiUsageCall[] }) {
  return (
    <div className="table-scroll">
      <table className="stock-status-table data-health-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Feature</th>
            <th>Status</th>
            <th>Endpoint</th>
            <th>Error</th>
          </tr>
        </thead>
        <tbody>
          {calls.map((call) => (
            <tr key={call.id}>
              <td>{formatDate(call.requested_at)}</td>
              <td>{call.feature}</td>
              <td>{call.status ?? "-"}</td>
              <td>{call.endpoint}</td>
              <td>{call.error ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function missingEnemyFields(member: EnemyScoutingGapRow): string {
  const fields = [
    member.ff_battlestats === null ? "FF stats" : null,
    member.bsp_battlestats === null ? "BSP stats" : null,
    member.networth === null ? "Networth" : null,
  ].filter((field): field is string => Boolean(field));
  return fields.length > 0 ? fields.join(", ") : "-";
}

function networthAttemptLabel(member: EnemyScoutingGapRow): string {
  if (member.networth !== null) {
    return "-";
  }

  const attempts = member.networth_attempt_count ?? 0;
  const attemptedAt = member.networth_attempted_at ? formatDate(member.networth_attempted_at) : "not attempted";
  if (attempts <= 0) {
    return "Pending, not attempted";
  }

  return `${formatNumber(attempts)} ${attempts === 1 ? "attempt" : "attempts"}, ${attemptedAt}`;
}

function RadarIcon() {
  return <Radar size={17} />;
}

function HealthMetric({
  label,
  value,
  status,
  showIcon = true,
}: {
  label: string;
  value: string;
  status: DataHealthStatus;
  showIcon?: boolean;
}) {
  return (
    <section className={`metric-card data-health-metric-card ${status}`}>
      <div className="panel-kicker">
        {showIcon ? (
          <span className={`data-health-metric-icon ${status}`}>
            {status === "good" ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
          </span>
        ) : (
          <span className="data-health-metric-icon empty" aria-hidden="true" />
        )}
        <span>{label}</span>
      </div>
      <strong>{value}</strong>
    </section>
  );
}

function MetricLine({ label, title, value }: { label: string; title?: string; value: string }) {
  return (
    <div className="dashboard-metric-line" title={title}>
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

function formatApiUsageWindowSummaryLabel(seconds: number): string {
  const configured = API_USAGE_WINDOW_OPTIONS.find((option) => option.seconds === seconds);
  if (configured) return configured.summaryLabel;
  if (seconds < 60 * 60) return `${Math.round(seconds / 60)}m`;
  if (seconds < 24 * 60 * 60) return `${Math.round(seconds / (60 * 60))}h`;
  return `${Math.round(seconds / (24 * 60 * 60))}d`;
}

function formatTornApiKeySource(keySource: string, keyLabel?: string | null): string {
  const trimmedLabel = keyLabel?.trim();
  if (trimmedLabel) return trimmedLabel;

  switch (keySource) {
    case "env:TORN_API_KEY":
      return "Admin fallback key";
    case "member_supplied:auth":
      return "Member auth key";
    case "member_supplied:trade_scout":
      return "Trade Scout member key";
    default:
      return keySource;
  }
}

function publicKeyPoolKeyLabel(key: TornApiUsageKey): string {
  const trimmedLabel = key.key_label?.trim();
  if (trimmedLabel) return trimmedLabel;
  if (key.key_source === "env:TORN_API_KEY") return "Fallback key";
  if (key.key_source.startsWith("key_pool:")) {
    return `Pool ${key.key_source.slice("key_pool:".length, "key_pool:".length + 8)}`;
  }
  return formatTornApiKeySource(key.key_source);
}

function nullableNumber(value: number | null): string {
  return value === null ? "-" : formatNumber(value);
}

function formatRate(value: number): string {
  if (!Number.isFinite(value)) return "0.00";
  if (value > 0 && value < 0.01) return "<0.01";
  return value.toFixed(2);
}

function displayMetricValue(value: string, timestamp: number | null | undefined, label: string): string {
  if (timestamp && value === String(timestamp)) {
    if (PRECISE_RELATIVE_METRIC_LABELS.has(label)) {
      return formatPreciseRelativeTime(timestamp);
    }
    return formatRelativeTime(timestamp);
  }
  return value;
}

function formatPreciseRelativeTime(timestamp: number | null): string {
  if (!timestamp) return "-";

  const elapsedSeconds = Math.max(0, Math.floor(Date.now() / 1000) - timestamp);
  if (elapsedSeconds < 60) return `${elapsedSeconds}s ago`;

  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  if (minutes < 60) {
    return seconds === 0 ? `${minutes}m ago` : `${minutes}m ${seconds}s ago`;
  }

  return formatRelativeTime(timestamp);
}

function subsystemDescription(key: string): string {
  if (key === "ingestion") return "Checks whether faction attack data is being imported on schedule.";
  if (key === "maintenance") return "Checks scheduled cleanup and repair jobs that keep derived data tidy.";
  if (key === "personal_stats") return "Checks daily personal-stat snapshots.";
  if (key === "gym_stats") return "Checks the five gym contributor stat streams.";
  if (key === "roster") return "Checks current faction members data.";
  if (key === "torn_api") return "Checks recent Torn API failures and rate limits that can slow updates.";
  if (key === "key_health") return "Checks per-key Torn API call volume over the last 24 hours.";
  if (key === "stock_data") return "Checks stock profile and price snapshot freshness.";
  if (key === "war_reports") return "Checks ended wars that still need official Torn reports reconciled.";
  return "Checks one dashboard data source for freshness and coverage.";
}

function memberVisibleSubsystems(subsystems: DataHealthSubsystem[]): DataHealthSubsystem[] {
  return subsystems.filter((subsystem) => !ADMIN_ONLY_SUBSYSTEM_KEYS.has(subsystem.key));
}

function adminOnlySubsystems(subsystems: DataHealthSubsystem[]): DataHealthSubsystem[] {
  return subsystems.filter((subsystem) => ADMIN_ONLY_SUBSYSTEM_KEYS.has(subsystem.key));
}

function overallStatus(subsystems: DataHealthSubsystem[], fallback: DataHealthStatus): DataHealthStatus {
  if (subsystems.length === 0) return fallback;
  return subsystems.reduce<DataHealthStatus>((highest, subsystem) =>
    statusRank(subsystem.status) > statusRank(highest) ? subsystem.status : highest,
  "good");
}

function statusRank(status: DataHealthStatus): number {
  if (status === "critical") return 3;
  if (status === "warn") return 2;
  if (status === "unknown") return 1;
  return 0;
}

function isAdminDataHealthResponse(
  data: AdminDataHealthResponse | DataHealthSummaryResponse | null,
): data is AdminDataHealthResponse {
  return Boolean(data && "settings" in data && "details" in data);
}
