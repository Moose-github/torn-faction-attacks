import { HOME_FACTION_ID } from "../constants";
import { dateKeyFromMs, utcDateKey } from "./dates";
import {
  MISSING_DONATOR_DAYS_ERROR_CODE,
  MISSING_PERSONALSTATS_BUCKET_ERROR_CODE,
  OLD_PERSONALSTATS_BUCKET_ERROR_CODE,
  PERSONALSTATS_BUCKET_MISMATCH_ERROR_CODE,
  RETRY_EXPIRED_PERSONALSTATS_ERROR_CODE,
} from "./model";

// Calendar age of the requested snapshot, independent of retry state or poll time.
export function personalStatsIssueCutoffDate(now: number): string {
  return dateKeyFromMs(Date.parse(`${utcDateKey(now)}T00:00:00Z`) - 2 * 86_400_000);
}

export function personalStatsAttentionParams(now: number): [string, string, number] {
  return [personalStatsIssueCutoffDate(now), utcDateKey(now), HOME_FACTION_ID];
}

function issueKindSql(error: string): string {
  return `CASE
    WHEN ${error} IS NULL
      OR ${error} LIKE '${OLD_PERSONALSTATS_BUCKET_ERROR_CODE}%'
      OR ${error} LIKE '${MISSING_PERSONALSTATS_BUCKET_ERROR_CODE}%'
      OR ${error} LIKE '${PERSONALSTATS_BUCKET_MISMATCH_ERROR_CODE}%'
      OR ${error} LIKE '${RETRY_EXPIRED_PERSONALSTATS_ERROR_CODE}%'
    THEN 'missing_data'
    WHEN ${error} LIKE '${MISSING_DONATOR_DAYS_ERROR_CODE}%' THEN 'missing_donator_days'
    ELSE 'collection_error'
  END`;
}

// Retry timestamps, pending -> expired, and a newer returned bucket do not turn
// an accepted missing date into a new issue. Other failures still match exactly.
export function acceptedDailyStatsIssueSql(statsAlias: string): string {
  return `EXISTS (
    SELECT 1 FROM daily_stats_issue_acceptances accepted
    WHERE accepted.member_id = ${statsAlias}.member_id
      AND accepted.snapshot_date = ${statsAlias}.snapshot_date
      AND (
        accepted.issue_error IS ${statsAlias}.error
        OR (${issueKindSql("accepted.issue_error")} = 'missing_data'
          AND ${issueKindSql(`${statsAlias}.error`)} = 'missing_data')
      )
  )`;
}

// Only dates already tracked by snapshots/collection (plus the newly due date)
// are expected. This also finds gaps with no queue row or recorded error.
// Every consumer binds personalStatsAttentionParams(now) to this CTE.
export const PERSONAL_STATS_ATTENTION_CTE = `
  WITH policy(cutoff_date, today, faction_id) AS (SELECT ?, ?, ?),
  tracked_dates(snapshot_date) AS (
    SELECT snapshot_date FROM member_lifestyle_stat_snapshots
    UNION SELECT snapshot_date FROM member_personal_stats_recent
    UNION SELECT snapshot_date FROM daily_stats_issue_acceptances
    UNION SELECT cutoff_date FROM policy
  ),
  missing_stats AS (
    SELECT members.member_id, members.name AS member_name, dates.snapshot_date,
      COALESCE(recent.status, 'pending') AS status,
      recent.error, recent.updated_at
    FROM tracked_dates dates
    CROSS JOIN policy
    JOIN home_faction_members members
      ON members.faction_id = policy.faction_id
     AND members.is_current = 1 AND members.report_exempt = 0
     AND (members.current_join_date IS NULL OR dates.snapshot_date >= members.current_join_date)
    LEFT JOIN member_lifestyle_stat_snapshots snapshots
      ON snapshots.member_id = members.member_id AND snapshots.snapshot_date = dates.snapshot_date
     AND snapshots.personal_ready = 1
    LEFT JOIN member_personal_stats_recent recent
      ON recent.member_id = members.member_id AND recent.snapshot_date = dates.snapshot_date
    WHERE dates.snapshot_date <= policy.today AND snapshots.member_id IS NULL
  ),
  classified_stats AS (
    SELECT *, ${issueKindSql("error")} AS issue_kind FROM missing_stats
  ),
  attention_stats AS (
    SELECT stats.*, ${acceptedDailyStatsIssueSql("stats")} AS accepted
    FROM classified_stats stats CROSS JOIN policy
    WHERE stats.snapshot_date <= policy.cutoff_date OR stats.issue_kind = 'collection_error'
  )
`;
