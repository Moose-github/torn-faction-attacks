import { revokeSessionsForFormerFactionMembers } from "./auth";
import { HOME_FACTION_ID } from "./constants";
import { fetchTornFactionMembers } from "./enemyScouting";
import { Env, TornFactionMember } from "./types";
import { boolToInt, d1Changes, finiteNumber, json } from "./utils";

export type HomeFactionMembershipSyncMetrics = {
  writeStatements: number;
  changedRows: number;
  fetchedMembers: number;
  revokedSessions: number;
  markedDepartedRows: number;
  skipped?: boolean;
  reason?: string;
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
        WHERE home_faction_members.faction_id IS NOT excluded.faction_id
          OR home_faction_members.name IS NOT excluded.name
          OR home_faction_members.level IS NOT excluded.level
          OR home_faction_members.position IS NOT excluded.position
          OR home_faction_members.days_in_faction IS NOT excluded.days_in_faction
          OR home_faction_members.is_revivable IS NOT excluded.is_revivable
          OR home_faction_members.is_current IS NOT 1
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

  const currentMemberIds = validMemberIds(members);
  const markedDepartedRows = await markDepartedHomeFactionMembers(env, currentMemberIds);
  const revokedSessions = await revokeSessionsForFormerFactionMembers(env, currentMemberIds);
  const upsertChangedRows = upsertResults.reduce(
    (total: number, result: unknown) => total + d1Changes(result),
    0,
  );

  return {
    writeStatements: members.length + 2,
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
      COALESCE(SUM(CASE WHEN is_revivable = 1 THEN 1 ELSE 0 END), 0) AS revivable_members,
      COALESCE(SUM(CASE WHEN ff_battlestats IS NOT NULL THEN 1 ELSE 0 END), 0) AS stat_estimates,
      COALESCE(SUM(CASE WHEN networth IS NOT NULL THEN 1 ELSE 0 END), 0) AS networth_estimates,
      MAX(updated_at) AS updated_at
    FROM home_faction_members
    WHERE faction_id = ?
      AND is_current = 1
    `,
  )
    .bind(HOME_FACTION_ID)
    .first()) as {
      current_members?: number | null;
      revivable_members?: number | null;
      stat_estimates?: number | null;
      networth_estimates?: number | null;
      updated_at?: number | null;
    } | null;

  return json({
    ok: true,
    faction_id: HOME_FACTION_ID,
    current_members: Number(row?.current_members ?? 0),
    revivable_members: Number(row?.revivable_members ?? 0),
    stat_estimates: Number(row?.stat_estimates ?? 0),
    networth_estimates: Number(row?.networth_estimates ?? 0),
    updated_at: row?.updated_at ?? null,
  });
}

async function markDepartedHomeFactionMembers(
  env: Env,
  currentMemberIds: number[],
): Promise<number> {
  if (currentMemberIds.length === 0) {
    return 0;
  }

  const result = await env.DB.prepare(
    `
    UPDATE home_faction_members
    SET is_current = 0,
        updated_at = unixepoch()
    WHERE member_id NOT IN (${currentMemberIds.map(() => "?").join(",")})
      AND is_current != 0
    `,
  )
    .bind(...currentMemberIds)
    .run();
  return d1Changes(result);
}

function validMemberIds(members: TornFactionMember[]): number[] {
  return members.map((member) => member.id).filter((id) => Number.isInteger(id) && id > 0);
}
