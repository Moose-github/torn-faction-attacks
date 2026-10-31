import { describe, expect, it } from "vitest";
import { initialMeritState, meritCost, meritReducer, parseMeritImport } from "./meritsSimulator";
import { MERIT_DEFINITIONS } from "./meritDefinitions";

const catalog = { merits: [{ id: 7, name: "Bank Interest", description: "Interest" }, { id: 99, name: "New Upgrade", description: "A new bonus" }] };
const user = { merits: { upgrades: [{ id: 99, level: 3 }, { id: 7, level: 10 }], used: 61, available: 9 } };

describe("merit import", () => {
  it("preserves the original display order and level associations when the API catalog is reversed", () => {
    const entries = MERIT_DEFINITIONS.map((definition, index) => ({ id: index + 100, name: definition.name, level: index % 11 }));
    const used = entries.reduce((sum, entry) => sum + meritCost(entry.level), 0) + 6;
    const result = parseMeritImport({ merits: { upgrades: [...entries, { id: 999, level: 3 }], used, available: 20 } }, {
      merits: [{ id: 999, name: "New Upgrade", description: "New bonus" }, ...entries.slice().reverse()],
    });
    expect(result.definitions.map(definition => definition.name)).toEqual([...MERIT_DEFINITIONS.map(definition => definition.name), "New Upgrade"]);
    expect(result.levels).toEqual([...entries.map(entry => entry.level), 3]);
    expect(result.used).toBe(used);
    expect(result.budget).toBe(used + 20);
  });
  it("maps IDs through the catalog regardless of order, retaining unfamiliar upgrades", () => {
    const result = parseMeritImport(user, catalog);
    expect(result.levels).toEqual([10, 3]);
    expect(result.budget).toBe(70);
    expect(result.used).toBe(61);
    expect(result.definitions[0].multiplier).toBe(5);
    expect(result.definitions[1]).toMatchObject({ key: "99", name: "New Upgrade", group: "Other", multiplier: null });
  });
  it("treats omitted catalog upgrades as zero and accepts zero available merits", () => {
    const result = parseMeritImport({ merits: { upgrades: [{ id: 7, level: 10 }], used: 55, available: 0 } }, catalog);
    expect(result.levels).toEqual([10, 0]);
    expect(result.budget).toBe(55);
  });
  it.each([
    {}, { merits: { ...user.merits, used: 62 } }, { merits: { ...user.merits, available: -1 } },
    { merits: { ...user.merits, upgrades: [{ id: 7, level: 11 }] } },
    { merits: { ...user.merits, upgrades: [{ id: 7, level: 2.5 }] } },
    { merits: { ...user.merits, upgrades: [{ id: 7, level: "10" }] } },
    { merits: { ...user.merits, upgrades: [{ id: 999, level: 10 }] } },
    { merits: { ...user.merits, upgrades: [{ id: 7, level: 10 }, { id: 7, level: 10 }] } },
  ])("rejects incomplete or inconsistent imports", value => expect(() => parseMeritImport(value, catalog)).toThrow());
});

describe("merit allocation", () => {
  it("charges incremental levels, clears allocations and restores the imported baseline", () => {
    let state = meritReducer(initialMeritState(), { type: "import", snapshot: parseMeritImport(user, catalog) });
    state = meritReducer(state, { type: "level", index: 1, level: 5 });
    expect(state.used).toBe(70);
    expect(state.baseline).toEqual([10, 3]);
    state = meritReducer(state, { type: "level", index: 0, level: 0 });
    expect(state.used).toBe(15);
    state = meritReducer(state, { type: "reset" });
    expect(state.used).toBe(61);
    expect(state.levels).toEqual([10, 3]);
    state = meritReducer(state, { type: "clear" });
    expect(state.used).toBe(0);
    expect(state.levels).toEqual([0, 0]);
    state = meritReducer(state, { type: "reset" });
    expect(state.used).toBe(61);
    expect(state.levels).toEqual([10, 3]);
  });
  it("allows visible over-budget planning, rejects bad inputs and keeps rapid edits consistent", () => {
    let state = initialMeritState();
    for (let i = 0; i < 500; i++) {
      state = meritReducer(state, { type: "level", index: i % state.levels.length, level: i % 11 });
      expect(state.used).toBe(state.levels.reduce((sum, level) => sum + meritCost(level), 0));
    }
    expect(state.used).toBeGreaterThan(state.budget);
    expect(meritReducer(state, { type: "level", index: -1, level: 10 })).toBe(state);
    expect(meritReducer(state, { type: "level", index: 0, level: 11 })).toBe(state);
    expect(meritReducer(state, { type: "budget", budget: NaN })).toBe(state);
    expect(meritReducer(state, { type: "budget", budget: -1 })).toBe(state);
  });
});
