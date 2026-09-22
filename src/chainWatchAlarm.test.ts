import { beforeEach, describe, expect, it, vi } from "vitest";
import { HOME_FACTION_ID } from "./constants";
import { handleChainWatchAlarm } from "./chainWatch";
import { ChainWatchAlarm } from "./chainWatchAlarm";
import { handleWatchCheckInAlarm } from "./chainWatchCheckIns";
import type { Env } from "./types";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {
  constructor(public ctx: DurableObjectState, public env: Env) {}
} }));
vi.mock("./chainWatch", () => ({ handleChainWatchAlarm: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./chainWatchCheckIns", () => ({ handleWatchCheckInAlarm: vi.fn().mockResolvedValue(null) }));

describe("faction alarm ownership", () => {
  beforeEach(() => vi.clearAllMocks());
  function object() {
    const values = new Map<string, unknown>();
    const storage = {
      get: vi.fn(async (key: string) => values.get(key)),
      put: vi.fn(async (key: string, value: unknown) => { values.set(key, value); }),
      delete: vi.fn(async (key: string) => values.delete(key)),
      setAlarm: vi.fn(), deleteAlarm: vi.fn(),
    };
    const env = {} as Env;
    return { values, storage, env, alarm: new ChainWatchAlarm({ storage } as unknown as DurableObjectState, env) };
  }
  it("retires legacy war alarms without invoking the faction monitor", async () => {
    const { values, storage, alarm } = object(); values.set("warId", HOME_FACTION_ID);
    await alarm.alarm();
    expect(handleChainWatchAlarm).not.toHaveBeenCalled();
    expect(storage.deleteAlarm).toHaveBeenCalled();
    expect(values.size).toBe(0);
  });
  it("ignores late legacy schedule RPCs", async () => {
    const { storage, alarm } = object();
    await alarm.schedule();
    expect(storage.deleteAlarm).toHaveBeenCalled();
    expect(storage.setAlarm).not.toHaveBeenCalled();
  });
  it("schedules and handles the faction alarm", async () => {
    const { env, values, storage, alarm } = object();
    const at = Math.floor(Date.now() / 1000) + 60;
    await alarm.scheduleFaction(HOME_FACTION_ID, at);
    expect(values.get("factionId")).toBe(HOME_FACTION_ID);
    expect(storage.setAlarm).toHaveBeenCalledWith(at * 1000);
    await alarm.alarm();
    expect(handleChainWatchAlarm).toHaveBeenCalledExactlyOnceWith(env, HOME_FACTION_ID);
  });
  it("persists a check-in deadline and handles it without invoking the faction monitor", async () => {
    const { env, values, storage, alarm } = object();
    const at = Math.floor(Date.now() / 1000) + 30;
    await alarm.scheduleCheckIn("check-in", at);
    expect(values.get("checkInId")).toBe("check-in");
    expect(storage.setAlarm).toHaveBeenCalledWith(at * 1000);
    // Recreate the instance to model eviction before the deadline.
    await new ChainWatchAlarm({ storage } as unknown as DurableObjectState, env).alarm();
    expect(handleWatchCheckInAlarm).toHaveBeenCalledExactlyOnceWith(env, "check-in");
    expect(handleChainWatchAlarm).not.toHaveBeenCalled();
    expect(values.has("checkInId")).toBe(false);
  });
  it("reschedules a check-in alarm when delivery needs another attempt", async () => {
    const { values, storage, alarm } = object();
    const next = Math.floor(Date.now() / 1000) + 5;
    values.set("checkInId", "check-in");
    vi.mocked(handleWatchCheckInAlarm).mockResolvedValueOnce(next);
    await alarm.alarm();
    expect(storage.setAlarm).toHaveBeenCalledWith(next * 1000);
    expect(values.get("checkInId")).toBe("check-in");
  });
  it("propagates failures for durable alarm retry without forgetting the check-in", async () => {
    const { values, alarm } = object();
    values.set("checkInId", "check-in");
    vi.mocked(handleWatchCheckInAlarm).mockRejectedValueOnce(new Error("Discord unavailable"));
    await expect(alarm.alarm()).rejects.toThrow("Discord unavailable");
    expect(values.get("checkInId")).toBe("check-in");
  });
});
