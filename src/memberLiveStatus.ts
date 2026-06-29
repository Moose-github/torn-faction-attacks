import type { Env } from "./types";

export const HOME_MEMBER_LIVE_STATUS_TABLE = "home_member_live_status";
export const ENEMY_MEMBER_LIVE_STATUS_TABLE = "enemy_member_live_status";

export type MemberLiveStatusTable =
  | typeof HOME_MEMBER_LIVE_STATUS_TABLE
  | typeof ENEMY_MEMBER_LIVE_STATUS_TABLE;

export type MemberLiveStatusSnapshot = {
  member_id: number;
  faction_id: number;
  is_revivable: number | null;
  status_state: string | null;
  status_description: string | null;
  last_action_status: string | null;
  last_action_timestamp: number | null;
  plane_image_type: string | null;
  travel_origin: string | null;
  travel_destination: string | null;
  travel_signature: string | null;
  travel_detected_at: number | null;
  travel_started_after: number | null;
  travel_started_before: number | null;
  estimated_arrival_at: number | null;
  estimated_arrival_earliest: number | null;
  estimated_arrival_latest: number | null;
  travel_trip_destination: string | null;
  travel_trip_type: string | null;
  travel_trip_inferred_at: number | null;
  status_updated_at: number | null;
};

export const MEMBER_LIVE_STATUS_SELECT_COLUMNS = `
  live.is_revivable,
  live.status_state,
  live.status_description,
  live.last_action_status,
  live.last_action_timestamp,
  live.plane_image_type,
  live.travel_origin,
  live.travel_destination,
  live.travel_signature,
  live.travel_detected_at,
  live.travel_started_after,
  live.travel_started_before,
  live.estimated_arrival_at,
  live.estimated_arrival_earliest,
  live.estimated_arrival_latest,
  live.travel_trip_destination,
  live.travel_trip_type,
  live.travel_trip_inferred_at,
  live.status_updated_at
`;

export function upsertMemberLiveStatus(
  env: Env,
  tableName: MemberLiveStatusTable,
  snapshot: MemberLiveStatusSnapshot,
): D1PreparedStatement {
  return env.DB.prepare(
    `
    INSERT INTO ${tableName} (
      member_id,
      faction_id,
      is_revivable,
      status_state,
      status_description,
      last_action_status,
      last_action_timestamp,
      plane_image_type,
      travel_origin,
      travel_destination,
      travel_signature,
      travel_detected_at,
      travel_started_after,
      travel_started_before,
      estimated_arrival_at,
      estimated_arrival_earliest,
      estimated_arrival_latest,
      travel_trip_destination,
      travel_trip_type,
      travel_trip_inferred_at,
      status_updated_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
    ON CONFLICT(member_id) DO UPDATE SET
      faction_id = excluded.faction_id,
      is_revivable = excluded.is_revivable,
      status_state = excluded.status_state,
      status_description = excluded.status_description,
      last_action_status = excluded.last_action_status,
      last_action_timestamp = excluded.last_action_timestamp,
      plane_image_type = excluded.plane_image_type,
      travel_origin = excluded.travel_origin,
      travel_destination = excluded.travel_destination,
      travel_signature = excluded.travel_signature,
      travel_detected_at = excluded.travel_detected_at,
      travel_started_after = excluded.travel_started_after,
      travel_started_before = excluded.travel_started_before,
      estimated_arrival_at = excluded.estimated_arrival_at,
      estimated_arrival_earliest = excluded.estimated_arrival_earliest,
      estimated_arrival_latest = excluded.estimated_arrival_latest,
      travel_trip_destination = excluded.travel_trip_destination,
      travel_trip_type = excluded.travel_trip_type,
      travel_trip_inferred_at = excluded.travel_trip_inferred_at,
      status_updated_at = excluded.status_updated_at,
      updated_at = excluded.updated_at
    `,
  ).bind(
    snapshot.member_id,
    snapshot.faction_id,
    snapshot.is_revivable,
    snapshot.status_state,
    snapshot.status_description,
    snapshot.last_action_status,
    snapshot.last_action_timestamp,
    snapshot.plane_image_type,
    snapshot.travel_origin,
    snapshot.travel_destination,
    snapshot.travel_signature,
    snapshot.travel_detected_at,
    snapshot.travel_started_after,
    snapshot.travel_started_before,
    snapshot.estimated_arrival_at,
    snapshot.estimated_arrival_earliest,
    snapshot.estimated_arrival_latest,
    snapshot.travel_trip_destination,
    snapshot.travel_trip_type,
    snapshot.travel_trip_inferred_at,
    snapshot.status_updated_at,
  );
}

export function upsertMemberRevivableStatus(
  env: Env,
  tableName: MemberLiveStatusTable,
  memberId: number,
  factionId: number,
  isRevivable: number | null,
): D1PreparedStatement {
  return env.DB.prepare(
    `
    INSERT INTO ${tableName} (
      member_id,
      faction_id,
      is_revivable,
      updated_at
    )
    VALUES (?, ?, ?, unixepoch())
    ON CONFLICT(member_id) DO UPDATE SET
      faction_id = excluded.faction_id,
      is_revivable = excluded.is_revivable,
      updated_at = excluded.updated_at
    WHERE ${tableName}.faction_id IS NOT excluded.faction_id
       OR ${tableName}.is_revivable IS NOT excluded.is_revivable
    `,
  ).bind(memberId, factionId, isRevivable);
}

export function deleteStaleMemberLiveStatus(
  env: Env,
  tableName: MemberLiveStatusTable,
  factionId: number,
  memberIds: number[],
): D1PreparedStatement {
  return env.DB.prepare(
    `
    DELETE FROM ${tableName}
    WHERE faction_id = ?
      AND member_id NOT IN (${memberIds.map(() => "?").join(",")})
    `,
  ).bind(factionId, ...memberIds);
}
