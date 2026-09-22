import { WATCH_HOUR } from "../shared/chainWatchSchedule";
import { groupWatchShifts } from "../shared/chainWatchShifts";
import type { Env } from "./types";

export type WatchAssignmentBlock = {
  watch_id: string; start_at: number; end_at: number; check_in_revision: number; assigned_to: number;
  discord_user_id: string | null; guild_id: string; channel_id: string; watch_name: string; member_name: string;
};

// Used both by the sender and the confirmation UPDATE. The revision invalidates
// old buttons even when a slot changes A -> B -> A between scheduler ticks.
export const validAssignment = `EXISTS (
  SELECT 1 FROM chain_watch_slots s JOIN chain_watch_schedules w ON w.id = s.watch_id
  WHERE s.watch_id = chain_watch_check_ins.watch_id AND s.start_at = chain_watch_check_ins.start_at
    AND s.check_in_revision = chain_watch_check_ins.assignment_revision
    AND s.assigned_to = chain_watch_check_ins.assigned_to AND s.cancelled = 0
    AND w.is_open = 1 AND w.guild_id = chain_watch_check_ins.guild_id
    AND s.start_at >= w.start_at AND (w.finish_at IS NULL OR w.finish_at > unixepoch())
    AND (w.finish_at IS NULL OR s.start_at < w.finish_at)
    AND NOT EXISTS (SELECT 1 FROM chain_watch_slots previous WHERE previous.watch_id = s.watch_id
      AND previous.start_at = s.start_at - ${WATCH_HOUR} AND previous.cancelled = 0
      AND previous.assigned_to = s.assigned_to)
    AND (unixepoch() < s.start_at OR (
      EXISTS (SELECT 1 FROM chain_watch_slots current WHERE current.watch_id = s.watch_id
        AND current.start_at = unixepoch() - unixepoch() % ${WATCH_HOUR}
        AND current.assigned_to = s.assigned_to AND current.cancelled = 0)
      AND NOT EXISTS (SELECT 1 FROM chain_watch_slots gap WHERE gap.watch_id = s.watch_id
        AND gap.start_at > s.start_at AND gap.start_at <= unixepoch()
        AND (gap.assigned_to IS NOT s.assigned_to OR gap.cancelled = 1))
    ))
)`;

// Reads use the same grouping as roster readiness. Write-time guards above and
// the takeover trigger stay in SQL so concurrent assignment changes are atomic.
export async function readWatchAssignmentBlocks(env: Env): Promise<WatchAssignmentBlock[]> {
  const rows = await env.DB.prepare(`SELECT s.watch_id, s.start_at, s.check_in_revision, s.assigned_to, s.cancelled,
      w.guild_id, w.channel_id, w.name AS watch_name, COALESCE(m.name, 'Player ' || s.assigned_to) AS member_name,
      CASE WHEN m.is_current = 1 THEN links.discord_user_id ELSE NULL END AS discord_user_id
    FROM chain_watch_slots s JOIN chain_watch_schedules w ON w.id = s.watch_id
    LEFT JOIN home_faction_members m ON m.member_id = s.assigned_to
    LEFT JOIN discord_member_links links ON links.torn_user_id = s.assigned_to
    WHERE w.is_open = 1 AND w.guild_id = ? AND s.cancelled = 0 AND s.assigned_to IS NOT NULL
      AND s.start_at >= w.start_at AND (w.finish_at IS NULL OR s.start_at < w.finish_at)
    ORDER BY s.watch_id, s.start_at`).bind(env.DISCORD_GUILD_ID).all<Omit<WatchAssignmentBlock, "end_at"> & { cancelled: number }>();
  return groupWatchShifts(rows.results).map(({ first, end_at }) => {
    const { cancelled: _cancelled, ...row } = first;
    const id = row.discord_user_id?.trim();
    return { ...row, end_at, discord_user_id: id && /^\d{5,32}$/.test(id) ? id : null };
  });
}
