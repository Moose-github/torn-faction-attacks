import { WATCH_HOUR } from "./chainWatchSchedule";

type AssignedHour = {
  watch_id: string;
  start_at: number;
  assigned_to: number | null;
  cancelled: number;
};

export type WatchShift<T> = {
  first: T;
  slots: T[];
  start_at: number;
  end_at: number;
};

// Input is ordered by watch and start time. Daily sheet boundaries do not split
// a shift; gaps, cancellations, empty hours and a different owner do.
export function groupWatchShifts<T extends AssignedHour>(slots: readonly T[]): WatchShift<T>[] {
  const shifts: WatchShift<T>[] = [];
  let previous: WatchShift<T> | undefined;
  for (const slot of slots) {
    if (slot.cancelled || slot.assigned_to === null) {
      previous = undefined;
      continue;
    }
    if (previous && previous.first.watch_id === slot.watch_id &&
        previous.first.assigned_to === slot.assigned_to && previous.end_at === slot.start_at) {
      previous.slots.push(slot);
      previous.end_at += WATCH_HOUR;
    } else {
      previous = { first: slot, slots: [slot], start_at: slot.start_at, end_at: slot.start_at + WATCH_HOUR };
      shifts.push(previous);
    }
  }
  return shifts;
}

// A takeover includes the unfinished current hour, preserving completed hours.
// Its exact scope is checked again inside the confirmation SQL transaction.
export function remainingWatchShift(shift: { start_at: number; end_at: number }, now: number) {
  return { start_at: Math.max(shift.start_at, Math.floor(now / WATCH_HOUR) * WATCH_HOUR), end_at: shift.end_at };
}

type CheckInHour = AssignedHour & {
  check_in_confirmed_at: number | null;
  check_in_closed_at: number | null;
  check_in_end_at: number | null;
};

export function watchShiftConfirmations<T extends CheckInHour>(slots: readonly T[]): Map<T, number | null> {
  const confirmations = new Map<T, number | null>();
  for (const { first, slots: hours } of groupWatchShifts(slots)) {
    for (const hour of hours) {
      // Only the first hour's current assignment revision supplies readiness.
      // A closed check-in cannot cover hours appended after the shift ended.
      confirmations.set(hour, first.check_in_closed_at === null || hour.start_at < (first.check_in_end_at ?? 0)
        ? first.check_in_confirmed_at : null);
    }
  }
  return confirmations;
}
