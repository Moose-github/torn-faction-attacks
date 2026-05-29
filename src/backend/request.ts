export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return {};
  }

  const body = await request.json().catch(() => ({}));
  return isRecord(body) ? body : {};
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Math.floor(Number(value));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function positiveIntegerOrNull(value: unknown): number | null {
  const parsed = Math.floor(Number(value));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function positiveCurrencyOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function finitePositiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function boundedInteger(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

export function boundedNumber(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

export function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function validPositiveId(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}
