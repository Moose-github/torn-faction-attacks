import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HOME_FACTION_ID } from "../src/constants";
import { writeLifestyleSnapshotForDate } from "../src/lifestyleStats/internal";
import type { Env } from "../src/types";

const date = "2026-11-02";
let db: DatabaseSync;
let env: Env;
let clock: number;
let changed: number;

beforeEach(() => {
  db = new DatabaseSync(":memory:");
  clock = 1000;
  changed = 0;
  db.function("unixepoch", () => clock);
  const schema = readFileSync(new URL("../schema/current.sql", import.meta.url), "utf8");
  for (const table of ["home_faction_members", "member_personal_stats_recent", "member_gym_stats_current", "member_lifestyle_stat_snapshots"]) {
    db.exec(schema.match(new RegExp(`CREATE TABLE ${table} \\([\\s\\S]*?\\n\\);`))![0]);
  }
  env = { DB: { prepare(sql: string) {
    return { bind(...args: SQLInputValue[]) {
      return { async run() {
        changed = Number(db.prepare(sql).run(...args).changes);
        return { success: true, meta: { changes: changed } };
      } };
    } };
  } } } as unknown as Env;
});
afterEach(() => db.close());

function member(id = 1) {
  db.prepare("INSERT INTO home_faction_members(member_id,faction_id,name) VALUES(?,?,?)")
    .run(id, HOME_FACTION_ID, `Member ${id}`);
}
function ready(id = 1) {
  member(id);
  db.prepare(`INSERT INTO member_personal_stats_recent
    (member_id,snapshot_date,target_timestamp,updated_at,personalstats_bucket_date,personal_captured_at,xantaken)
    VALUES(?,?,100,100,?,100,5)`).run(id, date, date);
  db.prepare("INSERT INTO member_gym_stats_current(member_id,gym_captured_at,gymenergy) VALUES(?,100,10)").run(id);
}
function snapshot(id = 1) {
  return db.prepare("SELECT * FROM member_lifestyle_stat_snapshots WHERE member_id=? AND snapshot_date=?").get(id, date)!;
}
async function write(options: { freshAfter?: number; allowPartialGym?: boolean } = {}) {
  await writeLifestyleSnapshotForDate(env, date, options);
  return changed;
}

describe("lifestyle snapshot write suppression", () => {
  it("inserts pending members once and leaves their capture time unchanged on refresh", async () => {
    for (let id = 1; id <= 59; id++) member(id);
    expect(await write()).toBe(59);
    clock++;
    expect(await write()).toBe(0);
    expect(snapshot().captured_at).toBe(1000);
  });

  it("skips unchanged ready members and only updates the member whose data changed", async () => {
    ready(); ready(2);
    expect(await write()).toBe(2);
    clock++;
    expect(await write()).toBe(0);
    db.exec("UPDATE member_personal_stats_recent SET xantaken=6 WHERE member_id=1");
    expect(await write()).toBe(1);
    expect(snapshot()).toMatchObject({ xantaken: 6, fully_ready: 1, captured_at: 1001 });
    expect(snapshot(2).captured_at).toBe(1000);
  });

  it.each([
    "xantaken", "overdosed", "refills", "useractivity", "networth", "daysbeendonator",
    "xantaken_timestamp", "overdosed_timestamp", "refills_timestamp", "useractivity_timestamp",
    "networth_timestamp", "daysbeendonator_timestamp", "target_timestamp", "personal_captured_at",
    "personalstats_key_source", "member_name",
  ])("saves a changed personal field: %s", async column => {
    ready(); await write(); clock++;
    const value = column === "personalstats_key_source" || column === "member_name" ? "changed" : 200;
    db.prepare(`UPDATE member_personal_stats_recent SET ${column}=?`).run(value);
    expect(await write()).toBe(1);
    expect(snapshot()[column === "target_timestamp" ? "personalstats_requested_at" : column]).toBe(value);
    expect(await write()).toBe(0);
  });

  it.each(["gymenergy", "gymstrength", "gymspeed", "gymdefense", "gymdexterity", "gym_captured_at"])(
    "saves a changed gym field: %s", async column => {
      ready(); await write();
      db.prepare(`UPDATE member_gym_stats_current SET ${column}=?`).run(200);
      expect(await write()).toBe(1);
      expect(snapshot()[column]).toBe(200);
      expect(await write()).toBe(0);
    },
  );

  it("saves null transitions and roster renames", async () => {
    ready(); await write();
    db.exec("UPDATE member_personal_stats_recent SET xantaken=NULL; UPDATE member_gym_stats_current SET gymenergy=NULL");
    expect(await write()).toBe(1);
    expect(snapshot()).toMatchObject({ xantaken: null, gymenergy: null });
    db.exec("UPDATE home_faction_members SET name='Renamed'");
    expect(await write()).toBe(1);
    expect(snapshot().member_name).toBe("Renamed");
  });

  it("retains ready data when newer collection attempts are incomplete or stale", async () => {
    ready(); await write();
    const original = snapshot();
    db.exec("UPDATE member_personal_stats_recent SET xantaken=99; UPDATE member_gym_stats_current SET gymenergy=99");
    clock++;
    expect(await write({ freshAfter: 200 })).toBe(0);
    expect(snapshot()).toEqual(original);
    db.exec("UPDATE member_personal_stats_recent SET personal_captured_at=NULL; UPDATE member_gym_stats_current SET gym_captured_at=NULL");
    expect(await write()).toBe(0);
    expect(snapshot()).toEqual(original);
  });

  it("saves personal errors, preserves them during pending retries, then clears them on success", async () => {
    ready(); await write();
    db.exec("UPDATE member_personal_stats_recent SET error='Retry failed', xantaken=99");
    expect(await write()).toBe(1);
    expect(snapshot()).toMatchObject({ xantaken: 5, validation_error: "Retry failed", personal_ready: 1 });
    expect(await write()).toBe(0);
    db.exec("UPDATE member_personal_stats_recent SET error=NULL, personal_captured_at=NULL");
    expect(await write()).toBe(0);
    db.exec("UPDATE member_personal_stats_recent SET personal_captured_at=200");
    expect(await write()).toBe(1);
    expect(snapshot()).toMatchObject({ xantaken: 99, validation_error: null });
  });

  it("clears a pending member's error when the source error clears", async () => {
    ready();
    db.exec("UPDATE member_personal_stats_recent SET error='Unavailable', personal_captured_at=NULL");
    await write();
    db.exec("UPDATE member_personal_stats_recent SET error=NULL");
    expect(await write()).toBe(1);
    expect(snapshot()).toMatchObject({ validation_error: null, personal_ready: 0 });
  });

  it("handles partial gym errors and recovery without discarding accepted data", async () => {
    ready(); await write();
    db.exec("UPDATE member_gym_stats_current SET gym_error='Partial', gymenergy=20");
    expect(await write()).toBe(0);
    expect(await write({ allowPartialGym: true })).toBe(1);
    expect(snapshot()).toMatchObject({ gymenergy: 20, gym_error: "Partial", gym_ready: 1, fully_ready: 0 });
    expect(await write({ allowPartialGym: true })).toBe(0);
    db.exec("UPDATE member_gym_stats_current SET gym_error=NULL");
    expect(await write()).toBe(1);
    expect(snapshot()).toMatchObject({ gym_error: null, fully_ready: 1 });
  });

  it("updates readiness when captures arrive even if all measured stats remain null", async () => {
    ready();
    db.exec("UPDATE member_personal_stats_recent SET personal_captured_at=NULL,xantaken=NULL; UPDATE member_gym_stats_current SET gym_captured_at=NULL,gymenergy=NULL");
    await write();
    db.exec("UPDATE member_personal_stats_recent SET personal_captured_at=200");
    expect(await write()).toBe(1);
    expect(snapshot()).toMatchObject({ personal_ready: 1, gym_ready: 0, fully_ready: 0 });
    db.exec("UPDATE member_gym_stats_current SET gym_captured_at=200");
    expect(await write()).toBe(1);
    expect(snapshot()).toMatchObject({ fully_ready: 1 });
  });

  it("repairs inconsistent fully-ready flags", async () => {
    ready(); await write();
    db.exec("UPDATE member_lifestyle_stat_snapshots SET fully_ready=0");
    expect(await write()).toBe(1);
    expect(snapshot().fully_ready).toBe(1);
  });
});
