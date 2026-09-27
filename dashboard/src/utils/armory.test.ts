import { describe, expect, it } from "vitest";
import type { ArmoryCopy } from "../../../shared/armory";
import { armoryCounts, armoryCsv, EMPTY_ARMORY_FILTERS, filterArmory, groupArmory, loanElapsed, weaponClass } from "./armory";
const copy = (uid: string, special = false): ArmoryCopy => ({ uid, id: 399, name: "ArmaLite M-15A4", type: "Primary", loaned: null, loan_first_seen_at: null,
  details: { uid, id: 399, name: "ArmaLite M-15A4", type: "Weapon", sub_type: "Rifle", stats: { damage: 70, accuracy: 60, quality: 20 },
    bonuses: special ? [{ id: 50, title: "Achilles", value: 52, description: "52% increased Foot damage" }] : [], rarity: special ? "yellow" : null } });
describe("armory display", () => {
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
    expect(groupArmory([{ ...copy("3"), details: null }, copy("1"), special], true, "damage").map(group => group.items[0].uid)).toEqual(["2", "1", "3"]);
    const csv = armoryCsv([special]);
    expect(csv).toContain("'=HYPERLINK"); expect(csv).toContain("Achilles (52)"); expect(csv).toContain("Weaken (22)");
    expect(csv.split("\r\n")).toHaveLength(2);
  });
});
