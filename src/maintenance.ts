import { sampleFactionActivityHeatmaps } from "./heatmap";
import { syncHomeFactionMembershipAndSessions } from "./homeFactionMembers";
import { syncMissingRankedWarReports } from "./ingestion";
import { getDailyStatsAttention } from "./lifestyleStats/dailyAttention";
import { refreshMemberAchievementSummariesIfStale } from "./memberAchievements";
import { rebuildOpenWarMemberStatsFromRaw } from "./summaries";
import { readSyncTimestamp, upsertSyncTimestamp } from "./syncState";
import { Env, TornFactionMember } from "./types";
import { d1Changes, json, nowSeconds } from "./utils";
import { reconcileXanaxCompetitionRollover } from "./xanaxCompetition";

type MaintenanceTaskMetrics = {
  writeStatements: number;
  changedRows: number;
  details?: Record<string, unknown>;
};

type MaintenanceTask = {
  name: string;
  run: () => Promise<MaintenanceTaskMetrics>;
};

type MaintenanceTaskLog = MaintenanceTaskMetrics & {
  id: string;
  name: string;
  startedAt: number;
  finishedAt: number;
  status: "success" | "error";
  error: string | null;
};

type ScheduledMaintenanceOptions = {
  prefetchedHeatmapMembersByFaction?: Map<number, TornFactionMember[]>;
};

const METRICS_RETENTION_SECONDS = 14 * 24 * 60 * 60;
const TORN_API_CALL_LOG_RETENTION_SECONDS = 7 * 24 * 60 * 60;
const METRICS_RETENTION_STATE_NAME = "scheduled_metrics_retention";
const MEMBER_STAT_CORRECTION_INTERVAL_SECONDS = 60 * 60;
const MEMBER_STAT_CORRECTION_STATE_NAME = "open_war_member_stats_rebuild";
const NOOP_MAINTENANCE_METRIC_INTERVAL_SECONDS = 60 * 60;

export async function runScheduledMaintenance(
  env: Env,
  options: ScheduledMaintenanceOptions = {},
): Promise<void> {
  const runId = crypto.randomUUID();
  const startedAt = nowSeconds();
  const tasks = buildScheduledMaintenanceTasks(env, options);

  const results = await Promise.all(tasks.map((task) => runMaintenanceTask(task)));
  const retentionResult = await runMaintenanceTask({
    name: "metrics retention cleanup",
    run: () => cleanupOldMetrics(env),
  });
  const loggedResults =
    retentionResult.details?.skipped === true ? results : [...results, retentionResult];

  for (const result of loggedResults) {
    if (result.status === "error") {
      console.error(`Scheduled maintenance ${result.name} failed:`, result.error);
    }
  }

  if (await shouldWriteMaintenanceRunMetric(env, startedAt, loggedResults)) {
    await writeMaintenanceRunMetric(env, runId, startedAt, loggedResults);
  }
}

function buildScheduledMaintenanceTasks(
  env: Env,
  options: ScheduledMaintenanceOptions,
): MaintenanceTask[] {
  return [
    {
      name: "home faction membership",
      run: async () => {
        const result = await syncHomeFactionMembershipAndSessions(env);
        return {
          writeStatements: result.writeStatements,
          changedRows: result.changedRows,
          details: result,
        };
      },
    },
    {
      name: "heatmap sampling",
      run: () =>
        sampleFactionActivityHeatmaps(env, {
          membersByFaction: options.prefetchedHeatmapMembersByFaction,
        }),
    },
    {
      name: "missing ranked war reports",
      run: async () => {
        const result = await syncMissingRankedWarReports(env);
        return {
          writeStatements: result.writeOperations,
          changedRows: result.writeOperations,
          details: result,
        };
      },
    },
    {
      name: "member stat correction",
      run: () => runMemberStatCorrectionIfDue(env),
    },
    {
      name: "member achievements",
      run: () => refreshMemberAchievementSummariesIfStale(env),
    },
    {
      name: "xanax competition rollover",
      run: () => reconcileXanaxCompetitionRollover(env),
    },
  ];
}

export async function getLatestMaintenanceRun(env: Env): Promise<Response> {
  const run = await env.DB.prepare(
    `
    SELECT *
    FROM scheduled_maintenance_runs
    ORDER BY started_at DESC
    LIMIT 1
    `,
  )
    .first()
    .catch((err: any) => {
      console.warn("Unable to read scheduled maintenance run metric:", err?.message || err);
      return null;
    });

  if (!run) {
    return json({ ok: true, run: null, tasks: [], daily_stats_attention: await getDailyStatsAttention(env) });
  }

  const tasks = await env.DB.prepare(
    `
    SELECT *
    FROM scheduled_maintenance_tasks
    WHERE run_id = ?
    ORDER BY started_at ASC, task_name ASC
    `,
  )
    .bind((run as { id: string }).id)
    .all()
    .catch((err: any) => {
      console.warn("Unable to read scheduled maintenance task metrics:", err?.message || err);
      return { results: [] };
    });

  return json({
    ok: true,
    run,
    tasks: tasks.results ?? [],
    daily_stats_attention: await getDailyStatsAttention(env),
  });
}

async function runMaintenanceTask(task: MaintenanceTask): Promise<MaintenanceTaskLog> {
  const startedAt = nowSeconds();
  try {
    const result = await task.run();
    return {
      id: crypto.randomUUID(),
      name: task.name,
      startedAt,
      finishedAt: nowSeconds(),
      status: "success",
      error: null,
      writeStatements: result.writeStatements,
      changedRows: result.changedRows,
      details: result.details,
    };
  } catch (err: any) {
    return {
      id: crypto.randomUUID(),
      name: task.name,
      startedAt,
      finishedAt: nowSeconds(),
      status: "error",
      error: err?.message || String(err),
      writeStatements: 0,
      changedRows: 0,
      details: undefined,
    };
  }
}

async function writeMaintenanceRunMetric(
  env: Env,
  runId: string,
  startedAt: number,
  results: MaintenanceTaskLog[],
): Promise<void> {
  const finishedAt = nowSeconds();
  const failed = results.find((result) => result.status === "error");
  const writeStatements = results.reduce((total, result) => total + result.writeStatements, 0);
  const changedRows = results.reduce((total, result) => total + result.changedRows, 0);

  const statements = [
    env.DB.prepare(
      `
      INSERT INTO scheduled_maintenance_runs (
        id,
        started_at,
        finished_at,
        status,
        task_count,
        write_statements,
        changed_rows,
        error
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).bind(
      runId,
      startedAt,
      finishedAt,
      failed ? "error" : "success",
      results.length,
      writeStatements,
      changedRows,
      failed?.error ?? null,
    ),
    ...results.filter(shouldLogMaintenanceTask).map((result) =>
      env.DB.prepare(
        `
        INSERT INTO scheduled_maintenance_tasks (
          id,
          run_id,
          task_name,
          started_at,
          finished_at,
          status,
          write_statements,
          changed_rows,
          details,
          error
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      ).bind(
        result.id,
        runId,
        result.name,
        result.startedAt,
        result.finishedAt,
        result.status,
        result.writeStatements,
        result.changedRows,
        result.details ? JSON.stringify(result.details) : null,
        result.error,
      ),
    ),
  ];

  await env.DB.batch(statements).catch((err: any) => {
    console.warn("Unable to write scheduled maintenance metrics:", err?.message || err);
  });
}

function shouldLogMaintenanceTask(result: MaintenanceTaskLog): boolean {
  if (result.status === "error") {
    return true;
  }

  if (result.writeStatements === 0 && result.changedRows === 0) {
    return false;
  }

  if (result.name === "heatmap sampling") {
    return result.writeStatements > 1 || result.changedRows > 1;
  }

  if (result.name === "home faction membership") {
    return result.changedRows > 0;
  }

  return true;
}

async function shouldWriteMaintenanceRunMetric(
  env: Env,
  startedAt: number,
  results: MaintenanceTaskLog[],
): Promise<boolean> {
  if (results.length > 0) {
    return true;
  }

  const latest = (await env.DB.prepare(
    `
    SELECT started_at
    FROM scheduled_maintenance_runs
    ORDER BY started_at DESC
    LIMIT 1
    `,
  )
    .first()
    .catch(() => null)) as { started_at: number | null } | null;

  return Number(latest?.started_at ?? 0) <= startedAt - NOOP_MAINTENANCE_METRIC_INTERVAL_SECONDS;
}

async function runMemberStatCorrectionIfDue(env: Env): Promise<MaintenanceTaskMetrics> {
  const now = nowSeconds();
  const lastCorrectionAt = await readSyncTimestamp(env, MEMBER_STAT_CORRECTION_STATE_NAME);

  if (lastCorrectionAt > now - MEMBER_STAT_CORRECTION_INTERVAL_SECONDS) {
    return {
      writeStatements: 0,
      changedRows: 0,
      details: {
        skipped: true,
        reason: "member stat correction already ran in the last hour",
      },
    };
  }

  const result = await rebuildOpenWarMemberStatsFromRaw(env);
  if (result.wars_rebuilt === 0) {
    return {
      writeStatements: 0,
      changedRows: 0,
      details: result,
    };
  }

  await upsertSyncTimestamp(env, MEMBER_STAT_CORRECTION_STATE_NAME, now);

  return {
    writeStatements: result.wars_rebuilt + 1,
    changedRows: result.wars_rebuilt + 1,
    details: result,
  };
}

async function cleanupOldMetrics(env: Env): Promise<MaintenanceTaskMetrics> {
  const now = nowSeconds();
  const lastCleanupAt = await readSyncTimestamp(env, METRICS_RETENTION_STATE_NAME);

  if (lastCleanupAt > now - 24 * 60 * 60) {
    return {
      writeStatements: 0,
      changedRows: 0,
      details: {
        skipped: true,
        reason: "retention already ran in the last 24 hours",
      },
    };
  }

  const cutoff = now - METRICS_RETENTION_SECONDS;
  const taskDelete = await env.DB.prepare(
    `
    DELETE FROM scheduled_maintenance_tasks
    WHERE run_id IN (
      SELECT id
      FROM scheduled_maintenance_runs
      WHERE started_at < ?
    )
    `,
  )
    .bind(cutoff)
    .run();
  const maintenanceDelete = await env.DB.prepare(
    `
    DELETE FROM scheduled_maintenance_runs
    WHERE started_at < ?
    `,
  )
    .bind(cutoff)
    .run();
  const ingestionDelete = await env.DB.prepare(
    `
    DELETE FROM ingestion_runs
    WHERE started_at < ?
    `,
  )
    .bind(cutoff)
    .run();
  const tornApiCallLogCutoff = now - TORN_API_CALL_LOG_RETENTION_SECONDS;
  const tornApiCallLogDelete = await env.DB.prepare(
    `
    DELETE FROM torn_api_call_log
    WHERE requested_at < ?
    `,
  )
    .bind(tornApiCallLogCutoff)
    .run();

  await upsertSyncTimestamp(env, METRICS_RETENTION_STATE_NAME, now);

  const deletedMaintenanceTasks = d1Changes(taskDelete);
  const deletedMaintenanceRuns = d1Changes(maintenanceDelete);
  const deletedIngestionRuns = d1Changes(ingestionDelete);
  const deletedTornApiCallLogs = d1Changes(tornApiCallLogDelete);

  return {
    writeStatements: 5,
    changedRows:
      deletedMaintenanceTasks +
      deletedMaintenanceRuns +
      deletedIngestionRuns +
      deletedTornApiCallLogs +
      1,
    details: {
      cutoff,
      retention_days: 14,
      torn_api_call_log_cutoff: tornApiCallLogCutoff,
      torn_api_call_log_retention_days: 7,
      deleted_maintenance_tasks: deletedMaintenanceTasks,
      deleted_maintenance_runs: deletedMaintenanceRuns,
      deleted_ingestion_runs: deletedIngestionRuns,
      deleted_torn_api_call_logs: deletedTornApiCallLogs,
    },
  };
}
