import { revokeSessionsForFormerFactionMembers } from "./auth";
import { bumpGlobalWarCacheVersion, bumpMemberLifestyleCacheVersion } from "./cacheVersions";
import { HOME_FACTION_ID } from "./constants";
import { fetchTornFactionMembers } from "./enemyScouting";
import {
  markDepartedHomeFactionMembers,
  upsertHomeFactionMemberRoster,
  validMemberIds,
} from "./homeFactionRoster";
import {
  HOME_MEMBER_LIVE_STATUS_TABLE,
  upsertMemberRevivableStatus,
} from "./memberLiveStatus";
import { Env } from "./types";
import { boolToInt, d1Changes, effectiveRevivableStatus, json } from "./utils";

export type HomeFactionMembershipSyncMetrics = {
  writeStatements: number;
  changedRows: number;
  fetchedMembers: number;
  revokedSessions: number;
  markedDepartedRows: number;
  skipped?: boolean;
  reason?: string;
};

type HomeFactionReportExemptionRow = {
  member_id: number;
  name: string;
  position: string | null;
  is_current: number;
  report_exempt: number;
  report_exempt_reason: string | null;
  report_exempt_updated_at: number | null;
};

export async function syncHomeFactionMembershipAndSessions(
  env: Env,
): Promise<HomeFactionMembershipSyncMetrics> {
  const members = await fetchTornFactionMembers(env, HOME_FACTION_ID);
  if (members.length === 0) {
    return {
      writeStatements: 0,
      changedRows: 0,
      fetchedMembers: 0,
      revokedSessions: 0,
      markedDepartedRows: 0,
      skipped: true,
      reason: "Torn returned no home faction members",
    };
  }

  const upsertResults = await env.DB.batch(
    members.flatMap((member) => [
      upsertHomeFactionMemberRoster(env, member),
      upsertMemberRevivableStatus(
        env,
        HOME_MEMBER_LIVE_STATUS_TABLE,
        member.id,
        HOME_FACTION_ID,
        boolToInt(effectiveRevivableStatus(member) ?? false),
      ),
    ]),
  );

  const currentMemberIds = validMemberIds(members);
  const markedDepartedRows = await markDepartedHomeFactionMembers(env, currentMemberIds);
  const revokedSessions = await revokeSessionsForFormerFactionMembers(env, currentMemberIds);
  const upsertChangedRows = upsertResults.reduce(
    (total: number, result: unknown) => total + d1Changes(result),
    0,
  );

  return {
    writeStatements: members.length * 2 + 2,
    changedRows: upsertChangedRows + markedDepartedRows + revokedSessions,
    fetchedMembers: members.length,
    revokedSessions,
    markedDepartedRows,
  };
}

export async function getCurrentHomeFactionMemberSummary(env: Env): Promise<Response> {
  const row = (await env.DB.prepare(
    `
    SELECT
      COUNT(*) AS current_members,
      COALESCE(SUM(CASE WHEN report_exempt = 0 THEN 1 ELSE 0 END), 0) AS reportable_members,
      COALESCE(SUM(CASE WHEN report_exempt = 1 THEN 1 ELSE 0 END), 0) AS report_exempt_members,
      COALESCE(SUM(CASE WHEN live.is_revivable = 1 THEN 1 ELSE 0 END), 0) AS revivable_members,
      COALESCE(SUM(CASE WHEN ff_battlestats IS NOT NULL THEN 1 ELSE 0 END), 0) AS stat_estimates,
      COALESCE(SUM(CASE WHEN networth IS NOT NULL THEN 1 ELSE 0 END), 0) AS networth_estimates,
      MAX(members.updated_at) AS updated_at
    FROM home_faction_members members
    LEFT JOIN home_member_live_status live
      ON live.member_id = members.member_id
     AND live.faction_id = members.faction_id
    WHERE members.faction_id = ?
      AND members.is_current = 1
    `,
  )
    .bind(HOME_FACTION_ID)
    .first()) as {
      current_members?: number | null;
      reportable_members?: number | null;
      report_exempt_members?: number | null;
      revivable_members?: number | null;
      stat_estimates?: number | null;
      networth_estimates?: number | null;
      updated_at?: number | null;
    } | null;

  return json({
    ok: true,
    faction_id: HOME_FACTION_ID,
    current_members: Number(row?.current_members ?? 0),
    reportable_members: Number(row?.reportable_members ?? 0),
    report_exempt_members: Number(row?.report_exempt_members ?? 0),
    revivable_members: Number(row?.revivable_members ?? 0),
    stat_estimates: Number(row?.stat_estimates ?? 0),
    networth_estimates: Number(row?.networth_estimates ?? 0),
    updated_at: row?.updated_at ?? null,
  });
}

export async function listHomeFactionReportExemptions(env: Env): Promise<Response> {
  const rows = ((await env.DB.prepare(
    `
    SELECT
      member_id,
      name,
      position,
      is_current,
      report_exempt,
      report_exempt_reason,
      report_exempt_updated_at
    FROM home_faction_members
    WHERE faction_id = ?
      AND (is_current = 1 OR report_exempt = 1)
    ORDER BY report_exempt DESC, is_current DESC, LOWER(name), member_id
    `,
  )
    .bind(HOME_FACTION_ID)
    .all()).results ?? []) as HomeFactionReportExemptionRow[];

  return json({
    ok: true,
    faction_id: HOME_FACTION_ID,
    members: rows,
  });
}

export async function updateHomeFactionReportExemption(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as {
    member_id?: unknown;
    report_exempt?: unknown;
    reason?: unknown;
  };
  const memberId = Number(body.member_id);
  if (!Number.isInteger(memberId) || memberId <= 0) {
    return json({ ok: false, error: "A valid member_id is required", code: "INVALID_MEMBER_ID" }, 400);
  }

  const member = (await env.DB.prepare(
    `
    SELECT member_id
    FROM home_faction_members
    WHERE member_id = ?
      AND faction_id = ?
    LIMIT 1
    `,
  )
    .bind(memberId, HOME_FACTION_ID)
    .first()) as { member_id: number } | null;
  if (!member) {
    return json({ ok: false, error: "Member is not known in the home faction roster", code: "MEMBER_NOT_FOUND" }, 404);
  }

  const reportExempt = body.report_exempt === true || body.report_exempt === 1 || body.report_exempt === "1";
  const reason = typeof body.reason === "string" && body.reason.trim().length > 0
    ? body.reason.trim().slice(0, 240)
    : null;

  await env.DB.prepare(
    `
    UPDATE home_faction_members
    SET report_exempt = ?,
        report_exempt_reason = ?,
        report_exempt_updated_at = unixepoch(),
        updated_at = unixepoch()
    WHERE member_id = ?
      AND faction_id = ?
    `,
  )
    .bind(reportExempt ? 1 : 0, reportExempt ? reason : null, memberId, HOME_FACTION_ID)
    .run();

  await Promise.all([
    bumpMemberLifestyleCacheVersion(env),
    bumpGlobalWarCacheVersion(env),
  ]);
  return listHomeFactionReportExemptions(env);
}
