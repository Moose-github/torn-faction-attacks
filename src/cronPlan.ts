import { CRON_JOB_DEFINITIONS } from "./cronJobs/definitions";
import type { CronJob } from "./cronJobs/model";
import type { Env } from "./types";
import { createBackgroundReadScope } from "./backgroundReadScope";

export type { CronJob } from "./cronJobs/model";
export { shouldRunMonthlyXanaxCompetitionDiscordReminder } from "./cronJobs/definitions";

export function buildCronPlan(env: Env, scheduledTime: number): CronJob[] {
  const date = new Date(scheduledTime);
  const runEnv = createBackgroundReadScope(env);

  return CRON_JOB_DEFINITIONS.filter((job) => job.shouldRun(date)).map((job) => ({
    label: job.label,
    cadence: job.cadence,
    category: job.category,
    purpose: job.purpose,
    fullWarStatsRebuild: job.fullWarStatsRebuild?.(date) ?? false,
    run: () => job.run(runEnv, scheduledTime),
  }));
}
