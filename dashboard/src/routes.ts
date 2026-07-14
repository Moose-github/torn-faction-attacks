export type AppView =
  | "dashboard"
  | "war"
  | "warRoom"
  | "retaliations"
  | "hospitalMonitor"
  | "members"
  | "lifestyle"
  | "miscellaneous"
  | "tradeScout"
  | "arrestScout"
  | "warPayouts"
  | "stockMarketStatus"
  | "stockInvestments"
  | "diceGame"
  | "dataHealth"
  | "settings"
  | "admin";

export type AppRoute = {
  view: AppView;
  warName: string | null;
};

export const PAGE_PATHS: Record<Exclude<AppView, "war">, string> = {
  dashboard: "/",
  warRoom: "/war-room",
  retaliations: "/retaliations",
  hospitalMonitor: "/enemy-hospital-monitor",
  members: "/members",
  lifestyle: "/daily-averages",
  miscellaneous: "/miscellaneous",
  tradeScout: "/trade-scout",
  arrestScout: "/arrest-scout",
  warPayouts: "/war-payouts",
  stockMarketStatus: "/admin/stock-market",
  stockInvestments: "/admin/stock-investments",
  diceGame: "/dice-game",
  dataHealth: "/data-health",
  settings: "/settings",
  admin: "/admin",
};

export function parseAppRoute(pathname: string): AppRoute {
  const normalizedPath = pathname.replace(/\/+$/, "") || "/";
  const lowerPath = normalizedPath.toLowerCase();

  if (lowerPath === "/wars") {
    return {
      view: "war",
      warName: null,
    };
  }

  if (lowerPath.startsWith("/wars/")) {
    const rawWarName = normalizedPath.slice("/wars/".length);
    return {
      view: "war",
      warName: safeDecodePathPart(rawWarName),
    };
  }

  if (lowerPath === "/admin/data-health") {
    return {
      view: "dataHealth",
      warName: null,
    };
  }

  const matchedPage = Object.entries(PAGE_PATHS).find(([, path]) => path === lowerPath);
  if (matchedPage) {
    return {
      view: matchedPage[0] as AppView,
      warName: null,
    };
  }

  return {
    view: "dashboard",
    warName: null,
  };
}

export function pathForView(view: AppView, warName?: string | null): string {
  if (view === "war") {
    return warName ? `/wars/${encodeURIComponent(warName)}` : "/wars";
  }

  return PAGE_PATHS[view];
}

export function isAdminOnlyView(view: AppView): boolean {
  return view === "admin" || view === "warPayouts" || view === "stockMarketStatus" || view === "stockInvestments";
}

function safeDecodePathPart(value: string): string | null {
  if (!value) {
    return null;
  }

  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
