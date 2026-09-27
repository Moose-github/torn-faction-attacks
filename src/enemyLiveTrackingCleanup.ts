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

  // Keep scouting history and big-hitter selections until roster replacement.

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
  const pushSnapshotRowsDeleted = 0;
  const enemyActivitySampleRowsDeleted = 0;
  const controlSnapshotRowsDeleted = 0;
  const bigHitterRowsDeleted = 0;
  const pushAlertLatchesCleared = d1Changes(pushAlertResult);
  const warCheckedRowsReset = d1Changes(warCheckedResult);

  return {
    writeStatements:
      (clearMemberStatuses ? 1 : 0) +
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
