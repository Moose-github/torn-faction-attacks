import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_DATA_HEALTH_SETTINGS,
  statusForAgeSeconds,
  statusForCount,
  statusForPercent,
  updateDataHealthSettingsFromRequest,
} from "./dataHealth";
import type { Env } from "./types";

describe("data health severity", () => {
  it("uses balanced age defaults for warn and critical states", () => {
    expect(statusForAgeSeconds(
      DEFAULT_DATA_HEALTH_SETTINGS.ingestion_warn_seconds - 1,
      DEFAULT_DATA_HEALTH_SETTINGS.ingestion_warn_seconds,
      DEFAULT_DATA_HEALTH_SETTINGS.ingestion_critical_seconds,
    )).toBe("good");
    expect(statusForAgeSeconds(
      DEFAULT_DATA_HEALTH_SETTINGS.ingestion_warn_seconds,
      DEFAULT_DATA_HEALTH_SETTINGS.ingestion_warn_seconds,
      DEFAULT_DATA_HEALTH_SETTINGS.ingestion_critical_seconds,
    )).toBe("warn");
    expect(statusForAgeSeconds(
      DEFAULT_DATA_HEALTH_SETTINGS.ingestion_critical_seconds,
      DEFAULT_DATA_HEALTH_SETTINGS.ingestion_warn_seconds,
      DEFAULT_DATA_HEALTH_SETTINGS.ingestion_critical_seconds,
    )).toBe("critical");
  });

  it("supports custom count thresholds", () => {
    expect(statusForCount(1, 2, 4)).toBe("good");
    expect(statusForCount(2, 2, 4)).toBe("warn");
    expect(statusForCount(4, 2, 4)).toBe("critical");
  });

  it("supports custom percentage thresholds", () => {
    expect(statusForPercent(4.9, 5, 15)).toBe("good");
    expect(statusForPercent(5, 5, 15)).toBe("warn");
    expect(statusForPercent(15, 5, 15)).toBe("critical");
  });

  it("rejects invalid threshold ordering", async () => {
    const save = vi.fn();
    const env = settingsEnv(DEFAULT_DATA_HEALTH_SETTINGS, save);
    const response = await updateDataHealthSettingsFromRequest(
      jsonRequest({ ingestion_warn_seconds: 200, ingestion_critical_seconds: 100 }),
      env,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      ok: false,
      code: "INVALID_DATA_HEALTH_SETTINGS",
    });
    expect(save).not.toHaveBeenCalled();
  });
});

function settingsEnv(settings: Record<string, unknown>, save: () => void): Env {
  return {
    DB: {
      prepare(sql: string) {
        return {
          bind() {
            return {
              first: async () => sql.includes("SELECT *") ? settings : null,
              run: async () => {
                save();
                return { success: true };
              },
            };
          },
        };
      },
    },
  } as unknown as Env;
}

function jsonRequest(body: unknown): Request {
  return new Request("https://worker.test/api/admin/data-health/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
