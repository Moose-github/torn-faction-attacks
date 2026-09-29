import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  fetchEnemyScoutingOnceForWar, refreshEnemyScoutingForWar,
  refreshEnemyHitStatsForWar, restartLiveEnemyTrackingFromRequest,
} from "./enemyScouting";
import { runPracticalPhaseHooks, runWarOfficiallyEndedHooks, runWarPracticallyFinishedHooks } from "./war/lifecycleHooks";
import { withTornKeyPool } from "./tornKeyPool";

vi.mock("./tornKeyPool", () => ({
  withTornKeyPool: vi.fn(), readAvailableTornApiKeys: vi.fn(async () => []),
}));
vi.mock("./cacheVersions", () => ({ bumpWarCacheVersion: vi.fn(), bumpWarCacheVersionById: vi.fn() }));
vi.mock("./warStats", () => ({ rebuildWarStatsFromRaw: vi.fn() }));
vi.mock("./discordTravelTracker", () => ({
  enableDiscordTravelTrackersForWar: vi.fn(), stopDiscordTravelTrackersForWar: vi.fn(),
}));

const tables = [
  "enemy_faction_members", "enemy_hit_stat_snapshots", "enemy_faction_activity_samples",
  "enemy_member_activity_samples", "enemy_push_activity_snapshots", "war_control_snapshots", "enemy_big_hitters",
];
let sqlite, env, retained;
const rows = (table) => sqlite.prepare(`SELECT * FROM ${table}`).all();
function expectHistoryRetained() {
  for (const table of tables) expect(rows(table), table).toEqual(expect.arrayContaining(retained.get(table)));
  expect(rows("home_faction_activity_samples")).toHaveLength(1);
}

beforeEach(() => {
  vi.clearAllMocks();
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../schema/current.sql", import.meta.url), "utf8"));
  sqlite.exec(`
    INSERT INTO wars (id, name, status, practical_start_time, enemy_faction_id, official_end_time)
    VALUES (24, 'Old', 'ended', 50, 6000, 90), (25, 'Current', 'active', 100, 7002, NULL),
           (26, 'Next', 'scheduled', 200, 8000, NULL);
    INSERT INTO enemy_faction_members (member_id, faction_id, name) VALUES (1, 7002, 'Member');
    INSERT INTO enemy_member_live_status (member_id, faction_id, status_state) VALUES (1, 7002, 'Okay');
    INSERT INTO enemy_big_hitters (war_id, faction_id, member_id, member_name) VALUES (25, 7002, 1, 'Member');
    INSERT INTO enemy_push_activity_snapshots
      (war_id, faction_id, bucket_start, total_members, online_count, idle_count, offline_count,
       recently_active_count, offline_idle_to_online_count, hospital_count, revivable_count, pressure_level)
    VALUES (25, 7002, 100, 1, 1, 0, 0, 1, 1, 0, 1, 'low');
    INSERT INTO war_control_snapshots (war_id, bucket_start, control_state, control_confidence, control_reason)
    VALUES (25, 100, 'neutral', 1, 'test');
    INSERT INTO enemy_hit_stat_snapshots (war_id, faction_id, member_id, member_name, snapshot_date, snapshot_kind)
    VALUES (25, 7002, 1, 'Member', '2000-01-01', 'current');
    INSERT INTO enemy_faction_activity_samples VALUES (25, 7002, '2000-01-01', 0, 1, 1, 100);
    INSERT INTO enemy_member_activity_samples
      (war_id, faction_id, member_id, member_name, date, interval_index, is_recently_active, sampled_at)
    VALUES (25, 7002, 1, 'Member', '2000-01-01', 0, 1, 100);
    INSERT INTO home_faction_activity_samples VALUES (8803, '2000-01-01', 0, 1, 1, 100);
  `);
  function prepare(sql, args = []) {
    return {
      bind: (...values) => prepare(sql, values),
      first: async () => sqlite.prepare(sql).get(...args) ?? null,
      all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
      run: async () => ({ success: true, meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) } }),
    };
  }
  env = { DB: { prepare, batch: async (statements) => {
    sqlite.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      sqlite.exec("COMMIT");
      return results;
    } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } } };
  retained = new Map(tables.map((table) => [table, rows(table)]));
  vi.mocked(withTornKeyPool).mockResolvedValue({ members: [] });
});
afterEach(() => sqlite.close());

it.each(["practical finish", "official end", "phase pause", "tracker restart"])("retains every enemy history table through %s", async (action) => {
  const options = { warId: 25, enemyFactionId: 7002 };
  if (action === "practical finish") await runWarPracticallyFinishedHooks(env, options);
  if (action === "official end") await runWarOfficiallyEndedHooks(env, options);
  if (action === "phase pause") await runPracticalPhaseHooks(env, {
    id: "phase-25", war_id: 25, status: "completed", reason: "manual",
  }, false);
  if (action === "tracker restart") {
    const response = await restartLiveEnemyTrackingFromRequest(new Request("https://test/restart", {
      method: "POST", body: JSON.stringify({ war_id: 25 }),
    }), env);
    expect(response.status).toBe(200);
  }
  expectHistoryRetained();
});

it.each([refreshEnemyScoutingForWar, refreshEnemyHitStatsForWar])("historical refresh cannot replace the retained enemy after official end (%s)", async (refresh) => {
  sqlite.exec("UPDATE wars SET status='ended', official_end_time=190 WHERE id=25");
  await refresh(new URL("https://test/api/wars/Old/enemy-scouting"), env);
  expectHistoryRetained();
  expect(withTornKeyPool).not.toHaveBeenCalled();
});

it("retries scouting for the same faction without deleting history", async () => {
  expect(await fetchEnemyScoutingOnceForWar(env, 25)).toBe(true);
  expectHistoryRetained();
});

it("retains history when the incoming faction is still blocked by an unfinished war", async () => {
  expect(await fetchEnemyScoutingOnceForWar(env, 26)).toBe(false);
  expectHistoryRetained();
});

it.each(["empty", "failed"])("retains history when scouting the new faction returns an %s response", async (outcome) => {
  sqlite.exec("UPDATE wars SET status='ended', official_end_time=190 WHERE id=25");
  if (outcome === "failed") vi.mocked(withTornKeyPool).mockRejectedValueOnce(new Error("Torn unavailable"));
  expect(await fetchEnemyScoutingOnceForWar(env, 26)).toBe(false);
  expectHistoryRetained();
});

it.each(["automatic", "manual", "hit-stat refresh"])("clears all enemy history together when a new faction is scouted (%s)", async (route) => {
  sqlite.exec("UPDATE wars SET status='ended', official_end_time=190 WHERE id=25");
  vi.mocked(withTornKeyPool)
    .mockResolvedValueOnce({ members: [{ id: 2, name: "New enemy", level: 50 }] })
    .mockResolvedValueOnce({ job: null });
  if (route === "automatic") expect(await fetchEnemyScoutingOnceForWar(env, 26)).toBe(true);
  else if (route === "hit-stat refresh") expect((await refreshEnemyHitStatsForWar(new URL("https://test/api/wars/Next/enemy-hit-stats/refresh"), env)).status).toBe(200);
  else expect((await refreshEnemyScoutingForWar(new URL("https://test/api/wars/Next/enemy-scouting"), env)).status).toBe(200);
  expect(rows("enemy_faction_members").map((row) => row.faction_id)).toEqual([8000]);
  for (const table of tables.slice(1)) {
    expect(rows(table).filter((row) => row.war_id === 25), table).toEqual([]);
  }
  expect(rows("home_faction_activity_samples")).toHaveLength(1);
});

it("rolls back the entire cleanup when saving the replacement roster fails", async () => {
  sqlite.exec(`UPDATE wars SET status='ended', official_end_time=190 WHERE id=25;
    CREATE TRIGGER reject_new_roster BEFORE INSERT ON enemy_faction_members
    WHEN NEW.faction_id=8000 BEGIN SELECT RAISE(ABORT, 'roster save failed'); END;`);
  vi.mocked(withTornKeyPool)
    .mockResolvedValueOnce({ members: [{ id: 2, name: "New enemy", level: 50 }] })
    .mockResolvedValueOnce({ job: null });
  expect(await fetchEnemyScoutingOnceForWar(env, 26)).toBe(false);
  expectHistoryRetained();
});
