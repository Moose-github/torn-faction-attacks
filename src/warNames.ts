import type { Env } from "./types";

export function sanitizeWarName(value: string, fallback = "historical-war"): string {
  return value.replace(/[^a-zA-Z0-9 _-]/g, "").trim().slice(0, 50) || fallback;
}

function ordinal(value: number): string {
  const lastTwo = value % 100;
  const ending = lastTwo >= 11 && lastTwo <= 13
    ? "th"
    : ({ 1: "st", 2: "nd", 3: "rd" }[value % 10] ?? "th");
  return `${value}${ending}`;
}

export async function uniqueWarName(env: Env, baseName: string): Promise<string> {
  for (let occurrence = 1; ; occurrence += 1) {
    const suffix = occurrence === 1 ? "" : ` (${ordinal(occurrence)})`;
    const candidate = `${baseName.slice(0, 50 - suffix.length)}${suffix}`;
    // Reserve legacy numeric names too, even before the rename migration runs.
    const legacySuffix = occurrence === 1 ? "" : ` ${occurrence}`;
    const legacyName = `${baseName.slice(0, 50 - legacySuffix.length)}${legacySuffix}`;
    const existing = await env.DB.prepare(`
      SELECT id FROM wars
      WHERE LOWER(name) = LOWER(?) OR LOWER(name) = LOWER(?)
      LIMIT 1
    `).bind(candidate, legacyName).first();
    if (!existing) return candidate;
  }
}
