/** Parse full amounts or case-insensitive k/m/b/t shorthand used by calculator inputs. */
export function parseNumber(value: string, fallback: number): number {
  const normalized = value.trim().toLowerCase().replace(/[$,%\s,_]/g, "");
  if (!normalized) {
    return fallback;
  }

  const match = normalized.match(/^(-?(?:\d+|\d*\.\d+))(k|m|b|t)?$/);
  if (!match) {
    return fallback;
  }

  const multiplier = {
    k: 1_000,
    m: 1_000_000,
    b: 1_000_000_000,
    t: 1_000_000_000_000,
  }[match[2] ?? ""] ?? 1;
  const parsed = Number(match[1]) * multiplier;
  return Number.isFinite(parsed) ? parsed : fallback;
}
