export type ThemeMode = "light" | "dark";

const THEME_STORAGE_KEY = "buttgrass-theme";

export function initialThemeMode(): ThemeMode {
  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (storedTheme === "light" || storedTheme === "dark") {
    return storedTheme;
  }

  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function persistThemeMode(themeMode: ThemeMode): void {
  document.documentElement.dataset.theme = themeMode;
  window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
}
