import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

it("removes unused schema while keeping shared items, live indexes and current sync state", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys = ON");
    db.exec(read("schema/current.sql"));
    db.exec(`
      ALTER TABLE ingestion_runs ADD COLUMN heatmap_finished_at INTEGER;
      ALTER TABLE wars ADD COLUMN auto_end_enabled INTEGER NOT NULL DEFAULT 0;
      CREATE TABLE retaliation_board_state (id INTEGER PRIMARY KEY, discord_message_id TEXT);
      CREATE TABLE item_groups (id TEXT PRIMARY KEY);
      CREATE TABLE item_group_items (group_id TEXT NOT NULL REFERENCES item_groups(id) ON DELETE CASCADE,
        torn_item_id INTEGER NOT NULL REFERENCES torn_items(torn_item_id));
      CREATE INDEX idx_attacks_war_ingest_run ON attacks(war_id, ingest_run_id);
      INSERT INTO torn_items(torn_item_id, name) VALUES (530, 'Can');
      INSERT INTO item_groups(id) VALUES ('energy_cans');
      INSERT INTO item_group_items(group_id, torn_item_id) VALUES ('energy_cans', 530);
      INSERT INTO wars(id, name, status, practical_start_time, auto_end_enabled) VALUES (1, 'Kept war', 'ended', 1, 1);
      INSERT INTO ingestion_runs(id, trigger_source, started_at) VALUES ('run', 'cron', 1);
      INSERT INTO sync_state(name, last_started) VALUES
        ('member_lifestyle_stats_refresh', 1),
        ('member_lifestyle_stats_stale_discord_alert', 1),
        ('member_personal_stats_current_daily', 1),
        ('member_personal_stats_current_daily_lock', 1),
        ('member_personal_stats_current_daily_reset', 1),
        ('enemy_travel_cleared:7', 1),
        ('enemyXtravelXcleared:7', 1),
        ('member_personal_stats_recent_daily', 1);
    `);

    db.exec(read("migrations/0203_remove_unused_schema.sql"));

    const names = db.prepare("SELECT name FROM sqlite_schema").all().map((row) => row.name);
    for (const removed of ["retaliation_board_state", "item_groups", "item_group_items", "idx_attacks_war_ingest_run"]) {
      expect(names).not.toContain(removed);
    }
    expect(names).toContain("idx_attacks_war_started");
    expect(names).toContain("idx_member_lifestyle_snapshots_personal_ready_latest");
    const columns = (table: string) => db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all().map((row) => row.name);
    expect(columns("ingestion_runs")).not.toContain("heatmap_finished_at");
    expect(columns("wars")).not.toContain("auto_end_enabled");
    expect(db.prepare("SELECT name FROM wars").all()).toEqual([{ name: "Kept war" }]);
    expect(db.prepare("SELECT id FROM ingestion_runs").all()).toEqual([{ id: "run" }]);
    expect(db.prepare("SELECT torn_item_id FROM torn_items").all()).toEqual([{ torn_item_id: 530 }]);
    expect(db.prepare("SELECT name FROM sync_state ORDER BY name").all()).toEqual([
      { name: "enemyXtravelXcleared:7" },
      { name: "member_personal_stats_recent_daily" },
    ]);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    db.close();
  }
});
