import { fetchWithTimeout } from "../utils";

export class ExternalApiError extends Error {
  constructor(
    message: string,
    readonly service: string,
    readonly status: number | null = null,
  ) {
    super(message);
  }
}

export async function fetchExternal(
  input: string | URL,
  init: RequestInit,
  options: { timeoutMs?: number } = {},
): Promise<Response> {
  const url = input.toString();
  return options.timeoutMs
    ? fetchWithTimeout(url, init, options.timeoutMs)
    : fetch(url, init);
}

export async function fetchExternalJson<T = unknown>(
  service: string,
  input: string | URL,
  init: RequestInit,
  options: { timeoutMs?: number } = {},
): Promise<T> {
  const response = await fetchExternal(input, init, options);
  const data = await readExternalJson<T>(response);
  await assertExternalResponseOk(response, service, data);
  return data;
}

export async function readExternalJson<T = unknown>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) {
    return {} as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return { raw: text } as T;
  }
}

export async function assertExternalResponseOk(
  response: Response,
  service: string,
  data?: unknown,
): Promise<void> {
  if (response.ok) {
    return;
  }

  const details = data === undefined
    ? await response.text().catch(() => "")
    : upstreamErrorMessage(data);
  throw new ExternalApiError(
    `${service} request failed with HTTP ${response.status}${details ? ` ${details}` : ""}`,
    service,
    response.status,
  );
}

export function throwIfUpstreamError(data: unknown, service: string): void {
  const message = upstreamErrorMessage(data);
  if (message) {
    throw new ExternalApiError(`${service} API error: ${message}`, service);
  }
}

export function upstreamErrorMessage(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const record = data as Record<string, unknown>;
  const error = record.error;
  if (!error) {
    return null;
  }

  if (typeof error === "string") {
    return error;
  }

  if (typeof error === "object" && error !== null) {
    const errorRecord = error as Record<string, unknown>;
    return String(errorRecord.error ?? errorRecord.message ?? JSON.stringify(error));
  }

  return String(error);
}
