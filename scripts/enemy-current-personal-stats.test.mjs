import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchTrackedTornResponse } from "../src/external/torn";
import { refreshMissingEnemyScoutingNetworth } from "../src/enemyScoutingCron";
import {
  ENEMY_HIT_STAT_KEYS, extractCurrentEnemyScoutingStats, refreshMissingEnemyHitStats,
  refreshCurrentEnemyPersonalStats, seedEnemyHitStatSnapshots,
} from "../src/enemyHitStats";

vi.mock("../src/external/torn", () => ({ fetchTrackedTornResponse: vi.fn() }));
vi.mock("../src/tornKeyPool", () => ({ recordTornKeyUse: vi.fn(), withTornKeyPool: vi.fn() }));
vi.mock("../src/enemyNetworth", async (original) => ({
  ...await original(),
  readAvailableEnemyNetworthKeys: vi.fn(async () => [{ key: "test-key", keySource: "test" }]),
}));
vi.mock("../src/syncLatches", () => ({
  readSetSyncLatches: vi.fn(async () => new Set()), setSyncLatch: vi.fn(),
  clearSyncLatch: vi.fn(), isSyncLatchSet: vi.fn(),
}));
vi.mock("../src/enemyScouting", () => ({
  readCurrentScoutingWar: vi.fn(async () => ({ id: 1, enemy_faction_id: 2 })),
}));
vi.mock("../src/discordImageRenderer", () => ({}));

const current = () => ({
  attacking: { hits: { success: 58039 }, faction: { ranked_war_hits: 2976, retaliations: 342 }, ammunition: { special: 47619 } },
  finishing_hits: { temporary: 1816, piercing: 202, slashing: 1651, clubbing: 4645, mechanical: 521, hand_to_hand: 464 },
  networth: { total: 13330767324 },
});
const key = { key: "test-key", keySource: "test" };
const options = { warId: 1, enemyFactionId: 2, completeLatchName: "hits", limit: 40 };
let sqlite;
let env;
let failBatch;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-28T12:00:00Z"));
  failBatch = false;
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../migrations/0086_create_enemy_hit_stat_snapshots.sql", import.meta.url), "utf8"));
  sqlite.exec(`CREATE TABLE enemy_faction_members (
    faction_id INTEGER, member_id INTEGER, name TEXT, level INTEGER,
    networth INTEGER, networth_updated_at INTEGER, networth_attempted_at INTEGER,
    networth_attempt_count INTEGER DEFAULT 0, networth_error TEXT,
    networth_key_source TEXT, updated_at INTEGER
  ); INSERT INTO enemy_faction_members (faction_id, member_id, name, level) VALUES (2, 3, 'Player', 100);`);
  env = { DB: {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      let params = [];
      return {
        bind(...values) { params = values; return this; },
        async all() { return { results: statement.all(...params) }; },
        async first() { return statement.get(...params) ?? null; },
        async run() { return { meta: { changes: Number(statement.run(...params).changes) } }; },
      };
    },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) {
          results.push(await statement.run());
          if (failBatch) throw new Error("batch failed");
        }
        sqlite.exec("COMMIT");
        return results;
      } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  } };
  await seedEnemyHitStatSnapshots(env, 1, 2, [{ member_id: 3, name: "Player" }], Date.now() / 1000 - 3600);
  vi.mocked(fetchTrackedTornResponse).mockImplementation(async (_env, input) => {
    const url = new URL(input);
    return Response.json({ personalstats: url.searchParams.has("cat") ? current() :
      ENEMY_HIT_STAT_KEYS.map((name) => ({ name, value: 10, timestamp: Number(url.searchParams.get("timestamp")) })) });
  });
});
afterEach(() => { sqlite.close(); vi.useRealTimers(); });

describe("enemy current personal stats collection", () => {
  it("fills current combat and net worth once, then fetches only four historical snapshots", async () => {
    expect(await refreshMissingEnemyScoutingNetworth(env)).toMatchObject({ updated: 1, failed: 0 });
    const row = sqlite.prepare("SELECT * FROM enemy_hit_stat_snapshots WHERE snapshot_kind = 'current'").get();
    expect(row).toMatchObject({
      rankedwarhits: 2976, attackhits: 58039, temphits: 1816, piercinghits: 202,
      slashinghits: 1651, clubbinghits: 4645, mechanicalhits: 521, h2hhits: 464,
      retals: 342, specialammoused: 47619, rankedwarhits_timestamp: null,
      requested_at: Date.now() / 1000,
    });
    expect(sqlite.prepare("SELECT networth FROM enemy_faction_members").get().networth).toBe(13330767324);
    expect(await refreshMissingEnemyHitStats(env, options)).toMatchObject({ updated: 4, failed: 0 });
    const calls = vi.mocked(fetchTrackedTornResponse).mock.calls;
    expect(calls).toHaveLength(5);
    expect(calls[0][1]).toBe("https://api.torn.com/v2/user/3/personalstats?cat=all");
    expect(calls[0][2].headers.Authorization).toBe("ApiKey test-key");
    for (const call of calls.slice(1)) {
      const url = new URL(call[1]);
      expect(url.searchParams.has("cat")).toBe(false);
      expect(url.searchParams.get("stat")).toBe(ENEMY_HIT_STAT_KEYS.join(","));
      expect(Number(url.searchParams.get("timestamp"))).toBeGreaterThan(0);
    }
    const historical = sqlite.prepare("SELECT * FROM enemy_hit_stat_snapshots WHERE snapshot_kind = 'wednesday'").all();
    expect(historical.every((item) => item.rankedwarhits_timestamp === item.requested_at)).toBe(true);
    await refreshMissingEnemyScoutingNetworth(env);
    await refreshMissingEnemyHitStats(env, options);
    expect(fetchTrackedTornResponse).toHaveBeenCalledTimes(5);
  });

  it("lets the combat collector fill current net worth too", async () => {
    expect(await refreshMissingEnemyHitStats(env, options)).toMatchObject({ updated: 5, failed: 0 });
    await refreshMissingEnemyScoutingNetworth(env);
    expect(fetchTrackedTornResponse).toHaveBeenCalledTimes(5);
    expect(sqlite.prepare("SELECT networth FROM enemy_faction_members").get().networth).toBe(13330767324);
  });

  it("preserves completed current combat when only net worth needs repair", async () => {
    sqlite.exec("UPDATE enemy_hit_stat_snapshots SET completed_at = 123, rankedwarhits = 999 WHERE snapshot_kind = 'current'");
    await refreshMissingEnemyScoutingNetworth(env);
    expect(sqlite.prepare("SELECT rankedwarhits FROM enemy_hit_stat_snapshots WHERE snapshot_kind = 'current'").get().rankedwarhits).toBe(999);
  });

  it("rejects missing stats but accepts valid zero values", () => {
    const source = current();
    source.finishing_hits.temporary = 0;
    expect(extractCurrentEnemyScoutingStats(source).temphits.value).toBe(0);
    source.finishing_hits.temporary = null;
    expect(() => extractCurrentEnemyScoutingStats(source)).toThrow("finishing_hits.temporary");
  });

  it("leaves both datasets pending on incomplete responses and records a retry", async () => {
    vi.mocked(fetchTrackedTornResponse).mockResolvedValue(Response.json({ personalstats: { networth: { total: 10 } } }));
    expect(await refreshMissingEnemyScoutingNetworth(env)).toMatchObject({ updated: 0, failed: 1 });
    expect(sqlite.prepare("SELECT networth_updated_at, networth_attempt_count FROM enemy_faction_members").get())
      .toMatchObject({ networth_updated_at: null, networth_attempt_count: 1 });
    expect(sqlite.prepare("SELECT completed_at FROM enemy_hit_stat_snapshots WHERE snapshot_kind = 'current'").get().completed_at).toBeNull();
  });

  it("rolls back net worth if the combined save fails", async () => {
    failBatch = true;
    await expect(refreshCurrentEnemyPersonalStats(env, 1, 2, 3, key)).rejects.toThrow("batch failed");
    expect(sqlite.prepare("SELECT networth_updated_at FROM enemy_faction_members").get().networth_updated_at).toBeNull();
    expect(sqlite.prepare("SELECT completed_at FROM enemy_hit_stat_snapshots WHERE snapshot_kind = 'current'").get().completed_at).toBeNull();
  });
});
