import {
  DAILY_REFRESH_AFTER_UTC_HOUR,
  DAILY_REFRESH_AFTER_UTC_MINUTE,
  type TimedLifestyleStats,
} from "./model";

export function normalizeDateParam(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  return Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)) ? null : value;
}

export function dateDiffDays(startDate: string, endDate: string): number {
  return Math.max(1, calendarDateDiffDays(startDate, endDate));
}

export function calendarDateDiffDays(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00.000Z`);
  const end = Date.parse(`${endDate}T00:00:00.000Z`);
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

export function dailyRefreshReadyAt(timestamp: number): number | null {
  const date = new Date(timestamp * 1000);
  const readyAt = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    DAILY_REFRESH_AFTER_UTC_HOUR,
    DAILY_REFRESH_AFTER_UTC_MINUTE,
    0,
  );

  return timestamp * 1000 >= readyAt ? Math.floor(readyAt / 1000) : null;
}

export function recentCompletedPersonalStatsDates(timestamp: number): string[] {
  const date = new Date(timestamp * 1000);
  const todayStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return [
    dateKeyFromMs(todayStart - 2 * 86_400_000),
    dateKeyFromMs(todayStart - 86_400_000),
  ];
}

export function timestampForDailyPoll(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00.000Z`) / 1000);
}

/**
 * The day of the Torn snapshot a personalstats call returned. Each stat's
 * timestamp is the day it last changed. daysbeendonator moves every day for
 * donators, so it is the requested day or, before Torn catches up, the day
 * before. Anything older means the member was not a donator on that day, so
 * fall back to timeplayed, which moves on every day they play.
 */
export function personalStatsBucketDate(
  stats: Pick<TimedLifestyleStats, "daysbeendonator_timestamp" | "useractivity_timestamp">,
  requestedAt: number | null,
): string | null {
  const donatorDate = stats.daysbeendonator_timestamp ? utcDateKey(stats.daysbeendonator_timestamp) : null;
  if (requestedAt === null) {
    return donatorDate;
  }

  const dayBeforeRequested = utcDateKey(requestedAt - 86_400);
  if (donatorDate !== null && donatorDate >= dayBeforeRequested) {
    return donatorDate;
  }

  return stats.useractivity_timestamp ? utcDateKey(stats.useractivity_timestamp) : donatorDate;
}

export function utcDateKey(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

export function dateKeyFromMs(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function enumerateDateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  let cursor = Date.parse(`${startDate}T00:00:00.000Z`);
  const end = Date.parse(`${endDate}T00:00:00.000Z`);
  while (cursor <= end) {
    dates.push(dateKeyFromMs(cursor));
    cursor += 86_400_000;
  }
  return dates;
}
