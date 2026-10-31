import { describe, expect, it } from "vitest";
import { initialMeritState, meritCost, meritReducer, parseMeritImport } from "./meritsSimulator";

const catalog = { merits: [{ id: 7, name: "Bank Interest", description: "Interest" }, { id: 99, name: "New Upgrade", description: "A new bonus" }] };
const user = { merits: { upgrades: [{ id: 99, level: 3 }, { id: 7, level: 10 }], used: 61, available: 9 } };

describe("merit import", () => {
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
  it("charges incremental levels and restores the baseline through undo and reset", () => {
    let state = meritReducer(initialMeritState(), { type: "import", snapshot: parseMeritImport(user, catalog) });
    state = meritReducer(state, { type: "level", index: 1, level: 5 });
    expect(state.used).toBe(70);
    expect(state.baseline).toEqual([10, 3]);
    state = meritReducer(state, { type: "level", index: 0, level: 0 });
    expect(state.used).toBe(15);
    state = meritReducer(state, { type: "undo" });
    expect(state.used).toBe(70);
    state = meritReducer(state, { type: "reset" });
    expect(state.used).toBe(61);
    expect(state.levels).toEqual([10, 3]);
    state = meritReducer(state, { type: "clear" });
    expect(state.used).toBe(0);
    expect(meritReducer(state, { type: "undo" }).used).toBe(61);
  });
  it("allows visible over-budget planning, rejects bad inputs and keeps rapid edits consistent", () => {
    let state = initialMeritState();
    for (let i = 0; i < 500; i++) {
      state = meritReducer(state, { type: "level", index: i % state.levels.length, level: i % 11 });
      expect(state.used).toBe(state.levels.reduce((sum, level) => sum + meritCost(level), 0));
    }
    expect(state.used).toBeGreaterThan(state.budget);
    expect(state.history.length).toBeLessThanOrEqual(100);
    expect(meritReducer(state, { type: "level", index: -1, level: 10 })).toBe(state);
    expect(meritReducer(state, { type: "level", index: 0, level: 11 })).toBe(state);
    expect(meritReducer(state, { type: "budget", budget: NaN })).toBe(state);
    expect(meritReducer(state, { type: "budget", budget: -1 })).toBe(state);
  });
});
