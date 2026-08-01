import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DISCORD_ALERT_KEYS } from "./discordAlerts";
import type { Env } from "./types";

const discordMock = vi.hoisted(() => ({
  sendDiscordAlertMessageWithAttachment: vi.fn(),
}));

const rendererMock = vi.hoisted(() => ({
  renderXanaxCompetitionReminderGif: vi.fn(async () => new Uint8Array([1, 2, 3])),
}));

vi.mock("./discordAlertDelivery", () => discordMock);
vi.mock("./xanaxCompetitionImageRenderer", () => rendererMock);

import {
  buildMonthlyXanaxCompetitionDiscordMessage,
  getXanaxCompetition,
  runMonthlyXanaxCompetitionDiscordReminder,
} from "./xanaxCompetition";

describe("monthly Xanax competition Discord reminder", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T00:10:00.000Z"));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
    discordMock.sendDiscordAlertMessageWithAttachment.mockReset();
    rendererMock.renderXanaxCompetitionReminderGif.mockClear();
    rendererMock.renderXanaxCompetitionReminderGif.mockResolvedValue(new Uint8Array([1, 2, 3]));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("formats the current prize in the Discord message", () => {
    expect(buildMonthlyXanaxCompetitionDiscordMessage(20_000_000)).toBe(
      "New month, new Xanax competition: the prize is $20,000,000. Take 100 Xanax this month to claim it.",
    );
  });

  it("reconciles rollover before rendering and marks complete after Discord succeeds", async () => {
    const fixture = createReminderFixture({
      lastRolloverMonthKey: "2026-04",
      rolloverCount: 0,
    });
    const scheduledTime = Date.UTC(2026, 5, 1, 0, 10, 0);

    await expect(runMonthlyXanaxCompetitionDiscordReminder(fixture.env, scheduledTime))
      .resolves
      .toEqual({ sent: true, skipped: false, monthKey: "2026-06" });

    expect(fixture.settings.rollover_count).toBe(1);
    expect(rendererMock.renderXanaxCompetitionReminderGif).toHaveBeenCalledWith({
      monthKey: "2026-06",
      currentPrize: 20_000_000,
      xanaxImageDataUri: null,
    });
    expect(discordMock.sendDiscordAlertMessageWithAttachment).toHaveBeenCalledWith(fixture.env, DISCORD_ALERT_KEYS.xanaxCompetition, {
      content: "New month, new Xanax competition: the prize is $20,000,000. Take 100 Xanax this month to claim it.",
      filename: "xanax-competition-2026-06.gif",
      mimeType: "image/gif",
      data: new Uint8Array([1, 2, 3]),
    });
    expect(fixture.operations.indexOf("rollover")).toBeLessThan(
      fixture.operations.lastIndexOf("read-settings"),
    );
    expect(fixture.syncState.has("xanax_competition_discord_reminder:complete:2026-06"))
      .toBe(true);
  });

  it("does not mark the month complete when Discord send fails", async () => {
    discordMock.sendDiscordAlertMessageWithAttachment.mockRejectedValueOnce(new Error("discord down"));
    const fixture = createReminderFixture({
      lastRolloverMonthKey: "2026-04",
      rolloverCount: 0,
    });

    await expect(runMonthlyXanaxCompetitionDiscordReminder(
      fixture.env,
      Date.UTC(2026, 5, 1, 0, 10, 0),
    )).rejects.toThrow("discord down");

    expect(fixture.syncState.has("xanax_competition_discord_reminder:complete:2026-06"))
      .toBe(false);
  });
});

describe("monthly Xanax competition progress", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-25T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("displays the previous month throughout the first five UTC days", async () => {
    for (const timestamp of [
      "2026-07-01T00:00:00.000Z",
      "2026-07-02T12:00:00.000Z",
      "2026-07-03T12:00:00.000Z",
      "2026-07-04T12:00:00.000Z",
      "2026-07-05T23:59:59.000Z",
    ]) {
      vi.setSystemTime(new Date(timestamp));
      const calls: Array<{ method: string; sql: string; params: unknown[] }> = [];
      const env = createProgressFixture(calls, {
        completeRange: { start_date: "2026-04-30", end_date: "2026-06-29" },
      });

      const response = await getXanaxCompetition(env, 3238283);
      const body = await response.json() as any;

      expect(body.settings.month_key).toBe("2026-06");
      expect(body.display).toMatchObject({
        mode: "grace_progress",
        month_key: "2026-06",
        calendar_month_key: "2026-07",
        grace_window: true,
        complete: false,
      });
    }
  });

  it("returns a completed previous-month summary during the grace window when data is complete", async () => {
    vi.setSystemTime(new Date("2026-07-03T12:00:00.000Z"));
    const calls: Array<{ method: string; sql: string; params: unknown[] }> = [];
    const env = createProgressFixture(calls, {
      completeRange: { start_date: "2026-04-30", end_date: "2026-06-30" },
      progressRows: [
        {
          member_id: 111,
          member_name: "Winner",
          start_xantaken: 1000,
          end_xantaken: 1112,
          latest_snapshot_date: "2026-06-30",
        },
        {
          member_id: 222,
          member_name: "Runner",
          start_xantaken: 700,
          end_xantaken: 803,
          latest_snapshot_date: "2026-06-30",
        },
        {
          member_id: 333,
          member_name: "Third",
          start_xantaken: 500,
          end_xantaken: 590,
          latest_snapshot_date: "2026-06-30",
        },
        {
          member_id: 444,
          member_name: "Fourth",
          start_xantaken: 400,
          end_xantaken: 450,
          latest_snapshot_date: "2026-06-30",
        },
      ],
    });

    const response = await getXanaxCompetition(env, 111);
    const body = await response.json() as any;

    expect(body.display).toMatchObject({
      mode: "completed_summary",
      month_key: "2026-06",
      calendar_month_key: "2026-07",
      grace_window: true,
      complete: true,
    });
    expect(body.summary).toMatchObject({
      month_key: "2026-06",
      prize: 10_000_000,
      final_snapshot_date: "2026-06-30",
      eligible_count: 2,
      winner: {
        rank: 1,
        member_id: 111,
        member_name: "Winner",
        monthly_xanax: 112,
        eligible: true,
      },
    });
    expect(body.summary.top_contenders.map((row: any) => row.member_id)).toEqual([111, 222, 333]);
    expect(body.current_user_progress).toMatchObject({
      member_id: 111,
      monthly_xanax: 112,
      eligible: true,
    });
  });

  it("keeps the previous-month progress display during the grace window when data is incomplete", async () => {
    vi.setSystemTime(new Date("2026-07-03T12:00:00.000Z"));
    const calls: Array<{ method: string; sql: string; params: unknown[] }> = [];
    const env = createProgressFixture(calls, {
      completeRange: { start_date: "2026-04-30", end_date: "2026-06-29" },
    });

    const response = await getXanaxCompetition(env, 3238283);
    const body = await response.json() as any;

    expect(body.settings.month_key).toBe("2026-06");
    expect(body.display.mode).toBe("grace_progress");
    expect(body.display.complete).toBe(false);
    expect(body.summary).toBeNull();

    const progressCall = calls.find((call) =>
      call.method === "all" && call.sql.includes("baseline.xantaken AS start_xantaken")
    );
    expect(progressCall?.params.slice(0, 2)).toEqual(["2026-06-01", "2026-06-30"]);
  });

  it("switches to the calendar month on the sixth UTC day", async () => {
    vi.setSystemTime(new Date("2026-07-06T00:00:00.000Z"));
    const calls: Array<{ method: string; sql: string; params: unknown[] }> = [];
    const env = createProgressFixture(calls, {
      completeRange: { start_date: "2026-04-30", end_date: "2026-07-05" },
    });

    const response = await getXanaxCompetition(env, 3238283);
    const body = await response.json() as any;

    expect(body.settings.month_key).toBe("2026-07");
    expect(body.display).toMatchObject({
      mode: "active",
      month_key: "2026-07",
      calendar_month_key: "2026-07",
      grace_window: false,
      complete: false,
    });
    expect(body.summary).toBeNull();
  });

  it("uses the latest faction-complete personal stats date as the leaderboard cutoff", async () => {
    const calls: Array<{ method: string; sql: string; params: unknown[] }> = [];
    const env = createProgressFixture(calls);

    const response = await getXanaxCompetition(env, 3238283);
    const body = await response.json() as any;

    expect(body.settings.month_key).toBe("2026-07");
    expect(body.current_user_progress).toMatchObject({
      member_id: 3238283,
      member_name: "M00SE",
      monthly_xanax: 69,
      remaining: 31,
      eligible: false,
    });

    const progressCall = calls.find((call) =>
      call.method === "all" && call.sql.includes("baseline.xantaken AS start_xantaken")
    );
    expect(progressCall?.sql).toContain("snapshot_date < CASE WHEN members.current_join_date IS NOT NULL");
    expect(progressCall?.sql).toContain("snapshot_date >= CASE WHEN members.current_join_date IS NOT NULL");
    expect(progressCall?.params).toEqual([
      "2026-07-01",
      "2026-07-24",
      "2026-07-01",
      "2026-07-01",
      "2026-07-01",
      "2026-07-01",
      "2026-07-24",
      8803,
    ]);
  });
});

type ReminderFixtureOptions = {
  enabled?: number;
  lastRolloverMonthKey: string | null;
  rolloverCount: number;
};

function createReminderFixture(options: ReminderFixtureOptions): {
  env: Env;
  operations: string[];
  settings: {
    id: number;
    enabled: number;
    base_prize: number;
    rollover_count: number;
    last_rollover_month_key: string | null;
    updated_at: number;
  };
  syncState: Map<string, number>;
} {
  const operations: string[] = [];
  const syncState = new Map<string, number>();
  const settings = {
    id: 1,
    enabled: options.enabled ?? 1,
    base_prize: 10_000_000,
    rollover_count: options.rolloverCount,
    last_rollover_month_key: options.lastRolloverMonthKey,
    updated_at: 1,
  };
  const db = {
    prepare(sql: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...boundValues: unknown[]) {
          values = boundValues;
          return statement;
        },
        async first() {
          const compactSql = compact(sql);
          if (compactSql.includes("FROM sync_state")) {
            const name = String(values[0]);
            const lastStarted = syncState.get(name);
            return lastStarted === undefined
              ? null
              : { name, last_started: lastStarted, active_war_id: null };
          }
          if (compactSql.includes("FROM xanax_competition_settings")) {
            operations.push("read-settings");
            return { ...settings };
          }
          if (compactSql.includes("FROM alert_settings")) {
            return {
              alert_key: DISCORD_ALERT_KEYS.xanaxCompetition,
              enabled: 1,
              configurable: 1,
            };
          }
          if (compactSql.includes("FROM xanax_competition_claims")) {
            operations.push("read-claim");
            return null;
          }
          throw new Error(`Unexpected first query: ${compactSql}`);
        },
        async run() {
          const compactSql = compact(sql);
          if (
            compactSql.includes("INSERT INTO sync_state") &&
            compactSql.includes("WHERE sync_state.last_started < ?")
          ) {
            const name = String(values[0]);
            const now = Number(values[1]);
            const cutoff = Number(values[2]);
            const existing = syncState.get(name) ?? 0;
            const changes = existing < cutoff ? 1 : 0;
            if (changes > 0) {
              syncState.set(name, now);
            }
            return { meta: { changes } };
          }
          if (compactSql.includes("INSERT INTO sync_state")) {
            syncState.set(String(values[0]), Number(values[1]));
            return { meta: { changes: 1 } };
          }
          if (compactSql.includes("UPDATE xanax_competition_settings")) {
            settings.rollover_count += Number(values[0]);
            settings.last_rollover_month_key = String(values[1]);
            settings.updated_at = Number(values[2]);
            operations.push("rollover");
            return { meta: { changes: 1 } };
          }
          if (compactSql.includes("INSERT INTO xanax_competition_settings")) {
            return { meta: { changes: 0 } };
          }
          throw new Error(`Unexpected run query: ${compactSql}`);
        },
        async all() {
          return { results: [] };
        },
      };
      return statement;
    },
    async batch() {
      return [];
    },
  };

  return {
    env: { DB: db } as unknown as Env,
    operations,
    settings,
    syncState,
  };
}

type TestProgressRow = {
  member_id: number;
  member_name: string | null;
  start_xantaken: number | null;
  end_xantaken: number | null;
  latest_snapshot_date: string | null;
};

function createProgressFixture(
  calls: Array<{ method: string; sql: string; params: unknown[] }>,
  options: {
    completeRange?: { start_date: string; end_date: string } | null;
    progressRows?: TestProgressRow[];
  } = {},
): Env {
  const settings = {
    id: 1,
    enabled: 1,
    base_prize: 10_000_000,
    rollover_count: 0,
    last_rollover_month_key: "2026-06",
    updated_at: 1,
  };
  const completeRange = options.completeRange ?? { start_date: "2026-04-30", end_date: "2026-07-23" };
  const progressRows = options.progressRows ?? [
    {
      member_id: 3238283,
      member_name: "M00SE",
      start_xantaken: 2189,
      end_xantaken: 2258,
      latest_snapshot_date: "2026-07-23",
    },
  ];
  const db = {
    prepare(sql: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...boundValues: unknown[]) {
          values = boundValues;
          return statement;
        },
        async first() {
          const compactSql = compact(sql);
          calls.push({ method: "first", sql: compactSql, params: values });
          if (compactSql.includes("MIN(candidate_dates.snapshot_date) AS start_date")) {
            return completeRange;
          }
          if (compactSql.includes("FROM xanax_competition_settings")) {
            return { ...settings };
          }
          return null;
        },
        async run() {
          calls.push({ method: "run", sql: compact(sql), params: values });
          return { meta: { changes: 0 } };
        },
        async all() {
          const compactSql = compact(sql);
          calls.push({ method: "all", sql: compactSql, params: values });
          if (compactSql.includes("baseline.xantaken AS start_xantaken")) {
            return {
              results: progressRows,
            };
          }
          return { results: [] };
        },
      };
      return statement;
    },
  };

  return { DB: db } as unknown as Env;
}

function compact(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}
