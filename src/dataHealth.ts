import { readJsonObject } from "./backend/request";
import { getDailyStatsAttention } from "./lifestyleStats/dailyAttention";
import {
  GYM_CONTRIBUTOR_STAT_KEYS,
  GymContributorStatKey,
} from "./lifestyleStats/model";
import {
  ADMIN_ONLY_SUBSYSTEM_KEYS,
  API_USAGE_WINDOW_SECONDS,
  DEFAULT_ADMIN_API_USAGE_WINDOW_SECONDS,
  DEFAULT_DATA_HEALTH_SETTINGS,
  HEALTH_CACHE_TIME_SECONDS,
  KEY_HEALTH_WINDOW_SECONDS,
  MAX_ADMIN_API_USAGE_WINDOW_SECONDS,
  STATUS_RANK,
  statusForAgeSeconds,
  statusForCount,
  statusForPercent,
  type DataHealthIssue,
  type DataHealthSettings,
  type DataHealthSnapshot,
  type DataHealthStatus,
  type DataHealthSubsystem,
} from "./dataHealth/model";
import {
  normalizeSettingsPatch,
  readApiUsageFeatures,
  readApiUsageHealth,
  readApiUsageHealthRollup,
  readApiUsageKeys,
  readDataHealthSettings,
  readEnemyScoutingCoverage,
  readEnemyScoutingGaps,
  readGymStatsHealth,
  readLatestAttackStarted,
  readLatestIngestionRun,
  readLatestMaintenance,
  readLatestStockRun,
  readPersonalStatsCoverage,
  readPersonalStatsCoverageGaps,
  readRecentApiCalls,
  readRosterHealth,
  readStockCoverage,
  readStockLastError,
  readWarReportHealth,
  saveDataHealthSettings,
} from "./dataHealth/queries";
import { Env } from "./types";
import { json, nowSeconds, parseLimit } from "./utils";

export {
  DEFAULT_DATA_HEALTH_SETTINGS,
  statusForAgeSeconds,
  statusForCount,
  statusForPercent,
};
export type { DataHealthIssue, DataHealthSettings, DataHealthStatus };

export async function getDataHealthSummary(env: Env): Promise<Response> {
  const snapshot = await readDataHealthSnapshot(env, { includeAdminDetail: false });
  const subsystems = memberVisibleSubsystems(subsystemsFromSnapshot(snapshot));
  return json({
    ok: true,
    generated_at: snapshot.now,
    cache_seconds: HEALTH_CACHE_TIME_SECONDS,
    overall_status: overallStatus(subsystems),
    subsystems: sanitizeSubsystems(subsystems),
  });
}

export async function getAdminDataHealth(env: Env): Promise<Response>;
export async function getAdminDataHealth(url: URL, env: Env): Promise<Response>;
export async function getAdminDataHealth(urlOrEnv: URL | Env, maybeEnv?: Env): Promise<Response> {
  const url = urlOrEnv instanceof URL ? urlOrEnv : null;
  const env = maybeEnv ?? urlOrEnv as Env;
  const apiUsageWindowSeconds = parseLimit(
    url?.searchParams.get("window_seconds") ?? null,
    DEFAULT_ADMIN_API_USAGE_WINDOW_SECONDS,
    MAX_ADMIN_API_USAGE_WINDOW_SECONDS,
  );
  const includeApiUsageBreakdown = url?.searchParams.get("include_breakdown") === "1";
  const snapshot = await readDataHealthSnapshot(env, {
    includeAdminDetail: true,
    apiUsageWindowSeconds,
    includeApiUsageBreakdown,
  });
  const subsystems = subsystemsFromSnapshot(snapshot);
  return json({
    ok: true,
    generated_at: snapshot.now,
    cache_seconds: HEALTH_CACHE_TIME_SECONDS,
    overall_status: overallStatus(subsystems),
    settings: snapshot.settings,
    subsystems,
    issues: issuesFromSnapshot(snapshot, subsystems),
    details: {
      ingestion_run: snapshot.ingestion,
      maintenance_run: snapshot.maintenance,
      maintenance_tasks: snapshot.maintenanceTasks,
      daily_stats_attention: snapshot.dailyStats,
      personal_stats_coverage_gaps: snapshot.personalStatsCoverageGaps,
      gym_stats_health: snapshot.gymStats,
      roster: snapshot.roster,
      api_usage: snapshot.apiDetailUsage,
      api_usage_window_seconds: snapshot.apiUsageWindowSeconds,
      api_key_health: snapshot.apiKeyHealth,
      api_key_health_window_seconds: KEY_HEALTH_WINDOW_SECONDS,
      api_keys: snapshot.apiKeys,
      api_features: snapshot.apiFeatures,
      api_endpoints: snapshot.apiEndpoints,
      api_recent_calls: snapshot.apiRecentCalls,
      stock_run: snapshot.stockRun,
      stock_coverage: snapshot.stockCoverage,
      stock_last_error: snapshot.stockLastError,
      war_reports: snapshot.warReports,
      enemy_scouting_coverage: snapshot.enemyScoutingCoverage,
      enemy_scouting_gaps: snapshot.enemyScoutingGaps,
    },
  });
}

export async function updateDataHealthSettingsFromRequest(request: Request, env: Env): Promise<Response> {
  const body = await readJsonObject(request);
  const current = await readDataHealthSettings(env);
  const next = normalizeSettingsPatch(body, current);
  if ("error" in next) {
    return json({ ok: false, error: next.error, code: "INVALID_DATA_HEALTH_SETTINGS" }, 400);
  }

  await saveDataHealthSettings(env, next.settings);
  return json({
    ok: true,
    settings: await readDataHealthSettings(env),
  });
}

async function readDataHealthSnapshot(
  env: Env,
  options: { includeAdminDetail: boolean; apiUsageWindowSeconds?: number; includeApiUsageBreakdown?: boolean },
): Promise<DataHealthSnapshot> {
  const now = nowSeconds();
  const settings = await readDataHealthSettings(env);
  const apiUsageWindowSeconds = options.apiUsageWindowSeconds ?? API_USAGE_WINDOW_SECONDS;
  const includeApiUsageBreakdown = options.includeAdminDetail && options.includeApiUsageBreakdown === true;

  const [
    ingestion,
    latestAttack,
    maintenance,
    dailyStats,
    roster,
    apiUsage,
    apiDetailUsage,
    apiKeyHealth,
    apiKeys,
    apiFeatures,
    apiEndpoints,
    apiRecentCalls,
    stockRun,
    stockCoverage,
    stockLastError,
    warReports,
    enemyScoutingCoverage,
    enemyScoutingGaps,
  ] = await Promise.all([
    readLatestIngestionRun(env),
    readLatestAttackStarted(env),
    readLatestMaintenance(env),
    getDailyStatsAttention(env),
    readRosterHealth(env),
    readApiUsageHealth(env, now, API_USAGE_WINDOW_SECONDS),
    options.includeAdminDetail ? readApiUsageHealthRollup(env, now, apiUsageWindowSeconds) : readApiUsageHealth(env, now, API_USAGE_WINDOW_SECONDS),
    options.includeAdminDetail ? readApiUsageKeys(env, now, KEY_HEALTH_WINDOW_SECONDS) : Promise.resolve([]),
    options.includeAdminDetail ? readApiUsageKeys(env, now, apiUsageWindowSeconds) : Promise.resolve([]),
    includeApiUsageBreakdown ? readApiUsageFeatures(env, now, "feature", apiUsageWindowSeconds) : Promise.resolve([]),
    includeApiUsageBreakdown ? readApiUsageFeatures(env, now, "endpoint", apiUsageWindowSeconds) : Promise.resolve([]),
    options.includeAdminDetail ? readRecentApiCalls(env) : Promise.resolve([]),
    readLatestStockRun(env),
    readStockCoverage(env, now, settings),
    readStockLastError(env),
    readWarReportHealth(env),
    options.includeAdminDetail ? readEnemyScoutingCoverage(env) : Promise.resolve([]),
    options.includeAdminDetail ? readEnemyScoutingGaps(env) : Promise.resolve([]),
  ]);
  const [personalStatsCoverage, personalStatsCoverageGaps, gymStats] = await Promise.all([
    readPersonalStatsCoverage(env, dailyStats.personalstats_target_date),
    options.includeAdminDetail
      ? readPersonalStatsCoverageGaps(env, dailyStats.personalstats_target_date)
      : Promise.resolve([]),
    readGymStatsHealth(env, dailyStats.personalstats_target_date, now),
  ]);

  return {
    now,
    settings,
    ingestion,
    latestAttackStarted: latestAttack,
    maintenance: maintenance.run,
    maintenanceTasks: maintenance.tasks,
    dailyStats,
    personalStatsCoverage,
    personalStatsCoverageGaps,
    gymStats,
    roster,
    apiUsage,
    apiDetailUsage,
    apiUsageWindowSeconds,
    apiKeyHealth,
    apiKeys,
    apiFeatures,
    apiEndpoints,
    apiRecentCalls,
    stockRun,
    stockCoverage,
    stockLastError,
    warReports,
    enemyScoutingCoverage,
    enemyScoutingGaps,
  };
}

function subsystemsFromSnapshot(snapshot: DataHealthSnapshot): DataHealthSubsystem[] {
  return [
    ingestionSubsystem(snapshot),
    rosterSubsystem(snapshot),
    maintenanceSubsystem(snapshot),
    personalStatsSubsystem(snapshot),
    gymStatsSubsystem(snapshot),
    apiSubsystem(snapshot),
    keyHealthSubsystem(snapshot),
    stockSubsystem(snapshot),
    warReportsSubsystem(snapshot),
  ];
}

function ingestionSubsystem(snapshot: DataHealthSnapshot): DataHealthSubsystem {
  const run = snapshot.ingestion;
  if (!run) {
    return unknownSubsystem("ingestion", "Attack ingestion", "No ingestion run has been recorded");
  }

  const age = snapshot.now - (run.finished_at ?? run.started_at);
  const freshnessStatus = statusForAgeSeconds(age, snapshot.settings.ingestion_warn_seconds, snapshot.settings.ingestion_critical_seconds);
  const status = run.status === "error" ? "critical" : maxStatus(freshnessStatus, run.status === "running" ? "warn" : "good");
  const completedAt = run.finished_at ?? run.started_at;
  const staleThresholdSeconds = freshnessStatus === "critical"
    ? snapshot.settings.ingestion_critical_seconds
    : snapshot.settings.ingestion_warn_seconds;
  const summary = run.status === "error"
    ? "Latest attack ingestion failed"
    : freshnessStatus !== "good"
      ? `Last attack poll is older than ${formatDurationLabel(staleThresholdSeconds)}`
      : run.status === "running"
        ? "Attack ingestion is currently running"
        : "Attack polling is on schedule";

  return {
    key: "ingestion",
    label: "Attack ingestion",
    status,
    summary,
    updated_at: completedAt,
    metrics: [
      { label: "Last poll", value: String(completedAt), timestamp: completedAt },
      {
        label: "Last run returned",
        value: `${run.fetched_attacks}`,
        title: "Attack rows returned by the latest poll window. This can include overlap and does not mean the newest stored attack happened in that run.",
      },
      {
        label: "Newest stored attack",
        value: snapshot.latestAttackStarted === null ? "-" : String(snapshot.latestAttackStarted),
        timestamp: snapshot.latestAttackStarted,
      },
    ],
  };
}

function maintenanceSubsystem(snapshot: DataHealthSnapshot): DataHealthSubsystem {
  const run = snapshot.maintenance;
  if (!run) {
    return unknownSubsystem("maintenance", "Scheduled maintenance", "No maintenance run has been recorded");
  }

  const failedTasks = snapshot.maintenanceTasks.filter((task) => task.status === "error").length;
  const age = snapshot.now - (run.finished_at ?? run.started_at);
  const freshnessStatus = statusForAgeSeconds(age, snapshot.settings.maintenance_warn_seconds, snapshot.settings.maintenance_critical_seconds);
  const status = failedTasks > 0 || run.status === "error" ? "critical" : maxStatus(freshnessStatus, run.status === "running" ? "warn" : "good");
  const staleThresholdSeconds = freshnessStatus === "critical"
    ? snapshot.settings.maintenance_critical_seconds
    : snapshot.settings.maintenance_warn_seconds;
  const summary = failedTasks > 0
    ? `${failedTasks} maintenance task failed`
    : run.status === "error"
      ? "Latest scheduled maintenance failed"
      : freshnessStatus !== "good"
        ? `Last completed maintenance is older than ${formatDurationLabel(staleThresholdSeconds)}`
        : run.status === "running"
          ? "Scheduled maintenance is currently running"
          : `${run.task_count} tasks logged`;
  return {
    key: "maintenance",
    label: "Scheduled maintenance",
    status,
    summary,
    updated_at: run.finished_at ?? run.started_at,
    metrics: [
      { label: "Latest run", value: run.status, timestamp: run.started_at },
      { label: "Tasks", value: String(run.task_count) },
      { label: "Changed rows", value: String(run.changed_rows) },
    ],
  };
}

function personalStatsSubsystem(snapshot: DataHealthSnapshot): DataHealthSubsystem {
  const attention = snapshot.dailyStats;
  const affectedCount = attention.stale_personalstats + attention.missing_donator_days;
  const oldestCoverage = snapshot.personalStatsCoverage[0] ?? null;
  const oldestMissingCoverage = oldestCoverage ? Math.max(0, oldestCoverage.total_members - oldestCoverage.ready_members) : 0;
  const status = !oldestCoverage || oldestCoverage.total_members === 0
    ? "unknown"
    : statusForCount(
      oldestMissingCoverage,
      snapshot.settings.stale_daily_members_warn,
      snapshot.settings.stale_daily_members_critical,
    );
  const coverageMetrics = snapshot.personalStatsCoverage.map((coverage) => ({
    label: coverage.snapshot_date,
    value: `${coverage.ready_members}/${coverage.total_members}`,
  }));
  const outstandingMetric = {
    label: "Outstanding",
    value: String(affectedCount),
    title: "Number of members missing personal stats from before the recent days.",
  };
  return {
    key: "personal_stats",
    label: "Personal stats",
    status,
    summary: affectedCount > 0 ? `${affectedCount} reportable members need personal stat attention` : "Personal stats are up to date",
    updated_at: null,
    metrics: [
      ...coverageMetrics,
      outstandingMetric,
    ],
  };
}

function gymStatsSubsystem(snapshot: DataHealthSnapshot): DataHealthSubsystem {
  const gymStats = snapshot.gymStats;
  const totalStreams = GYM_CONTRIBUTOR_STAT_KEYS.length;
  const completedStreams = gymStats.completed_gym_stats.length;
  const missingStreams = gymStats.missing_gym_stats.length;
  const lagStatus = gymStats.gym_lag_days === null
    ? "unknown"
    : statusForCount(
      gymStats.gym_lag_days,
      snapshot.settings.daily_stats_lag_warn_days,
      snapshot.settings.daily_stats_lag_critical_days,
    );
  const streamStatus = gymStats.target_refresh_at === null
    ? "good"
    : missingStreams === 0
      ? "good"
      : missingStreams === totalStreams
        ? "critical"
        : "warn";
  const status = maxStatus(lagStatus, streamStatus);
  const summary = missingStreams > 0
    ? `${missingStreams} gym stat ${missingStreams === 1 ? "stream needs" : "streams need"} fetching`
    : gymStats.gym_lag_days !== null && gymStats.gym_lag_days > 0
      ? `Published gym stats are ${gymStats.gym_lag_days}d behind`
      : "Gym contributor stats are up to date";
  return {
    key: "gym_stats",
    label: "Gym stats",
    status,
    summary,
    updated_at: null,
    updated_label: publishedDateLabel(gymStats.latest_gym_snapshot_date),
    metrics: [
      {
        label: "Stat streams",
        value: `${completedStreams}/${totalStreams}`,
        title: `Completed gym stat streams: ${statStreamList(gymStats.completed_gym_stats)}.`,
      },
      {
        label: "Missing streams",
        value: String(missingStreams),
        title: `Missing gym stat streams: ${statStreamList(gymStats.missing_gym_stats)}.`,
      },
      { label: "Published date", value: gymStats.latest_gym_snapshot_date ?? "-" },
    ],
  };
}

function rosterSubsystem(snapshot: DataHealthSnapshot): DataHealthSubsystem {
  const roster = snapshot.roster;
  const totalMembers = roster.current_members;
  return {
    key: "roster",
    label: "Faction Members",
    status: roster.current_members > 0 ? "good" : "unknown",
    summary: roster.current_members > 0 ? `${roster.current_members} current faction members` : "No current members found",
    updated_at: roster.updated_at,
    metrics: [
      {
        label: "Profile coverage",
        value: `${roster.profile_members}/${totalMembers}`,
        title: "Current members with name, level, and position metadata.",
      },
      { label: "Stats", value: `${roster.stat_estimates}/${totalMembers}` },
      { label: "Networth", value: `${roster.networth_estimates}/${totalMembers}` },
    ],
  };
}

function apiSubsystem(snapshot: DataHealthSnapshot): DataHealthSubsystem {
  const usage = snapshot.apiUsage;
  const errorRate = usage.requests > 0 ? usage.errors / usage.requests * 100 : 0;
  const errorStatus = usage.requests === 0
    ? "unknown"
    : statusForPercent(
      errorRate,
      snapshot.settings.api_error_rate_warn_percent,
      snapshot.settings.api_error_rate_critical_percent,
    );
  const rateLimitStatus = statusForCount(
    usage.rate_limited,
    snapshot.settings.api_rate_limited_warn,
    snapshot.settings.api_rate_limited_critical,
  );
  const status = maxStatus(errorStatus, rateLimitStatus);
  return {
    key: "torn_api",
    label: "Torn API usage",
    status,
    summary: usage.requests > 0 ? `${usage.requests} calls in the last hour` : "No calls recorded in the last hour",
    updated_at: null,
    metrics: [
      { label: "Requests", value: String(usage.requests) },
      { label: "Errors", value: String(usage.errors) },
      { label: "429s", value: String(usage.rate_limited) },
    ],
  };
}

function keyHealthSubsystem(snapshot: DataHealthSnapshot): DataHealthSubsystem {
  const keys = snapshot.apiKeyHealth;
  const totalCallsPerMinute = keys.reduce((sum, key) => sum + Number(key.calls_per_minute ?? 0), 0);
  return {
    key: "key_health",
    label: "Key health",
    status: keys.length > 0 ? "good" : "unknown",
    summary: keys.length > 0
      ? `${keys.length} keys averaged ${formatRate(totalCallsPerMinute)} calls/min over 24h`
      : "No key calls recorded in the last 24h",
    updated_at: keys.reduce<number | null>((latest, key) => {
      const requestedAt = nullableNumber(key.last_requested_at);
      return requestedAt === null ? latest : Math.max(latest ?? 0, requestedAt);
    }, null),
    metrics: keys.length > 0
      ? keys.map((key) => ({
        label: formatKeySourceLabel(key.key_source),
        value: `${formatRate(Number(key.calls_per_minute ?? 0))}/min`,
        title: `${key.key_source}: ${Number(key.requests ?? 0)} calls in the last 24h`,
      }))
      : [{ label: "Calls/min", value: "0/min" }],
  };
}

function stockSubsystem(snapshot: DataHealthSnapshot): DataHealthSubsystem {
  const coverage = snapshot.stockCoverage;
  const stockAge = coverage.newest_snapshot_at === null ? null : snapshot.now - coverage.newest_snapshot_at;
  const freshnessStatus = statusForAgeSeconds(
    stockAge,
    snapshot.settings.stock_freshness_warn_seconds,
    snapshot.settings.stock_freshness_critical_seconds,
  );
  const staleStatus = statusForCount(
    coverage.stale_stocks,
    snapshot.settings.stale_stocks_warn,
    snapshot.settings.stale_stocks_critical,
  );
  const runStatus = snapshot.stockRun?.status === "error" ? "critical" : "good";
  const status = maxStatus(freshnessStatus, staleStatus, runStatus);
  return {
    key: "stock_data",
    label: "Stock data",
    status,
    summary: `${coverage.stocks_with_snapshots}/${coverage.total_stocks} stocks have snapshots`,
    updated_at: coverage.newest_snapshot_at,
    metrics: [
      { label: "Coverage", value: `${coverage.stocks_with_snapshots}/${coverage.total_stocks}` },
      { label: "Stale stocks", value: String(coverage.stale_stocks) },
      { label: "Latest snapshot", value: formatTimestampMetric(coverage.newest_snapshot_at), timestamp: coverage.newest_snapshot_at },
    ],
  };
}

function warReportsSubsystem(snapshot: DataHealthSnapshot): DataHealthSubsystem {
  const missing = snapshot.warReports.missing_reports;
  return {
    key: "war_reports",
    label: "War reports",
    status: missing > 0 ? "warn" : "good",
    summary: missing > 0 ? `${missing} ended wars are missing reports` : "Ended war reports are reconciled",
    updated_at: snapshot.warReports.oldest_missing_finished_at,
    metrics: [
      { label: "Missing reports", value: String(missing) },
      { label: "Oldest missing", value: formatTimestampMetric(snapshot.warReports.oldest_missing_finished_at), timestamp: snapshot.warReports.oldest_missing_finished_at },
    ],
  };
}

function issuesFromSnapshot(snapshot: DataHealthSnapshot, subsystems: DataHealthSubsystem[]): DataHealthIssue[] {
  return subsystems
    .filter((subsystem) => subsystem.status !== "good")
    .map((subsystem) => ({
      key: subsystem.key,
      subsystem: subsystem.label,
      status: subsystem.status as Exclude<DataHealthStatus, "good">,
      title: subsystem.summary,
      detail: issueDetailForSubsystem(snapshot, subsystem),
      action_view: actionForSubsystem(subsystem.key)?.view ?? null,
      action_label: actionForSubsystem(subsystem.key)?.label ?? null,
    }))
    .sort((left, right) => STATUS_RANK[right.status] - STATUS_RANK[left.status]);
}

function issueDetailForSubsystem(snapshot: DataHealthSnapshot, subsystem: DataHealthSubsystem): string {
  if (subsystem.key === "ingestion") {
    if (snapshot.ingestion?.error) return snapshot.ingestion.error;
    const completedAt = snapshot.ingestion?.finished_at ?? snapshot.ingestion?.started_at ?? null;
    return [
      `Last poll: ${formatTimestampLabel(completedAt)}`,
      `warning target: ${formatDurationLabel(snapshot.settings.ingestion_warn_seconds)}`,
      `critical target: ${formatDurationLabel(snapshot.settings.ingestion_critical_seconds)}`,
      `last run returned: ${snapshot.ingestion?.fetched_attacks ?? 0}`,
      `newest stored attack: ${formatTimestampLabel(snapshot.latestAttackStarted)}`,
    ].join("; ");
  }
  if (subsystem.key === "maintenance" && snapshot.maintenance?.error) return snapshot.maintenance.error;
  if (subsystem.key === "stock_data" && snapshot.stockRun?.error) return snapshot.stockRun.error;
  if (subsystem.key === "personal_stats") {
    const coverage = snapshot.personalStatsCoverage[0] ?? null;
    if (!coverage) return "No recent personal stat coverage is available";

    const missingMembers = snapshot.personalStatsCoverageGaps
      .filter((gap) => gap.snapshot_date === coverage.snapshot_date)
      .map(formatPersonalStatsGapMember);
    if (missingMembers.length === 0) {
      return `${coverage.snapshot_date}: missing personal stats member identity unavailable`;
    }

    return `${coverage.snapshot_date}: ${missingMembers.join(", ")}`;
  }
  if (subsystem.key === "gym_stats") {
    return [
      `${snapshot.gymStats.missing_gym_stats.length} missing gym stat streams`,
      `missing: ${statStreamList(snapshot.gymStats.missing_gym_stats)}`,
      `members impacted in published snapshot: ${snapshot.gymStats.stale_gym_members}`,
      `latest published date: ${snapshot.gymStats.latest_gym_snapshot_date ?? "-"}`,
    ].join("; ");
  }
  return subsystem.metrics.map((metric) => `${metric.label}: ${metric.value}`).join("; ");
}

function actionForSubsystem(key: string): { view: string; label: string } | null {
  if (key === "stock_data") return { view: "stockMarketStatus", label: "Open stock market" };
  if (key === "personal_stats" || key === "gym_stats" || key === "roster") return { view: "lifestyle", label: "Open member stats" };
  if (key === "war_reports") return { view: "admin", label: "Open admin controls" };
  return { view: "admin", label: "Open admin controls" };
}

function sanitizeSubsystems(subsystems: DataHealthSubsystem[]): DataHealthSubsystem[] {
  return subsystems.map((subsystem) => ({
    ...subsystem,
    metrics: subsystem.metrics.slice(0, 3),
  }));
}

function memberVisibleSubsystems(subsystems: DataHealthSubsystem[]): DataHealthSubsystem[] {
  return subsystems.filter((subsystem) => !ADMIN_ONLY_SUBSYSTEM_KEYS.has(subsystem.key));
}

function unknownSubsystem(key: string, label: string, summary: string): DataHealthSubsystem {
  return {
    key,
    label,
    status: "unknown",
    summary,
    updated_at: null,
    metrics: [],
  };
}

function overallStatus(subsystems: DataHealthSubsystem[]): DataHealthStatus {
  if (subsystems.length === 0) return "unknown";
  return maxStatus(...subsystems.map((subsystem) => subsystem.status));
}

function maxStatus(...statuses: DataHealthStatus[]): DataHealthStatus {
  return statuses.reduce((highest, status) =>
    STATUS_RANK[status] > STATUS_RANK[highest] ? status : highest,
  "good" as DataHealthStatus);
}

function nullableNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatRate(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : "0.00";
}

function formatKeySourceLabel(keySource: string): string {
  switch (keySource) {
    case "env:TORN_API_KEY":
      return "Primary key";
    case "secrets:TORN_API_KEY_POOL_1":
      return "Pool key 1";
    case "secrets:TORN_API_KEY_POOL_2":
      return "Pool key 2";
    case "member_supplied:auth":
      return "Member auth key";
    case "member_supplied:trade_scout":
      return "Trade Scout member key";
    default:
      return keySource;
  }
}

function publishedDateLabel(snapshotDate: string | null): string | null {
  return snapshotDate ? `Published ${snapshotDate}` : null;
}

function statStreamList(stats: readonly GymContributorStatKey[]): string {
  return stats.length > 0 ? stats.map(formatGymStatName).join(", ") : "none";
}

function formatPersonalStatsGapMember(member: {
  member_id: number;
  member_name: string | null;
}): string {
  return `${member.member_name ?? "Unknown member"} #${member.member_id}`;
}

function formatGymStatName(stat: GymContributorStatKey): string {
  if (stat === "gymenergy") return "energy";
  if (stat === "gymstrength") return "strength";
  if (stat === "gymspeed") return "speed";
  if (stat === "gymdefense") return "defense";
  return "dexterity";
}

function formatTimestampMetric(timestamp: number | null): string {
  return timestamp === null ? "-" : String(timestamp);
}

function formatTimestampLabel(timestamp: number | null): string {
  if (timestamp === null) return "-";
  return new Date(timestamp * 1000).toISOString().replace("T", " ").replace(".000Z", " UTC");
}

function formatDurationLabel(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds >= 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 60)}m`;
}
