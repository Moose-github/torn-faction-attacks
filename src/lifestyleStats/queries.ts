import { HOME_FACTION_ID } from "../constants";
import type { Env } from "../types";
import { PERSONAL_STATS_ATTENTION_CTE, personalStatsAttentionParams } from "./attentionPolicy";
import type {
  DailyStatsAttention,
  LifestyleMemberRow,
  LifestyleSnapshotReadyFilter,
  LifestyleSnapshotRow,
} from "./model";

const LIFESTYLE_SNAPSHOT_COLUMNS = `
  snapshots.member_id,
  snapshots.snapshot_date,
  snapshots.member_name,
  snapshots.xantaken,
  snapshots.overdosed,
  snapshots.refills,
  snapshots.useractivity,
  snapshots.networth,
  snapshots.daysbeendonator,
  snapshots.xantaken_timestamp,
  snapshots.overdosed_timestamp,
  snapshots.refills_timestamp,
  snapshots.useractivity_timestamp,
  snapshots.networth_timestamp,
  snapshots.daysbeendonator_timestamp,
  snapshots.personalstats_bucket_date,
  snapshots.personalstats_requested_at,
  snapshots.personalstats_key_source,
  snapshots.gymenergy,
  snapshots.gymstrength,
  snapshots.gymspeed,
  snapshots.gymdefense,
  snapshots.gymdexterity,
  snapshots.personal_captured_at,
  snapshots.gym_captured_at,
  snapshots.gym_error,
  snapshots.personal_ready,
  snapshots.gym_ready,
  snapshots.fully_ready,
  snapshots.captured_at,
  snapshots.validation_error
`;

function currentMembershipDateCondition(
  memberAlias: string,
  dateExpression: string,
): string {
  return `(
          ${memberAlias}.current_join_date IS NULL
          OR ${dateExpression} >= ${memberAlias}.current_join_date
        )`;
}

export type DailyStatsAttentionCounts = Pick<
  DailyStatsAttention,
  "missing_donator_days" | "stale_personalstats" | "affected_member_count" | "accepted_issues"
>;

export async function readCompleteLifestyleSnapshotDateRange(
  env: Env,
  readyFilter: LifestyleSnapshotReadyFilter,
): Promise<{ start_date: string; end_date: string } | null> {
  const readyCondition = lifestyleSnapshotReadyCondition("snapshots", readyFilter);
  const row = (await env.DB.prepare(
    `
    SELECT
      MIN(candidate_dates.snapshot_date) AS start_date,
      MAX(candidate_dates.snapshot_date) AS end_date
    FROM (
      SELECT DISTINCT snapshot_date
      FROM member_lifestyle_stat_snapshots
    ) candidate_dates
    WHERE NOT EXISTS (
      SELECT 1
      FROM home_faction_members members
      LEFT JOIN member_lifestyle_stat_snapshots snapshots
        ON snapshots.member_id = members.member_id
       AND snapshots.snapshot_date = candidate_dates.snapshot_date
       AND ${readyCondition}
      WHERE members.faction_id = ?
        AND members.is_current = 1
        AND members.report_exempt = 0
        AND ${currentMembershipDateCondition("members", "candidate_dates.snapshot_date")}
        AND snapshots.member_id IS NULL
    )
    `,
  ).bind(HOME_FACTION_ID).first()) as { start_date: string | null; end_date: string | null } | null;

  if (!row?.start_date || !row.end_date) {
    return null;
  }

  return {
    start_date: row.start_date,
    end_date: row.end_date,
  };
}

export async function readLifestylePeriodSnapshotRows(
  env: Env,
  startDate: string,
  endDate: string,
): Promise<LifestyleSnapshotRow[]> {
  const rows = await env.DB.prepare(
    `
    SELECT ${LIFESTYLE_SNAPSHOT_COLUMNS}
    FROM member_lifestyle_stat_snapshots snapshots
    JOIN home_faction_members
      ON home_faction_members.member_id = snapshots.member_id
     AND home_faction_members.is_current = 1
     AND home_faction_members.report_exempt = 0
    WHERE snapshots.snapshot_date BETWEEN ? AND ?
      AND snapshots.fully_ready = 1
    ORDER BY snapshots.member_id ASC, snapshots.snapshot_date ASC
    `,
  )
    .bind(startDate, endDate)
    .all<LifestyleSnapshotRow>();

  return rows.results ?? [];
}

export async function readLifestyleDailyChartSnapshotRows(
  env: Env,
  startDate: string,
  endDate: string,
  memberIds: number[],
  readyColumn: "personal_ready" | "gym_ready",
): Promise<LifestyleSnapshotRow[]> {
  if (memberIds.length === 0) {
    return [];
  }

  const placeholders = memberIds.map(() => "?").join(",");
  const rows = await env.DB.prepare(
    `
    SELECT ${LIFESTYLE_SNAPSHOT_COLUMNS}
    FROM member_lifestyle_stat_snapshots snapshots
    JOIN home_faction_members members
      ON members.member_id = snapshots.member_id
     AND members.is_current = 1
     AND members.report_exempt = 0
    WHERE snapshots.snapshot_date BETWEEN ? AND ?
      AND snapshots.member_id IN (${placeholders})
      AND snapshots.${readyColumn} = 1
    ORDER BY snapshots.member_id ASC, snapshots.snapshot_date ASC
    `,
  )
    .bind(startDate, endDate, ...memberIds)
    .all<LifestyleSnapshotRow>();

  return rows.results ?? [];
}

function lifestyleSnapshotReadyCondition(tableAlias: string, readyFilter: LifestyleSnapshotReadyFilter): string {
  if (readyFilter === "any_ready") {
    return `(${tableAlias}.personal_ready = 1 OR ${tableAlias}.gym_ready = 1)`;
  }

  return `${tableAlias}.${readyFilter} = 1`;
}

export async function readHomeMembersById(
  env: Env,
  options: { includeReportExempt?: boolean } = {},
): Promise<Map<number, LifestyleMemberRow>> {
  const rows = await env.DB.prepare(
    `
    SELECT member_id, name, level, position, updated_at AS personal_captured_at
    FROM home_faction_members
    WHERE faction_id = ?
      AND is_current = 1
      AND (? = 1 OR report_exempt = 0)
    `,
  )
    .bind(HOME_FACTION_ID, options.includeReportExempt ? 1 : 0)
    .all<LifestyleMemberRow>();

  return new Map((rows.results ?? []).map((row) => [row.member_id, row]));
}

export async function readLatestPersonalStatsBucketDate(env: Env): Promise<string | null> {
  const latestBucketRow = (await env.DB.prepare(
    `
    SELECT snapshots.snapshot_date AS snapshot_date
    FROM member_lifestyle_stat_snapshots snapshots
    JOIN home_faction_members members
      ON members.member_id = snapshots.member_id
     AND members.is_current = 1
     AND members.report_exempt = 0
    WHERE snapshots.personal_ready = 1
    ORDER BY snapshots.snapshot_date DESC
    LIMIT 1
    `,
  ).first()) as { snapshot_date: string | null } | null;

  return latestBucketRow?.snapshot_date ?? null;
}

export async function readDailyStatsAttentionMembers(
  env: Env,
  now: number,
): Promise<DailyStatsAttention["affected_members"]> {
  const rows = await env.DB.prepare(`
    ${PERSONAL_STATS_ATTENTION_CTE}
    SELECT member_id, member_name, snapshot_date, status, error, updated_at
    FROM attention_stats WHERE accepted = 0
    ORDER BY snapshot_date ASC, member_name ASC, member_id ASC
    LIMIT 12
  `).bind(...personalStatsAttentionParams(now)).all<DailyStatsAttention["affected_members"][number]>();
  return rows.results ?? [];
}

export async function readDailyStatsAttentionCounts(env: Env, now: number): Promise<DailyStatsAttentionCounts> {
  const counts = await env.DB.prepare(`
    ${PERSONAL_STATS_ATTENTION_CTE}
    SELECT
      SUM(CASE WHEN accepted = 0 AND issue_kind <> 'missing_donator_days' THEN 1 ELSE 0 END) AS stale_personalstats,
      SUM(CASE WHEN accepted = 0 AND issue_kind = 'missing_donator_days' THEN 1 ELSE 0 END) AS missing_donator_days,
      COUNT(DISTINCT CASE WHEN accepted = 0 THEN member_id END) AS affected_member_count,
      SUM(accepted) AS accepted_issues
    FROM attention_stats
  `).bind(...personalStatsAttentionParams(now)).first<DailyStatsAttentionCounts>();
  return {
    stale_personalstats: counts?.stale_personalstats ?? 0,
    missing_donator_days: counts?.missing_donator_days ?? 0,
    affected_member_count: counts?.affected_member_count ?? 0,
    accepted_issues: counts?.accepted_issues ?? 0,
  };
}

export async function acceptDailyStatsAttentionIssue(
  env: Env,
  issue: Pick<DailyStatsAttention["affected_members"][number], "member_id" | "snapshot_date" | "status" | "error">,
  now: number,
  acceptedBy: number | null,
): Promise<boolean> {
  const result = await env.DB.prepare(`
    ${PERSONAL_STATS_ATTENTION_CTE}
    INSERT INTO daily_stats_issue_acceptances
      (member_id, snapshot_date, issue_status, issue_error, accepted_by, accepted_at)
    SELECT member_id, snapshot_date, status, error, ?, unixepoch()
    FROM attention_stats
    WHERE member_id = ? AND snapshot_date = ? AND status = ? AND error IS ?
    ON CONFLICT(member_id, snapshot_date) DO UPDATE SET
      issue_status = excluded.issue_status,
      issue_error = excluded.issue_error,
      accepted_by = excluded.accepted_by,
      accepted_at = excluded.accepted_at
  `).bind(
    ...personalStatsAttentionParams(now), acceptedBy,
    issue.member_id, issue.snapshot_date, issue.status, issue.error,
  ).run();
  return Number(result.meta.changes) > 0;
}
