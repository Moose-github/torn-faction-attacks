import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routeWarPayoutPresetApi } from "./warPayoutPresetRoutes";

vi.mock("../auth", () => ({
  requireAdmin: vi.fn(async request => {
    const token = request.headers.get("Authorization");
    return token === "Bearer admin-a" || token === "Bearer admin-b" ? null : new Response("Forbidden", { status: token ? 403 : 401 });
  }),
  requireMember: vi.fn(),
  readAuthenticatedUserId: vi.fn(async request => request.headers.get("Authorization") === "Bearer admin-a" ? 101 : 202),
}));

const config = {
  schemaVersion: 1, mode: "respect", respectBasis: "raw",
  pointRules: [{ id: "points", metric: "attacks_vs_enemy_successful", points: "1" }],
  flatPaymentRules: [{ id: "flat", metric: "friendly_hosps", amount: "2000000" }],
  bonusRules: [{ id: "bonus", type: "bonus", metric: "average_fair_fight", operator: ">=", threshold: "3", percent: "10" }],
};
let sqlite;
let env;
beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../../migrations/0175_create_war_payout_presets.sql", import.meta.url), "utf8"));
  class Statement {
    constructor(sql, values = []) { this.sql = sql; this.values = values; }
    bind(...values) { return new Statement(this.sql, values); }
    async first() { return sqlite.prepare(this.sql).get(...this.values) ?? null; }
    async all() { return { results: sqlite.prepare(this.sql).all(...this.values) }; }
  }
  env = { DB: { prepare: sql => new Statement(sql) } };
});
afterEach(() => sqlite.close());

async function request(method = "GET", suffix = "", body, user = "admin-a") {
  const headers = { "Content-Type": "application/json" };
  if (user) headers.Authorization = `Bearer ${user}`;
  const req = new Request(`https://worker.test/api/war-payout-presets${suffix}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return routeWarPayoutPresetApi({ request: req, url: new URL(req.url), env, ctx: {} });
}
async function create(name = "Termed payouts") {
  const response = await request("POST", "", { name, config, created_by: 999 });
  expect(response.status).toBe(201);
  return (await response.json()).preset;
}

describe("shared payout presets API", () => {
  it.each(["GET", "POST", "PUT", "DELETE"])("protects %s with admin authentication", async method => {
    const suffix = method === "PUT" || method === "DELETE" ? "/some-id" : "";
    expect((await request(method, suffix, undefined, "member")).status).toBe(403);
    expect((await request(method, suffix, undefined, null)).status).toBe(401);
    expect(sqlite.prepare("SELECT count(*) AS n FROM war_payout_presets").get().n).toBe(0);
  });

  it("stores every rule in SQLite and shares it with another admin", async () => {
    const saved = await create();
    expect(saved).toMatchObject({ name: "Termed payouts", config, revision: 1, created_by: 101, updated_by: 101 });
    expect(JSON.parse(sqlite.prepare("SELECT config_json FROM war_payout_presets").get().config_json)).toEqual(config);
    const list = await request("GET", "", undefined, "admin-b");
    expect(list.headers.get("Cache-Control")).toBe("no-store");
    expect((await list.json()).presets).toEqual([saved]);
    expect((await (await request("GET", `/${saved.id}`, undefined, "admin-b")).json()).preset).toEqual(saved);
  });

  it("normalizes inputs and excludes the war, pool, and respect cap from storage", async () => {
    const response = await request("POST", "", { name: "  Shared rules  ", config: { ...config, flatPaymentRules: [{ ...config.flatPaymentRules[0], amount: "2,000,000" }], respectLimit: "200", poolInput: "100000000", selectedWarName: "Example" } });
    const saved = (await response.json()).preset;
    expect(saved.name).toBe("Shared rules");
    expect(saved.config).toEqual(config);
    expect(JSON.parse(sqlite.prepare("SELECT config_json FROM war_payout_presets").get().config_json)).toEqual(config);
  });

  it("ignores respect caps in older presets and removes them when saving", async () => {
    const saved = await create();
    sqlite.prepare("UPDATE war_payout_presets SET config_json = ? WHERE id = ?").run(JSON.stringify({ ...config, respectLimit: "200" }), saved.id);
    expect((await (await request("GET", `/${saved.id}`)).json()).preset.config).toEqual(config);
    expect((await (await request()).json()).presets[0].config).toEqual(config);
    expect((await request("PUT", `/${saved.id}`, { name: saved.name, config: { ...config, respectLimit: "300" } })).status).toBe(200);
    expect(JSON.parse(sqlite.prepare("SELECT config_json FROM war_payout_presets").get().config_json)).toEqual(config);
  });

  it("prevents duplicate names without replacing the existing rules", async () => {
    const original = await create();
    expect((await request("POST", "", { name: " termed payouts ", config: { ...config, mode: "points" } })).status).toBe(409);
    expect((await (await request("GET", `/${original.id}`)).json()).preset.config.mode).toBe("respect");
  });

  it("allows another admin to update and rename a shared preset", async () => {
    const original = await create();
    const response = await request("PUT", `/${original.id}`, { name: "Updated rules", config: { ...config, mode: "points" } }, "admin-b");
    expect(response.status).toBe(200);
    expect((await response.json()).preset).toMatchObject({ id: original.id, name: "Updated rules", revision: 2, created_by: 101, updated_by: 202, config: { mode: "points" } });
  });

  it("allows admins to overwrite newer settings without a revision check", async () => {
    const original = await create();
    expect((await request("PUT", `/${original.id}`, { name: original.name, revision: 1, config: { ...config, mode: "points" } })).status).toBe(200);
    expect((await request("PUT", `/${original.id}`, { name: original.name, revision: 1, config: { ...config, respectBasis: "adjusted" } }, "admin-b")).status).toBe(200);
    const saved = (await (await request("GET", `/${original.id}`)).json()).preset;
    expect(saved).toMatchObject({ revision: 3, updated_by: 202, config: { ...config, respectBasis: "adjusted" } });
    expect((await request("DELETE", `/${original.id}?revision=1`)).status).toBe(200);
  });

  it("deletes a shared preset for every admin and reports missing records", async () => {
    const original = await create();
    expect((await request("DELETE", `/${original.id}`, undefined, "admin-b")).status).toBe(200);
    expect((await (await request()).json()).presets).toEqual([]);
    expect((await request("GET", `/${original.id}`)).status).toBe(404);
    expect((await request("PUT", `/${original.id}`, { name: original.name, config })).status).toBe(404);
  });

  it.each([
    { name: "", config },
    { name: "Invalid", config: { ...config, flatPaymentRules: [{ ...config.flatPaymentRules[0], amount: "-10" }] } },
    { name: "Invalid", config: { ...config, mode: "unknown" } },
    { name: "Invalid", config: { ...config, schemaVersion: 2 } },
    { name: "Invalid", config: { ...config, bonusRules: [{ ...config.bonusRules[0], metric: "not_a_stat" }] } },
    { name: "Invalid", config: { ...config, pointRules: [config.pointRules[0], { ...config.pointRules[0], id: "duplicate-metric" }] } },
  ])("rejects invalid names and rules before writing ($name)", async body => {
    expect((await request("POST", "", body)).status).toBe(400);
    expect(sqlite.prepare("SELECT count(*) AS n FROM war_payout_presets").get().n).toBe(0);
  });

  it("accepts updates and deletes without a loaded revision", async () => {
    const original = await create();
    expect((await request("PUT", `/${original.id}`, { name: original.name, config })).status).toBe(200);
    expect((await request("DELETE", `/${original.id}`)).status).toBe(200);
    expect((await request("PATCH")).status).toBe(405);
  });

  it("keeps an existing preset intact when renaming to a duplicate name", async () => {
    const original = await create();
    await create("Another preset");
    expect((await request("PUT", `/${original.id}`, { name: "Another preset", config })).status).toBe(409);
    expect((await (await request("GET", `/${original.id}`)).json()).preset.revision).toBe(1);
  });
});
