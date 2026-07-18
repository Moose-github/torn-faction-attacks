import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_DATA_HEALTH_SETTINGS,
  getAdminDataHealth,
  getDataHealthSummary,
  statusForAgeSeconds,
  statusForCount,
  statusForPercent,
  updateDataHealthSettingsFromRequest,
} from "./dataHealth";
import { getDailyStatsAttention } from "./lifestyleStats/dailyAttention";
import type { Env } from "./types";

vi.mock("./lifestyleStats/dailyAttention", () => ({
  getDailyStatsAttention: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("data health severity", () => {
  it("uses balanced age defaults for warn and critical states", () => {
    expect(statusForAgeSeconds(
      DEFAULT_DATA_HEALTH_SETTINGS.ingestion_warn_seconds - 1,
      DEFAULT_DATA_HEALTH_SETTINGS.ingestion_warn_seconds,
      DEFAULT_DATA_HEALTH_SETTINGS.ingestion_critical_seconds,
    )).toBe("good");
    expect(statusForAgeSeconds(
      DEFAULT_DATA_HEALTH_SETTINGS.ingestion_warn_seconds,
      DEFAULT_DATA_HEALTH_SETTINGS.ingestion_warn_seconds,
      DEFAULT_DATA_HEALTH_SETTINGS.ingestion_critical_seconds,
    )).toBe("warn");
    expect(statusForAgeSeconds(
      DEFAULT_DATA_HEALTH_SETTINGS.ingestion_critical_seconds,
      DEFAULT_DATA_HEALTH_SETTINGS.ingestion_warn_seconds,
      DEFAULT_DATA_HEALTH_SETTINGS.ingestion_critical_seconds,
    )).toBe("critical");
  });

  it("supports custom count thresholds", () => {
    expect(statusForCount(1, 2, 4)).toBe("good");
    expect(statusForCount(2, 2, 4)).toBe("warn");
    expect(statusForCount(4, 2, 4)).toBe("critical");
  });

  it("supports custom percentage thresholds", () => {
    expect(statusForPercent(4.9, 5, 15)).toBe("good");
    expect(statusForPercent(5, 5, 15)).toBe("warn");
    expect(statusForPercent(15, 5, 15)).toBe("critical");
  });

  it("rejects invalid threshold ordering", async () => {
    const save = vi.fn();
    const env = settingsEnv(DEFAULT_DATA_HEALTH_SETTINGS, save);
    const response = await updateDataHealthSettingsFromRequest(
      jsonRequest({ ingestion_warn_seconds: 200, ingestion_critical_seconds: 100 }),
      env,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      ok: false,
      code: "INVALID_DATA_HEALTH_SETTINGS",
    });
    expect(save).not.toHaveBeenCalled();
  });

  it("describes stale maintenance issues with the freshness reason", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const now = Math.floor(Date.now() / 1000);
    vi.mocked(getDailyStatsAttention).mockResolvedValue({
      stale_personalstats: 0,
      missing_donator_days: 0,
      personalstats_target_date: "2025-12-31",
      latest_personalstats_bucket_date: "2025-12-31",
      personalstats_lag_days: 0,
      affected_members: [],
    });

    const response = await getAdminDataHealth(dataHealthEnv({
      maintenanceRun: {
        id: "maintenance-run-1",
        started_at: now - 3700,
        finished_at: now - 3600,
        status: "success",
        task_count: 3,
        write_statements: 2,
        changed_rows: 4,
        error: null,
      },
    }));
    const body = await response.json() as {
      subsystems: Array<{ key: string; status: string; summary: string }>;
      issues: Array<{ key: string; title: string }>;
    };

    const maintenance = body.subsystems.find((subsystem) => subsystem.key === "maintenance");
    expect(maintenance).toMatchObject({
      status: "warn",
      summary: "Last completed maintenance is older than 45m",
    });
    expect(body.issues.find((issue) => issue.key === "maintenance")?.title)
      .toBe("Last completed maintenance is older than 45m");
  });

  it("treats attack ingestion older than the one-minute polling window as stale", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const now = Math.floor(Date.now() / 1000);
    vi.mocked(getDailyStatsAttention).mockResolvedValue({
      stale_personalstats: 0,
      missing_donator_days: 0,
      personalstats_target_date: "2025-12-31",
      latest_personalstats_bucket_date: "2025-12-31",
      personalstats_lag_days: 0,
      affected_members: [],
    });

    const response = await getAdminDataHealth(dataHealthEnv({
      ingestionRun: {
        ...successfulIngestionRun(now),
        started_at: now - 200,
        finished_at: now - 180,
        fetched_attacks: 1,
      },
      latestAttackStarted: now - 540,
    }));
    const body = await response.json() as {
      subsystems: Array<{ key: string; status: string; summary: string; metrics: Array<{ label: string; value: string }> }>;
      issues: Array<{ key: string; title: string; detail: string }>;
    };

    const ingestion = body.subsystems.find((subsystem) => subsystem.key === "ingestion");
    expect(ingestion).toMatchObject({
      status: "warn",
      summary: "Last attack poll is older than 2m",
      metrics: [
        { label: "Last poll", value: String(now - 180) },
        { label: "Last run returned", value: "1" },
        { label: "Newest stored attack", value: String(now - 540) },
      ],
    });
    expect(body.issues.find((issue) => issue.key === "ingestion")).toMatchObject({
      title: "Last attack poll is older than 2m",
      detail: expect.stringContaining("last run returned: 1"),
    });
  });

  it("describes a fresh attack ingestion run without using returned attacks as the headline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const now = Math.floor(Date.now() / 1000);
    vi.mocked(getDailyStatsAttention).mockResolvedValue({
      stale_personalstats: 0,
      missing_donator_days: 0,
      personalstats_target_date: "2025-12-31",
      latest_personalstats_bucket_date: "2025-12-31",
      personalstats_lag_days: 0,
      affected_members: [],
    });

    const response = await getAdminDataHealth(dataHealthEnv({
      ingestionRun: {
        ...successfulIngestionRun(now),
        finished_at: now - 45,
        fetched_attacks: 3,
      },
      latestAttackStarted: now - 600,
    }));
    const body = await response.json() as {
      subsystems: Array<{ key: string; status: string; summary: string; metrics: Array<{ label: string; value: string; title?: string | null }> }>;
    };

    const ingestion = body.subsystems.find((subsystem) => subsystem.key === "ingestion");
    expect(ingestion).toMatchObject({
      status: "good",
      summary: "Attack polling is on schedule",
      metrics: [
        { label: "Last poll", value: String(now - 45) },
        { label: "Last run returned", value: "3" },
        { label: "Newest stored attack", value: String(now - 600) },
      ],
    });
    expect(ingestion?.metrics[1].title).toContain("latest poll window");
  });

  it("hides admin-only subsystems from the member summary", async () => {
    vi.mocked(getDailyStatsAttention).mockResolvedValue({
      stale_personalstats: 0,
      missing_donator_days: 0,
      personalstats_target_date: "2025-12-31",
      latest_personalstats_bucket_date: "2025-12-31",
      personalstats_lag_days: 0,
      affected_members: [],
    });

    const response = await getDataHealthSummary(dataHealthEnv({
      maintenanceRun: {
        id: "maintenance-run-failed",
        started_at: Math.floor(Date.now() / 1000) - 60,
        finished_at: Math.floor(Date.now() / 1000) - 30,
        status: "error",
        task_count: 3,
        write_statements: 2,
        changed_rows: 4,
        error: "maintenance failed",
      },
    }));
    const body = await response.json() as {
      overall_status: string;
      subsystems: Array<{ key: string }>;
    };

    expect(body.subsystems.map((subsystem) => subsystem.key)).not.toContain("maintenance");
    expect(body.subsystems.map((subsystem) => subsystem.key)).not.toContain("war_reports");
    expect(body.overall_status).toBe("good");
  });

  it("defaults admin API usage to one hour and skips breakdown queries until requested", async () => {
    vi.mocked(getDailyStatsAttention).mockResolvedValue({
      stale_personalstats: 0,
      missing_donator_days: 0,
      personalstats_target_date: "2025-12-31",
      latest_personalstats_bucket_date: "2025-12-31",
      personalstats_lag_days: 0,
      affected_members: [],
    });
    const breakdownQueries: string[] = [];
    const env = dataHealthEnv({
      onApiBreakdownQuery: (sql) => breakdownQueries.push(sql),
      apiRollupSummary: {
        requests: 10,
        errors: 0,
        rate_limited: 0,
        avg_duration_ms: 100,
        max_duration_ms: 100,
      },
      apiFeatureRows: [
        {
          feature: "personal_stats",
          requests: 10,
          errors: 0,
          rate_limited: 0,
          avg_duration_ms: 100,
          last_requested_at: 1_767_139_200,
        },
      ],
    });

    const defaultResponse = await getAdminDataHealth(env);
    const defaultBody = await defaultResponse.json() as {
      details: {
        api_usage_window_seconds: number;
        api_features: unknown[];
      };
    };

    expect(defaultBody.details.api_usage_window_seconds).toBe(60 * 60);
    expect(defaultBody.details.api_features).toEqual([]);
    expect(breakdownQueries).toEqual([]);

    const breakdownResponse = await getAdminDataHealth(
      new URL("https://worker.test/api/admin/data-health?include_breakdown=1"),
      env,
    );
    const breakdownBody = await breakdownResponse.json() as {
      details: {
        api_usage_window_seconds: number;
        api_features: Array<{ feature: string; requests: number }>;
      };
    };

    expect(breakdownBody.details.api_usage_window_seconds).toBe(60 * 60);
    expect(breakdownBody.details.api_features).toEqual([
      expect.objectContaining({ feature: "personal_stats", requests: 10 }),
    ]);
    expect(breakdownQueries.some((sql) => sql.includes("FROM torn_api_usage_rollup_15m"))).toBe(true);
    expect(breakdownQueries.some((sql) => sql.includes("FROM torn_api_call_log"))).toBe(false);
  });

  it("hides transient member auth keys from key health", async () => {
    vi.mocked(getDailyStatsAttention).mockResolvedValue({
      stale_personalstats: 0,
      missing_donator_days: 0,
      personalstats_target_date: "2025-12-31",
      latest_personalstats_bucket_date: "2025-12-31",
      personalstats_lag_days: 0,
      affected_members: [],
    });

    const response = await getAdminDataHealth(dataHealthEnv({
      apiKeyRows: [
        {
          key_source: "member_supplied:auth",
          requests: 1,
          errors: 0,
          rate_limited: 0,
          avg_duration_ms: 100,
          last_requested_at: 1_767_139_200,
        },
        {
          key_source: "env:TORN_API_KEY",
          requests: 1,
          errors: 0,
          rate_limited: 0,
          avg_duration_ms: 100,
          last_requested_at: 1_767_139_200,
        },
        {
          key_source: "key_pool:11f3d22e-c241-4ecb-8159-4edeb36d68a1",
          key_label: "Dara faction stat key",
          requests: 1,
          errors: 0,
          rate_limited: 0,
          avg_duration_ms: 100,
          last_requested_at: 1_767_139_200,
        },
      ],
    }));
    const body = await response.json() as {
      key_pool: {
        active_saved_keys: number;
        pool_requests: number;
        fallback_requests: number;
        total_requests: number;
        pool_share_percent: number | null;
        keys: Array<{ key_source: string; key_label?: string | null; requests: number; calls_per_minute: number }>;
      };
      subsystems: Array<{ key: string; metrics: Array<{ label: string; value: string }> }>;
      details: {
        api_key_health: Array<{ key_source: string; requests: number; calls_per_minute: number }>;
      };
    };

    expect(body.key_pool).toMatchObject({
      active_saved_keys: 2,
      pool_requests: 1,
      fallback_requests: 1,
      total_requests: 2,
      pool_share_percent: 50,
    });
    expect(body.key_pool.keys).toContainEqual(
      expect.objectContaining({
        key_source: "key_pool:11f3d22e-c241-4ecb-8159-4edeb36d68a1",
        key_label: "Dara faction stat key",
      }),
    );
    expect(body.details.api_key_health.map((key) => key.key_source)).toEqual([
      "env:TORN_API_KEY",
      "key_pool:11f3d22e-c241-4ecb-8159-4edeb36d68a1",
    ]);
    expect(body.subsystems.find((subsystem) => subsystem.key === "key_health")?.metrics).toContainEqual(
      expect.objectContaining({
        label: "Admin fallback key",
        value: "<0.01/min",
      }),
    );
    const fallbackKey = body.details.api_key_health.find((key) => key.key_source === "env:TORN_API_KEY");
    expect(fallbackKey).toMatchObject({ requests: 1 });
    expect(fallbackKey?.calls_per_minute).toBeCloseTo(1 / 1_440, 6);
    expect(body.subsystems.find((subsystem) => subsystem.key === "key_health")?.metrics).toContainEqual(
      expect.objectContaining({
        label: "Dara faction stat key",
        value: "<0.01/min",
      }),
    );
  });

  it("splits daily member stats into personal and gym subsystem tiles", async () => {
    vi.mocked(getDailyStatsAttention).mockResolvedValue({
      stale_personalstats: 1,
      missing_donator_days: 0,
      personalstats_target_date: "2025-12-31",
      latest_personalstats_bucket_date: "2025-12-31",
      personalstats_lag_days: 1,
      affected_members: [],
    });

    const response = await getAdminDataHealth(dataHealthEnv({
      gymLatestDate: "2026-01-01",
      staleGymMembers: 3,
      completedGymStats: ["gymenergy", "gymstrength", "gymspeed"],
      personalCoverage: [
        { snapshot_date: "2025-12-30", ready_members: 55, total_members: 60 },
        { snapshot_date: "2025-12-31", ready_members: 60, total_members: 60 },
      ],
    }));
    const body = await response.json() as {
      subsystems: Array<{ key: string; status: string; summary: string; updated_label?: string | null; metrics: Array<{ label: string; value: string }> }>;
      details: {
        gym_stats_health: {
          latest_gym_snapshot_date: string | null;
          completed_gym_stats: string[];
          missing_gym_stats: string[];
          stale_gym_members: number;
        };
      };
    };

    expect(body.subsystems.some((subsystem) => subsystem.key === "daily_stats")).toBe(false);
    expect(body.subsystems.find((subsystem) => subsystem.key === "personal_stats")).toMatchObject({
      status: "critical",
      summary: "1 reportable members need personal stat attention",
      metrics: [
        { label: "2025-12-30", value: "55/60" },
        { label: "2025-12-31", value: "60/60" },
        { label: "Outstanding", value: "1" },
      ],
    });
    expect(body.subsystems.find((subsystem) => subsystem.key === "personal_stats"))
      .not.toHaveProperty("updated_label");
    expect(body.subsystems.find((subsystem) => subsystem.key === "gym_stats")).toMatchObject({
      summary: "2 gym stat streams need fetching",
      updated_label: "Published 2026-01-01",
      metrics: [
        { label: "Stat streams", value: "3/5" },
        { label: "Missing streams", value: "2" },
        { label: "Published date", value: "2026-01-01" },
      ],
    });
    expect(body.details.gym_stats_health).toMatchObject({
      latest_gym_snapshot_date: "2026-01-01",
      completed_gym_stats: ["gymenergy", "gymstrength", "gymspeed"],
      missing_gym_stats: ["gymdefense", "gymdexterity"],
      stale_gym_members: 3,
    });

    expect(body.subsystems.slice(0, 2).map((subsystem) => subsystem.key)).toEqual(["ingestion", "roster"]);
    expect(body.subsystems.find((subsystem) => subsystem.key === "roster")).toMatchObject({
      label: "Faction Members",
      metrics: [
        { label: "Profile coverage", value: "1/1" },
        { label: "Stats", value: "1/1" },
        { label: "Networth", value: "1/1" },
      ],
    });
  });

  it("names members missing from personal stats coverage in admin issues", async () => {
    vi.mocked(getDailyStatsAttention).mockResolvedValue({
      stale_personalstats: 0,
      missing_donator_days: 0,
      personalstats_target_date: "2026-06-08",
      latest_personalstats_bucket_date: "2026-06-08",
      personalstats_lag_days: 0,
      affected_members: [],
    });

    const response = await getAdminDataHealth(dataHealthEnv({
      personalCoverage: [
        { snapshot_date: "2026-06-07", ready_members: 59, total_members: 60 },
        { snapshot_date: "2026-06-08", ready_members: 60, total_members: 60 },
      ],
      personalCoverageGaps: [
        {
          snapshot_date: "2026-06-07",
          member_id: 123456,
          member_name: "Missing Member",
          latest_personal_ready_date: "2026-06-06",
          recent_snapshot_date: "2026-06-08",
          recent_status: "completed",
          recent_error: null,
          recent_updated_at: 1_781_000_000,
        },
        {
          snapshot_date: "2026-06-08",
          member_id: 234567,
          member_name: "Expected Pending Member",
          latest_personal_ready_date: "2026-06-07",
          recent_snapshot_date: "2026-06-08",
          recent_status: "pending",
          recent_error: null,
          recent_updated_at: 1_781_000_100,
        },
      ],
    }));
    const body = await response.json() as {
      issues: Array<{ key: string; detail: string }>;
      details: {
        personal_stats_coverage_gaps: Array<{
          snapshot_date: string;
          member_id: number;
          member_name: string | null;
        }>;
      };
    };

    expect(body.issues.find((issue) => issue.key === "personal_stats")?.detail)
      .toBe("2026-06-07: Missing Member #123456");
    expect(body.issues.find((issue) => issue.key === "personal_stats")?.detail)
      .not.toContain("Expected Pending Member");
    expect(body.details.personal_stats_coverage_gaps).toEqual([
      expect.objectContaining({
        snapshot_date: "2026-06-07",
        member_id: 123456,
        member_name: "Missing Member",
      }),
      expect.objectContaining({
        snapshot_date: "2026-06-08",
        member_id: 234567,
        member_name: "Expected Pending Member",
      }),
    ]);
  });

  it("bases personal stats severity on the oldest recent date only", async () => {
    vi.mocked(getDailyStatsAttention).mockResolvedValue({
      stale_personalstats: 0,
      missing_donator_days: 0,
      personalstats_target_date: "2025-12-31",
      latest_personalstats_bucket_date: "2025-12-31",
      personalstats_lag_days: 0,
      affected_members: [],
    });

    const response = await getAdminDataHealth(dataHealthEnv({
      personalCoverage: [
        { snapshot_date: "2025-12-30", ready_members: 60, total_members: 60 },
        { snapshot_date: "2025-12-31", ready_members: 55, total_members: 60 },
      ],
    }));
    const body = await response.json() as {
      subsystems: Array<{ key: string; status: string; metrics: Array<{ label: string; value: string }> }>;
    };

    expect(body.subsystems.find((subsystem) => subsystem.key === "personal_stats")).toMatchObject({
      status: "good",
      metrics: [
        { label: "2025-12-30", value: "60/60" },
        { label: "2025-12-31", value: "55/60" },
        { label: "Outstanding", value: "0" },
      ],
    });
  });
});

function settingsEnv(settings: Record<string, unknown>, save: () => void): Env {
  return {
    DB: {
      prepare(sql: string) {
        return {
          bind() {
            return {
              first: async () => sql.includes("SELECT *") ? settings : null,
              run: async () => {
                save();
                return { success: true };
              },
            };
          },
        };
      },
    },
  } as unknown as Env;
}

function dataHealthEnv({
  settings = DEFAULT_DATA_HEALTH_SETTINGS,
  ingestionRun,
  latestAttackStarted = null,
  maintenanceRun = successfulMaintenanceRun(),
  gymLatestDate = "2025-12-31",
  completedGymStats = ["gymenergy", "gymstrength", "gymspeed", "gymdefense", "gymdexterity"],
  staleGymMembers = 0,
  personalCoverage = [
    { snapshot_date: "2025-12-30", ready_members: 1, total_members: 1 },
    { snapshot_date: "2025-12-31", ready_members: 1, total_members: 1 },
  ],
  personalCoverageGaps = [],
  apiRollupSummary = {
    requests: 1,
    errors: 0,
    rate_limited: 0,
    avg_duration_ms: 100,
    max_duration_ms: 100,
  },
  apiFeatureRows = [],
  apiKeyRows = [],
  keyPoolCounts,
  onApiBreakdownQuery,
}: {
  settings?: Record<string, unknown>;
  ingestionRun?: Record<string, unknown>;
  latestAttackStarted?: number | null;
  maintenanceRun?: Record<string, unknown>;
  gymLatestDate?: string;
  completedGymStats?: string[];
  staleGymMembers?: number;
  personalCoverage?: Array<{ snapshot_date: string; ready_members: number; total_members: number }>;
  personalCoverageGaps?: Array<Record<string, unknown>>;
  apiRollupSummary?: Record<string, unknown>;
  apiFeatureRows?: Array<Record<string, unknown>>;
  apiKeyRows?: Array<Record<string, unknown>>;
  keyPoolCounts?: Record<string, unknown>;
  onApiBreakdownQuery?: (sql: string) => void;
}): Env {
  return {
    DB: {
      prepare(sql: string) {
        const compactSql = sql.replace(/\s+/g, " ").trim();
        const statement = {
          bind() {
            return statement;
          },
          first: async () => firstRowForDataHealthQuery(compactSql, maintenanceRun, {
            settings,
            ingestionRun,
            latestAttackStarted,
            gymLatestDate,
            staleGymMembers,
            apiRollupSummary,
            keyPoolCounts,
          }),
          all: async () => {
            if (
              compactSql.includes("FROM torn_api_usage_rollup_15m") &&
              compactSql.includes("GROUP BY group_value") &&
              !compactSql.includes("group_type = 'key_source'")
            ) {
              onApiBreakdownQuery?.(compactSql);
            }
            return {
              results: rowsForDataHealthQuery(compactSql, {
                completedGymStats,
                personalCoverage,
                personalCoverageGaps,
                apiFeatureRows,
                apiKeyRows,
              }),
            };
          },
          run: async () => ({ success: true }),
        };
        return statement;
      },
    },
  } as unknown as Env;
}

function firstRowForDataHealthQuery(
  sql: string,
  maintenanceRun: Record<string, unknown>,
  options: {
    settings: Record<string, unknown>;
    ingestionRun?: Record<string, unknown>;
    latestAttackStarted: number | null;
    gymLatestDate: string;
    staleGymMembers: number;
    apiRollupSummary: Record<string, unknown>;
    keyPoolCounts?: Record<string, unknown>;
  },
): Record<string, unknown> | null {
  if (sql.includes("FROM data_health_settings")) return options.settings;
  if (sql.includes("FROM ingestion_runs")) {
    return options.ingestionRun ?? successfulIngestionRun(Math.floor(Date.now() / 1000));
  }
  if (sql.includes("FROM attacks")) return { latest_attack_started: options.latestAttackStarted };
  if (sql.includes("FROM scheduled_maintenance_runs")) return maintenanceRun;
  if (sql.includes("FROM member_lifestyle_stat_snapshots snapshots") && sql.includes("snapshots.gym_ready = 1")) {
    return { snapshot_date: options.gymLatestDate };
  }
  if (sql.includes("stale_gym_members")) {
    return { stale_gym_members: options.staleGymMembers };
  }
  if (sql.includes("FROM home_faction_members")) {
    return {
      current_members: 1,
      profile_members: 1,
      reportable_members: 1,
      report_exempt_members: 0,
      revivable_members: 1,
      stat_estimates: 1,
      networth_estimates: 1,
      updated_at: Math.floor(Date.now() / 1000),
    };
  }
  if (sql.includes("FROM torn_api_call_log") && sql.includes("COUNT(*) AS requests")) {
    return {
      requests: 1,
      errors: 0,
      rate_limited: 0,
      avg_duration_ms: 100,
      max_duration_ms: 100,
    };
  }
  if (sql.includes("FROM torn_api_usage_rollup_15m") && sql.includes("SUM(requests) AS requests")) {
    return options.apiRollupSummary;
  }
  if (sql.includes("FROM torn_api_keys")) {
    return options.keyPoolCounts ?? { saved_keys: 2, active_saved_keys: 2 };
  }
  if (sql.includes("FROM stock_ingestion_runs")) return null;
  if (sql.includes("FROM latest")) {
    return {
      total_stocks: 1,
      stocks_with_snapshots: 1,
      oldest_snapshot_at: Math.floor(Date.now() / 1000),
      newest_snapshot_at: Math.floor(Date.now() / 1000),
      stale_stocks: 0,
    };
  }
  if (sql.includes("FROM wars")) {
    return {
      missing_reports: 0,
      oldest_missing_finished_at: null,
    };
  }
  return null;
}

function successfulMaintenanceRun(): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: "maintenance-run-healthy",
    started_at: now - 60,
    finished_at: now - 30,
    status: "success",
    task_count: 3,
    write_statements: 2,
    changed_rows: 4,
    error: null,
  };
}

function successfulIngestionRun(now: number): Record<string, unknown> {
  return {
    id: "ingestion-run-1",
    trigger_source: "cron",
    started_at: now - 60,
    ranked_war_checked_at: null,
    attacks_fetch_finished_at: null,
    d1_writes_finished_at: null,
    stats_finished_at: null,
    report_finished_at: null,
    heatmap_finished_at: null,
    finished_at: now - 30,
    latest_attack_started: null,
    fetched_pages: 0,
    fetched_attacks: 0,
    wrote_batches: 0,
    saw_rows: 0,
    active_war_id: null,
    status: "success",
    error: null,
  };
}

function rowsForDataHealthQuery(
  sql: string,
  options: {
    completedGymStats: string[];
    personalCoverage: Array<{ snapshot_date: string; ready_members: number; total_members: number }>;
    personalCoverageGaps: Array<Record<string, unknown>>;
    apiFeatureRows: Array<Record<string, unknown>>;
    apiKeyRows: Array<Record<string, unknown>>;
  },
): Array<Record<string, unknown>> {
  if (sql.includes("FROM scheduled_maintenance_tasks")) return [];
  if (sql.includes("FROM sync_state")) {
    return options.completedGymStats.map((stat) => ({
      name: `member_gym_stats_current_daily_${stat}`,
      last_started: Math.floor(Date.now() / 1000),
    }));
  }
  if (sql.includes("reportable_members")) return options.personalCoverageGaps;
  if (sql.includes("WITH target_dates")) return options.personalCoverage;
  if (sql.includes("FROM torn_api_usage_rollup_15m") && sql.includes("GROUP BY group_value")) {
    if (sql.includes("group_type = 'key_source'")) {
      return sql.includes("group_value <> 'member_supplied:auth'")
        ? options.apiKeyRows.filter((row) => row.key_source !== "member_supplied:auth")
        : options.apiKeyRows;
    }
    return options.apiFeatureRows;
  }
  if (sql.includes("GROUP BY")) return [];
  if (sql.includes("FROM torn_api_call_log")) return [];
  return [];
}

function jsonRequest(body: unknown): Request {
  return new Request("https://worker.test/api/admin/data-health/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
