import type { Env } from "../types";

export type CronJob = {
  label: string;
  cadence: string;
  category: string;
  purpose: string;
  fullWarStatsRebuild: boolean;
  run: () => Promise<unknown>;
};

export type CronJobDefinition = Omit<CronJob, "fullWarStatsRebuild" | "run"> & {
  fullWarStatsRebuild?: (date: Date) => boolean;
  shouldRun: (date: Date) => boolean;
  run: (env: Env, scheduledTime: number) => Promise<unknown>;
};
