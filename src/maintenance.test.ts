import { beforeEach, describe, expect, it, vi } from "vitest";
import { HeatmapSamplingError, sampleFactionActivityHeatmaps, type HeatmapSampleMetrics } from "./heatmap";
import { auditEventAttackLinks } from "./eventTracking";
import { syncHomeFactionMembershipAndSessions } from "./homeFactionMembers";
import { syncMissingRankedWarReports } from "./ingestion";
import { auditDailyStatsAttention } from "./lifestyleStats/attentionAudit";
import { runHeatmapSamplingRetry, runScheduledMaintenance } from "./maintenance";
import { refreshMemberAchievementSummariesIfStale } from "./memberAchievements";
import { cleanupRetaliationMessages } from "./retaliationDiscordMessages";
import { refreshTornApiUsageRollups } from "./tornApiUsage";
import type { Env } from "./types";
import { reconcileXanaxCompetitionRollover } from "./xanaxCompetition";

vi.mock("./heatmap", async (importOriginal) => ({
  ...await importOriginal<typeof import("./heatmap")>(),
  sampleFactionActivityHeatmaps: vi.fn(),
}));

vi.mock("./xanaxCompetition", () => ({
  reconcileXanaxCompetitionRollover: vi.fn(),
}));

vi.mock("./eventTracking", async (importOriginal) => ({
  ...await importOriginal<typeof import("./eventTracking")>(),
  auditEventAttackLinks: vi.fn(),
}));

vi.mock("./homeFactionMembers", async (importOriginal) => ({
  ...await importOriginal<typeof import("./homeFactionMembers")>(),
  syncHomeFactionMembershipAndSessions: vi.fn(),
}));

vi.mock("./ingestion", async (importOriginal) => ({
  ...await importOriginal<typeof import("./ingestion")>(),
  syncMissingRankedWarReports: vi.fn(),
}));

vi.mock("./lifestyleStats/attentionAudit", async (importOriginal) => ({
  ...await importOriginal<typeof import("./lifestyleStats/attentionAudit")>(),
  auditDailyStatsAttention: vi.fn(),
}));

vi.mock("./memberAchievements", async (importOriginal) => ({
  ...await importOriginal<typeof import("./memberAchievements")>(),
  refreshMemberAchievementSummariesIfStale: vi.fn(),
}));

vi.mock("./retaliationDiscordMessages", async (importOriginal) => ({
  ...await importOriginal<typeof import("./retaliationDiscordMessages")>(),
  cleanupRetaliationMessages: vi.fn(),
}));

vi.mock("./tornApiUsage", async (importOriginal) => ({
  ...await importOriginal<typeof import("./tornApiUsage")>(),
  refreshTornApiUsageRollups: vi.fn(),
}));

vi.mock("./syncState", async (importOriginal) => ({
  ...await importOriginal<typeof import("./syncState")>(),
  // Retention counts as already run, leaving only the scheduled tasks to log.
  readSyncTimestamp: vi.fn(async () => Number.MAX_SAFE_INTEGER),
}));

function metrics(overrides: Partial<HeatmapSampleMetrics> = {}): HeatmapSampleMetrics {
  return {
    writeStatements: 0,
    changedRows: 0,
    homeSampled: false,
    enemySampled: false,
    revivableUpdateStatements: 0,
    revivableChangedRows: 0,
    staleHeatmapRowsDeleted: 0,
    ...overrides,
  };
}

function testDatabase() {
  const statements: Array<{ sql: string; args: unknown[] }> = [];
  const batch = vi.fn(async () => []);
  const env = {
    DB: {
      prepare(sql: string) {
        return {
          bind(...args: unknown[]) {
            const statement = { sql, args };
            statements.push(statement);
            return statement;
          },
        };
      },
      batch,
    },
  } as unknown as Env;
  return { env, statements, batch };
}

beforeEach(() => {
  vi.mocked(sampleFactionActivityHeatmaps).mockReset();
  vi.mocked(cleanupRetaliationMessages).mockReset();
});

describe("scheduled maintenance task logging", () => {
  beforeEach(() => {
    const noWrites = { writeStatements: 0, changedRows: 0 };
    vi.mocked(sampleFactionActivityHeatmaps).mockResolvedValue(metrics());
    vi.mocked(auditDailyStatsAttention).mockResolvedValue(noWrites as never);
    vi.mocked(syncHomeFactionMembershipAndSessions).mockResolvedValue(noWrites as never);
    vi.mocked(syncMissingRankedWarReports).mockResolvedValue({ writeOperations: 0 } as never);
    vi.mocked(refreshMemberAchievementSummariesIfStale).mockResolvedValue(noWrites as never);
    vi.mocked(reconcileXanaxCompetitionRollover).mockResolvedValue(noWrites as never);
    vi.mocked(refreshTornApiUsageRollups).mockResolvedValue(noWrites as never);
    vi.mocked(auditEventAttackLinks).mockResolvedValue(noWrites as never);
  });

  const retentionTask = (statements: Array<{ sql: string; args: unknown[] }>) => statements.find((statement) =>
    statement.sql.includes("INSERT INTO scheduled_maintenance_tasks") &&
    statement.args[2] === "retaliation message retention");

  it("does not log retaliation retention when nothing was deleted", async () => {
    const { env, statements } = testDatabase();
    vi.mocked(cleanupRetaliationMessages).mockResolvedValue(0);

    await runScheduledMaintenance(env);

    expect(cleanupRetaliationMessages).toHaveBeenCalledTimes(1);
    expect(retentionTask(statements)).toBeUndefined();
  });

  it("logs retaliation retention when it deletes rows", async () => {
    const { env, statements } = testDatabase();
    vi.mocked(cleanupRetaliationMessages).mockResolvedValue(3);

    await runScheduledMaintenance(env);

    expect(retentionTask(statements)?.args.slice(5, 8)).toEqual(["success", 1, 3]);
  });
});

describe("heatmap retry maintenance metrics", () => {
  it("does not write a maintenance run when every sample already exists", async () => {
    const { env, batch } = testDatabase();
    const scheduledTime = Date.UTC(2026, 8, 16, 0, 1);
    vi.mocked(sampleFactionActivityHeatmaps).mockResolvedValue(metrics());

    await runHeatmapSamplingRetry(env, scheduledTime);

    expect(sampleFactionActivityHeatmaps).toHaveBeenCalledExactlyOnceWith(env, {
      retrySlotAt: scheduledTime / 1000,
    });
    expect(batch).not.toHaveBeenCalled();
  });

  it("records a successful retry", async () => {
    const { env, statements, batch } = testDatabase();
    vi.mocked(sampleFactionActivityHeatmaps).mockResolvedValue(metrics({
      enemySampled: true,
      writeStatements: 44,
      changedRows: 44,
    }));

    await runHeatmapSamplingRetry(env, Date.UTC(2026, 8, 16, 0, 1));

    expect(batch).toHaveBeenCalledTimes(1);
    const task = statements.find((statement) => statement.sql.includes("INSERT INTO scheduled_maintenance_tasks"));
    expect(task?.args.slice(2, 3)).toEqual(["heatmap sampling retry"]);
    expect(task?.args.slice(5, 8)).toEqual(["success", 44, 44]);
  });

  it("retains successful home writes when the enemy retry fails", async () => {
    const { env, statements, batch } = testDatabase();
    const partialMetrics = metrics({ homeSampled: true, writeStatements: 1, changedRows: 1 });
    vi.mocked(sampleFactionActivityHeatmaps).mockRejectedValue(
      new HeatmapSamplingError(["enemy faction 51164: HTTP 504"], partialMetrics),
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await runHeatmapSamplingRetry(env, Date.UTC(2026, 8, 16, 0, 1));

      expect(sampleFactionActivityHeatmaps).toHaveBeenCalledTimes(1);
      expect(batch).toHaveBeenCalledTimes(1);
      const task = statements.find((statement) => statement.sql.includes("INSERT INTO scheduled_maintenance_tasks"));
      expect(task?.args.slice(5, 8)).toEqual(["error", 1, 1]);
      expect(JSON.parse(String(task?.args[8]))).toEqual(partialMetrics);
      expect(task?.args[9]).toContain("enemy faction 51164: HTTP 504");
    } finally {
      consoleError.mockRestore();
    }
  });
});
