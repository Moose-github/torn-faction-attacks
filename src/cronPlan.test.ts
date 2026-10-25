import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./enemyScoutingCron", () => ({
  runEnemyScoutingCronTick: vi.fn(),
}));
vi.mock("./armory", () => ({ runArmoryCron: vi.fn(), runMedicalStockAlertsCron: vi.fn() }));
vi.mock("./ingestion", () => ({
  runIngestion: vi.fn(),
}));
vi.mock("./chainWatch", () => ({
  runChainWatchCron: vi.fn(),
}));
vi.mock("./lifestyleStats", () => ({
  processMemberLifestyleRepairJobs: vi.fn(),
  refreshDailyGymStats: vi.fn(),
  refreshDailyMemberLifestyleStats: vi.fn(),
}));
vi.mock("./lifestyleStats/dailyPersonal", () => ({
  refreshDailyMemberLifestyleStats: vi.fn(),
}));
vi.mock("./maintenance", () => ({
  markOpenWarMemberStatsRebuildComplete: vi.fn(),
  runHeatmapSamplingRetry: vi.fn(),
  runScheduledMaintenance: vi.fn(),
}));
vi.mock("./miscellaneous", () => ({
  refreshTornShoplifting: vi.fn(),
}));
vi.mock("./retaliations", () => ({
  syncRetaliationDiscordBoard: vi.fn(),
}));
vi.mock("./warStats", () => ({
  rebuildWarStatsFromRaw: vi.fn(),
  refreshOpenWarChainBonusAdjustmentsFromRaw: vi.fn(),
}));
vi.mock("./xanaxCompetition", () => ({
  reconcileXanaxCompetitionRollover: vi.fn(),
  runMonthlyXanaxCompetitionDiscordReminder: vi.fn(),
}));

import {
  buildCronPlan,
  shouldRunMonthlyXanaxCompetitionDiscordReminder,
} from "./cronPlan";
import { runChainWatchCron } from "./chainWatch";
import { runArmoryCron, runMedicalStockAlertsCron } from "./armory";
import { runIngestion } from "./ingestion";
import { refreshDailyMemberLifestyleStats } from "./lifestyleStats/dailyPersonal";
import { markOpenWarMemberStatsRebuildComplete, runHeatmapSamplingRetry, runScheduledMaintenance } from "./maintenance";
import { syncRetaliationDiscordBoard } from "./retaliations";
import type { Env } from "./types";
import { rebuildWarStatsFromRaw, refreshOpenWarChainBonusAdjustmentsFromRaw } from "./warStats";

beforeEach(() => {
  vi.clearAllMocks();
});

/** Env whose DB emulates the sync_state slot claim used by catch-up jobs. */
function slotEnv(): Env {
  const claims = new Map<string, number>();
  return {
    DB: {
      prepare: () => ({
        bind: (name: string, slotStart: number) => ({
          first: async () => {
            if ((claims.get(name) ?? -1) >= slotStart) return null;
            claims.set(name, slotStart);
            return { name };
          },
        }),
      }),
    },
  } as unknown as Env;
}

const SLOT_JOB_LABELS = [
  "Cron faction armory inventory",
  "Cron ingestion",
  "Cron targeted chain bonus correction",
  "Cron scheduled maintenance",
  "Cron personal lifestyle stats",
];

/** Runs only the slot-gated jobs (and ingestion, which owns the hourly rebuild). */
async function runMinutes(env: Env, minutes: number[], hour = 1): Promise<void> {
  for (const minute of minutes) {
    const jobs = buildCronPlan(env, Date.UTC(2026, 8, 27, hour, minute))
      .filter((job) => SLOT_JOB_LABELS.includes(job.label));
    for (const job of jobs) await job.run();
  }
}

it("refreshes all armory inventory once per quarter hour and checks saved stock alerts every minute", async () => {
  const env = slotEnv();
  for (let minute = 0; minute < 60; minute++) {
    const jobs = buildCronPlan(env, Date.UTC(2026, 8, 27, 1, minute)).filter(job => job.label.includes("armory"));
    expect(jobs.map(job => job.label)).toEqual(minute % 15 < 5
      ? ["Cron faction armory inventory", "Cron medical armory stock alerts"]
      : ["Cron medical armory stock alerts"]);
    for (const job of jobs) await job.run();
  }
  expect(runArmoryCron).toHaveBeenCalledTimes(4);
  expect(runArmoryCron).toHaveBeenCalledWith(env);
  expect(runMedicalStockAlertsCron).toHaveBeenCalledTimes(60);
});

describe("heatmap sampling retry cron", () => {
  it("schedules exactly one retry after the catch-up window of every quarter-hour slot", () => {
    for (let hour = 0; hour < 24; hour += 1) {
      const retryMinutes: number[] = [];
      for (let minute = 0; minute < 60; minute += 1) {
        const jobs = buildCronPlan({} as Env, Date.UTC(2026, 8, 16, hour, minute));
        if (jobs.some((job) => job.label === "Cron heatmap sampling retry")) {
          retryMinutes.push(minute);
        }
      }
      expect(retryMinutes).toEqual([5, 20, 35, 50]);
    }
  });

  it("runs only the heatmap retry with the scheduled time", async () => {
    const env = {} as Env;
    const scheduledTime = Date.UTC(2026, 8, 16, 0, 5);
    const job = buildCronPlan(env, scheduledTime).find((item) => item.label === "Cron heatmap sampling retry");

    expect(job).toBeDefined();
    await job!.run();

    expect(runHeatmapSamplingRetry).toHaveBeenCalledExactlyOnceWith(env, scheduledTime);
    expect(runScheduledMaintenance).not.toHaveBeenCalled();
  });
});

describe("monthly Xanax competition cron", () => {
  it("never schedules more than one full war-stat rebuild in the same tick", () => {
    for (let hour = 0; hour < 24; hour += 1) {
      for (let minute = 0; minute < 60; minute += 1) {
        const fullRebuildJobs = buildCronPlan({} as Env, Date.UTC(2026, 5, 1, hour, minute, 0))
          .filter((job) => job.fullWarStatsRebuild);

        expect(fullRebuildJobs.length).toBeLessThanOrEqual(1);
      }
    }
  });

  it("refreshes the chain directly after ingestion, before the exact war rebuild", async () => {
    const calls: string[] = [];
    vi.mocked(runIngestion).mockImplementation(async () => {
      calls.push("ingestion");
    });
    vi.mocked(rebuildWarStatsFromRaw).mockImplementation(async () => {
      calls.push("exact-rebuild");
      return { wars_rebuilt: 1, combat_bucket_rows: 3 };
    });
    vi.mocked(markOpenWarMemberStatsRebuildComplete).mockImplementation(async () => {
      calls.push("latch");
    });
    vi.mocked(runChainWatchCron).mockImplementation(async () => {
      calls.push("chain-watch");
    });
    vi.mocked(syncRetaliationDiscordBoard).mockImplementation(async () => {
      calls.push("retaliation");
      return { active: false, nextRefreshAt: 0, edited: false };
    });

    const scheduledTime = Date.UTC(2026, 5, 1, 6, 0, 0);
    const ingestionJob = buildCronPlan(slotEnv(), scheduledTime)
      .find((job) => job.label === "Cron ingestion");

    await ingestionJob?.run();

    expect(calls).toEqual([
      "ingestion",
      "chain-watch",
      "exact-rebuild",
      "latch",
      "retaliation",
    ]);
    expect(rebuildWarStatsFromRaw).toHaveBeenCalledWith(
      expect.anything(),
      { scope: "open-wars", reason: "cron" },
    );
    expect(markOpenWarMemberStatsRebuildComplete).toHaveBeenCalledWith(
      expect.anything(),
      Math.floor(scheduledTime / 1000),
    );
  });

  it("still refreshes chain monitoring when ingestion fails", async () => {
    vi.mocked(runIngestion).mockRejectedValueOnce(new Error("Feed unavailable"));
    const scheduledTime = Date.UTC(2026, 5, 1, 6, 1, 0);
    const job = buildCronPlan({} as Env, scheduledTime).find((item) => item.label === "Cron ingestion");
    await expect(job!.run()).rejects.toThrow("Feed unavailable");
    expect(runChainWatchCron).toHaveBeenCalledWith(expect.anything(), scheduledTime);
    expect(rebuildWarStatsFromRaw).not.toHaveBeenCalled();
  });

  it("keeps personal lifestyle imports on the four daily UTC slots", () => {
    expect(buildCronPlan({} as Env, Date.UTC(2026, 5, 1, 0, 10, 0)).map((job) => job.label))
      .toContain("Cron personal lifestyle stats");
    expect(buildCronPlan({} as Env, Date.UTC(2026, 5, 1, 6, 10, 0)).map((job) => job.label))
      .toContain("Cron personal lifestyle stats");
    expect(buildCronPlan({} as Env, Date.UTC(2026, 5, 1, 12, 10, 0)).map((job) => job.label))
      .toContain("Cron personal lifestyle stats");
    expect(buildCronPlan({} as Env, Date.UTC(2026, 5, 1, 18, 10, 0)).map((job) => job.label))
      .toContain("Cron personal lifestyle stats");
    expect(buildCronPlan({} as Env, Date.UTC(2026, 5, 1, 0, 15, 0)).map((job) => job.label))
      .not.toContain("Cron personal lifestyle stats");
  });

  it("schedules gym lifestyle imports independently for daily and retry gating", () => {
    expect(buildCronPlan({} as Env, Date.UTC(2026, 5, 1, 0, 10, 0)).map((job) => job.label))
      .toContain("Cron gym lifestyle stats");
    expect(buildCronPlan({} as Env, Date.UTC(2026, 5, 1, 0, 15, 0)).map((job) => job.label))
      .toContain("Cron gym lifestyle stats");
  });

  it("runs during the first-day 00:10 UTC retry window", () => {
    expect(shouldRunMonthlyXanaxCompetitionDiscordReminder(
      new Date(Date.UTC(2026, 5, 1, 0, 10, 0)),
    )).toBe(true);
    expect(shouldRunMonthlyXanaxCompetitionDiscordReminder(
      new Date(Date.UTC(2026, 5, 1, 0, 19, 0)),
    )).toBe(true);
  });

  it("does not run outside the monthly retry window", () => {
    expect(shouldRunMonthlyXanaxCompetitionDiscordReminder(
      new Date(Date.UTC(2026, 5, 1, 0, 9, 0)),
    )).toBe(false);
    expect(shouldRunMonthlyXanaxCompetitionDiscordReminder(
      new Date(Date.UTC(2026, 5, 1, 0, 20, 0)),
    )).toBe(false);
    expect(shouldRunMonthlyXanaxCompetitionDiscordReminder(
      new Date(Date.UTC(2026, 5, 2, 0, 10, 0)),
    )).toBe(false);
  });

  it("includes the Discord reminder job at 00:10 UTC on the first", () => {
    const labels = buildCronPlan({} as Env, Date.UTC(2026, 5, 1, 0, 10, 0))
      .map((job) => job.label);

    expect(labels).toContain("Cron monthly Xanax competition Discord reminder");
  });
});

describe("catch-up for skipped cron minutes", () => {
  it("runs quarter-hour jobs on the next minute when the slot minute is skipped, and only once", async () => {
    const env = slotEnv();

    // 01:15 never fired; 01:16 and 01:17 did.
    await runMinutes(env, [16, 17]);

    expect(runArmoryCron).toHaveBeenCalledTimes(1);
    expect(runScheduledMaintenance).toHaveBeenCalledTimes(1);
    expect(refreshOpenWarChainBonusAdjustmentsFromRaw).toHaveBeenCalledTimes(1);
  });

  it("gives up on a slot after the catch-up window", async () => {
    const env = slotEnv();

    await runMinutes(env, [20, 21]);

    expect(runArmoryCron).not.toHaveBeenCalled();
    expect(runScheduledMaintenance).not.toHaveBeenCalled();
  });

  it("never runs the chain bonus correction in the hourly rebuild window", async () => {
    await runMinutes(slotEnv(), [0, 1, 2, 3, 4]);

    expect(refreshOpenWarChainBonusAdjustmentsFromRaw).not.toHaveBeenCalled();
    expect(rebuildWarStatsFromRaw).toHaveBeenCalledTimes(1);
  });

  it("retries the hourly rebuild on the next minute when ingestion fails", async () => {
    const env = slotEnv();
    vi.mocked(rebuildWarStatsFromRaw).mockResolvedValue({ wars_rebuilt: 1, combat_bucket_rows: 0 } as never);
    vi.mocked(runIngestion).mockRejectedValueOnce(new Error("Feed unavailable"));

    const failed = buildCronPlan(env, Date.UTC(2026, 8, 27, 1, 0)).find((job) => job.label === "Cron ingestion");
    await expect(failed!.run()).rejects.toThrow("Feed unavailable");
    await runMinutes(env, [1, 2]);

    expect(rebuildWarStatsFromRaw).toHaveBeenCalledTimes(1);
  });

  it("catches up a skipped six-hourly lifestyle import", async () => {
    const env = slotEnv();

    // 06:10 never fired.
    await runMinutes(env, [11, 12, 15], 6);

    expect(refreshDailyMemberLifestyleStats).toHaveBeenCalledTimes(1);
  });

  it("runs the enemy scouting tick every minute", () => {
    for (let minute = 0; minute < 60; minute += 1) {
      expect(buildCronPlan({} as Env, Date.UTC(2026, 8, 27, 1, minute)).map((job) => job.label))
        .toContain("Cron enemy scouting tick");
    }
  });
});
