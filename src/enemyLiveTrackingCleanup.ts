import { ENEMY_PUSH_ALERT_STATE_PREFIX } from "./discordAlertSettings";
import { clearSyncLatchesByPrefix } from "./syncLatches";
import { Env } from "./types";
import { d1Changes } from "./utils";

export type EnemyLiveTrackingCleanupMetrics = {
  writeStatements: number;
  changedRows: number;
  memberStatusRowsCleared: number;
  pushSnapshotRowsDeleted: number;
  enemyActivitySampleRowsDeleted: number;
  controlSnapshotRowsDeleted: number;
  bigHitterRowsDeleted: number;
  pushAlertLatchesCleared: number;
  warCheckedRowsReset: number;
};

export async function clearEnemyLiveTrackingRows(
  env: Env,
  warId: number,
  factionId: number,
  options: { clearMemberStatuses?: boolean; resetWarCheckedAt?: boolean } = {},
): Promise<EnemyLiveTrackingCleanupMetrics> {
  const clearMemberStatuses = options.clearMemberStatuses !== false;
  const memberResult = clearMemberStatuses
    ? await env.DB.prepare(
        `
        UPDATE enemy_faction_members
        SET is_revivable = NULL,
            status_state = NULL,
            status_description = NULL,
            last_action_status = NULL,
            last_action_timestamp = NULL,
            plane_image_type = NULL,
            travel_origin = NULL,
            travel_destination = NULL,
            travel_signature = NULL,
            travel_detected_at = NULL,
            travel_started_after = NULL,
            travel_started_before = NULL,
            estimated_arrival_at = NULL,
            estimated_arrival_earliest = NULL,
            estimated_arrival_latest = NULL,
            travel_trip_destination = NULL,
            travel_trip_type = NULL,
            travel_trip_inferred_at = NULL,
            status_updated_at = NULL,
            updated_at = unixepoch()
        WHERE faction_id = ?
          AND (
            is_revivable IS NOT NULL OR
            status_state IS NOT NULL OR
            status_description IS NOT NULL OR
            last_action_status IS NOT NULL OR
            last_action_timestamp IS NOT NULL OR
            plane_image_type IS NOT NULL OR
            travel_origin IS NOT NULL OR
            travel_destination IS NOT NULL OR
            travel_signature IS NOT NULL OR
            travel_detected_at IS NOT NULL OR
            travel_started_after IS NOT NULL OR
            travel_started_before IS NOT NULL OR
            estimated_arrival_at IS NOT NULL OR
            estimated_arrival_earliest IS NOT NULL OR
            estimated_arrival_latest IS NOT NULL OR
            travel_trip_destination IS NOT NULL OR
            travel_trip_type IS NOT NULL OR
            travel_trip_inferred_at IS NOT NULL OR
            status_updated_at IS NOT NULL
          )
        `,
      )
        .bind(factionId)
        .run()
    : null;

  const pushSnapshotResult = await env.DB.prepare(
    `
    DELETE FROM enemy_push_activity_snapshots
    WHERE war_id = ?
    `,
  )
    .bind(warId)
    .run();

  const memberSampleResult = await env.DB.prepare(
    `
    DELETE FROM enemy_member_activity_samples
    WHERE war_id = ?
    `,
  )
    .bind(warId)
    .run();

  const factionSampleResult = await env.DB.prepare(
    `
    DELETE FROM enemy_faction_activity_samples
    WHERE war_id = ?
    `,
  )
    .bind(warId)
    .run();

  const controlSnapshotResult = await env.DB.prepare(
    `
    DELETE FROM war_control_snapshots
    WHERE war_id = ?
    `,
  )
    .bind(warId)
    .run();

  const bigHitterResult = await env.DB.prepare(
    `
    DELETE FROM enemy_big_hitters
    WHERE war_id = ?
    `,
  )
    .bind(warId)
    .run();

  const pushAlertResult = await clearSyncLatchesByPrefix(
    env,
    `${ENEMY_PUSH_ALERT_STATE_PREFIX}:${warId}:`,
  );

  const warCheckedResult = options.resetWarCheckedAt
    ? await env.DB.prepare(
        `
        UPDATE wars
        SET enemy_scouting_status_checked_at = NULL
        WHERE id = ?
        `,
      )
        .bind(warId)
        .run()
    : null;

  const memberStatusRowsCleared = d1Changes(memberResult);
  const pushSnapshotRowsDeleted = d1Changes(pushSnapshotResult);
  const enemyActivitySampleRowsDeleted =
    d1Changes(memberSampleResult) + d1Changes(factionSampleResult);
  const controlSnapshotRowsDeleted = d1Changes(controlSnapshotResult);
  const bigHitterRowsDeleted = d1Changes(bigHitterResult);
  const pushAlertLatchesCleared = d1Changes(pushAlertResult);
  const warCheckedRowsReset = d1Changes(warCheckedResult);

  return {
    writeStatements:
      (clearMemberStatuses ? 1 : 0) +
      5 +
      1 +
      (options.resetWarCheckedAt ? 1 : 0),
    changedRows:
      memberStatusRowsCleared +
      pushSnapshotRowsDeleted +
      enemyActivitySampleRowsDeleted +
      controlSnapshotRowsDeleted +
      bigHitterRowsDeleted +
      pushAlertLatchesCleared +
      warCheckedRowsReset,
    memberStatusRowsCleared,
    pushSnapshotRowsDeleted,
    enemyActivitySampleRowsDeleted,
    controlSnapshotRowsDeleted,
    bigHitterRowsDeleted,
    pushAlertLatchesCleared,
    warCheckedRowsReset,
  };
}
