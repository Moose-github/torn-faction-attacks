import { trackedTornFetch, type TornApiCallInput } from "../tornApiUsage";
import type { Env } from "../types";
import {
  assertExternalResponseOk,
  readExternalJson,
  throwIfUpstreamError,
} from "./http";

export async function fetchTrackedTornResponse(
  env: Env,
  input: string | URL,
  init: RequestInit,
  call: TornApiCallInput,
): Promise<Response> {
  return trackedTornFetch(env, input, init, call);
}

export async function fetchTrackedTornJson<T = unknown>(
  env: Env,
  input: string | URL,
  init: RequestInit,
  call: TornApiCallInput,
  options: { rejectApiError?: boolean; service?: string } = {},
): Promise<T> {
  const service = options.service ?? "Torn";
  const response = await trackedTornFetch(env, input, init, call);
  const data = await readExternalJson<T>(response);
  await assertExternalResponseOk(response, service, data);
  if (options.rejectApiError ?? true) {
    throwIfUpstreamError(data, service);
  }
  return data;
}
