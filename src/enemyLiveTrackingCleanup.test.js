import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { clearEnemyLiveTrackingRows } from "./enemyLiveTrackingCleanup";
import { handleEnemyTargetMatched } from "./enemyTargetLifecycle";

it.each([false, true])("retains enemy history until scouting replacement (tracking restart: %s)", async (restart) => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    sqlite.exec(readFileSync(new URL("../schema/current.sql", import.meta.url), "utf8"));
    sqlite.exec(`
      INSERT INTO wars (id, name, status, practical_start_time, enemy_faction_id)
      VALUES (25, 'Current enemy', 'active', 100, 7002), (26, 'Next enemy', 'scheduled', 200, 8000);
      INSERT INTO enemy_faction_members (member_id, faction_id, name) VALUES (1, 7002, 'Member');
      INSERT INTO enemy_member_live_status (member_id, faction_id, status_state) VALUES (1, 7002, 'Okay');
      INSERT INTO enemy_big_hitters (war_id, faction_id, member_id, member_name) VALUES (25, 7002, 1, 'Member');
      INSERT INTO enemy_push_activity_snapshots
        (war_id, faction_id, bucket_start, total_members, online_count, idle_count, offline_count,
         recently_active_count, offline_idle_to_online_count, hospital_count, revivable_count, pressure_level)
      VALUES (25, 7002, 100, 1, 1, 0, 0, 1, 1, 0, 1, 'low');
      INSERT INTO war_control_snapshots
        (war_id, bucket_start, control_state, control_confidence, control_reason)
      VALUES (25, 100, 'neutral', 1, 'test');
      INSERT INTO enemy_hit_stat_snapshots
        (war_id, faction_id, member_id, member_name, snapshot_date, snapshot_kind)
      VALUES (25, 7002, 1, 'Member', '2026-09-27', 'current');
      INSERT INTO enemy_faction_activity_samples VALUES (25, 7002, '2026-09-27', 0, 1, 1, 100);
      INSERT INTO enemy_member_activity_samples
        (war_id, faction_id, member_id, member_name, date, interval_index, is_recently_active, sampled_at)
      VALUES (25, 7002, 1, 'Member', '2026-09-27', 0, 1, 100);
      INSERT INTO home_faction_activity_samples VALUES (999, '2026-09-27', 0, 1, 1, 100);
    `);
    const env = {
      DB: {
        prepare(sql) {
          let values = [];
          return {
            bind(...params) { values = params; return this; },
            async run() {
              const result = sqlite.prepare(sql).run(...values);
              return { success: true, meta: { changes: Number(result.changes) } };
            },
          };
        },
      },
    };
    const rows = (table) => sqlite.prepare(`SELECT * FROM ${table}`).all();
    const retainedTables = [
      "enemy_faction_members", "enemy_hit_stat_snapshots", "enemy_faction_activity_samples",
      "enemy_member_activity_samples", "enemy_push_activity_snapshots", "war_control_snapshots", "enemy_big_hitters",
    ];
    const retainedRows = new Map(retainedTables.map((table) => [table, rows(table)]));
    const homeSamples = rows("home_faction_activity_samples");

    // Merely resetting fill state must not be a second history-cleanup trigger.
    await handleEnemyTargetMatched(env, 7002, { warId: 25 });
    const cleanup = await clearEnemyLiveTrackingRows(env, 25, 7002, { resetWarCheckedAt: restart });
    expect(rows("enemy_member_live_status")).toEqual([]);
    for (const table of retainedTables) expect(rows(table)).toEqual(retainedRows.get(table));
    expect(cleanup).toMatchObject({
      enemyActivitySampleRowsDeleted: 0, pushSnapshotRowsDeleted: 0,
      controlSnapshotRowsDeleted: 0, bigHitterRowsDeleted: 0,
      writeStatements: restart ? 3 : 2, changedRows: restart ? 2 : 1,
    });
    // Official-end cleanup after practical finish also preserves the same data.
    await clearEnemyLiveTrackingRows(env, 25, 7002);
    for (const table of retainedTables) expect(rows(table)).toEqual(retainedRows.get(table));

    const replacement = await handleEnemyTargetMatched(env, 8000, {
      warId: 26,
      clearCachedEnemyRoster: true,
      clearHomeComparisonStats: true,
    });
    for (const table of retainedTables) expect(rows(table)).toEqual([]);
    expect(replacement).toMatchObject({
      enemyRosterRowsDeleted: 1, enemyHitStatRowsDeleted: 1,
      enemyActivitySampleRowsDeleted: 2, enemyPushRowsDeleted: 1,
      enemyControlRowsDeleted: 1, enemyBigHitterRowsDeleted: 1,
    });
    expect(rows("home_faction_activity_samples")).toEqual(homeSamples);
  } finally {
    sqlite.close();
  }
});
