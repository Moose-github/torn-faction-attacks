import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authenticateWithTornKey, getCurrentAuthSession, grantAdminAccess, requireAdmin, revokeAdminAccess } from "../src/auth";
import { deleteWar } from "../src/wars";
import { relinkWarAttacks } from "../src/warRelink";
import { fetchTrackedTornJson } from "../src/external/torn";
import { HOME_FACTION_ID } from "../src/constants";
import type { Env } from "../src/types";

vi.mock("../src/external/torn", () => ({ fetchTrackedTornJson: vi.fn() }));
vi.mock("../src/cacheVersions", () => ({ bumpWarCacheVersion: vi.fn(), bumpGlobalWarCacheVersion: vi.fn() }));
vi.mock("../src/warStats", () => ({ clearWarStats: vi.fn(), rebuildWarStatsFromRaw: vi.fn() }));

let sqlite: DatabaseSync;
let env: Env;
let tokens: string[];
function statement(sql: string, values: SQLInputValue[] = []) {
  return {
    bind: (...args: SQLInputValue[]) => statement(sql, args),
    first: async () => sqlite.prepare(sql).get(...values) ?? null,
    all: async () => ({ results: sqlite.prepare(sql).all(...values) }),
    run: async () => ({ success: true, meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }),
  };
}
function request(body: unknown = {}, token = tokens[0]) {
  return new Request("https://worker.test/api/admin", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../schema/current.sql", import.meta.url), "utf8"));
  env = { DB: { prepare: statement, batch: async (items: ReturnType<typeof statement>[]) => {
    sqlite.exec("BEGIN");
    try { const result = []; for (const item of items) result.push(await item.run()); sqlite.exec("COMMIT"); return result; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } } } as unknown as Env;
  tokens = [crypto.randomUUID(), crypto.randomUUID()];
  for (let id = 1; id <= 2; id++) {
    sqlite.prepare("INSERT INTO admin_users(torn_user_id) VALUES (?)").run(id);
    sqlite.prepare("INSERT INTO auth_sessions(token, torn_user_id, access_level, expires_at) VALUES (?, ?, 'admin', unixepoch() + 3600)").run(tokens[id - 1], id);
    sqlite.prepare("INSERT INTO wars(id, name, status, war_type, practical_start_time, practical_finish_time, torn_war_id) VALUES (?, ?, 'ended', 'event', 100, 200, ?)").run(id, `War ${id}`, 1000 + id);
  }
});
afterEach(() => sqlite.close());

describe("admin access revocation", () => {
  it("demotes existing sessions and prevents automatic regrant at sign-in", async () => {
    expect(await requireAdmin(request({}, tokens[1]), env)).toBeNull();
    expect((await revokeAdminAccess(request({ torn_user_id: 2 }), env)).status).toBe(200);
    expect((await requireAdmin(request({}, tokens[1]), env))?.status).toBe(403);
    expect(await (await getCurrentAuthSession(request({}, tokens[1]), env)).json()).toMatchObject({ access_level: "member" });
    vi.mocked(fetchTrackedTornJson).mockResolvedValue({ info: { user: { id: 2, name: "Former admin", faction_id: HOME_FACTION_ID }, access: { faction: true } } });
    expect(await (await authenticateWithTornKey(request({ key: "test-key" }), env)).json()).toMatchObject({ ok: true, access_level: "member" });
    expect(sqlite.prepare("SELECT * FROM admin_users WHERE torn_user_id=2").get()).toBeUndefined();
    expect((await grantAdminAccess(request({ torn_user_id: 2 }), env)).status).toBe(200);
    expect(sqlite.prepare("SELECT * FROM admin_access_revocations WHERE torn_user_id=2").get()).toBeUndefined();
    expect(await requireAdmin(request({}, tokens[1]), env)).toBeNull();
  });
  it("checks persisted access even when a session has been cached elsewhere", async () => {
    expect(await requireAdmin(request({}, tokens[1]), env)).toBeNull();
    sqlite.exec("DELETE FROM admin_users WHERE torn_user_id=2");
    expect((await requireAdmin(request({}, tokens[1]), env))?.status).toBe(403);
  });
  it("rejects self-revocation and keeps the last administrator", async () => {
    expect((await revokeAdminAccess(request({ torn_user_id: 1 }), env)).status).toBe(400);
    sqlite.exec("DELETE FROM admin_users WHERE torn_user_id=2");
    expect((await revokeAdminAccess(request({ torn_user_id: 1 }, tokens[1]), env)).status).toBe(403);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM admin_users").get()!.n).toBe(1);
  });
  it.each([0, -1, 1.5, "bad"])("rejects invalid user ID %s", async id => {
    expect((await revokeAdminAccess(request({ torn_user_id: id }), env)).status).toBe(400);
    expect((await grantAdminAccess(request({ torn_user_id: id }), env)).status).toBe(400);
  });
  it("applies the revocation migration without changing existing admins", () => {
    sqlite.exec("DROP TABLE admin_access_revocations");
    sqlite.exec(readFileSync(new URL("../migrations/0172_add_admin_access_revocations.sql", import.meta.url), "utf8"));
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM admin_users").get()!.n).toBe(2);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM admin_access_revocations").get()!.n).toBe(0);
  });
});

describe("explicit war targets", () => {
  it("rejects conflicting delete identifiers before modifying records", async () => {
    const response = await deleteWar(request({ torn_war_id: 1001, name: "War 2" }), env);
    expect(response.status).toBe(400);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM wars").get()!.n).toBe(2);
  });
  it("deletes only the selected record and unlinks its attacks", async () => {
    sqlite.exec("INSERT INTO attacks(id, war_id) VALUES (1, 1), (2, 2)");
    expect((await deleteWar(request({ war_id: 2 }), env)).status).toBe(200);
    expect(sqlite.prepare("SELECT id FROM wars").all()).toEqual([{ id: 1 }]);
    expect(sqlite.prepare("SELECT id, war_id FROM attacks ORDER BY id").all()).toEqual([{ id: 1, war_id: 1 }, { id: 2, war_id: null }]);
  });
  it.each([{}, { scope: "selected" }, { scope: "all", war_id: 1 }, { war_id: 1, name: "War 2" }, { scope: "unexpected" }])("rejects implicit or conflicting reassignment scope %j", async body => {
    expect((await relinkWarAttacks(request(body), env)).status).toBe(400);
  });
  it("previews only the selected war and requires explicit all scope", async () => {
    expect(await (await relinkWarAttacks(request({ scope: "selected", war_id: 2 }), env)).json()).toMatchObject({ scope: "single_war", wars_processed: 1, wars: [{ war_id: 2 }] });
    expect(await (await relinkWarAttacks(request({ scope: "all" }), env)).json()).toMatchObject({ scope: "all_wars", wars_processed: 2 });
  });
});
