import { describe, expect, it, vi } from "vitest";

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
  runScheduledMaintenance: vi.fn(),
}));
vi.mock("./miscellaneous", () => ({
  refreshTornShoplifting: vi.fn(),
}));
vi.mock("./warStats", () => ({
  rebuildOpenWarMemberStatsFromRaw: vi.fn(),
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
import type { Env } from "./types";

describe("monthly Xanax competition cron", () => {
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
