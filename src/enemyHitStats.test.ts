import { describe, expect, it } from "vitest";
import {
  buildEnemyHitStatTrends,
  enemyHitStatSnapshotTargets,
  gunHits,
  meleeHits,
  type EnemyHitStatSnapshotRow,
} from "./enemyHitStats";
import { extractPersonalStats } from "./personalStats";

describe("enemy hit stat snapshots", () => {
  it("seeds current plus the previous four calendar Wednesdays", () => {
    const detectedAt = Date.UTC(2026, 4, 31, 9, 30, 0) / 1000;

    expect(enemyHitStatSnapshotTargets(detectedAt)).toEqual([
      { snapshotDate: "2026-05-31", snapshotKind: "current", requestedAt: detectedAt, apiTimestamp: null },
      {
        snapshotDate: "2026-05-27",
        snapshotKind: "wednesday",
        requestedAt: Date.UTC(2026, 4, 27, 0, 10, 0) / 1000,
        apiTimestamp: Date.UTC(2026, 4, 27, 0, 10, 0) / 1000,
      },
      {
        snapshotDate: "2026-05-20",
        snapshotKind: "wednesday",
        requestedAt: Date.UTC(2026, 4, 20, 0, 10, 0) / 1000,
        apiTimestamp: Date.UTC(2026, 4, 20, 0, 10, 0) / 1000,
      },
      {
        snapshotDate: "2026-05-13",
        snapshotKind: "wednesday",
        requestedAt: Date.UTC(2026, 4, 13, 0, 10, 0) / 1000,
        apiTimestamp: Date.UTC(2026, 4, 13, 0, 10, 0) / 1000,
      },
      {
        snapshotDate: "2026-05-06",
        snapshotKind: "wednesday",
        requestedAt: Date.UTC(2026, 4, 6, 0, 10, 0) / 1000,
        apiTimestamp: Date.UTC(2026, 4, 6, 0, 10, 0) / 1000,
      },
    ]);
  });

  it("does not reuse the match day when the match is found on a Wednesday", () => {
    const detectedAt = Date.UTC(2026, 4, 27, 12, 0, 0) / 1000;

    expect(enemyHitStatSnapshotTargets(detectedAt).map((target) => target.snapshotDate)).toEqual([
      "2026-05-27",
      "2026-05-20",
      "2026-05-13",
      "2026-05-06",
      "2026-04-29",
    ]);
  });

  it("parses Torn personalstats arrays by stat name", () => {
    expect(extractPersonalStats([
      { name: "rankedwarhits", value: 997, timestamp: 1770000000 },
      { name: "retals", value: "6", timestamp: "1770000001" },
    ])).toEqual({
      rankedwarhits: { value: 997, timestamp: 1770000000 },
      retals: { value: 6, timestamp: 1770000001 },
    });
  });

  it("derives melee and gun hits from raw hit stats", () => {
    const row = snapshotRow({
      attackhits: 100,
      temphits: 15,
      piercinghits: 10,
      slashinghits: 5,
      clubbinghits: 4,
      mechanicalhits: 3,
      h2hhits: 2,
    });

    expect(meleeHits(row)).toBe(24);
    expect(gunHits(row)).toBe(61);
    expect(gunHits({ ...row, attackhits: 10 })).toBe(0);
  });

  it("ranks trends by watch priority, ranked war pace, then retals", () => {
    const week = 7 * 24 * 60 * 60;
    const rows = [
      snapshotRow({
        member_id: 1,
        member_name: "Medium",
        requested_at: 1000,
        snapshot_date: "old",
        rankedwarhits: 0,
        retals: 0,
      }),
      snapshotRow({
        member_id: 1,
        member_name: "Medium",
        requested_at: 1000 + week,
        snapshot_date: "new",
        rankedwarhits: 30,
        retals: 0,
      }),
      snapshotRow({
        member_id: 2,
        member_name: "High",
        requested_at: 1000,
        snapshot_date: "old",
        rankedwarhits: 0,
        retals: 0,
      }),
      snapshotRow({
        member_id: 2,
        member_name: "High",
        requested_at: 1000 + week,
        snapshot_date: "new",
        rankedwarhits: 100,
        retals: 0,
      }),
      snapshotRow({
        member_id: 3,
        member_name: "Low",
        requested_at: 1000,
        snapshot_date: "old",
        rankedwarhits: 0,
        retals: 0,
      }),
      snapshotRow({
        member_id: 3,
        member_name: "Low",
        requested_at: 1000 + week,
        snapshot_date: "new",
        rankedwarhits: 4,
        retals: 0,
      }),
    ];

    const trends = buildEnemyHitStatTrends(rows);

    expect(trends.map((trend) => [trend.member_name, trend.priority, trend.rankedwarhits_per_week])).toEqual([
      ["High", "high", 100],
      ["Medium", "medium", 30],
      ["Low", "low", 4],
    ]);
  });

  it("includes special ammo weekly trend and snapshot tooltip data", () => {
    const week = 7 * 24 * 60 * 60;
    const trends = buildEnemyHitStatTrends([
      snapshotRow({
        requested_at: 1000,
        snapshot_date: "2026-05-06",
        rankedwarhits: 10,
        retals: 1,
        specialammoused: 20,
      }),
      snapshotRow({
        requested_at: 1000 + week,
        snapshot_date: "2026-05-13",
        rankedwarhits: 15,
        retals: 3,
        specialammoused: 34,
      }),
    ]);

    expect(trends[0].specialammoused_per_week).toBe(14);
    expect(trends[0].snapshots).toEqual([
      {
        snapshot_date: "2026-05-06",
        rankedwarhits: 10,
        retals: 1,
        specialammoused: 20,
      },
      {
        snapshot_date: "2026-05-13",
        rankedwarhits: 15,
        retals: 3,
        specialammoused: 34,
      },
    ]);
  });
});

function snapshotRow(overrides: Partial<EnemyHitStatSnapshotRow>): EnemyHitStatSnapshotRow {
  return {
    war_id: 1,
    faction_id: 2,
    member_id: 3,
    member_name: "Player",
    snapshot_date: "2026-05-31",
    snapshot_kind: "current",
    requested_at: 1000,
    rankedwarhits: 0,
    attackhits: 0,
    temphits: 0,
    piercinghits: 0,
    slashinghits: 0,
    clubbinghits: 0,
    mechanicalhits: 0,
    h2hhits: 0,
    retals: 0,
    specialammoused: 0,
    rankedwarhits_timestamp: null,
    attackhits_timestamp: null,
    temphits_timestamp: null,
    piercinghits_timestamp: null,
    slashinghits_timestamp: null,
    clubbinghits_timestamp: null,
    mechanicalhits_timestamp: null,
    h2hhits_timestamp: null,
    retals_timestamp: null,
    specialammoused_timestamp: null,
    attempted_at: null,
    attempt_count: 0,
    error: null,
    key_source: null,
    completed_at: 1000,
    created_at: 1000,
    updated_at: 1000,
    ...overrides,
  };
}
