import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { updateOfficialWar } from "./wars";
import { readWarFromUrl } from "./warRequest";

vi.mock("./cacheVersions", () => ({ bumpWarCacheVersionById: vi.fn() }));
vi.mock("./warStats", () => ({ rebuildWarStatsFromRaw: vi.fn() }));

let sqlite;
let env;
beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  const schema = readFileSync("schema/current.sql", "utf8");
  const warsTable = schema.match(/CREATE TABLE wars \([\s\S]*?\n\);/)[0];
  // Start with the previous schema and apply the actual migration.
  sqlite.exec(warsTable.replace("  enemy_target_respect REAL,\n", ""));
  sqlite.exec("INSERT INTO wars (id, name, status, practical_start_time, war_type) VALUES (1, 'test-war', 'active', 100, 'real')");
  sqlite.exec(readFileSync("migrations/0162_add_enemy_target_respect.sql", "utf8"));
  env = {
    DB: {
      prepare(sql) {
        const statement = sqlite.prepare(sql);
        let values = [];
        return {
          bind(...params) { values = params; return this; },
          async first() { return statement.get(...values) ?? null; },
        };
      },
    },
  };
});
afterEach(() => sqlite.close());

async function update(fields = {}) {
  return updateOfficialWar(new Request("https://worker.test/api/admin/wars/update", {
    method: "POST",
    body: JSON.stringify({ id: 1, war_type: "termed", practical_start_time: 100, ...fields }),
  }), env);
}
function saved() { return sqlite.prepare("SELECT * FROM wars WHERE id = 1").get(); }

describe("optional enemy target respect", () => {
  it("saves a decimal target during conversion and returns it when the war is reloaded", async () => {
    const response = await update({ enemy_target_respect: 3200.125 });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ war: { war_type: "termed", enemy_target_respect: 3200.125 } });
    expect(saved().enemy_target_respect).toBe(3200.125);
    const reloaded = await readWarFromUrl(new URL("https://worker.test/api/wars/test-war"), env);
    expect(reloaded.enemy_target_respect).toBe(3200.125);
    expect(saved().auto_end_enabled).toBe(0);
  });

  it.each([undefined, null, ""])("allows conversion with no enemy target (%s)", async (value) => {
    const response = await update({ enemy_target_respect: value, auto_end_enabled: true, faction_respect_limit: 9000 });
    expect(response.status).toBe(200);
    expect(saved()).toMatchObject({ enemy_target_respect: null, auto_end_enabled: 1, faction_respect_limit: 9000 });
  });

  it("accepts zero as an explicit target", async () => {
    expect((await update({ enemy_target_respect: 0 })).status).toBe(200);
    expect(saved().enemy_target_respect).toBe(0);
  });

  it.each([-1, "not a number", "Infinity"])("rejects an invalid target (%s) without changing the war", async (value) => {
    const response = await update({ enemy_target_respect: value });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_ENEMY_TARGET_RESPECT" });
    expect(saved()).toMatchObject({ war_type: "real", enemy_target_respect: null });
  });

  it("preserves an omitted target on later edits and allows explicitly clearing it", async () => {
    await update({ enemy_target_respect: 3200 });
    expect((await update()).status).toBe(200);
    expect(saved().enemy_target_respect).toBe(3200);
    expect((await update({ enemy_target_respect: null })).status).toBe(200);
    expect(saved().enemy_target_respect).toBeNull();
  });

  it("clears the target when returning to a real war", async () => {
    await update({ enemy_target_respect: 3200 });
    expect((await update({ war_type: "real" })).status).toBe(200);
    expect(saved()).toMatchObject({ war_type: "real", enemy_target_respect: null });
  });

  it("rejects setting the target on a real war", async () => {
    const response = await update({ war_type: "real", enemy_target_respect: 3200 });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "TERM_FIELDS_REQUIRE_TERMED_WAR" });
    expect(saved().enemy_target_respect).toBeNull();
  });
});
