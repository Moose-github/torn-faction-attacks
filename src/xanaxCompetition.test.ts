import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "./types";

const discordMock = vi.hoisted(() => ({
  sendDiscordMessageWithAttachment: vi.fn(),
}));

const rendererMock = vi.hoisted(() => ({
  renderXanaxCompetitionReminderPng: vi.fn(async () => new Uint8Array([1, 2, 3])),
}));

vi.mock("./discord", () => discordMock);
vi.mock("./xanaxCompetitionImageRenderer", () => rendererMock);

import {
  buildMonthlyXanaxCompetitionDiscordMessage,
  runMonthlyXanaxCompetitionDiscordReminder,
} from "./xanaxCompetition";

describe("monthly Xanax competition Discord reminder", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T00:10:00.000Z"));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
    discordMock.sendDiscordMessageWithAttachment.mockReset();
    rendererMock.renderXanaxCompetitionReminderPng.mockClear();
    rendererMock.renderXanaxCompetitionReminderPng.mockResolvedValue(new Uint8Array([1, 2, 3]));
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
    expect(rendererMock.renderXanaxCompetitionReminderPng).toHaveBeenCalledWith({
      monthKey: "2026-06",
      currentPrize: 20_000_000,
      xanaxImageDataUri: null,
    });
    expect(discordMock.sendDiscordMessageWithAttachment).toHaveBeenCalledWith(fixture.env, {
      content: "New month, new Xanax competition: the prize is $20,000,000. Take 100 Xanax this month to claim it.",
      filename: "xanax-competition-2026-06.png",
      mimeType: "image/png",
      data: new Uint8Array([1, 2, 3]),
    });
    expect(fixture.operations.indexOf("rollover")).toBeLessThan(
      fixture.operations.lastIndexOf("read-settings"),
    );
    expect(fixture.syncState.has("xanax_competition_discord_reminder:complete:2026-06"))
      .toBe(true);
  });

  it("does not mark the month complete when Discord send fails", async () => {
    discordMock.sendDiscordMessageWithAttachment.mockRejectedValueOnce(new Error("discord down"));
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

function compact(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}
