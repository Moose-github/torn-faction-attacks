import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_DATA_HEALTH_SETTINGS,
  getAdminDataHealth,
  statusForAgeSeconds,
  statusForCount,
  statusForPercent,
  updateDataHealthSettingsFromRequest,
} from "./dataHealth";
import { getDailyStatsAttention } from "./lifestyleStats";
import type { Env } from "./types";

vi.mock("./lifestyleStats", () => ({
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
      personalCoverage: [
        { snapshot_date: "2025-12-30", ready_members: 55, total_members: 60 },
        { snapshot_date: "2025-12-31", ready_members: 60, total_members: 60 },
      ],
    }));
    const body = await response.json() as {
      subsystems: Array<{ key: string; summary: string; updated_label?: string | null; metrics: Array<{ label: string; value: string }> }>;
      details: { gym_stats_health: { latest_gym_snapshot_date: string | null; stale_gym_members: number } };
    };

    expect(body.subsystems.some((subsystem) => subsystem.key === "daily_stats")).toBe(false);
    expect(body.subsystems.find((subsystem) => subsystem.key === "personal_stats")).toMatchObject({
      summary: "1 reportable members need personal stat attention",
      updated_label: "Latest snapshot 2025-12-31",
      metrics: [
        { label: "2025-12-30", value: "55/60" },
        { label: "2025-12-31", value: "60/60" },
        { label: "Stale", value: "1" },
      ],
    });
    expect(body.subsystems.find((subsystem) => subsystem.key === "gym_stats")).toMatchObject({
      summary: "3 reportable members need gym snapshots",
      updated_label: "Latest snapshot 2026-01-01",
      metrics: [
        { label: "Lag days", value: "0" },
        { label: "Stale members", value: "3" },
        { label: "Latest snapshot", value: "2026-01-01" },
      ],
    });
    expect(body.details.gym_stats_health).toMatchObject({
      latest_gym_snapshot_date: "2026-01-01",
      stale_gym_members: 3,
    });

    const rosterMetricLabels = body.subsystems
      .find((subsystem) => subsystem.key === "roster")
      ?.metrics.map((metric) => metric.label);
    expect(rosterMetricLabels).toEqual(["Current", "Stat estimates", "Networth estimates"]);
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
  maintenanceRun = successfulMaintenanceRun(),
  gymLatestDate = "2025-12-31",
  staleGymMembers = 0,
  personalCoverage = [
    { snapshot_date: "2025-12-30", ready_members: 1, total_members: 1 },
    { snapshot_date: "2025-12-31", ready_members: 1, total_members: 1 },
  ],
}: {
  maintenanceRun?: Record<string, unknown>;
  gymLatestDate?: string;
  staleGymMembers?: number;
  personalCoverage?: Array<{ snapshot_date: string; ready_members: number; total_members: number }>;
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
            gymLatestDate,
            staleGymMembers,
          }),
          all: async () => ({ results: rowsForDataHealthQuery(compactSql, { personalCoverage }) }),
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
  gymStats: { gymLatestDate: string; staleGymMembers: number },
): Record<string, unknown> | null {
  if (sql.includes("FROM data_health_settings")) return DEFAULT_DATA_HEALTH_SETTINGS;
  if (sql.includes("FROM ingestion_runs")) {
    return {
      id: "ingestion-run-1",
      trigger_source: "cron",
      started_at: Math.floor(Date.now() / 1000) - 60,
      ranked_war_checked_at: null,
      attacks_fetch_finished_at: null,
      d1_writes_finished_at: null,
      stats_finished_at: null,
      report_finished_at: null,
      finished_at: Math.floor(Date.now() / 1000) - 30,
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
  if (sql.includes("FROM attacks")) return { latest_attack_started: null };
  if (sql.includes("FROM scheduled_maintenance_runs")) return maintenanceRun;
  if (sql.includes("FROM member_lifestyle_stat_snapshots snapshots") && sql.includes("snapshots.gym_ready = 1")) {
    return { snapshot_date: gymStats.gymLatestDate };
  }
  if (sql.includes("stale_gym_members")) {
    return { stale_gym_members: gymStats.staleGymMembers };
  }
  if (sql.includes("FROM home_faction_members")) {
    return {
      current_members: 1,
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

function rowsForDataHealthQuery(
  sql: string,
  options: { personalCoverage: Array<{ snapshot_date: string; ready_members: number; total_members: number }> },
): Array<Record<string, unknown>> {
  if (sql.includes("FROM scheduled_maintenance_tasks")) return [];
  if (sql.includes("WITH target_dates")) return options.personalCoverage;
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
