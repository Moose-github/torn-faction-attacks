import { beforeEach, describe, expect, it, vi } from "vitest";
import { HeatmapSamplingError, sampleFactionActivityHeatmaps, type HeatmapSampleMetrics } from "./heatmap";
import { runHeatmapSamplingRetry } from "./maintenance";
import type { Env } from "./types";

vi.mock("./heatmap", async (importOriginal) => ({
  ...await importOriginal<typeof import("./heatmap")>(),
  sampleFactionActivityHeatmaps: vi.fn(),
}));

vi.mock("./xanaxCompetition", () => ({
  reconcileXanaxCompetitionRollover: vi.fn(),
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
