import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getWarProgress, recordRankedWarProgress } from "./warProgress";
import { HOME_FACTION_ID } from "./constants";

let sqlite, env;
const start = 1_800_000;
const at = (hours) => start + hours * 3600;
function ranked(fields = {}) {
  return { id: 88, start, end: 0, target: 7600, winner: null, factions: [
    { id: HOME_FACTION_ID, name: "Home", score: 8200 },
    { id: 123, name: "Enemy", score: 3200 },
  ], ...fields };
}
function state() { return sqlite.prepare("SELECT * FROM war_score_state").get(); }
function history() { return sqlite.prepare("SELECT * FROM war_score_history ORDER BY bucket_start").all(); }
beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  const schema = readFileSync("schema/current.sql", "utf8");
  sqlite.exec(schema.match(/CREATE TABLE wars \([\s\S]*?\n\);/)[0]);
  sqlite.exec(readFileSync("migrations/0163_add_war_score_history.sql", "utf8"));
  sqlite.prepare(`INSERT INTO wars (id, name, status, practical_start_time, official_start_time,
    torn_war_id, war_type, faction_respect_limit, enemy_target_respect)
    VALUES (1, 'test-war', 'active', ?, ?, 88, 'termed', 9700, 3200)`).run(start + 60, start);
  class Statement {
    constructor(sql, values = []) { this.sql = sql; this.values = values; }
    bind(...values) { return new Statement(this.sql, values); }
    execute() { return { results: sqlite.prepare(this.sql).all(...this.values), success: true }; }
    async run() { return this.execute(); }
    async all() { return this.execute(); }
    async first() { return this.execute().results[0] ?? null; }
  }
  env = { DB: {
    prepare: (sql) => new Statement(sql),
    async batch(statements) {
      sqlite.exec("BEGIN");
      try { const result = statements.map((s) => s.execute()); sqlite.exec("COMMIT"); return result; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  } };
});
afterEach(() => sqlite.close());

describe("ranked war score collection", () => {
  it("keeps fresh official scores and one actual observation per 15-minute interval", async () => {
    await recordRankedWarProgress(env, ranked(), at(48) + 5);
    const changed = ranked(); changed.factions[0].score = 8500;
    await recordRankedWarProgress(env, changed, at(48) + 65);
    expect(state()).toMatchObject({ home_score: 8500, observed_at: at(48) + 65, original_target: 10000 });
    expect(history()).toHaveLength(1);
    expect(history()[0]).toMatchObject({ home_score: 8200, observed_at: at(48) + 5 });
    await recordRankedWarProgress(env, changed, at(48) + 905);
    expect(history()).toHaveLength(2);
  });
  it("continues after practical tracking ends, including unchanged scores and target decay", async () => {
    sqlite.prepare("UPDATE wars SET status = 'ended', practical_finish_time = ?").run(at(47));
    await recordRankedWarProgress(env, ranked(), at(48));
    await recordRankedWarProgress(env, ranked({ target: 7500 }), at(49));
    expect(state()).toMatchObject({ original_target: 10000, target: 7500, observed_at: at(49) });
    expect(history()).toHaveLength(2);
    expect(history()[1].bucket_start - history()[0].bucket_start).toBe(3600);
  });
  it("retains the original at zero target and stops recording once officially ended", async () => {
    await recordRankedWarProgress(env, ranked(), at(48));
    await recordRankedWarProgress(env, ranked({ target: 0, end: at(124) }), at(124) + 60);
    expect(state()).toMatchObject({ original_target: 10000, ended_at: at(124), target: 0 });
    expect(history()[1].observed_at).toBe(at(124) + 60);
    await recordRankedWarProgress(env, ranked({ target: 0, end: at(124) }), at(125));
    expect(history()).toHaveLength(2);
    expect(state().observed_at).toBe(at(124) + 60);
  });
  it("captures the original for scheduled wars without inventing pre-war history", async () => {
    await recordRankedWarProgress(env, ranked({ target: 10000 }), start - 60);
    expect(state().original_target).toBe(10000);
    expect(history()).toHaveLength(0);
  });
  it("cannot infer an original from the first observation at zero", async () => {
    await recordRankedWarProgress(env, ranked({ target: 0 }), at(124));
    expect(state().original_target).toBeNull();
  });
  it("skips unrelated wars, events, and malformed scores", async () => {
    await recordRankedWarProgress(env, ranked({ id: 99 }), at(48));
    await recordRankedWarProgress(env, ranked({ target: NaN }), at(48));
    await recordRankedWarProgress(env, ranked({ factions: [] }), at(48));
    sqlite.exec("UPDATE wars SET war_type = 'event'");
    await recordRankedWarProgress(env, ranked(), at(48));
    expect(state()).toBeUndefined();
  });
  it("returns saved targets and separate latest/history data without mutating them", async () => {
    await recordRankedWarProgress(env, ranked(), at(48));
    const response = await getWarProgress(new URL("https://worker.test/api/wars/test-war/progress"), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      war: { faction_respect_limit: 9700, enemy_target_respect: 3200, official_start_time: start },
      latest: { home_score: 8200, enemy_score: 3200, original_target: 10000 }, interval_seconds: 900,
      history: [{ observed_at: at(48), home_score: 8200 }],
    });
  });
  it("returns an empty history for older wars and cascades deletion", async () => {
    const response = await getWarProgress(new URL("https://worker.test/api/wars/test-war/progress"), env);
    expect(await response.json()).toMatchObject({ latest: null, history: [] });
    await recordRankedWarProgress(env, ranked(), at(48));
    sqlite.exec("DELETE FROM wars");
    expect(history()).toHaveLength(0);
    expect(state()).toBeUndefined();
  });
});
