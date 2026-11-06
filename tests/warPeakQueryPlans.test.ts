import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterAll, describe, expect, it } from "vitest";
import { warningStillActiveSql } from "../src/chainWatchWarningTargets";
import { HOME_FACTION_ID } from "../src/constants";
import { PHASE_SCORE_ROWS_SQL } from "../src/practicalPhases";
import { WAR_CHAIN_BONUSES_SQL } from "../src/warQueries";

// These three queries read 76k-85k rows per run during the 2026-11-05 war
// because each picked an index bounded only by faction. Guard the plans.
const db = new DatabaseSync(":memory:");
db.exec(readFileSync(new URL("../schema/current.sql", import.meta.url), "utf8"));
afterAll(() => db.close());

function plan(sql: string): string[] {
  return (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as Array<{ detail: string }>).map((row) => row.detail);
}

function insertAttack(values: Record<string, unknown>): void {
  const columns = Object.keys(values);
  db.prepare(`INSERT INTO attacks (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`)
    .run(...(Object.values(values) as never[]));
}

describe("war peak query plans", () => {
  it("reads chain bonuses from the war and event bonus indexes", () => {
    const details = plan(WAR_CHAIN_BONUSES_SQL);
    expect(details.some((d) => d.includes("USING INDEX idx_attacks_war_bonus (war_id=?)"))).toBe(true);
    expect(details.some((d) => d.includes("USING INDEX idx_attacks_event_bonus (event_id=?)"))).toBe(true);
    expect(details.some((d) => d.includes("idx_attacks_successful_hit_at"))).toBe(false);
  });

  it("bounds phase score rows on both sides of the hit time", () => {
    expect(plan(PHASE_SCORE_ROWS_SQL).join(" ")).toMatch(/attacker_faction_id=\? AND <expr>>\? AND <expr><\?/);
  });

  it("bounds the saving-attack check on both sides of the hit time", () => {
    for (const stage of ["warning_60", "warning_30"] as const) {
      expect(plan(warningStillActiveSql(stage)).join(" "))
        .toMatch(/SEARCH a USING INDEX \w+ \(attacker_faction_id=\? AND <expr>>\? AND <expr><\?\)/);
    }
  });

  it("keeps the chain bonus results of the war and event branches", () => {
    db.exec(`INSERT INTO wars (id, name, status, war_type, enemy_faction_id, practical_start_time)
      VALUES (900, 'Plan war', 'active', 'real', 77, 1000), (901, 'Plan event', 'active', 'event', NULL, 1350)`);
    const base = { attacker_faction_id: HOME_FACTION_ID, result: "Hospitalized", respect_gain: 1, respect_loss: 0 };
    insertAttack({ ...base, id: 1, code: "a", war_id: 900, defender_faction_id: 77, started: 1100, ended: 1101, chain: 25 });
    insertAttack({ ...base, id: 2, code: "b", war_id: 900, defender_faction_id: 77, started: 1200, ended: 1201, chain: 26 });
    insertAttack({ ...base, id: 3, code: "c", war_id: 900, defender_faction_id: 88, started: 1300, ended: 1301, chain: 50 });
    insertAttack({ ...base, id: 4, code: "d", event_id: 901, defender_faction_id: 88, started: 1400, ended: 1401, chain: 100 });
    insertAttack({ ...base, id: 5, code: "e", event_id: 901, attacker_faction_id: 5, defender_faction_id: 88, started: 1500, ended: 1501, chain: 10 });
    const ids = (warId: number) => (db.prepare(WAR_CHAIN_BONUSES_SQL).all(warId, 25) as Array<{ id: number }>).map((row) => row.id);
    expect(ids(900)).toEqual([1]);
    expect(ids(901)).toEqual([4]);
  });
});
