import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const REMOVED_INDEXES = [
  "idx_enemy_hit_stat_snapshots_member ON enemy_hit_stat_snapshots(war_id, faction_id, member_id, snapshot_date)",
  "idx_member_lifestyle_xantaken_rechecks_member_date ON member_lifestyle_xantaken_rechecks(member_id, snapshot_date)",
  "idx_war_control_snapshots_war_created ON war_control_snapshots(war_id, created_at DESC)",
  "idx_member_lifestyle_repair_items_status ON member_lifestyle_repair_items(status, updated_at)",
  "idx_retaliation_opportunities_expires ON retaliation_opportunities(expires_at)",
  "idx_retaliation_claim_signals_expires ON retaliation_claim_signals(expires_at)",
  "idx_retaliation_claim_signals_target ON retaliation_claim_signals(target_id, updated_at DESC)",
];

it("removes the legacy board and redundant indexes whether or not the table still exists", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys = ON");
    db.exec(read("schema/current.sql"));
    db.exec("CREATE TABLE retaliation_board_state (id INTEGER PRIMARY KEY)");
    for (const index of REMOVED_INDEXES) db.exec(`CREATE INDEX ${index}`);
    const migration = read("migrations/0204_remove_legacy_board_and_redundant_indexes.sql");

    db.exec(migration);
    // Production reaches this migration with the table already gone.
    db.exec(migration);

    const names = db.prepare("SELECT name FROM sqlite_schema").all().map((row) => row.name);
    expect(names).not.toContain("retaliation_board_state");
    for (const index of REMOVED_INDEXES) expect(names).not.toContain(index.split(" ")[0]);
    expect(names).toContain("idx_retaliation_opportunities_attack_at");
    expect(names).toContain("idx_member_lifestyle_repair_items_job_status");
    expect(names).toContain("sqlite_autoindex_enemy_hit_stat_snapshots_1");
    expect(names).toContain("sqlite_autoindex_member_lifestyle_xantaken_rechecks_1");
  } finally {
    db.close();
  }
});
