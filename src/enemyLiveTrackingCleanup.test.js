import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { clearEnemyLiveTrackingRows } from "./enemyLiveTrackingCleanup";
import { handleEnemyTargetMatched } from "./enemyTargetLifecycle";

it.each([false, true])("retains heatmaps until scouting replacement (tracking restart: %s)", async (restart) => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    sqlite.exec(readFileSync(new URL("../schema/current.sql", import.meta.url), "utf8"));
    sqlite.exec(`
      INSERT INTO wars (id, name, status, practical_start_time, enemy_faction_id)
      VALUES (25, 'Current enemy', 'active', 100, 7002), (26, 'Next enemy', 'scheduled', 200, 8000);
      INSERT INTO enemy_faction_members (member_id, faction_id, name) VALUES (1, 7002, 'Member');
      INSERT INTO enemy_member_live_status (member_id, faction_id, status_state) VALUES (1, 7002, 'Okay');
      INSERT INTO enemy_big_hitters (war_id, faction_id, member_id, member_name) VALUES (25, 7002, 1, 'Member');
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
    const factionSamples = rows("enemy_faction_activity_samples");
    const memberSamples = rows("enemy_member_activity_samples");
    const homeSamples = rows("home_faction_activity_samples");

    const cleanup = await clearEnemyLiveTrackingRows(env, 25, 7002, { resetWarCheckedAt: restart });
    expect(rows("enemy_member_live_status")).toEqual([]);
    expect(rows("enemy_big_hitters")).toEqual([]);
    expect(rows("enemy_faction_members")).toHaveLength(1);
    expect(rows("enemy_faction_activity_samples")).toEqual(factionSamples);
    expect(rows("enemy_member_activity_samples")).toEqual(memberSamples);
    expect(cleanup.enemyActivitySampleRowsDeleted).toBe(0);
    expect(cleanup.writeStatements).toBe(restart ? 6 : 5);
    expect(cleanup.changedRows).toBe(restart ? 3 : 2);

    const replacement = await handleEnemyTargetMatched(env, 8000, {
      warId: 26,
      clearCachedEnemyRoster: true,
      clearHomeComparisonStats: true,
      clearReplaceableHeatmaps: true,
    });
    expect(rows("enemy_faction_members")).toEqual([]);
    expect(rows("enemy_faction_activity_samples")).toEqual([]);
    expect(rows("enemy_member_activity_samples")).toEqual([]);
    expect(replacement.enemyActivitySampleRowsDeleted).toBe(2);
    expect(rows("home_faction_activity_samples")).toEqual(homeSamples);
  } finally {
    sqlite.close();
  }
});
