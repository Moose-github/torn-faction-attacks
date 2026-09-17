import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readSyncState } from "./syncState";
import type { Env } from "./types";
import { endWarPractically, finishEventTracking } from "./warLifecycle";
import { endActiveWar } from "./wars";

vi.mock("./syncState");
vi.mock("./warLifecycle");

describe("finish the selected active tracker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-17T12:00:00Z"));
    vi.mocked(readSyncState).mockResolvedValue({
      name: "attacks",
      last_started: null,
      active_war_id: 7,
      war_state: "current",
    });
  });

  afterEach(() => vi.useRealTimers());

  it("finishes the selected event at server time through the event lifecycle", async () => {
    const env = envWithWar("event");
    const response = await endActiveWar(request({ war_id: 7 }), env);
    const now = Math.floor(Date.now() / 1000);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, war_id: 7, practical_finish_time: now });
    expect(finishEventTracking).toHaveBeenCalledWith(env, { warId: 7, finishAt: now });
    expect(endWarPractically).not.toHaveBeenCalled();
  });

  it("rejects a stale selection without finishing another tracker", async () => {
    const env = envWithWar("real");
    const response = await endActiveWar(request({ war_id: 8 }), env);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ ok: false, code: "ACTIVE_WAR_CHANGED" });
    expect(env.DB.prepare).not.toHaveBeenCalled();
    expect(finishEventTracking).not.toHaveBeenCalled();
    expect(endWarPractically).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, "invalid", null, ""])("rejects invalid tracker id %s", async (warId) => {
    const response = await endActiveWar(request({ war_id: warId }), envWithWar("event"));

    expect(response.status).toBe(400);
    expect(readSyncState).not.toHaveBeenCalled();
    expect(finishEventTracking).not.toHaveBeenCalled();
  });

  it("does not finish a tracker when none is current", async () => {
    vi.mocked(readSyncState).mockResolvedValue(null);
    const response = await endActiveWar(request({ war_id: 7 }), envWithWar("event"));

    expect(response.status).toBe(400);
    expect(finishEventTracking).not.toHaveBeenCalled();
  });

  it("preserves existing requests without a selected id or body", async () => {
    const env = envWithWar("real");
    const response = await endActiveWar(request(), env);

    expect(response.status).toBe(200);
    expect(endWarPractically).toHaveBeenCalledWith(env, {
      warId: 7,
      finishAt: Math.floor(Date.now() / 1000),
      enemyFactionId: 123,
    });
  });

  it("preserves explicit finish timestamps", async () => {
    const env = envWithWar("event");
    const response = await endActiveWar(request({ war_id: 7, practical_finish_time: 200 }), env);

    expect(response.status).toBe(200);
    expect(finishEventTracking).toHaveBeenCalledWith(env, { warId: 7, finishAt: 200 });
  });
});

function request(body?: unknown): Request {
  return new Request("https://worker.test/api/wars/end", {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function envWithWar(warType: "real" | "event"): Env {
  const statement = {
    bind: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue({
      practical_start_time: 100,
      enemy_faction_id: warType === "event" ? null : 123,
      war_type: warType,
    }),
  };
  return { DB: { prepare: vi.fn().mockReturnValue(statement) } } as unknown as Env;
}
