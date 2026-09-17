export type ChainWatchSchedule = {
  id: string;
  name: string;
  start_at: number;
  finish_at: number | null;
  guild_id: string;
  channel_id: string;
  is_open: number;
};

export type ChainWatchSheet = {
  id: string;
  watch_id: string;
  start_at: number;
  end_at: number;
  discord_message_id: string | null;
};

export type ChainWatchSlot = {
  watch_id: string;
  sheet_id: string;
  start_at: number;
  assigned_to: number | null;
  member_name: string | null;
  cancelled: number;
};

export type ChainWatchScheduleResponse = {
  ok: true;
  now: number;
  watch: ChainWatchSchedule | null;
  sheets: ChainWatchSheet[];
  slots: ChainWatchSlot[];
  members: Array<{ member_id: number; name: string }>;
};

export const WATCH_HOUR = 3600;
export const WATCH_DAY = 24 * WATCH_HOUR;

export function nextWatchHour(now: number): number {
  return (Math.floor(now / WATCH_HOUR) + 1) * WATCH_HOUR;
}

export function watchDate(timestamp: number): string {
  const iso = new Date(timestamp * 1000).toISOString();
  return `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(2, 4)}`;
}

export function watchUtc(timestamp: number): string {
  return `${watchDate(timestamp)} ${new Date(timestamp * 1000).toISOString().slice(11, 16)} UTC`;
}

export function createsLongWatchRun(starts: Iterable<number>, added: number): boolean {
  const hours = new Set(starts);
  return (hours.has(added - WATCH_HOUR) && hours.has(added - 2 * WATCH_HOUR)) ||
    (hours.has(added - WATCH_HOUR) && hours.has(added + WATCH_HOUR)) ||
    (hours.has(added + WATCH_HOUR) && hours.has(added + 2 * WATCH_HOUR));
}
