import { describe, expect, it } from "vitest";
import { isAdminOnlyView, PAGE_PATHS, parseAppRoute } from "./routes";

it("protects the armory route as an admin page", () => {
  expect(parseAppRoute("/admin/armory")).toEqual({ view: "factionArmory", warName: null });
  expect(isAdminOnlyView("factionArmory")).toBe(true);
});

describe("page routes", () => {
  it.each(["/unknown-page", "/unknown-page/"])(
    "falls back to the dashboard for %s",
    (path) => {
      expect(parseAppRoute(path)).toEqual({ view: "dashboard", warName: null });
    },
  );

  it("leaves active page and recorded war routes unchanged", () => {
    for (const [view, path] of Object.entries(PAGE_PATHS)) {
      expect(parseAppRoute(path)).toEqual({ view, warName: null });
    }
    expect(parseAppRoute("/wars/example-war")).toEqual({ view: "war", warName: "example-war" });
  });
});
