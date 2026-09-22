import type { WatchAssignmentBlock } from "./chainWatchAssignments";

export const WATCH_CHECK_IN_PREFIX = "cws:checkin:";
export const WATCH_TAKE_OVER_PREFIX = "cws:takeover:";
export const WATCH_TAKE_OVER_CONFIRM_PREFIX = "cws:takeover-confirm:";
export const REMINDER_LEAD = 180;
export const ESCALATION_LEAD = 60;
export const TAKEOVER_LEAD = 30;
export const CLEANUP_DELAY = 5 * 60;

export type WatchCheckIn = Omit<WatchAssignmentBlock, "check_in_revision"> & {
  id: string; assignment_revision: number; reminder_message_id: string | null; reminder_sent_at: number | null;
  confirmed_at: number | null; escalation_message_id: string | null; escalation_channel_id: string | null;
  escalation_sent_at: number | null; escalation_kind: string | null; reminder_error: string | null;
  cancelled_at: number | null; closed_at: number | null; dirty: number;
  reminder_deleted_at: number | null; escalation_deleted_at: number | null;
  taken_over_by: number | null; taken_over_name: string | null; taken_over_at: number | null;
  taken_over_start_at: number | null; taken_over_end_at: number | null;
  takeover_button_shown: number;
};

export function reminderCleanupAt(row: WatchCheckIn): number | null {
  return row.cancelled_at !== null ? row.cancelled_at + CLEANUP_DELAY
    : row.confirmed_at !== null ? row.end_at + CLEANUP_DELAY : null;
}
