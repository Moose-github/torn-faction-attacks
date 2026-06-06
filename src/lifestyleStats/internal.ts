import { HOME_FACTION_ID } from "../constants";
import { fetchTornFactionMembers } from "../enemyScouting";
import { Env, TornFactionMember } from "../types";
import { boolToInt, finiteNumber } from "../utils";
import type {
  LifestyleMemberRow,
  TimedLifestyleStats,
} from "./model";
export { getDailyStatsAttention } from "./dailyAttention";
export type { DailyStatsAttention } from "./model";

export async function upsertLifestyleSnapshotPersonalStats(
  env: Env,
  target: { member_id: number; member_name: string | null; snapshot_date: string },
  stats: TimedLifestyleStats,
): Promise<void> {
  await env.DB.prepare(
    `
    INSERT INTO member_lifestyle_stat_snapshots (
      member_id,
      snapshot_date,
      member_name,
      xantaken,
      overdosed,
      refills,
      useractivity,
      networth,
      daysbeendonator,
      xantaken_timestamp,
      overdosed_timestamp,
      refills_timestamp,
      useractivity_timestamp,
      networth_timestamp,
      daysbeendonator_timestamp,
      personalstats_bucket_date,
      personalstats_requested_at,
      personalstats_key_source,
      validation_error,
      personal_captured_at,
      personal_ready,
      fully_ready,
      captured_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, unixepoch(), 1, 0, unixepoch())
    ON CONFLICT(member_id, snapshot_date) DO UPDATE SET
      member_name = excluded.member_name,
      xantaken = excluded.xantaken,
      overdosed = excluded.overdosed,
      refills = excluded.refills,
      useractivity = excluded.useractivity,
      networth = excluded.networth,
      daysbeendonator = excluded.daysbeendonator,
      xantaken_timestamp = excluded.xantaken_timestamp,
      overdosed_timestamp = excluded.overdosed_timestamp,
      refills_timestamp = excluded.refills_timestamp,
      useractivity_timestamp = excluded.useractivity_timestamp,
      networth_timestamp = excluded.networth_timestamp,
      daysbeendonator_timestamp = excluded.daysbeendonator_timestamp,
      personalstats_bucket_date = excluded.personalstats_bucket_date,
      personalstats_requested_at = excluded.personalstats_requested_at,
      personalstats_key_source = excluded.personalstats_key_source,
      validation_error = NULL,
      personal_captured_at = excluded.personal_captured_at,
      personal_ready = 1,
      fully_ready = CASE WHEN member_lifestyle_stat_snapshots.gym_ready = 1 THEN 1 ELSE 0 END,
      captured_at = excluded.captured_at
    `,
  )
    .bind(
      target.member_id,
      target.snapshot_date,
      target.member_name,
      stats.xantaken,
      stats.overdosed,
      stats.refills,
      stats.useractivity,
      stats.networth,
      stats.daysbeendonator,
      stats.xantaken_timestamp,
      stats.overdosed_timestamp,
      stats.refills_timestamp,
      stats.useractivity_timestamp,
      stats.networth_timestamp,
      stats.daysbeendonator_timestamp,
      stats.personalstats_bucket_date,
      stats.personalstats_requested_at,
      stats.personalstats_key_source,
    )
    .run();
}

export async function syncHomeFactionMemberList(env: Env): Promise<void> {
  const members = await fetchTornFactionMembers(env, HOME_FACTION_ID);
  if (members.length === 0) {
    return;
  }

  await env.DB.batch(
    members.map((member) =>
      env.DB.prepare(
        `
        INSERT INTO home_faction_members (
          member_id,
          faction_id,
          name,
          level,
          position,
          days_in_faction,
          is_revivable,
          is_current,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, unixepoch())
        ON CONFLICT(member_id) DO UPDATE SET
          faction_id = excluded.faction_id,
          name = excluded.name,
          level = excluded.level,
          position = excluded.position,
          days_in_faction = excluded.days_in_faction,
          is_revivable = excluded.is_revivable,
          is_current = 1,
          updated_at = excluded.updated_at
        `,
      ).bind(
        member.id,
        HOME_FACTION_ID,
        member.name,
        finiteNumber(member.level),
        member.position ?? null,
        finiteNumber(member.days_in_faction),
        boolToInt(member.is_revivable ?? false),
      ),
    ),
  );

  await markDepartedHomeFactionMembers(env, members);
  await removeDepartedLifestyleMembers(env, members);
}

export async function readHomeMembersById(
  env: Env,
  options: { includeReportExempt?: boolean } = {},
): Promise<Map<number, LifestyleMemberRow>> {
  const rows = ((await env.DB.prepare(
    `
    SELECT member_id, name, level, position, updated_at AS personal_captured_at
    FROM home_faction_members
    WHERE faction_id = ?
      AND is_current = 1
      AND (? = 1 OR report_exempt = 0)
    `,
  )
    .bind(HOME_FACTION_ID, options.includeReportExempt ? 1 : 0)
    .all()).results ?? []) as LifestyleMemberRow[];

  return new Map(rows.map((row) => [row.member_id, row]));
}

async function markDepartedHomeFactionMembers(
  env: Env,
  members: TornFactionMember[],
): Promise<void> {
  const ids = members.map((member) => member.id).filter((id) => Number.isInteger(id) && id > 0);
  if (ids.length === 0) {
    return;
  }

  await env.DB.prepare(
    `
    UPDATE home_faction_members
    SET is_current = 0,
        updated_at = unixepoch()
    WHERE member_id NOT IN (${ids.map(() => "?").join(",")})
      AND is_current != 0
    `,
  )
    .bind(...ids)
    .run();
}

async function removeDepartedLifestyleMembers(
  env: Env,
  members: TornFactionMember[],
): Promise<void> {
  const ids = members.map((member) => member.id).filter((id) => Number.isInteger(id) && id > 0);
  if (ids.length === 0) {
    return;
  }

  await env.DB.prepare(
    `
    DELETE FROM member_personal_stats_current
    WHERE member_id NOT IN (${ids.map(() => "?").join(",")})
    `,
  )
    .bind(...ids)
    .run();

  await env.DB.prepare(
    `
    DELETE FROM member_personal_stats_recent
    WHERE member_id NOT IN (${ids.map(() => "?").join(",")})
    `,
  )
    .bind(...ids)
    .run();

  await env.DB.prepare(
    `
    DELETE FROM member_gym_stats_current
    WHERE member_id NOT IN (${ids.map(() => "?").join(",")})
    `,
  )
    .bind(...ids)
    .run();
}

export async function writeLifestyleSnapshotForDate(
  env: Env,
  snapshotDate: string,
  options: { freshAfter?: number; allowPartialGym?: boolean } = {},
): Promise<void> {
  const freshAfter = options.freshAfter ?? null;
  const allowPartialGym = options.allowPartialGym ? 1 : 0;
  await env.DB.prepare(
    `
    WITH source AS (
      SELECT
        members.member_id,
        ? AS snapshot_date,
        COALESCE(personal.member_name, gym.member_name, members.name) AS member_name,
        personal.xantaken,
        personal.overdosed,
        personal.refills,
        personal.useractivity,
        personal.networth,
        personal.daysbeendonator,
        personal.xantaken_timestamp,
        personal.overdosed_timestamp,
        personal.refills_timestamp,
        personal.useractivity_timestamp,
        personal.networth_timestamp,
        personal.daysbeendonator_timestamp,
        personal.personalstats_bucket_date,
        personal.target_timestamp AS personalstats_requested_at,
        personal.personalstats_key_source,
        personal.error AS validation_error,
        gym.gymenergy,
        gym.gymstrength,
        gym.gymspeed,
        gym.gymdefense,
        gym.gymdexterity,
        personal.personal_captured_at,
        gym.gym_captured_at,
        gym.gym_error,
        CASE
          WHEN personal.personal_captured_at IS NOT NULL
            AND (? IS NULL OR personal.personal_captured_at >= ?)
            AND personal.error IS NULL
            AND personal.personalstats_bucket_date = ?
          THEN 1
          ELSE 0
        END AS personal_ready,
        CASE
          WHEN gym.gym_captured_at IS NOT NULL
            AND (? IS NULL OR gym.gym_captured_at >= ?)
            AND (gym.gym_error IS NULL OR ? = 1)
          THEN 1
          ELSE 0
        END AS gym_ready
      FROM home_faction_members members
      LEFT JOIN member_personal_stats_recent personal
        ON personal.member_id = members.member_id
       AND personal.snapshot_date = ?
      LEFT JOIN member_gym_stats_current gym
        ON gym.member_id = members.member_id
      WHERE members.faction_id = ?
        AND members.is_current = 1
        AND members.report_exempt = 0
    )
    INSERT INTO member_lifestyle_stat_snapshots (
      member_id,
      snapshot_date,
      member_name,
      xantaken,
      overdosed,
      refills,
      useractivity,
      networth,
      daysbeendonator,
      xantaken_timestamp,
      overdosed_timestamp,
      refills_timestamp,
      useractivity_timestamp,
      networth_timestamp,
      daysbeendonator_timestamp,
      personalstats_bucket_date,
      personalstats_requested_at,
      personalstats_key_source,
      validation_error,
      gymenergy,
      gymstrength,
      gymspeed,
      gymdefense,
      gymdexterity,
      personal_captured_at,
      gym_captured_at,
      gym_error,
      personal_ready,
      gym_ready,
      fully_ready,
      captured_at
    )
    SELECT
      member_id,
      snapshot_date,
      member_name,
      CASE WHEN personal_ready = 1 THEN xantaken ELSE NULL END,
      CASE WHEN personal_ready = 1 THEN overdosed ELSE NULL END,
      CASE WHEN personal_ready = 1 THEN refills ELSE NULL END,
      CASE WHEN personal_ready = 1 THEN useractivity ELSE NULL END,
      CASE WHEN personal_ready = 1 THEN networth ELSE NULL END,
      CASE WHEN personal_ready = 1 THEN daysbeendonator ELSE NULL END,
      CASE WHEN personal_ready = 1 THEN xantaken_timestamp ELSE NULL END,
      CASE WHEN personal_ready = 1 THEN overdosed_timestamp ELSE NULL END,
      CASE WHEN personal_ready = 1 THEN refills_timestamp ELSE NULL END,
      CASE WHEN personal_ready = 1 THEN useractivity_timestamp ELSE NULL END,
      CASE WHEN personal_ready = 1 THEN networth_timestamp ELSE NULL END,
      CASE WHEN personal_ready = 1 THEN daysbeendonator_timestamp ELSE NULL END,
      CASE WHEN personal_ready = 1 THEN personalstats_bucket_date ELSE NULL END,
      CASE WHEN personal_ready = 1 THEN personalstats_requested_at ELSE NULL END,
      CASE WHEN personal_ready = 1 THEN personalstats_key_source ELSE NULL END,
      CASE WHEN personal_ready = 1 THEN NULL ELSE validation_error END,
      CASE WHEN gym_ready = 1 THEN gymenergy ELSE NULL END,
      CASE WHEN gym_ready = 1 THEN gymstrength ELSE NULL END,
      CASE WHEN gym_ready = 1 THEN gymspeed ELSE NULL END,
      CASE WHEN gym_ready = 1 THEN gymdefense ELSE NULL END,
      CASE WHEN gym_ready = 1 THEN gymdexterity ELSE NULL END,
      CASE WHEN personal_ready = 1 THEN personal_captured_at ELSE NULL END,
      CASE WHEN gym_ready = 1 THEN gym_captured_at ELSE NULL END,
      CASE WHEN gym_ready = 1 THEN gym_error ELSE NULL END,
      personal_ready,
      gym_ready,
      CASE WHEN personal_ready = 1 AND gym_ready = 1 AND gym_error IS NULL THEN 1 ELSE 0 END,
      unixepoch()
    FROM source
    WHERE 1 = 1
    ON CONFLICT(member_id, snapshot_date) DO UPDATE SET
      member_name = excluded.member_name,
      xantaken = CASE WHEN excluded.personal_ready = 1 THEN excluded.xantaken ELSE member_lifestyle_stat_snapshots.xantaken END,
      overdosed = CASE WHEN excluded.personal_ready = 1 THEN excluded.overdosed ELSE member_lifestyle_stat_snapshots.overdosed END,
      refills = CASE WHEN excluded.personal_ready = 1 THEN excluded.refills ELSE member_lifestyle_stat_snapshots.refills END,
      useractivity = CASE WHEN excluded.personal_ready = 1 THEN excluded.useractivity ELSE member_lifestyle_stat_snapshots.useractivity END,
      networth = CASE WHEN excluded.personal_ready = 1 THEN excluded.networth ELSE member_lifestyle_stat_snapshots.networth END,
      daysbeendonator = CASE WHEN excluded.personal_ready = 1 THEN excluded.daysbeendonator ELSE member_lifestyle_stat_snapshots.daysbeendonator END,
      xantaken_timestamp = CASE WHEN excluded.personal_ready = 1 THEN excluded.xantaken_timestamp ELSE member_lifestyle_stat_snapshots.xantaken_timestamp END,
      overdosed_timestamp = CASE WHEN excluded.personal_ready = 1 THEN excluded.overdosed_timestamp ELSE member_lifestyle_stat_snapshots.overdosed_timestamp END,
      refills_timestamp = CASE WHEN excluded.personal_ready = 1 THEN excluded.refills_timestamp ELSE member_lifestyle_stat_snapshots.refills_timestamp END,
      useractivity_timestamp = CASE WHEN excluded.personal_ready = 1 THEN excluded.useractivity_timestamp ELSE member_lifestyle_stat_snapshots.useractivity_timestamp END,
      networth_timestamp = CASE WHEN excluded.personal_ready = 1 THEN excluded.networth_timestamp ELSE member_lifestyle_stat_snapshots.networth_timestamp END,
      daysbeendonator_timestamp = CASE WHEN excluded.personal_ready = 1 THEN excluded.daysbeendonator_timestamp ELSE member_lifestyle_stat_snapshots.daysbeendonator_timestamp END,
      personalstats_bucket_date = CASE WHEN excluded.personal_ready = 1 THEN excluded.personalstats_bucket_date ELSE member_lifestyle_stat_snapshots.personalstats_bucket_date END,
      personalstats_requested_at = CASE WHEN excluded.personal_ready = 1 THEN excluded.personalstats_requested_at ELSE member_lifestyle_stat_snapshots.personalstats_requested_at END,
      personalstats_key_source = CASE WHEN excluded.personal_ready = 1 THEN excluded.personalstats_key_source ELSE member_lifestyle_stat_snapshots.personalstats_key_source END,
      validation_error = CASE
        WHEN excluded.personal_ready = 1 THEN NULL
        WHEN excluded.validation_error IS NOT NULL THEN excluded.validation_error
        WHEN member_lifestyle_stat_snapshots.personal_ready = 1 THEN member_lifestyle_stat_snapshots.validation_error
        ELSE NULL
      END,
      gymenergy = CASE WHEN excluded.gym_ready = 1 THEN excluded.gymenergy ELSE member_lifestyle_stat_snapshots.gymenergy END,
      gymstrength = CASE WHEN excluded.gym_ready = 1 THEN excluded.gymstrength ELSE member_lifestyle_stat_snapshots.gymstrength END,
      gymspeed = CASE WHEN excluded.gym_ready = 1 THEN excluded.gymspeed ELSE member_lifestyle_stat_snapshots.gymspeed END,
      gymdefense = CASE WHEN excluded.gym_ready = 1 THEN excluded.gymdefense ELSE member_lifestyle_stat_snapshots.gymdefense END,
      gymdexterity = CASE WHEN excluded.gym_ready = 1 THEN excluded.gymdexterity ELSE member_lifestyle_stat_snapshots.gymdexterity END,
      personal_captured_at = CASE WHEN excluded.personal_ready = 1 THEN excluded.personal_captured_at ELSE member_lifestyle_stat_snapshots.personal_captured_at END,
      gym_captured_at = CASE WHEN excluded.gym_ready = 1 THEN excluded.gym_captured_at ELSE member_lifestyle_stat_snapshots.gym_captured_at END,
      gym_error = CASE WHEN excluded.gym_ready = 1 THEN excluded.gym_error ELSE member_lifestyle_stat_snapshots.gym_error END,
      personal_ready = CASE WHEN excluded.personal_ready = 1 THEN 1 ELSE member_lifestyle_stat_snapshots.personal_ready END,
      gym_ready = CASE WHEN excluded.gym_ready = 1 THEN 1 ELSE member_lifestyle_stat_snapshots.gym_ready END,
      fully_ready = CASE
        WHEN (CASE WHEN excluded.personal_ready = 1 THEN 1 ELSE member_lifestyle_stat_snapshots.personal_ready END) = 1
          AND (CASE WHEN excluded.gym_ready = 1 THEN 1 ELSE member_lifestyle_stat_snapshots.gym_ready END) = 1
          AND (CASE WHEN excluded.gym_ready = 1 THEN excluded.gym_error ELSE member_lifestyle_stat_snapshots.gym_error END) IS NULL
        THEN 1
        ELSE 0
      END,
      captured_at = excluded.captured_at
    `,
  )
    .bind(snapshotDate, freshAfter, freshAfter, snapshotDate, freshAfter, freshAfter, allowPartialGym, snapshotDate, HOME_FACTION_ID)
    .run();
}

