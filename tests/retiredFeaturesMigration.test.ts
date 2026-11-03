import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

it("removes retired game data while preserving shared catalogue items and groups", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys = ON");
    db.exec(read("schema/current.sql"));
    const packs = read("migrations/0139_add_item_catalog_pack_tables_and_current_trade_items.sql");
    for (const table of ["item_groups", "item_group_items", "pack_definitions", "pack_reward_entries"]) {
      db.exec(packs.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(.*?\\n\\);`, "s"))![0]);
    }
    db.exec(read("migrations/0140_seed_travel_pack_and_item_names.sql"));
    db.exec(read("migrations/0046_add_dice_game_losses.sql"));
    db.exec(`
      INSERT INTO dice_game_losses(torn_user_id, total_lost) VALUES (123, 50);
      INSERT INTO item_groups(id, name, description) VALUES
        ('energy_cans', 'Energy cans', 'Energy can items used by Trade Scout presets and pack rewards.'),
        ('other', 'Other group', 'Keep this group');
      INSERT INTO item_group_items(group_id, torn_item_id) VALUES ('energy_cans', 530), ('other', 258);
    `);
    const itemsBefore = db.prepare("SELECT * FROM torn_items ORDER BY torn_item_id").all();
    const migration = read("migrations/0202_remove_packs_and_dice_game.sql");
    db.exec(migration);
    db.exec(migration);
    expect(db.prepare("SELECT name FROM sqlite_schema WHERE name IN ('pack_definitions', 'pack_reward_entries', 'dice_game_losses', 'idx_dice_game_losses_total_lost')").all()).toEqual([]);
    expect(db.prepare("SELECT * FROM torn_items ORDER BY torn_item_id").all()).toEqual(itemsBefore);
    expect(db.prepare("SELECT group_id, torn_item_id FROM item_group_items ORDER BY group_id").all()).toEqual([
      { group_id: "energy_cans", torn_item_id: 530 },
      { group_id: "other", torn_item_id: 258 },
    ]);
    expect(db.prepare("SELECT id, description FROM item_groups ORDER BY id").all()).toEqual([
      { id: "energy_cans", description: "Energy can items used by Trade Scout presets." },
      { id: "other", description: "Keep this group" },
    ]);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    db.close();
  }
});
