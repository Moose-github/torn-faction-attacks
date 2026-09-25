import { describe, expect, it } from "vitest";
import { PAGE_PATHS, parseAppRoute, retiredPageRedirect } from "./routes";

describe("retired page routes", () => {
  it.each(["/dice-game", "/dice-game/", "/DICE-GAME", "/admin/packs", "/admin/packs/"])(
    "redirects %s to the dashboard",
    (path) => {
      expect(retiredPageRedirect(path)).toBe("/");
      expect(parseAppRoute(path)).toEqual({ view: "dashboard", warName: null });
    },
  );

  it("leaves active page and recorded war routes unchanged", () => {
    for (const [view, path] of Object.entries(PAGE_PATHS)) {
      expect(retiredPageRedirect(path)).toBeNull();
      expect(parseAppRoute(path)).toEqual({ view, warName: null });
    }
    expect(retiredPageRedirect("/wars/dice-game")).toBeNull();
    expect(parseAppRoute("/wars/dice-game")).toEqual({ view: "war", warName: "dice-game" });
  });
});
