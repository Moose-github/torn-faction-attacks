import type { Env } from "../types";
import { nowSeconds } from "../utils";
import { MAX_DAILY_XANTAKEN_DELTA, type XantakenRecheckRow } from "./model";

export type XantakenRepairDetail = Pick<XantakenRecheckRow,
  "member_id" | "member_name" | "snapshot_date" | "reason" | "prior_xantaken" |
  "current_xantaken" | "next_xantaken" | "returned_xantaken" | "returned_bucket_date" |
  "attempts" | "max_attempts" | "last_error" | "updated_at"
> & {
  repair_job_id: string | null;
  repair_status: string | null;
  repair_total_items: number | null;
  repair_completed_items: number | null;
  repair_failed_items: number | null;
  repair_skipped_items: number | null;
  repair_error: string | null;
};

export async function readXantakenRepairDetails(env: Env): Promise<XantakenRepairDetail[]> {
  return ((await env.DB.prepare(`
    SELECT r.member_id, r.member_name, r.snapshot_date, r.reason,
      r.prior_xantaken, r.current_xantaken, r.next_xantaken,
      r.returned_xantaken, r.returned_bucket_date, r.attempts, r.max_attempts,
      r.last_error, r.updated_at,
      j.id AS repair_job_id, j.status AS repair_status,
      j.total_items AS repair_total_items, j.completed_items AS repair_completed_items,
      j.failed_items AS repair_failed_items, j.skipped_items AS repair_skipped_items,
      j.last_error AS repair_error
    FROM member_lifestyle_xantaken_rechecks r
    LEFT JOIN member_lifestyle_repair_jobs j ON j.id = (
      SELECT candidate.id FROM member_lifestyle_repair_jobs candidate
      WHERE (candidate.member_id = r.member_id OR candidate.member_id IS NULL)
        AND candidate.effective_start_date <= date(r.snapshot_date, '-1 day')
        AND candidate.end_date >= date(r.snapshot_date, '+1 day')
        AND candidate.created_at >= r.created_at
      ORDER BY CASE WHEN candidate.status IN ('queued', 'running') THEN 0 ELSE 1 END,
        candidate.created_at DESC, candidate.id DESC
      LIMIT 1
    )
    WHERE r.status = 'needs_repair'
    ORDER BY r.snapshot_date ASC, r.member_id ASC
  `).all<XantakenRepairDetail>()).results ?? []);
}

/** Only clear a warning after all three dates were fetched by this repair and are consistent. */
export async function reconcileXantakenRepairJob(env: Env, jobId: string): Promise<void> {
  await env.DB.prepare(`
    UPDATE member_lifestyle_xantaken_rechecks AS r
    SET status = 'auto_fixed', last_error = NULL, finished_at = ?, updated_at = ?
    WHERE r.status = 'needs_repair'
      AND EXISTS (
        SELECT 1 FROM member_lifestyle_repair_jobs j
        WHERE j.id = ? AND j.status IN ('queued', 'running')
          AND j.created_at >= r.created_at
      )
      AND (
        SELECT COUNT(DISTINCT i.snapshot_date) FROM member_lifestyle_repair_items i
        WHERE i.job_id = ? AND i.member_id = r.member_id AND i.status = 'completed'
          AND i.returned_bucket_date = i.snapshot_date
          AND i.snapshot_date IN (date(r.snapshot_date, '-1 day'), r.snapshot_date, date(r.snapshot_date, '+1 day'))
      ) = 3
      AND EXISTS (
        SELECT 1 FROM member_lifestyle_stat_snapshots current
        JOIN member_lifestyle_stat_snapshots previous
          ON previous.member_id = current.member_id AND previous.snapshot_date = date(current.snapshot_date, '-1 day')
        JOIN member_lifestyle_stat_snapshots following
          ON following.member_id = current.member_id AND following.snapshot_date = date(current.snapshot_date, '+1 day')
        WHERE current.member_id = r.member_id AND current.snapshot_date = r.snapshot_date
          AND current.personal_ready = 1 AND previous.personal_ready = 1 AND following.personal_ready = 1
          AND current.xantaken - previous.xantaken BETWEEN 0 AND ?
          AND following.xantaken - current.xantaken BETWEEN 0 AND ?
      )
  `).bind(nowSeconds(), nowSeconds(), jobId, jobId, MAX_DAILY_XANTAKEN_DELTA, MAX_DAILY_XANTAKEN_DELTA).run();
}
