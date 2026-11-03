import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

it("removes the unused attack indexes and keeps the ones queries force or rely on", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(read("schema/current.sql"));
    db.exec(`
      CREATE INDEX idx_attacks_retaliation_enemy_recent ON attacks(attacker_id, defender_faction_id, started DESC, id DESC);
      CREATE INDEX idx_attacks_chain_watch_hit_at ON attacks (attacker_faction_id, COALESCE(ended, started), id) WHERE chain > 0;
    `);

    db.exec(read("migrations/0205_remove_unused_attack_indexes.sql"));

    const names = db.prepare("SELECT name FROM sqlite_schema WHERE type = 'index'").all().map((row) => row.name);
    expect(names).not.toContain("idx_attacks_retaliation_enemy_recent");
    expect(names).not.toContain("idx_attacks_chain_watch_hit_at");
    for (const kept of [
      "idx_attacks_started",
      "idx_attacks_war_bonus",
      "idx_attacks_event_bonus",
      "idx_attacks_event_attacker_started",
      "idx_attacks_event_defender_started",
      "idx_attacks_retaliation_claim_recent",
      "idx_attacks_retaliation_openings",
      "idx_attacks_successful_hit_at",
    ]) {
      expect(names).toContain(kept);
    }

    const chainQuery = `SELECT id FROM attacks WHERE attacker_faction_id = ?
      AND result IN ('Hospitalized','Mugged','Attacked','Arrested') AND chain > 0
      AND COALESCE(ended, started) > ? ORDER BY COALESCE(ended, started), id LIMIT 1`;
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${chainQuery}`).all().map((row) => row.detail).join(" ");
    expect(plan).toContain("idx_attacks_successful_hit_at");
  } finally {
    db.close();
  }
});
