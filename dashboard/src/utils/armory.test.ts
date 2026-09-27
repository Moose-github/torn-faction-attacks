import { describe, expect, it } from "vitest";
import type { ArmoryCopy } from "../../../shared/armory";
import { armoryCounts, armoryCsv, EMPTY_ARMORY_FILTERS, filterArmory, groupArmory, loanElapsed, weaponClass } from "./armory";
const copy = (uid: string, special = false): ArmoryCopy => ({ uid, id: 399, name: "ArmaLite M-15A4", type: "Primary", loaned: null, loan_first_seen_at: null,
  details: { uid, id: 399, name: "ArmaLite M-15A4", type: "Weapon", sub_type: "Rifle", stats: { damage: 70, accuracy: 60, armor: null, quality: 20 },
    bonuses: special ? [{ id: 50, title: "Achilles", value: 52, description: "52% increased Foot damage" }] : [], rarity: special ? "yellow" : null } });
describe("armory display", () => {
  it("sorts and exports armor protection without treating null weapon stats as zero", () => {
    const armor = (uid: string, protection: number): ArmoryCopy => {
      const item = copy(uid, true);
      return { ...item, type: "Defensive", details: { ...item.details!, type: "Armor", sub_type: null,
        stats: { damage: null, accuracy: null, armor: protection, quality: 23.08 } } };
    };
    const items = [armor("1", 47.15), armor("2", 55.2), { ...armor("3", 40), details: null }];
    expect(groupArmory(items, true, "armor", "desc").map(group => group.items[0].uid)).toEqual(["2", "1", "3"]);
    expect(groupArmory(items, true, "armor", "asc").map(group => group.items[0].uid)).toEqual(["1", "2", "3"]);
    expect(armoryCsv(items)).toContain('"Damage","Accuracy","Armor"');
    expect(armoryCsv(items)).toContain('"","","47.15","23.08"');
  });
  it.each([[175, "Taser"], [255, "Flamethrower"], [1257, "Cattle Prod"]] as const)("treats built-in effects on %s (%s) as standard while preserving rarity copies", (id, name) => {
    const item = copy("1", true);
    item.id = id; item.name = name;
    item.details = { ...item.details!, id, name, rarity: null };
    const sibling = { ...item, uid: "2" };
    expect(weaponClass(item)).toBe("standard");
    expect(filterArmory([item], { ...EMPTY_ARMORY_FILTERS, kind: "special" })).toEqual([]);
    expect(filterArmory([item], { ...EMPTY_ARMORY_FILTERS, kind: "standard" })).toEqual([item]);
    expect(groupArmory([item, sibling], false, "name")).toMatchObject([{ grouped: true, items: [{ uid: "1" }, { uid: "2" }] }]);
    expect(armoryCsv([item])).toContain('"standard"');
    expect(armoryCsv([item])).toContain("Achilles (52)");
    expect(weaponClass({ ...item, details: null })).toBe("pending");
    expect(weaponClass({ ...item, details: { ...item.details!, rarity: "yellow" } })).toBe("special");
    expect(weaponClass({ ...item, id: 399, details: { ...item.details!, id: 399 } })).toBe("standard");
  });
  it("classifies the supplied Shock Taser as standard without discarding its effect", () => {
    const item: ArmoryCopy = { ...copy("10523087267"), id: 175, name: "Taser", type: "Secondary",
      details: { id: 175, name: "Taser", uid: "10523087267", type: "Weapon", sub_type: "Mechanical",
        stats: { damage: 2.16, accuracy: 56.46, armor: null, quality: 36.24 },
        bonuses: [{ id: 120, title: "Shock", description: "100% chance to Shock opponent causing them to miss the next turn", value: 100 }],
        rarity: null } };
    expect(weaponClass(item)).toBe("standard");
    expect(armoryCsv([item])).toContain("Shock (100)");
    expect(weaponClass({ ...item, details: { ...item.details!, bonuses: [], rarity: "orange" } })).toBe("special");
  });
  it("sorts oldest observed loans first, including grouped copies, with unavailable times last", () => {
    const loan = (uid: string, timestamp: number | null, special = true): ArmoryCopy => ({
      ...copy(uid, special), loaned: { id: 1, name: "Borrower" }, loan_first_seen_at: timestamp });
    const items = [loan("1", 300), loan("2", null), loan("3", 200),
      loan("4", 400, false), loan("5", 100, false), { ...copy("6", true), loan_first_seen_at: 50 }];
    expect(groupArmory(items, true, "observed").map(group => group.items[0].uid)).toEqual(["5", "3", "1", "4", "2", "6"]);
    expect(groupArmory(items, false, "observed").map(group => group.items.map(item => item.uid))).toEqual([["5", "4"], ["3"], ["1"], ["2"], ["6"]]);
    expect(groupArmory(items, true, "observed", "desc").map(group => group.items[0].uid)).toEqual(["4", "1", "3", "5", "2", "6"]);
    expect(groupArmory(items, false, "observed", "desc").map(group => group.items.map(item => item.uid))).toEqual([["4", "5"], ["1"], ["3"], ["2"], ["6"]]);
    expect(items.map(item => item.uid)).toEqual(["1", "2", "3", "4", "5", "6"]);
  });
  it("formats observed loan age at minute, hour and day boundaries", () => {
    expect(loanElapsed(1000, 999)).toBe("Less than a minute");
    expect(loanElapsed(1000, 1060)).toBe("1m");
    expect(loanElapsed(1000, 4660)).toBe("1h 1m");
    expect(loanElapsed(1000, 1000 + 2 * 86400 + 3 * 3600)).toBe("2d 3h");
  });
  it("exports the current loan observation without inventing dates for untracked or available copies", () => {
    const item = { ...copy("1", true), loaned: { id: 1, name: "Borrower" }, loan_first_seen_at: 1790467200 };
    expect(armoryCsv([item])).toContain(new Date(1790467200 * 1000).toISOString());
    expect(armoryCsv([{ ...item, loaned: null }])).not.toContain(new Date(1790467200 * 1000).toISOString());
    expect(armoryCsv([{ ...item, loan_first_seen_at: null }])).not.toContain("1970-");
  });
  it("groups only verified standard copies while keeping each special and pending UID distinct", () => {
    const pending = { ...copy("5"), details: null };
    const groups = groupArmory([copy("1"), copy("2"), copy("3", true), copy("4", true), pending], false, "name");
    expect(groups.map(group => group.items.length).sort()).toEqual([1, 1, 1, 2]);
    expect(weaponClass(pending)).toBe("pending");
    const unusual = copy("6"); unusual.details!.rarity = "future rarity";
    expect(weaponClass(unusual)).toBe("special");
  });
  it("filters individual loans before grouping and preserves full summary counts", () => {
    const items = [copy("1"), { ...copy("2"), loaned: { id: 2332935, name: "Daz69" } }];
    const filtered = filterArmory(items, { ...EMPTY_ARMORY_FILTERS, search: "daz", status: "loaned" });
    expect(groupArmory(filtered, false, "name")[0].items.map(item => item.uid)).toEqual(["2"]);
    expect(armoryCounts(items)).toMatchObject({ total: 2, available: 1, loaned: 1, borrowers: 1 });
  });
  it("sorts individual stats with pending details last and exports every bonus safely", () => {
    const special = copy("2", true); special.details!.stats.damage = 80;
    special.name = '=HYPERLINK("bad")'; special.details!.bonuses.push({ id: 46, title: "Weaken", value: 22, description: "Defense reduction" });
    const items = [{ ...copy("3"), details: null }, copy("1"), special];
    expect(groupArmory(items, true, "damage", "desc").map(group => group.items[0].uid)).toEqual(["2", "1", "3"]);
    expect(groupArmory(items, true, "damage", "asc").map(group => group.items[0].uid)).toEqual(["1", "2", "3"]);
    const csv = armoryCsv([special]);
    expect(csv).toContain("'=HYPERLINK"); expect(csv).toContain("Achilles (52)"); expect(csv).toContain("Weaken (22)");
    expect(csv.split("\r\n")).toHaveLength(2);
  });
  it("applies direction to weapon names and loan counts", () => {
    const items = [{ ...copy("1", true), name: "Zulu" }, { ...copy("2", true), name: "Alpha", loaned: { id: 1, name: "Borrower" } }];
    const ids = (sort: "name" | "loaned", direction: "asc" | "desc") => groupArmory(items, true, sort, direction).map(group => group.items[0].uid);
    expect(ids("name", "asc")).toEqual(["2", "1"]);
    expect(ids("name", "desc")).toEqual(["1", "2"]);
    expect(ids("loaned", "asc")).toEqual(["1", "2"]);
    expect(ids("loaned", "desc")).toEqual(["2", "1"]);
  });
});
