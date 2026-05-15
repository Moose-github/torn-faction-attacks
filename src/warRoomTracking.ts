export type WarRoomTrackingWindow = {
  practical_start_time: number;
  practical_finish_time: number | null;
  official_start_time: number | null;
};

export function isWarRoomMemberTrackingActive(
  war: WarRoomTrackingWindow | null,
  timestamp: number,
): boolean {
  if (!war) {
    return false;
  }

  const start = war.official_start_time ?? war.practical_start_time;
  const updateFrom = start - 2 * 60 * 60;
  const updateUntil = war.practical_finish_time;

  return timestamp >= updateFrom && (updateUntil === null || timestamp <= updateUntil);
}

export function isWarRoomMemberTrackingLive(
  war: WarRoomTrackingWindow | null,
  timestamp: number,
): boolean {
  if (!war) {
    return false;
  }

  const start = war.official_start_time ?? war.practical_start_time;
  const updateUntil = war.practical_finish_time;

  return timestamp >= start && (updateUntil === null || timestamp <= updateUntil);
}
