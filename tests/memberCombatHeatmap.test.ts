import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOME_FACTION_ID } from "../src/constants";
import { getWarActivity, getWarMemberAttacks, getWarMemberCombatHeatmap } from "../src/warQueries";
import { applyIncrementalWarSummaries, rebuildWarStatsFromRaw } from "../src/warStats";
import type { Env } from "../src/types";

const base = 1_800_000_000;
let db: DatabaseSync;
let env: Env;
function statement(sql: string, args: SQLInputValue[] = []): any {
  return {
    bind: (...values: SQLInputValue[]) => statement(sql, values),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => ({ success: true, meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
  };
}
function attack(id: number, start: number, options: { member?: number; defend?: boolean; outside?: boolean; end?: number; chain?: number; respect?: number } = {}) {
  const member = options.member ?? 10;
  db.prepare(`INSERT INTO attacks (id, war_id, started, ended, attacker_id, attacker_name,
    attacker_faction_id, defender_id, defender_name, defender_faction_id, result, respect_gain, chain)
    VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, 'Hospitalized', ?, ?)`).run(
    id, base + start, base + (options.end ?? start + 1),
    options.defend ? 20 : member, options.defend ? "Enemy" : "Member " + member,
    options.defend ? 99 : HOME_FACTION_ID, options.defend ? member : 20,
    options.defend ? "Member " + member : "Enemy",
    options.defend ? HOME_FACTION_ID : options.outside ? 100 : 99,
    options.respect ?? 5, options.chain ?? 0,
  );
}
async function heatmap(window = "") {
  return getWarMemberCombatHeatmap(new URL("https://test/api/wars/Test/member-combat-heatmap" + (window ? "?window=" + window : "")), env);
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime((base + 2700) * 1000);
  db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../schema/current.sql", import.meta.url), "utf8"));
  env = { DB: { prepare: statement, batch: async (items: any[]) => Promise.all(items.map(item => item.run())) } } as unknown as Env;
  db.prepare(`INSERT INTO wars (id, name, status, war_type, practical_start_time, practical_finish_time,
    official_start_time, official_end_time, enemy_faction_id) VALUES (1, 'Test', 'ended', 'real', ?, ?, ?, ?, 99)`)
    .run(base + 100, base + 300, base, base + 1800);
});
afterEach(() => { db.close(); vi.useRealTimers(); });

describe("member combat heatmap time windows", () => {
  it.each(["real", "termed"])("counts anonymous ranked-war defenses consistently for %s wars", async (warType) => {
    db.prepare("UPDATE wars SET war_type = ?").run(warType);
    if (warType === "termed") {
      db.prepare(`INSERT INTO war_practical_phases (id, war_id, scheduled_start, start_time, finish_time, status)
        VALUES ('phase', 1, ?, ?, ?, 'completed')`).run(base + 100, base + 100, base + 300);
    }
    attack(1, 150, { defend: true }); // Anonymous ranked-war hit: included.
    attack(2, 160, { defend: true }); // Anonymous ordinary hit: excluded.
    attack(3, 170, { defend: true }); // Known different faction: excluded, even with ranked flag.
    attack(4, 400, { defend: true }); // After practical finish: official window only.
    attack(5, 50, { defend: true }); // Before practical start: official window only.
    attack(6, 180, { defend: true }); // Not against our faction: excluded.
    attack(7, 190, { defend: true }); // Known enemy: included.
    attack(8, 200); // Outgoing totals remain unchanged.
    db.exec(`UPDATE attacks SET attacker_id = NULL, attacker_name = NULL, attacker_faction_id = NULL,
      is_stealthed = 1, is_ranked_war = 1 WHERE id IN (1, 2, 4, 5, 6);
      UPDATE attacks SET is_ranked_war = 0 WHERE id = 2;
      UPDATE attacks SET attacker_faction_id = 100, is_ranked_war = 1 WHERE id = 3;
      UPDATE attacks SET defender_faction_id = 100 WHERE id = 6;
      UPDATE attacks SET ingest_run_id = 'stealth-test';`);
    const stats = () => db.prepare(`SELECT attacks_vs_enemy_successful, respect_gained,
      defends_total, respect_lost, respect_lost_raw FROM war_member_stats WHERE member_id = 10`).get();
    const expected = { attacks_vs_enemy_successful: 1, respect_gained: 5, defends_total: 2, respect_lost: 10, respect_lost_raw: 10 };
    await applyIncrementalWarSummaries(env, 1, "stealth-test");
    expect(stats()).toMatchObject(expected);
    await applyIncrementalWarSummaries(env, 1, "stealth-test");
    expect(stats()).toMatchObject(expected);
    await rebuildWarStatsFromRaw(env, { scope: "single-war", warId: 1 });
    expect(stats()).toMatchObject(expected);
    expect(db.prepare("SELECT total_respect_lost FROM war_summary WHERE war_id = 1").get()).toMatchObject({ total_respect_lost: 10 });
    for (const [window, count] of [["practical", 2], ["official", 4]] as const) {
      const combat = await (await heatmap(window)).json() as any;
      expect(combat.buckets.reduce((sum: number, b: any) => sum + b.defends_lost, 0)).toBe(count);
      const activity = await (await getWarActivity(new URL(`https://test/api/wars/Test/activity?window=${window}`), env)).json() as any;
      expect(activity.buckets.reduce((sum: number, b: any) => sum + b.defend_lost, 0)).toBe(count);
    }
    const detail = await (await getWarMemberAttacks(new URL("https://test/api/wars/Test/members/10/attacks"), env)).json() as any;
    expect(detail.attacks.find((row: any) => row.id === 1)).toMatchObject({ classification: "defend_lost", attacker_id: null });
    expect(detail.attacks.find((row: any) => row.id === 2)).toMatchObject({ classification: "other" });
    expect(detail.attacks.find((row: any) => row.id === 3)).toMatchObject({ classification: "other" });
  });

  it("defaults to practical and includes official-only combat, members, and empty time buckets in official mode", async () => {
    attack(1, 150);
    attack(2, 50);
    attack(3, 400, { member: 11 });
    attack(4, 950, { defend: true });
    attack(5, 1100, { outside: true });
    attack(6, -5);
    attack(7, 1790, { end: 1801 });
    attack(8, 500, { chain: 10, respect: 100 });
    await rebuildWarStatsFromRaw(env, { scope: "single-war", warId: 1 });
    const practical = await (await heatmap()).json() as any;
    expect(practical.window).toBe("practical");
    expect(practical.time_buckets).toEqual([base]);
    expect(practical.buckets.reduce((sum: number, b: any) => sum + b.attacks_successful, 0)).toBe(1);
    const official = await (await heatmap("official")).json() as any;
    expect(official.ok).toBe(true);
    expect(official.window).toBe("official");
    expect(official.time_buckets).toEqual([base, base + 900, base + 1800]);
    expect(official.members).toEqual(expect.arrayContaining([
      expect.objectContaining({ member_id: 10, attacks_vs_enemy_successful: 3, respect_gained: 15, defends_total: 1, respect_lost: 5, outside_hits: 1 }),
      expect.objectContaining({ member_id: 11, member_name: "Member 11", attacks_vs_enemy_successful: 1 }),
    ]));
    const activity = await (await getWarActivity(new URL("https://test/api/wars/Test/activity?window=official&bucket_minutes=15"), env)).json() as any;
    for (const bucket of activity.buckets) {
      const matching = official.buckets.filter((b: any) => b.bucket_start === bucket.bucket_start);
      expect(matching.reduce((sum: number, b: any) => sum + b.attacks_successful, 0)).toBe(bucket.enemy_success);
      expect(matching.reduce((sum: number, b: any) => sum + b.defends_lost, 0)).toBe(bucket.defend_lost);
      expect(matching.reduce((sum: number, b: any) => sum + b.outside_hits, 0)).toBe(bucket.outside);
    }
  });

  it("excludes report-exempt members in official mode", async () => {
    attack(1, 400);
    db.prepare("INSERT INTO home_faction_members (member_id, faction_id, name, report_exempt) VALUES (10, ?, 'Hidden', 1)").run(HOME_FACTION_ID);
    const result = await (await heatmap("official")).json() as any;
    expect(result.members).toEqual([]);
    expect(result.buckets).toEqual([]);
  });

  it("uses the practical start fallback and current time for an unfinished official window", async () => {
    db.exec("UPDATE wars SET official_start_time = NULL, official_end_time = NULL");
    const result = await (await heatmap("official")).json() as any;
    expect(result.time_buckets).toEqual([base, base + 900, base + 1800, base + 2700]);
  });

  it("returns no time buckets for an inverted official window and rejects invalid modes", async () => {
    db.prepare("UPDATE wars SET official_end_time = ?").run(base - 1);
    expect(await (await heatmap("official")).json()).toMatchObject({ time_buckets: [], buckets: [] });
    expect((await heatmap("invalid")).status).toBe(400);
  });
});
