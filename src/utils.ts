import { TornAttack } from "./types";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export function boolToInt(value: boolean | undefined): number | null {
  if (value === undefined) {
    return null;
  }

  return value ? 1 : 0;
}

export function parseLimit(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(Math.floor(parsed), max);
}

export function normalizeAttacks(
  attacks: TornAttack[] | Record<string, TornAttack> | undefined,
): TornAttack[] {
  if (!attacks) {
    return [];
  }

  if (Array.isArray(attacks)) {
    return attacks;
  }

  return Object.values(attacks);
}
