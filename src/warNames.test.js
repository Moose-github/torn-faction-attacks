import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { uniqueWarName } from "./warNames";
import { warNameFromWarRoute } from "./routes";

let sqlite;
let env;
beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  const schema = readFileSync(new URL("../schema/current.sql", import.meta.url), "utf8").replaceAll("\r\n", "\n");
  for (const table of ["wars", "sync_state"]) {
    sqlite.exec(schema.match(new RegExp(`CREATE TABLE ${table} \\([\\s\\S]*?\\n\\);`))[0]);
  }
  env = { DB: { prepare: sql => ({ bind: (...values) => ({
    first: async () => sqlite.prepare(sql).get(...values) ?? null,
  }) }) } };
});
afterEach(() => sqlite.close());

function addWar(name, faction = 123, type = "real") {
  sqlite.prepare(`INSERT INTO wars (name, status, practical_start_time, enemy_faction_id, war_type)
    VALUES (?, 'scheduled', 100, ?, ?)`).run(name, faction, type);
}

describe("repeat war names", () => {
  it("leaves the first war unsuffixed and numbers repeat matches", async () => {
    expect(await uniqueWarName(env, "siege")).toBe("siege");
    addWar("Siege");
    expect(await uniqueWarName(env, "siege")).toBe("siege (2nd)");
    addWar("siege (2nd)");
    expect(await uniqueWarName(env, "siege")).toBe("siege (3rd)");
  });

  it.each([[4, "4th"], [11, "11th"], [12, "12th"], [13, "13th"],
    [21, "21st"], [22, "22nd"], [23, "23rd"], [100, "100th"], [111, "111th"]])(
    "formats occurrence %i and respects legacy names", async (count, ordinal) => {
      addWar("siege");
      for (let n = 2; n < count; n++) addWar(`siege ${n}`);
      expect(await uniqueWarName(env, "siege")).toBe(`siege (${ordinal})`);
    },
  );

  it("fits the complete suffix within the 50-character limit", async () => {
    const base = "a".repeat(50);
    addWar(base);
    addWar(`${base.slice(0, 48)} 2`);
    const name = await uniqueWarName(env, base);
    expect(name).toBe(`${base.slice(0, 44)} (3rd)`);
    expect(name.length).toBe(50);
    expect(warNameFromWarRoute(new URL(`https://worker.test/api/wars/${encodeURIComponent(name)}`))).toBe(name);
  });
});

describe("legacy name migration", () => {
  it("renames matching faction repeats, preserves unrelated names, and skips collisions", () => {
    addWar("siege");
    addWar("siege 2");
    addWar("siege 3");
    addWar("siege (3rd)");
    addWar("siege 11");
    addWar("siege 21");
    addWar("siege 4", 456);
    addWar("siege 5", 123, "event");
    addWar("Sector 7", 789);
    const base = "b".repeat(50);
    addWar(base);
    addWar(`${base.slice(0, 48)} 2`);
    const migration = readFileSync(new URL("../migrations/0174_ordinal_repeat_war_names.sql", import.meta.url), "utf8");
    sqlite.exec(migration);
    const names = () => sqlite.prepare("SELECT name FROM wars ORDER BY id").all().map(row => row.name);
    const expected = ["siege", "siege (2nd)", "siege 3", "siege (3rd)", "siege (11th)",
      "siege (21st)", "siege 4", "siege 5", "Sector 7", base, `${base.slice(0, 44)} (2nd)`];
    expect(names()).toEqual(expected);
    sqlite.exec(migration);
    expect(names()).toEqual(expected);
    expect(sqlite.prepare("SELECT last_started FROM sync_state WHERE name = 'cache_version:war:all'").get().last_started).toBeGreaterThan(0);
  });
});
