import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HOME_FACTION_ID } from "./constants";
import { markDepartedHomeFactionMembers, upsertHomeFactionMemberRoster, upsertHomeFactionMemberRosters, validMemberIds } from "./homeFactionRoster";
import { HOME_MEMBER_LIVE_STATUS_TABLE, upsertMemberRevivableStatuses } from "./memberLiveStatus";

let sqlite;
let env;

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../schema/current.sql", import.meta.url), "utf8"));
  env = {
    DB: {
      prepare(sql) {
        let values = [];
        return {
          bind(...params) { expect(params.length).toBeLessThanOrEqual(100); values = params; return this; },
          async run() {
            const result = sqlite.prepare(sql).run(...values);
            return { success: true, meta: { changes: Number(result.changes) } };
          },
        };
      },
    },
  };
});

afterEach(() => {
  sqlite.close();
});

function member(overrides = {}) {
  return { id: 101, name: "Member", level: 50, position: "Member", days_in_faction: 10, ...overrides };
}

async function upsert(next) {
  const result = await upsertHomeFactionMemberRoster(env, next).run();
  return Number(result.meta.changes);
}

function row(memberId = 101) {
  return sqlite.prepare("SELECT * FROM home_faction_members WHERE member_id = ?").get(memberId);
}

describe("home faction roster upsert", () => {
  it("syncs 100 members in 11 bounded statements, preserves unchanged fields, and handles mixed changes", async () => {
    const members = Array.from({ length: 100 }, (_, i) => member({ id: i + 1, name: `Member ${i}` }));
    const statements = () => [
      ...upsertHomeFactionMemberRosters(env, members),
      ...upsertMemberRevivableStatuses(env, HOME_MEMBER_LIVE_STATUS_TABLE,
        members.map(m => ({ memberId: m.id, factionId: HOME_FACTION_ID, isRevivable: m.id === 1 ? null : 1 }))),
    ];
    expect(statements()).toHaveLength(11);
    for (const statement of statements()) await statement.run();
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM home_faction_members").get().n).toBe(100);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM home_member_live_status").get().n).toBe(100);
    sqlite.exec("UPDATE home_faction_members SET updated_at=1, current_join_date='2020-01-01'; UPDATE home_member_live_status SET updated_at=1, status_state='Traveling', travel_destination='Japan'");
    for (const statement of statements()) expect((await statement.run()).meta.changes).toBe(0);
    members[0].level = 51;
    sqlite.exec("UPDATE home_faction_members SET is_current=0 WHERE member_id=2");
    let changed = 0;
    for (const statement of statements()) changed += (await statement.run()).meta.changes;
    expect(changed).toBe(2);
    expect(row(1)).toMatchObject({ level: 51, current_join_date: "2020-01-01" });
    expect(row(2).current_join_date).not.toBe("2020-01-01");
    expect(row(3).updated_at).toBe(1);
    expect(sqlite.prepare("SELECT * FROM home_member_live_status WHERE member_id=1").get())
      .toMatchObject({ is_revivable: null, status_state: "Traveling", travel_destination: "Japan", updated_at: 1 });
    await upsertMemberRevivableStatuses(env, HOME_MEMBER_LIVE_STATUS_TABLE,
      [{ memberId: 1, factionId: HOME_FACTION_ID, isRevivable: 0 }])[0].run();
    expect(sqlite.prepare("SELECT * FROM home_member_live_status WHERE member_id=1").get())
      .toMatchObject({ is_revivable: 0, status_state: "Traveling", travel_destination: "Japan" });
    expect(upsertHomeFactionMemberRosters(env, [])).toEqual([]);
    expect(upsertMemberRevivableStatuses(env, HOME_MEMBER_LIVE_STATUS_TABLE, [])).toEqual([]);
  });
  it("skips the write when nothing on the roster changed", async () => {
    expect(await upsert(member())).toBe(1);
    sqlite.exec("UPDATE home_faction_members SET updated_at = 1");

    expect(await upsert(member())).toBe(0);
    expect(row().updated_at).toBe(1);
  });

  it("writes when a roster field changes", async () => {
    await upsert(member());
    sqlite.exec("UPDATE home_faction_members SET updated_at = 1");

    expect(await upsert(member({ level: 51 }))).toBe(1);
    expect(row()).toMatchObject({ level: 51, is_current: 1 });
    expect(row().updated_at).not.toBe(1);
  });

  it("restarts the join date when a departed member returns", async () => {
    await upsert(member());
    sqlite.exec("UPDATE home_faction_members SET is_current = 0, current_join_date = '2020-01-01'");

    expect(await upsert(member())).toBe(1);
    expect(row()).toMatchObject({ is_current: 1 });
    expect(row().current_join_date).not.toBe("2020-01-01");
  });
});

describe("departed home members", () => {
  it("marks members missing from the roster and clears their live status", async () => {
    await upsert(member({ id: 101 }));
    await upsert(member({ id: 102 }));
    sqlite.exec(`INSERT INTO home_member_live_status (member_id, faction_id) VALUES (101, ${HOME_FACTION_ID}), (102, ${HOME_FACTION_ID})`);

    expect(await markDepartedHomeFactionMembers(env, validMemberIds([member({ id: 101 })]))).toBe(1);
    expect(row(102).is_current).toBe(0);
    expect(row(101).is_current).toBe(1);
    expect(sqlite.prepare("SELECT member_id FROM home_member_live_status").all()).toEqual([{ member_id: 101 }]);
  });

  it("does nothing for an empty roster", async () => {
    await upsert(member());

    expect(await markDepartedHomeFactionMembers(env, [])).toBe(0);
    expect(row().is_current).toBe(1);
  });
});
