import type { Env } from "../types";

// Cloudflare occasionally skips a cron minute (a few percent of minutes, more at
// peak times). Jobs pinned to one minute therefore get a short window to catch
// up, and a claim in sync_state keeps each slot to a single run.
export const CRON_CATCH_UP_MINUTES = 5;

const MINUTES_PER_DAY = 24 * 60;

export type CronSlot = {
  /** True during the first CRON_CATCH_UP_MINUTES minutes of a slot. */
  isDue: (date: Date) => boolean;
  /** Unix seconds at which the slot containing scheduledTime began. */
  slotStart: (scheduledTime: number) => number;
};

/** A repeating slot every intervalMinutes, starting offsetMinutes after UTC midnight. */
export function cronSlot(intervalMinutes: number, offsetMinutes = 0): CronSlot {
  if (MINUTES_PER_DAY % intervalMinutes !== 0) {
    throw new Error(`Cron slot interval must divide a day: ${intervalMinutes}`);
  }

  const intervalSeconds = intervalMinutes * 60;
  const offsetSeconds = offsetMinutes * 60;
  return {
    isDue: (date) => {
      const minuteOfDay = date.getUTCHours() * 60 + date.getUTCMinutes();
      const minutesIntoSlot = (((minuteOfDay - offsetMinutes) % intervalMinutes) + intervalMinutes) % intervalMinutes;
      return minutesIntoSlot < CRON_CATCH_UP_MINUTES;
    },
    slotStart: (scheduledTime) => {
      const seconds = Math.floor(scheduledTime / 1000);
      return Math.floor((seconds - offsetSeconds) / intervalSeconds) * intervalSeconds + offsetSeconds;
    },
  };
}

/** Claims a slot for a job; true only for the first caller in that slot. */
export async function claimCronSlot(env: Env, jobName: string, slotStart: number): Promise<boolean> {
  const claimed = await env.DB.prepare(
    `
    INSERT INTO sync_state (name, last_started, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(name) DO UPDATE SET
      last_started = excluded.last_started,
      updated_at = CURRENT_TIMESTAMP
    WHERE sync_state.last_started < excluded.last_started
    RETURNING name
    `,
  )
    .bind(`cron_slot:${jobName}`, slotStart)
    .first();

  return claimed !== null;
}

/** Runs a slot job at most once per slot, during that slot's catch-up window. */
export async function runOncePerSlot<T>(
  env: Env,
  jobName: string,
  slot: CronSlot,
  scheduledTime: number,
  run: () => Promise<T>,
): Promise<T | { skipped: true; reason: string }> {
  if (!(await claimCronSlot(env, jobName, slot.slotStart(scheduledTime)))) {
    return { skipped: true, reason: "slot already ran" };
  }
  return run();
}
