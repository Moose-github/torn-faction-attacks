import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { claimCronSlot, cronSlot, CRON_CATCH_UP_MINUTES } from "./slots";

let sqlite;
let env;

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../../schema/current.sql", import.meta.url), "utf8"));
  env = {
    DB: {
      prepare(sql) {
        let values = [];
        return {
          bind(...params) { values = params; return this; },
          async first() { return sqlite.prepare(sql).get(...values) ?? null; },
        };
      },
    },
  };
});

afterEach(() => {
  sqlite.close();
});

describe("cron slot claims", () => {
  it("lets each slot be claimed once", async () => {
    expect(await claimCronSlot(env, "armory_inventory", 900)).toBe(true);
    expect(await claimCronSlot(env, "armory_inventory", 900)).toBe(false);
    expect(await claimCronSlot(env, "armory_inventory", 1800)).toBe(true);
    expect(await claimCronSlot(env, "armory_inventory", 900)).toBe(false);
  });

  it("keeps jobs' claims separate", async () => {
    expect(await claimCronSlot(env, "armory_inventory", 900)).toBe(true);
    expect(await claimCronSlot(env, "scheduled_maintenance", 900)).toBe(true);
    expect(sqlite.prepare("SELECT name, last_started FROM sync_state ORDER BY name").all()).toEqual([
      { name: "cron_slot:armory_inventory", last_started: 900 },
      { name: "cron_slot:scheduled_maintenance", last_started: 900 },
    ]);
  });
});

describe("cron slot timing", () => {
  const at = (hour, minute, second = 44) => Date.UTC(2026, 9, 25, hour, minute, second);

  it("is due for the first catch-up minutes of each quarter hour", () => {
    const slot = cronSlot(15);
    const due = [];
    for (let minute = 0; minute < 60; minute += 1) {
      if (slot.isDue(new Date(at(3, minute)))) due.push(minute);
    }
    expect(CRON_CATCH_UP_MINUTES).toBe(5);
    expect(due).toEqual([0, 1, 2, 3, 4, 15, 16, 17, 18, 19, 30, 31, 32, 33, 34, 45, 46, 47, 48, 49]);
    expect(slot.slotStart(at(3, 17))).toBe(at(3, 15, 0) / 1000);
  });

  it("supports offset slots such as the six-hourly 00:10 lifestyle import", () => {
    const slot = cronSlot(6 * 60, 10);
    expect(slot.isDue(new Date(at(6, 9)))).toBe(false);
    expect(slot.isDue(new Date(at(6, 10)))).toBe(true);
    expect(slot.isDue(new Date(at(6, 14)))).toBe(true);
    expect(slot.isDue(new Date(at(6, 15)))).toBe(false);
    expect(slot.isDue(new Date(at(7, 10)))).toBe(false);
    expect(slot.slotStart(at(6, 12))).toBe(at(6, 10, 0) / 1000);
    expect(slot.slotStart(at(0, 5))).toBe(at(18, 10, 0) / 1000 - 86_400);
  });

  it("rejects intervals that do not divide a day", () => {
    expect(() => cronSlot(7)).toThrow("must divide a day");
  });
});
