import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../types";
import type {
  XantakenRecheckRow,
  XantakenRecheckStatus,
} from "./model";
import { timestampForDailyPoll } from "./dates";

const mocks = vi.hoisted(() => ({
  bumpMemberLifestyleCacheVersion: vi.fn(),
  fetchTornPersonalStatsWithTimestamps: vi.fn(),
  refreshMemberAchievementSummaries: vi.fn(),
  runWithTornKeyPool: vi.fn(),
  upsertLifestyleSnapshotPersonalStats: vi.fn(),
}));

vi.mock("../cacheVersions", () => ({
  bumpMemberLifestyleCacheVersion: mocks.bumpMemberLifestyleCacheVersion,
}));

vi.mock("../memberAchievements", () => ({
  refreshMemberAchievementSummaries: mocks.refreshMemberAchievementSummaries,
}));

vi.mock("../personalStats", () => ({
  fetchTornPersonalStatsWithTimestamps: mocks.fetchTornPersonalStatsWithTimestamps,
}));

vi.mock("../tornKeyPool", () => ({
  runWithTornKeyPool: mocks.runWithTornKeyPool,
}));

vi.mock("./internal", () => ({
  upsertLifestyleSnapshotPersonalStats: mocks.upsertLifestyleSnapshotPersonalStats,
}));

import {
  processXantakenRechecks,
  queueImpossibleXantakenDeltaIfNeeded,
  queueStaleStatsRecheckIfNeeded,
  queueXantakenRecheckIfNeeded,
} from "./xantakenRechecks";

type QueryMethod = "first" | "all" | "run";

type QueryCall = {
  method: QueryMethod;
  sql: string;
  params: unknown[];
};

type SnapshotRow = {
  member_id: number;
  snapshot_date: string;
  member_name: string | null;
  xantaken: number | null;
  personal_ready: number;
  [stat: string]: unknown;
};

class TestD1Database {
  readonly calls: QueryCall[] = [];

  constructor(private readonly handler: (call: QueryCall) => unknown) {}

  prepare(sql: string): D1PreparedStatement {
    return new TestD1PreparedStatement(this, compactSql(sql)) as unknown as D1PreparedStatement;
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
  mocks.runWithTornKeyPool.mockImplementation(async (_env: Env, options: any) => ({
    result: await options.run({ key: "key", keySource: "key_pool:test" }),
    candidate: { keySource: "key_pool:test" },
  }));
});

describe("xantaken rechecks", () => {
  it("queues zero-delta rechecks for members without repeated zero-use history", async () => {
    const fixture = fixtureEnv({
      snapshots: [
        snapshot("2026-08-05", 2297),
        snapshot("2026-08-06", 2297),
      ],
      history: [
        { xantaken: 2297, previous_xantaken: 2294 },
        { xantaken: 2294, previous_xantaken: 2291 },
      ],
    });

    await expect(queueXantakenRecheckIfNeeded(fixture.env, 3238283, "2026-08-06")).resolves.toBe(true);

    expect(fixture.rechecks.get("3238283:2026-08-06")).toMatchObject({
      status: "pending",
      reason: "zero_delta_recheck",
      prior_xantaken: 2297,
      current_xantaken: 2297,
    });
  });

  it("skips zero-delta rechecks for repeated zero-use members", async () => {
    const fixture = fixtureEnv({
      snapshots: [
        snapshot("2026-08-05", 3287),
        snapshot("2026-08-06", 3287),
      ],
      history: [
        { xantaken: 3287, previous_xantaken: 3287 },
        { xantaken: 3287, previous_xantaken: 3287 },
        { xantaken: 3287, previous_xantaken: 3287 },
        { xantaken: 3287, previous_xantaken: 3287 },
      ],
    });

    await expect(queueXantakenRecheckIfNeeded(fixture.env, 3238283, "2026-08-06")).resolves.toBe(false);

    expect(fixture.rechecks.size).toBe(0);
  });

  it("queues the previous day when a later snapshot has an impossible jump", async () => {
    const fixture = fixtureEnv({
      snapshots: [
        snapshot("2026-08-05", 2297),
        snapshot("2026-08-06", 2297),
        snapshot("2026-08-07", 2304),
      ],
    });

    await expect(queueImpossibleXantakenDeltaIfNeeded(fixture.env, 3238283, "2026-08-07")).resolves.toBe(true);

    expect(fixture.rechecks.get("3238283:2026-08-06")).toMatchObject({
      status: "pending",
      reason: "impossible_delta",
      prior_xantaken: 2297,
      current_xantaken: 2297,
      next_xantaken: 2304,
    });
  });

  it("auto-fixes the M00SE stale zero when a recheck returns a valid same-bucket value", async () => {
    const fixture = fixtureEnv({
      snapshots: [
        snapshot("2026-08-05", 2297),
        snapshot("2026-08-06", 2297),
        snapshot("2026-08-07", 2304),
      ],
      rechecks: [
        recheck({
          reason: "zero_delta_recheck",
          prior_xantaken: 2297,
          current_xantaken: 2297,
          next_xantaken: 2304,
        }),
      ],
    });
    mocks.fetchTornPersonalStatsWithTimestamps.mockResolvedValue(personalStatsResponse("2026-08-06", 2300));

    const result = await processXantakenRechecks(fixture.env, { now: 100, limit: 5 });

    expect(result).toMatchObject({ processed: 1, auto_fixed: 1, skipped: false });
    expect(fixture.rechecks.get("3238283:2026-08-06")).toMatchObject({
      status: "auto_fixed",
      returned_bucket_date: "2026-08-06",
      returned_xantaken: 2300,
    });
    expect(mocks.upsertLifestyleSnapshotPersonalStats).toHaveBeenCalledWith(
      fixture.env,
      {
        member_id: 3238283,
        member_name: "M00SE",
        snapshot_date: "2026-08-06",
      },
      expect.objectContaining({
        xantaken: 2300,
        personalstats_bucket_date: "2026-08-06",
      }),
    );
    expect(mocks.refreshMemberAchievementSummaries).toHaveBeenCalledWith(fixture.env, "2026-08-06");
    expect(mocks.bumpMemberLifestyleCacheVersion).toHaveBeenCalledTimes(1);
  });

  it("marks rechecks as needing repair when the returned value still violates neighboring limits", async () => {
    const fixture = fixtureEnv({
      snapshots: [
        snapshot("2026-08-05", 2297),
        snapshot("2026-08-06", 2297),
        snapshot("2026-08-07", 2304),
      ],
      rechecks: [
        recheck({
          reason: "zero_delta_recheck",
          prior_xantaken: 2297,
          current_xantaken: 2297,
          next_xantaken: 2304,
        }),
      ],
    });
    mocks.fetchTornPersonalStatsWithTimestamps.mockResolvedValue(personalStatsResponse("2026-08-06", 2298));

    const result = await processXantakenRechecks(fixture.env, { now: 100, limit: 5 });

    expect(result).toMatchObject({ processed: 1, needs_repair: 1 });
    expect(fixture.rechecks.get("3238283:2026-08-06")).toMatchObject({
      status: "needs_repair",
      returned_xantaken: 2298,
    });
    expect(mocks.upsertLifestyleSnapshotPersonalStats).not.toHaveBeenCalled();
  });

  it("reschedules bucket mismatches without updating snapshot data", async () => {
    const fixture = fixtureEnv({
      snapshots: [
        snapshot("2026-08-05", 2297),
        snapshot("2026-08-06", 2297),
      ],
      rechecks: [recheck({ attempts: 0 })],
    });
    mocks.fetchTornPersonalStatsWithTimestamps.mockResolvedValue(personalStatsResponse("2026-08-05", 2297));

    const result = await processXantakenRechecks(fixture.env, { now: 100, limit: 5 });

    expect(result).toMatchObject({ processed: 1, auto_fixed: 0, failed: 0 });
    expect(fixture.rechecks.get("3238283:2026-08-06")).toMatchObject({
      status: "pending",
      attempts: 1,
      returned_bucket_date: "2026-08-05",
    });
    expect(mocks.upsertLifestyleSnapshotPersonalStats).not.toHaveBeenCalled();
  });
});

describe("stale stat rechecks", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("queues a re-fetch two days after the day starts when a stat looked unchanged", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-24T06:10:00.000Z"));
    const fixture = fixtureEnv({
      snapshots: [savedDay("2026-10-23", { refills: { value: 120, day: "2026-10-21" } })],
    });

    await expect(queueStaleStatsRecheckIfNeeded(fixture.env, 3238283, "2026-10-23")).resolves.toBe(true);

    expect(fixture.rechecks.get("3238283:2026-10-23")).toMatchObject({
      status: "pending",
      reason: "stale_stats_recheck",
      requested_at: timestampForDailyPoll("2026-10-23"),
      current_xantaken: 2300,
      max_attempts: 2,
      next_check_at: timestampForDailyPoll("2026-10-25"),
    });
  });

  it("skips days where every stat changed that day", async () => {
    const fixture = fixtureEnv({ snapshots: [savedDay("2026-10-23")] });

    await expect(queueStaleStatsRecheckIfNeeded(fixture.env, 3238283, "2026-10-23")).resolves.toBe(false);
    expect(fixture.rechecks.size).toBe(0);
  });

  it("leaves a day already queued for a Xanax recheck alone", async () => {
    const fixture = fixtureEnv({
      snapshots: [savedDay("2026-10-23", { refills: { value: 120, day: "2026-10-21" } })],
      rechecks: [recheck({ snapshot_date: "2026-10-23", reason: "zero_delta_recheck" })],
    });

    await expect(queueStaleStatsRecheckIfNeeded(fixture.env, 3238283, "2026-10-23")).resolves.toBe(false);
    expect(fixture.rechecks.get("3238283:2026-10-23")?.reason).toBe("zero_delta_recheck");
  });

  it("fixes only the stats Torn has since updated", async () => {
    const fixture = fixtureEnv({
      snapshots: [savedDay("2026-10-23", {
        refills: { value: 120, day: "2026-10-21" },
        networth: { value: 900000, day: "2026-10-22" },
      })],
      rechecks: [staleStatsRecheck()],
    });
    mocks.fetchTornPersonalStatsWithTimestamps.mockResolvedValue(fetchedDay("2026-10-23", {
      refills: { value: 122, day: "2026-10-23" },
      networth: { value: 880000, day: "2026-10-21" },
    }));

    const result = await processXantakenRechecks(fixture.env, { now: timestampForDailyPoll("2026-10-25"), limit: 5 });

    expect(result).toMatchObject({ processed: 1, auto_fixed: 1 });
    expect(fixture.rechecks.get("3238283:2026-10-23")?.status).toBe("auto_fixed");
    expect(mocks.upsertLifestyleSnapshotPersonalStats).toHaveBeenCalledWith(
      fixture.env,
      expect.objectContaining({ snapshot_date: "2026-10-23" }),
      expect.objectContaining({
        refills: 122,
        refills_timestamp: timestampForDailyPoll("2026-10-23"),
        networth: 900000,
        networth_timestamp: timestampForDailyPoll("2026-10-22"),
        xantaken: 2300,
        personalstats_key_source: "key_pool:test",
      }),
    );
  });

  it("keeps an impossible Xanax jump flagged even when other stats are corrected", async () => {
    const fixture = fixtureEnv({
      snapshots: [savedDay("2026-10-23", { refills: { value: 120, day: "2026-10-21" } })],
      rechecks: [recheck({ snapshot_date: "2026-10-23", reason: "impossible_delta", current_xantaken: 2300 })],
    });
    mocks.fetchTornPersonalStatsWithTimestamps.mockResolvedValue(fetchedDay("2026-10-23", {
      refills: { value: 122, day: "2026-10-23" },
    }));

    const result = await processXantakenRechecks(fixture.env, { now: timestampForDailyPoll("2026-10-25"), limit: 5 });

    expect(result).toMatchObject({ processed: 1, needs_repair: 1, auto_fixed: 0 });
    expect(mocks.upsertLifestyleSnapshotPersonalStats).toHaveBeenCalledWith(
      fixture.env,
      expect.anything(),
      expect.objectContaining({ refills: 122, xantaken: 2300 }),
    );
  });

  it("confirms an unchanged day after a single re-fetch", async () => {
    const fixture = fixtureEnv({
      snapshots: [savedDay("2026-10-23", { refills: { value: 120, day: "2026-10-21" } })],
      rechecks: [staleStatsRecheck()],
    });
    mocks.fetchTornPersonalStatsWithTimestamps.mockResolvedValue(fetchedDay("2026-10-23", {
      refills: { value: 120, day: "2026-10-21" },
    }));

    const result = await processXantakenRechecks(fixture.env, { now: timestampForDailyPoll("2026-10-25"), limit: 5 });

    expect(result).toMatchObject({ processed: 1, confirmed_zero: 1 });
    expect(fixture.rechecks.get("3238283:2026-10-23")).toMatchObject({ status: "confirmed_zero", attempts: 1 });
    expect(mocks.upsertLifestyleSnapshotPersonalStats).not.toHaveBeenCalled();
  });
});

function staleStatsRecheck(): XantakenRecheckRow {
  return recheck({
    snapshot_date: "2026-10-23",
    reason: "stale_stats_recheck",
    requested_at: timestampForDailyPoll("2026-10-23"),
    prior_xantaken: null,
    current_xantaken: 2300,
    max_attempts: 2,
    next_check_at: timestampForDailyPoll("2026-10-25"),
  });
}

/** A Torn response for the day with every stat changed that day except the given ones. */
function fetchedDay(
  snapshotDate: string,
  overrides: Partial<Record<string, { value: number; day: string }>> = {},
): Record<string, { value: number; timestamp: number }> {
  const stat = (key: string, value: number) => ({
    value: overrides[key]?.value ?? value,
    timestamp: timestampForDailyPoll(overrides[key]?.day ?? snapshotDate),
  });
  return {
    xantaken: stat("xantaken", 2300),
    overdosed: stat("overdosed", 4),
    refills: stat("refills", 120),
    timeplayed: stat("timeplayed", 5000),
    networth: stat("networth", 900000),
    daysbeendonator: stat("daysbeendonator", 300),
  };
}

function fixtureEnv(options: {
  snapshots: SnapshotRow[];
  history?: Array<{ xantaken: number | null; previous_xantaken: number | null }>;
  rechecks?: XantakenRecheckRow[];
}): { env: Env; rechecks: Map<string, XantakenRecheckRow> } {
  const snapshots = new Map(options.snapshots.map((row) => [`${row.member_id}:${row.snapshot_date}`, row]));
  const rechecks = new Map((options.rechecks ?? []).map((row) => [`${row.member_id}:${row.snapshot_date}`, row]));
  const history = options.history ?? [];
  mocks.upsertLifestyleSnapshotPersonalStats.mockImplementation(async (_env: Env, target: any, stats: any) => {
    const key = `${target.member_id}:${target.snapshot_date}`;
    const existing = snapshots.get(key);
    snapshots.set(key, {
      ...existing,
      member_id: target.member_id,
      snapshot_date: target.snapshot_date,
      member_name: target.member_name ?? existing?.member_name ?? null,
      ...stats,
      personal_ready: 1,
    });
  });
  const db = new TestD1Database((call) => {
    if (
      call.method === "all" &&
      call.sql.includes("FROM member_lifestyle_stat_snapshots") &&
      call.sql.includes("snapshot_date IN")
    ) {
      const [memberId, ...dates] = call.params;
      return dates
        .map((date) => snapshots.get(`${memberId}:${date}`))
        .filter(Boolean);
    }

    if (call.method === "all" && call.sql.includes("WITH ordered AS")) {
      return history;
    }

    if (call.method === "first" && call.sql.includes("FROM member_lifestyle_stat_snapshots")) {
      const [memberId, snapshotDate] = call.params;
      return snapshots.get(`${memberId}:${snapshotDate}`) ?? null;
    }

    if (call.method === "run" && call.sql.includes("'stale_stats_recheck'")) {
      const [memberId, snapshotDate, memberName, requestedAt, currentXantaken, maxAttempts, nextCheckAt, createdAt, updatedAt] = call.params;
      const key = `${memberId}:${snapshotDate}`;
      if (rechecks.has(key)) {
        return d1Result(0);
      }
      rechecks.set(key, recheck({
        member_id: Number(memberId),
        snapshot_date: String(snapshotDate),
        member_name: nullableString(memberName),
        reason: "stale_stats_recheck",
        requested_at: Number(requestedAt),
        prior_xantaken: null,
        current_xantaken: nullableNumber(currentXantaken),
        max_attempts: Number(maxAttempts),
        next_check_at: Number(nextCheckAt),
        created_at: Number(createdAt),
        updated_at: Number(updatedAt),
      }));
      return d1Result(1);
    }

    if (call.method === "run" && call.sql.includes("INSERT INTO member_lifestyle_xantaken_rechecks")) {
      const [
        memberId,
        snapshotDate,
        memberName,
        reason,
        requestedAt,
        priorXantaken,
        currentXantaken,
        nextXantaken,
        maxAttempts,
        nextCheckAt,
        createdAt,
        updatedAt,
      ] = call.params;
      const key = `${memberId}:${snapshotDate}`;
      const existing = rechecks.get(key);
      rechecks.set(key, {
        member_id: Number(memberId),
        snapshot_date: String(snapshotDate),
        member_name: memberName === null ? null : String(memberName),
        status: "pending",
        reason: existing?.reason === "impossible_delta" ? existing.reason : reason as XantakenRecheckRow["reason"],
        requested_at: Number(requestedAt),
        prior_xantaken: nullableNumber(priorXantaken),
        current_xantaken: nullableNumber(currentXantaken),
        next_xantaken: nullableNumber(nextXantaken),
        attempts: existing?.attempts ?? 0,
        max_attempts: Number(maxAttempts),
        next_check_at: Number(nextCheckAt),
        returned_bucket_date: null,
        returned_xantaken: null,
        key_source: existing?.key_source ?? null,
        last_error: null,
        created_at: existing?.created_at ?? Number(createdAt),
        updated_at: Number(updatedAt),
        finished_at: null,
      });
      return d1Result(1);
    }

    if (call.method === "all" && call.sql.includes("FROM member_lifestyle_xantaken_rechecks")) {
      const [now, limit] = call.params;
      return Array.from(rechecks.values())
        .filter((row) => row.status === "pending" && row.next_check_at <= Number(now))
        .sort((left, right) =>
          (left.reason === "impossible_delta" ? 0 : 1) - (right.reason === "impossible_delta" ? 0 : 1) ||
          left.next_check_at - right.next_check_at ||
          left.snapshot_date.localeCompare(right.snapshot_date) ||
          left.member_id - right.member_id)
        .slice(0, Number(limit));
    }

    if (call.method === "run" && call.sql.includes("UPDATE member_lifestyle_xantaken_rechecks")) {
      const isFinished = call.sql.includes("finished_at = ?");
      if (isFinished) {
        const [
          status,
          returnedBucketDate,
          returnedXantaken,
          keySource,
          error,
          finishedAt,
          updatedAt,
          memberId,
          snapshotDate,
        ] = call.params;
        const row = requireRecheck(rechecks, memberId, snapshotDate);
        row.status = status as XantakenRecheckStatus;
        row.attempts += 1;
        row.returned_bucket_date = nullableString(returnedBucketDate);
        row.returned_xantaken = nullableNumber(returnedXantaken);
        row.key_source = nullableString(keySource) ?? row.key_source;
        row.last_error = nullableString(error);
        row.finished_at = Number(finishedAt);
        row.updated_at = Number(updatedAt);
        return d1Result(1);
      }

      const [
        nextCheckAt,
        returnedBucketDate,
        returnedXantaken,
        keySource,
        error,
        updatedAt,
        memberId,
        snapshotDate,
      ] = call.params;
      const row = requireRecheck(rechecks, memberId, snapshotDate);
      row.attempts += 1;
      row.next_check_at = Number(nextCheckAt);
      row.returned_bucket_date = nullableString(returnedBucketDate);
      row.returned_xantaken = nullableNumber(returnedXantaken);
      row.key_source = nullableString(keySource) ?? row.key_source;
      row.last_error = nullableString(error);
      row.updated_at = Number(updatedAt);
      return d1Result(1);
    }

    if (call.method === "run" && call.sql.includes("UPDATE member_personal_stats_recent")) {
      return d1Result(1);
    }

    throw new Error(`Unhandled query: ${call.method} ${call.sql}`);
  });

  return { env: { DB: db } as unknown as Env, rechecks };
}

function snapshot(snapshotDate: string, xantaken: number | null, stats: Partial<SnapshotRow> = {}): SnapshotRow {
  return {
    member_id: 3238283,
    snapshot_date: snapshotDate,
    member_name: "M00SE",
    xantaken,
    personal_ready: 1,
    overdosed: null,
    refills: null,
    useractivity: null,
    networth: null,
    daysbeendonator: null,
    xantaken_timestamp: null,
    overdosed_timestamp: null,
    refills_timestamp: null,
    useractivity_timestamp: null,
    networth_timestamp: null,
    daysbeendonator_timestamp: null,
    personalstats_bucket_date: null,
    personalstats_requested_at: null,
    personalstats_key_source: null,
    ...stats,
  };
}

/** A saved day where every stat except the given ones changed that day. */
function savedDay(snapshotDate: string, unchanged: Partial<Record<string, { value: number; day: string }>> = {}): SnapshotRow {
  const dayStart = timestampForDailyPoll(snapshotDate);
  const stat = (key: string, value: number) => ({
    [key]: unchanged[key]?.value ?? value,
    [`${key}_timestamp`]: unchanged[key] ? timestampForDailyPoll(unchanged[key]!.day) : dayStart,
  });
  return snapshot(snapshotDate, null, {
    ...stat("xantaken", 2300),
    ...stat("overdosed", 4),
    ...stat("refills", 120),
    ...stat("useractivity", 5000),
    ...stat("networth", 900000),
    ...stat("daysbeendonator", 300),
    personalstats_bucket_date: snapshotDate,
    personalstats_requested_at: dayStart,
    personalstats_key_source: "key_pool:first",
  });
}

function recheck(overrides: Partial<XantakenRecheckRow> = {}): XantakenRecheckRow {
  return {
    member_id: 3238283,
    snapshot_date: "2026-08-06",
    member_name: "M00SE",
    status: "pending",
    reason: "zero_delta_recheck",
    requested_at: timestampForDailyPoll("2026-08-06"),
    prior_xantaken: 2297,
    current_xantaken: 2297,
    next_xantaken: null,
    attempts: 0,
    max_attempts: 3,
    next_check_at: 0,
    returned_bucket_date: null,
    returned_xantaken: null,
    key_source: null,
    last_error: null,
    created_at: 1,
    updated_at: 1,
    finished_at: null,
    ...overrides,
  };
}

function personalStatsResponse(bucketDate: string, xantaken: number): Record<string, { value: number; timestamp: number }> {
  const timestamp = timestampForDailyPoll(bucketDate);
  return {
    xantaken: { value: xantaken, timestamp },
    overdosed: { value: 0, timestamp },
    refills: { value: 1, timestamp },
    timeplayed: { value: 3600, timestamp },
    networth: { value: 123456, timestamp },
    daysbeendonator: { value: 42, timestamp },
  };
}

function requireRecheck(
  rechecks: Map<string, XantakenRecheckRow>,
  memberId: unknown,
  snapshotDate: unknown,
): XantakenRecheckRow {
  const row = rechecks.get(`${memberId}:${snapshotDate}`);
  if (!row) {
    throw new Error(`Missing recheck ${memberId}:${snapshotDate}`);
  }
  return row;
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function compactSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

function d1Result(changes: number): D1Result {
  return { meta: { changes } } as D1Result;
}
