import { WarSummary } from "../api";

export function isWarRoomMemberTrackingActive(war: WarSummary, nowSeconds: number): boolean {
  const start = war.official_start_time ?? war.practical_start_time;
  if (!start) {
    return false;
  }

  const updateFrom = start - 2 * 60 * 60;
  const updateUntil = war.practical_finish_time;
  return nowSeconds >= updateFrom && (updateUntil === null || nowSeconds <= updateUntil);
}
