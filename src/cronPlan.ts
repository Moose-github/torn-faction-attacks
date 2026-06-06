import { CRON_JOB_DEFINITIONS } from "./cronJobs/definitions";
import type { CronJob } from "./cronJobs/model";
import type { Env } from "./types";

export type { CronJob } from "./cronJobs/model";
export { shouldRunMonthlyXanaxCompetitionDiscordReminder } from "./cronJobs/definitions";

export function buildCronPlan(env: Env, scheduledTime: number): CronJob[] {
  const date = new Date(scheduledTime);

  return CRON_JOB_DEFINITIONS.filter((job) => job.shouldRun(date)).map((job) => ({
    label: job.label,
    cadence: job.cadence,
    category: job.category,
    purpose: job.purpose,
    run: () => job.run(env, scheduledTime),
  }));
}
