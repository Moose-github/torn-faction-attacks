import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./enemyScoutingCron", () => ({
  runEnemyScoutingCronTick: vi.fn(),
}));
vi.mock("./ingestion", () => ({
  runIngestion: vi.fn(),
}));
vi.mock("./chainWatch", () => ({
  runChainWatchCron: vi.fn(),
}));
vi.mock("./discordTravelTracker", () => ({
  syncDiscordTravelTracker: vi.fn(),
}));
vi.mock("./lifestyleStats", () => ({
  processMemberLifestyleRepairJobs: vi.fn(),
  refreshDailyGymStats: vi.fn(),
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
import { runIngestion } from "./ingestion";
import { markOpenWarMemberStatsRebuildComplete, runHeatmapSamplingRetry, runScheduledMaintenance } from "./maintenance";
import { syncRetaliationDiscordBoard } from "./retaliations";
import type { Env } from "./types";
import { rebuildWarStatsFromRaw } from "./warStats";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("heatmap sampling retry cron", () => {
  it("schedules exactly one retry at +1 minute for every quarter-hour slot", () => {
    for (let hour = 0; hour < 24; hour += 1) {
      const retryMinutes: number[] = [];
      for (let minute = 0; minute < 60; minute += 1) {
        const jobs = buildCronPlan({} as Env, Date.UTC(2026, 8, 16, hour, minute));
        if (jobs.some((job) => job.label === "Cron heatmap sampling retry")) {
          retryMinutes.push(minute);
        }
      }
      expect(retryMinutes).toEqual([1, 16, 31, 46]);
    }
  });

  it("runs only the heatmap retry with the scheduled time", async () => {
    const env = {} as Env;
    const scheduledTime = Date.UTC(2026, 8, 16, 0, 1);
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

  it("runs top-hour attack ingestion, exact rebuild, latch update, and alert refresh in order", async () => {
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
    const ingestionJob = buildCronPlan({} as Env, scheduledTime)
      .find((job) => job.label === "Cron ingestion");

    await ingestionJob?.run();

    expect(calls).toEqual([
      "ingestion",
      "exact-rebuild",
      "latch",
      "chain-watch",
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

  it("temporarily schedules manual/home Discord travel tracker syncs every five minutes", () => {
    expect(buildCronPlan({} as Env, Date.UTC(2026, 5, 1, 0, 5, 0)).map((job) => job.label))
      .toContain("Cron manual/home Discord travel tracker sync");
    expect(buildCronPlan({} as Env, Date.UTC(2026, 5, 1, 0, 6, 0)).map((job) => job.label))
      .not.toContain("Cron manual/home Discord travel tracker sync");
  });
});
