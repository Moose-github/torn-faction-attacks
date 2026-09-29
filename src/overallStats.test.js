import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getOverallStats } from "./warQueries";

let sqlite, env;

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  const schema = readFileSync("schema/current.sql", "utf8");
  for (const table of ["wars", "war_summary", "war_member_stats", "home_faction_members"]) {
    sqlite.exec(schema.match(new RegExp(`CREATE TABLE ${table} \\([\\s\\S]*?\\n\\);`))[0]);
  }
  sqlite.exec(`
    INSERT INTO home_faction_members (member_id, faction_id, name, is_current) VALUES
      (1, 8803, 'Current', 1), (2, 8803, 'Former', 0), (3, 8803, 'Event only', 1);
  `);
  for (const [id, type, score] of [[1, "real", 10], [2, "termed", 20], [3, null, 30], [4, "event", 100]]) {
    sqlite.prepare("INSERT INTO wars (id, name, status, practical_start_time, war_type) VALUES (?, ?, 'ended', 1, ?)")
      .run(id, `Record ${id}`, type);
    sqlite.prepare("INSERT INTO war_summary (war_id, total_respect_gain) VALUES (?, ?)").run(id, score * 3);
    for (const [memberId, multiplier] of [[1, 1], [2, 2]]) {
      sqlite.prepare(`INSERT INTO war_member_stats (war_id, member_id, respect_gained, attacks_vs_enemy_successful)
        VALUES (?, ?, ?, ?)`).run(id, memberId, score * multiplier, score * multiplier);
    }
  }
  sqlite.exec("INSERT INTO war_member_stats (war_id, member_id) VALUES (4, 3)");
  env = { DB: { prepare(sql) {
    return { bind(...values) {
      return {
        async first() { return sqlite.prepare(sql).get(...values) ?? null; },
        async all() { return { results: sqlite.prepare(sql).all(...values) }; },
      };
    } };
  } } };
});

afterEach(() => sqlite.close());

async function stats(query = "") {
  const response = await getOverallStats(new URL(`https://worker.test/api/stats${query}`), env);
  expect(response.status).toBe(200);
  return response.json();
}

describe("member performance event exclusion", () => {
  it("preserves all records when exclusion is not requested", async () => {
    const result = await stats();
    expect(result.overall).toMatchObject({ total_wars: 4, total_respect_gain: 480 });
    expect(result.members).toHaveLength(3);
    expect(result.members.find(member => member.member_id === 1)).toMatchObject({ wars_participated: 4, respect_gained: 160 });
  });

  it.each([false, true])("excludes events from totals and members, current members only: %s", async currentOnly => {
    const result = await stats(`?exclude_events=1&current_members=${currentOnly ? 1 : 0}`);
    expect(result.overall).toMatchObject({ total_wars: 3, total_respect_gain: currentOnly ? 60 : 180 });
    expect(result.members.map(member => member.member_id).sort()).toEqual(currentOnly ? [1] : [1, 2]);
    expect(result.members.find(member => member.member_id === 1)).toMatchObject({
      wars_participated: 3, respect_gained: 60, attacks_vs_enemy_successful: 60,
    });
  });

  it.each([['real', 2, 120], ['termed', 1, 60]])("combines exclusion with the %s record type", async (type, count, respect) => {
    const result = await stats(`?exclude_events=1&war_type=${type}`);
    expect(result.overall).toMatchObject({ total_wars: count, total_respect_gain: respect });
    expect(result.members.every(member => member.wars_participated === count)).toBe(true);
  });

  it("still supports viewing events when exclusion is disabled", async () => {
    const result = await stats("?war_type=event&exclude_events=0");
    expect(result.overall).toMatchObject({ total_wars: 1, total_respect_gain: 300 });
    expect(result.members).toHaveLength(3);
  });
});
