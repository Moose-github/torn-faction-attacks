import type { Env } from "../types";

export type CronJob = {
  label: string;
  cadence: string;
  category: string;
  purpose: string;
  run: () => Promise<unknown>;
};

export type CronJobDefinition = Omit<CronJob, "run"> & {
  shouldRun: (date: Date) => boolean;
  run: (env: Env, scheduledTime: number) => Promise<unknown>;
};
