import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../types";
import type {
  LifestyleRepairItemRow,
  LifestyleRepairJobRow,
} from "./model";
import {
  DAILY_GYM_COMPLETE_STATE_NAME,
  DAILY_GYM_FAILED_STATE_NAME,
  DAILY_GYM_LOCK_STATE_NAME,
  DAILY_GYM_RETRY_REFRESH_STATE_NAME,
  DAILY_GYM_RETRY_STATE_NAME,
  REPAIR_KEY_PAUSE_PREFIX,
} from "./model";
import { timestampForDailyPoll } from "./dates";

const mocks = vi.hoisted(() => ({
  bumpMemberLifestyleCacheVersion: vi.fn(),
  fetchTornPersonalStatsWithTimestamps: vi.fn(),
  fetchTrackedTornJson: vi.fn(),
  refreshMemberAchievementSummaries: vi.fn(),
  syncHomeFactionMemberList: vi.fn(),
  upsertLifestyleSnapshotPersonalStats: vi.fn(),
  writeLifestyleSnapshotForDate: vi.fn(),
}));

vi.mock("../cacheVersions", () => ({
  bumpMemberLifestyleCacheVersion: mocks.bumpMemberLifestyleCacheVersion,
}));

vi.mock("../external/torn", () => ({
  fetchTrackedTornJson: mocks.fetchTrackedTornJson,
}));

vi.mock("../memberAchievements", () => ({
  refreshMemberAchievementSummaries: mocks.refreshMemberAchievementSummaries,
}));

vi.mock("../personalStats", () => ({
  TornPersonalStatsHttpError: class TornPersonalStatsHttpError extends Error {
    constructor(public readonly status: number) {
      super(`Torn personalstats API error: ${status}`);
    }
  },
  fetchTornPersonalStatsWithTimestamps: mocks.fetchTornPersonalStatsWithTimestamps,
}));

vi.mock("./internal", () => ({
  syncHomeFactionMemberList: mocks.syncHomeFactionMemberList,
  upsertLifestyleSnapshotPersonalStats: mocks.upsertLifestyleSnapshotPersonalStats,
  writeLifestyleSnapshotForDate: mocks.writeLifestyleSnapshotForDate,
}));

import { TornPersonalStatsHttpError } from "../personalStats";
import { refreshDailyGymStats } from "./dailyGym";
import { processMemberLifestyleRepairJobs } from "./repairJobs";

type SyncStateRow = {
  name: string;
  last_started: number | null;
  active_war_id: number | null;
};

type QueryMethod = "first" | "all" | "run";

type QueryCall = {
  method: QueryMethod;
  sql: string;
  params: unknown[];
};

type QueryHandler = (call: QueryCall) => unknown;

class TestD1Database {
  readonly calls: QueryCall[] = [];

  constructor(private readonly handler: QueryHandler) {}

  prepare(sql: string): D1PreparedStatement {
    return new TestD1PreparedStatement(this, compactSql(sql)) as unknown as D1PreparedStatement;
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const results: D1Result<T>[] = [];
    for (const statement of statements) {
      results.push(await statement.run<T>());
    }
    return results;
  }

  execute(method: QueryMethod, sql: string, params: unknown[]): unknown {
    const call = { method, sql, params };
    this.calls.push(call);
    return this.handler(call);
  }
}

class TestD1PreparedStatement {
  private params: unknown[] = [];

  constructor(
    private readonly db: TestD1Database,
    private readonly sql: string,
  ) {}

  bind(...params: unknown[]): D1PreparedStatement {
    this.params = params;
    return this as unknown as D1PreparedStatement;
  }

  async first<T = unknown>(): Promise<T | null> {
    return (this.db.execute("first", this.sql, this.params) ?? null) as T | null;
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    const result = this.db.execute("all", this.sql, this.params);
    if (Array.isArray(result)) {
      return { results: result as T[] } as D1Result<T>;
    }
    return (result ?? { results: [] }) as D1Result<T>;
  }

  async run<T = unknown>(): Promise<D1Result<T>> {
    return (this.db.execute("run", this.sql, this.params) ?? d1Result(0)) as D1Result<T>;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("lifestyle stats workflows", () => {
  it("skips stale repair buckets and later unavailable repair items", async () => {
    const job = repairJob({
      calls_per_minute_per_key: 3,
      total_items: 3,
    });
    const items = [
      repairItem({
        id: "already-completed",
        snapshot_date: "2026-06-04",
        status: "completed",
        returned_bucket_date: "2026-06-04",
      }),
      repairItem({
        id: "stale-bucket",
        snapshot_date: "2026-06-05",
        requested_at: timestampForDailyPoll("2026-06-05"),
      }),
      repairItem({
        id: "later-unavailable",
        snapshot_date: "2026-06-06",
        requested_at: timestampForDailyPoll("2026-06-06"),
      }),
    ];
    const env = repairEnv({ job, items });
    mocks.fetchTornPersonalStatsWithTimestamps.mockResolvedValue(personalStatsResponse("2026-06-04"));

    const result = await processMemberLifestyleRepairJobs(env);

    expect(result.details).toMatchObject({
      job_id: job.id,
      processed: 1,
      skipped: 2,
      failed: 0,
    });
    expect(job.status).toBe("completed");
    expect(job.skipped_items).toBe(2);
    expect(items.find((item) => item.id === "stale-bucket")).toMatchObject({
      status: "skipped",
      returned_bucket_date: "2026-06-04",
      error: null,
    });
    expect(items.find((item) => item.id === "later-unavailable")).toMatchObject({
      status: "skipped",
      returned_bucket_date: "2026-06-04",
      error: null,
    });
    expect(mocks.upsertLifestyleSnapshotPersonalStats).toHaveBeenCalledWith(
      env,
      {
        member_id: 1001,
        member_name: "Tester",
        snapshot_date: "2026-06-04",
      },
      expect.objectContaining({
        daysbeendonator: 42,
        personalstats_bucket_date: "2026-06-04",
      }),
    );
    expect(mocks.refreshMemberAchievementSummaries).toHaveBeenCalledTimes(3);
    expect(mocks.bumpMemberLifestyleCacheVersion).toHaveBeenCalledTimes(1);
  });

  it("requeues rate-limited repair items and pauses the exhausted key", async () => {
    const job = repairJob({ total_items: 1 });
    const items = [repairItem({ id: "rate-limited" })];
    const syncState = new Map<string, SyncStateRow>();
    const env = repairEnv({ job, items, syncState });
    mocks.fetchTornPersonalStatsWithTimestamps.mockRejectedValue(new TornPersonalStatsHttpError(429));

    const result = await processMemberLifestyleRepairJobs(env);

    expect(result.details).toMatchObject({
      job_id: job.id,
      processed: 1,
      completed: 0,
      failed: 0,
      skipped: 0,
    });
    expect(job.status).toBe("running");
    expect(items[0]).toMatchObject({
      status: "pending",
      attempts: 1,
      key_source: "env:TORN_API_KEY",
      error: "Torn personalstats API error: 429",
    });
    expect(syncState.get(`${REPAIR_KEY_PAUSE_PREFIX}:env:TORN_API_KEY`)?.last_started).toBeGreaterThan(0);
    expect(mocks.upsertLifestyleSnapshotPersonalStats).not.toHaveBeenCalled();
    expect(mocks.bumpMemberLifestyleCacheVersion).not.toHaveBeenCalled();
  });

  it("finalizes an expired daily gym retry as partial and clears retry state", async () => {
    const refreshAt = timestampForDailyPoll("2026-06-06") + 10 * 60;
    const now = refreshAt + 6 * 60 * 60;
    const syncState = new Map<string, SyncStateRow>([
      [DAILY_GYM_RETRY_STATE_NAME, syncStateRow(DAILY_GYM_RETRY_STATE_NAME, now - 30, 6)],
      [DAILY_GYM_RETRY_REFRESH_STATE_NAME, syncStateRow(DAILY_GYM_RETRY_REFRESH_STATE_NAME, refreshAt, null)],
    ]);
    const gymFailures: string[] = [];
    const env = gymEnv({ syncState, gymFailures });

    const result = await refreshDailyGymStats(env, {
      homeMembersSynced: true,
      now,
    });

    expect(result).toEqual({
      refreshed_stats: 0,
      updated_members: 0,
      skipped: false,
      failed: true,
      retry_at: null,
    });
    expect(gymFailures).toEqual([
      "Missing gym contributor stats: gymenergy, gymstrength, gymspeed, gymdefense, gymdexterity",
    ]);
    expect(mocks.writeLifestyleSnapshotForDate).toHaveBeenCalledWith(
      env,
      "2026-06-06",
      { freshAfter: refreshAt, allowPartialGym: true },
    );
    expect(syncState.get(DAILY_GYM_FAILED_STATE_NAME)?.last_started).toBe(refreshAt);
    expect(syncState.get(DAILY_GYM_COMPLETE_STATE_NAME)?.last_started).toBe(refreshAt);
    expect(syncState.has(DAILY_GYM_RETRY_STATE_NAME)).toBe(false);
    expect(syncState.has(DAILY_GYM_RETRY_REFRESH_STATE_NAME)).toBe(false);
    expect(syncState.has(DAILY_GYM_LOCK_STATE_NAME)).toBe(false);
    expect(mocks.fetchTrackedTornJson).not.toHaveBeenCalled();
    expect(mocks.bumpMemberLifestyleCacheVersion).toHaveBeenCalledTimes(1);
  });
});

function repairEnv(options: {
  job: LifestyleRepairJobRow;
  items: LifestyleRepairItemRow[];
  syncState?: Map<string, SyncStateRow>;
}): Env {
  const syncState = options.syncState ?? new Map<string, SyncStateRow>();
  const db = new TestD1Database((call) => handleRepairQuery(call, {
    ...options,
    syncState,
  }));

  return {
    DB: db,
    TORN_API_KEY: "primary-key",
  } as unknown as Env;
}

function handleRepairQuery(
  call: QueryCall,
  options: {
    job: LifestyleRepairJobRow;
    items: LifestyleRepairItemRow[];
    syncState: Map<string, SyncStateRow>;
  },
): unknown {
  const { job, items, syncState } = options;
  if (isSyncStateRead(call)) {
    return syncState.get(String(call.params[0])) ?? null;
  }

  if (call.method === "run" && call.sql.includes("INSERT INTO sync_state")) {
    const name = String(call.params[0]);
    syncState.set(name, syncStateRow(name, Number(call.params[1] ?? 0), nullableNumber(call.params[2])));
    return d1Result(1);
  }

  if (
    call.method === "first" &&
    call.sql.includes("FROM member_lifestyle_repair_jobs") &&
    call.sql.includes("WHERE status IN ('queued', 'running')")
  ) {
    return ["queued", "running"].includes(job.status) ? job : null;
  }

  if (
    call.method === "first" &&
    call.sql.includes("FROM member_lifestyle_repair_jobs") &&
    call.sql.includes("WHERE id = ?")
  ) {
    return call.params[0] === job.id ? job : null;
  }

  if (call.method === "run" && call.sql.includes("Reset after stale running state")) {
    return d1Result(0);
  }

  if (
    call.method === "all" &&
    call.sql.includes("FROM member_lifestyle_repair_items") &&
    call.sql.includes("status = 'pending'") &&
    call.sql.includes("ORDER BY snapshot_date ASC, member_id ASC")
  ) {
    const limit = Number(call.params[1] ?? items.length);
    return items
      .filter((item) => item.job_id === job.id && item.status === "pending")
      .sort((left, right) => left.snapshot_date.localeCompare(right.snapshot_date) || left.member_id - right.member_id)
      .slice(0, limit);
  }

  if (call.method === "run" && call.sql.includes("UPDATE member_lifestyle_repair_jobs")) {
    if (call.sql.includes("active_key_count = ?")) {
      job.status = "running";
      job.started_at ??= Number(call.params[0] ?? 0);
      job.active_key_count = Number(call.params[1] ?? 0);
      job.updated_at = Number(call.params[2] ?? job.updated_at);
      return d1Result(1);
    }

    if (call.sql.includes("completed_items = ?")) {
      const counts = repairStatusCounts(items);
      job.completed_items = counts.completed;
      job.failed_items = counts.failed;
      job.skipped_items = counts.skipped;
      job.updated_at = Number(call.params[3] ?? job.updated_at);
      job.last_error = latestRepairError(items);
      return d1Result(1);
    }

    if (call.sql.includes("SET status = ?")) {
      job.status = call.params[0] as LifestyleRepairJobRow["status"];
      job.finished_at ??= Number(call.params[1] ?? 0);
      job.updated_at = Number(call.params[2] ?? job.updated_at);
      return d1Result(1);
    }
  }

  if (call.method === "run" && call.sql.includes("UPDATE member_lifestyle_repair_items")) {
    if (call.sql.includes("attempts = attempts + 1")) {
      const item = findRepairItem(items, call.params[3]);
      item.status = "running";
      item.attempts += 1;
      item.key_source = String(call.params[0]);
      item.started_at ??= Number(call.params[1] ?? 0);
      item.updated_at = Number(call.params[2] ?? item.updated_at);
      return d1Result(1);
    }

    if (call.sql.includes("SET status = 'pending'")) {
      const item = findRepairItem(items, call.params[2]);
      item.status = "pending";
      item.error = String(call.params[0]);
      item.updated_at = Number(call.params[1] ?? item.updated_at);
      return d1Result(1);
    }

    if (call.sql.includes("SET status = 'skipped'") && call.sql.includes("WHERE id = ?")) {
      const item = findRepairItem(items, call.params[4]);
      item.status = "skipped";
      item.returned_bucket_date = String(call.params[0]);
      item.error = call.params[1] === null ? null : String(call.params[1]);
      item.finished_at = Number(call.params[2] ?? 0);
      item.updated_at = Number(call.params[3] ?? item.updated_at);
      return d1Result(1);
    }

    if (call.sql.includes("SET status = 'skipped'") && call.sql.includes("WHERE id IN")) {
      const ids = call.params.slice(3).map(String);
      for (const id of ids) {
        const item = findRepairItem(items, id);
        item.status = "skipped";
        item.returned_bucket_date = String(call.params[0]);
        item.error = null;
        item.finished_at = Number(call.params[1] ?? 0);
        item.updated_at = Number(call.params[2] ?? item.updated_at);
      }
      return d1Result(ids.length);
    }
  }

  if (call.method === "run" && call.sql.includes("UPDATE member_lifestyle_stat_snapshots")) {
    return d1Result(1);
  }

  if (
    call.method === "first" &&
    call.sql.includes("FROM member_lifestyle_repair_items") &&
    call.sql.includes("returned_bucket_date = ?") &&
    call.sql.includes("status IN ('completed', 'skipped')")
  ) {
    const [jobId, memberId, snapshotDate, returnedBucketDate] = call.params;
    return items.find((item) =>
      item.job_id === jobId &&
      item.member_id === memberId &&
      item.snapshot_date < String(snapshotDate) &&
      item.returned_bucket_date === returnedBucketDate &&
      ["completed", "skipped"].includes(item.status)
    ) ?? null;
  }

  if (
    call.method === "all" &&
    call.sql.includes("FROM member_lifestyle_repair_items") &&
    call.sql.includes("status = 'pending'") &&
    call.sql.includes("snapshot_date > ?")
  ) {
    const [jobId, memberId, snapshotDate] = call.params;
    return items
      .filter((item) =>
        item.job_id === jobId &&
        item.member_id === memberId &&
        item.status === "pending" &&
        item.snapshot_date > String(snapshotDate)
      )
      .map((item) => ({ id: item.id, snapshot_date: item.snapshot_date }));
  }

  if (
    call.method === "all" &&
    call.sql.includes("SELECT status, COUNT(*) AS count") &&
    call.sql.includes("FROM member_lifestyle_repair_items")
  ) {
    return Object.entries(repairStatusCounts(items)).map(([status, count]) => ({ status, count }));
  }

  throw new Error(`Unhandled repair query: ${call.method} ${call.sql}`);
}

function gymEnv(options: {
  syncState: Map<string, SyncStateRow>;
  gymFailures: string[];
}): Env {
  const db = new TestD1Database((call) => handleGymQuery(call, options));
  return {
    DB: db,
    TORN_API_KEY: "primary-key",
  } as unknown as Env;
}

function handleGymQuery(
  call: QueryCall,
  options: {
    syncState: Map<string, SyncStateRow>;
    gymFailures: string[];
  },
): unknown {
  const { syncState, gymFailures } = options;
  if (isSyncStateRead(call)) {
    return syncState.get(String(call.params[0])) ?? null;
  }

  if (call.method === "run" && call.sql.includes("INSERT INTO sync_state")) {
    const name = String(call.params[0]);
    const lastStarted = Number(call.params[1] ?? 0);
    const activeWarId = nullableNumber(call.params[2]);
    const existing = syncState.get(name);
    if (call.sql.includes("WHERE sync_state.last_started < ?") && existing && Number(existing.last_started ?? 0) >= Number(call.params[3] ?? 0)) {
      return d1Result(0);
    }
    syncState.set(name, syncStateRow(name, lastStarted, activeWarId));
    return d1Result(1);
  }

  if (call.method === "run" && call.sql.includes("DELETE FROM sync_state")) {
    const deleted = syncState.delete(String(call.params[0]));
    return d1Result(deleted ? 1 : 0);
  }

  if (call.method === "run" && call.sql.includes("UPDATE member_gym_stats_current")) {
    gymFailures.push(String(call.params[0]));
    return d1Result(1);
  }

  throw new Error(`Unhandled gym query: ${call.method} ${call.sql}`);
}

function isSyncStateRead(call: QueryCall): boolean {
  return (
    call.method === "first" &&
    call.sql.includes("FROM sync_state") &&
    call.sql.includes("WHERE name = ?")
  );
}

function repairJob(overrides: Partial<LifestyleRepairJobRow> = {}): LifestyleRepairJobRow {
  return {
    id: "job-1",
    status: "queued",
    start_date: "2026-06-05",
    end_date: "2026-06-06",
    effective_start_date: "2026-06-04",
    member_scope: "current",
    member_id: 1001,
    calls_per_minute_per_key: 1,
    include_primary_key: 1,
    active_key_count: 0,
    total_items: 1,
    completed_items: 0,
    failed_items: 0,
    skipped_items: 0,
    started_at: null,
    finished_at: null,
    created_at: 1,
    updated_at: 1,
    alert_sent_at: null,
    last_error: null,
    ...overrides,
  };
}

function repairItem(overrides: Partial<LifestyleRepairItemRow> = {}): LifestyleRepairItemRow {
  return {
    id: "item-1",
    job_id: "job-1",
    member_id: 1001,
    member_name: "Tester",
    snapshot_date: "2026-06-05",
    requested_at: timestampForDailyPoll("2026-06-05"),
    status: "pending",
    attempts: 0,
    key_source: null,
    returned_bucket_date: null,
    error: null,
    started_at: null,
    finished_at: null,
    updated_at: 1,
    ...overrides,
  };
}

function personalStatsResponse(bucketDate: string): Record<string, { value: number; timestamp: number }> {
  const timestamp = timestampForDailyPoll(bucketDate);
  return {
    xantaken: { value: 10, timestamp },
    overdosed: { value: 0, timestamp },
    refills: { value: 1, timestamp },
    timeplayed: { value: 3600, timestamp },
    networth: { value: 123456, timestamp },
    daysbeendonator: { value: 42, timestamp },
  };
}

function syncStateRow(name: string, lastStarted: number, activeWarId: number | null): SyncStateRow {
  return {
    name,
    last_started: lastStarted,
    active_war_id: activeWarId,
  };
}

function repairStatusCounts(items: LifestyleRepairItemRow[]): Record<LifestyleRepairItemRow["status"], number> {
  return {
    pending: items.filter((item) => item.status === "pending").length,
    running: items.filter((item) => item.status === "running").length,
    completed: items.filter((item) => item.status === "completed").length,
    failed: items.filter((item) => item.status === "failed").length,
    skipped: items.filter((item) => item.status === "skipped").length,
  };
}

function latestRepairError(items: LifestyleRepairItemRow[]): string | null {
  return items
    .filter((item) => item.error !== null)
    .sort((left, right) => right.updated_at - left.updated_at)[0]?.error ?? null;
}

function findRepairItem(items: LifestyleRepairItemRow[], id: unknown): LifestyleRepairItemRow {
  const item = items.find((candidate) => candidate.id === id);
  if (!item) {
    throw new Error(`Missing repair item ${String(id)}`);
  }
  return item;
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function compactSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

function d1Result(changes: number): D1Result {
  return { meta: { changes } } as D1Result;
}
