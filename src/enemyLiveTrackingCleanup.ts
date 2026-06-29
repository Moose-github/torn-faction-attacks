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
        DELETE FROM enemy_member_live_status
        WHERE faction_id = ?
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
