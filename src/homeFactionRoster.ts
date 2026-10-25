import { HOME_FACTION_ID } from "./constants";
import { Env, TornFactionMember } from "./types";
import { d1Changes, finiteNumber } from "./utils";

// Shared by every job that syncs the home roster from a Torn member list, so
// the upsert and departure rules cannot drift between callers.

/** Upserts a current home member, writing only when its roster fields changed. */
export function upsertHomeFactionMemberRoster(env: Env, member: TornFactionMember): D1PreparedStatement {
  return env.DB.prepare(
    `
    INSERT INTO home_faction_members (
      member_id,
      faction_id,
      name,
      level,
      position,
      days_in_faction,
      is_current,
      current_join_date,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, 1, date('now'), unixepoch())
    ON CONFLICT(member_id) DO UPDATE SET
      faction_id = excluded.faction_id,
      name = excluded.name,
      level = excluded.level,
      position = excluded.position,
      days_in_faction = excluded.days_in_faction,
      current_join_date = CASE
        WHEN home_faction_members.is_current = 0 THEN excluded.current_join_date
        ELSE COALESCE(home_faction_members.current_join_date, excluded.current_join_date)
      END,
      is_current = 1,
      updated_at = excluded.updated_at
    WHERE home_faction_members.faction_id IS NOT excluded.faction_id
      OR home_faction_members.name IS NOT excluded.name
      OR home_faction_members.level IS NOT excluded.level
      OR home_faction_members.position IS NOT excluded.position
      OR home_faction_members.days_in_faction IS NOT excluded.days_in_faction
      OR (home_faction_members.current_join_date IS NULL AND excluded.current_join_date IS NOT NULL)
      OR home_faction_members.is_current IS NOT 1
    `,
  ).bind(
    member.id,
    HOME_FACTION_ID,
    member.name,
    finiteNumber(member.level),
    member.position ?? null,
    finiteNumber(member.days_in_faction),
  );
}

export function validMemberIds(members: TornFactionMember[]): number[] {
  return members.map((member) => member.id).filter((id) => Number.isInteger(id) && id > 0);
}

/** Marks members missing from the latest roster as departed; returns how many changed. */
export async function markDepartedHomeFactionMembers(
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

  await env.DB.prepare(
    `
    DELETE FROM home_member_live_status
    WHERE faction_id = ?
      AND member_id NOT IN (${currentMemberIds.map(() => "?").join(",")})
    `,
  )
    .bind(HOME_FACTION_ID, ...currentMemberIds)
    .run();

  return d1Changes(result);
}
