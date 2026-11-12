import { getAuthToken } from "../auth/storage";
import { reportAuthFailure } from "../auth/events";

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ??
  (import.meta.env.DEV ? "" : "https://torn-faction-attacks.moose-3065754.workers.dev");
export const MONITOR_WORKER_URL =
  import.meta.env.VITE_MONITOR_WORKER_URL ?? "https://torn-enemy-hospital-monitor.moose-3065754.workers.dev";

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null = null) {
    super(message);
    this.name = "ApiError";
  }
}

async function responseData(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const data: unknown = await response.json();
    return data !== null && typeof data === "object" ? data as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function requestError(response: Response, data: Record<string, unknown> | null, token: string | null, path: string): ApiError {
  const code = typeof data?.code === "string" ? data.code : null;
  const error = new ApiError(
    typeof data?.error === "string" ? data.error : `Request failed: ${response.status}`,
    response.status, code,
  );
  // Auth operations handle their own results. Attribute failures to the credential actually sent.
  if (token && !path.startsWith("/api/auth/")) {
    if (response.status === 401) reportAuthFailure({ token, kind: "unauthorized" });
    else if (response.status === 403 && code === "ADMIN_REQUIRED") reportAuthFailure({ token, kind: "permissions" });
  }
  return error;
}

async function requestJson<T>(path: string, method: string, body: unknown, includeAuth: boolean, signal?: AbortSignal): Promise<T> {
  const token = includeAuth ? getAuthToken() : null;
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method, headers, signal, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await responseData(response);
  if (!response.ok || data?.ok === false) throw requestError(response, data, token, path);
  if (data === null) throw new ApiError("Server returned an invalid JSON response", response.status, "INVALID_RESPONSE");
  return data as T;
}

export function getJson<T>(path: string, includeAuth = true, signal?: AbortSignal): Promise<T> {
  return requestJson(path, "GET", undefined, includeAuth, signal);
}

export function postJson<T = unknown>(path: string, body?: unknown, includeAuth = true, signal?: AbortSignal): Promise<T> {
  return requestJson(path, "POST", body, includeAuth, signal);
}

export function putJson<T = unknown>(path: string, body: unknown, includeAuth = true): Promise<T> {
  return requestJson(path, "PUT", body, includeAuth);
}

export function deleteJson<T = unknown>(path: string, includeAuth = true): Promise<T> {
  return requestJson(path, "DELETE", undefined, includeAuth);
}

/** File/image endpoints share the same error and auth handling as JSON endpoints. */
export async function getApiResponse(path: string): Promise<Response> {
  const token = getAuthToken();
  const response = await fetch(`${API_BASE_URL}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!response.ok) throw requestError(response, await responseData(response), token, path);
  return response;
}

export function filenameFromContentDisposition(value: string): string | null {
  const match = value.match(/filename="([^"]+)"/);
  return match?.[1] ?? null;
}
