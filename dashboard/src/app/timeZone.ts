export type TimeZoneMode = "local" | "utc";

const TIME_ZONE_STORAGE_KEY = "buttgrass-time-zone-mode";

let activeTimeZoneMode: TimeZoneMode = "local";

export function initialTimeZoneMode(): TimeZoneMode {
  if (typeof window === "undefined") {
    return activeTimeZoneMode;
  }

  const storedMode = window.localStorage.getItem(TIME_ZONE_STORAGE_KEY);
  activeTimeZoneMode = storedMode === "utc" ? "utc" : "local";
  return activeTimeZoneMode;
}

export function persistTimeZoneMode(timeZoneMode: TimeZoneMode): void {
  activeTimeZoneMode = timeZoneMode;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(TIME_ZONE_STORAGE_KEY, timeZoneMode);
  }
}

export function currentTimeZoneMode(): TimeZoneMode {
  return activeTimeZoneMode;
}
