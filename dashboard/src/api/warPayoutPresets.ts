import type { WarPayoutPreset, WarPayoutPresetConfig } from "../../../shared/warPayoutPresets";
import { deleteJson, getJson, postJson, putJson } from "./client";

const path = "/api/war-payout-presets";
export function getWarPayoutPresets(signal?: AbortSignal) {
  return getJson<{ ok: true; presets: WarPayoutPreset[] }>(path, true, signal);
}
export function getWarPayoutPreset(id: string) {
  return getJson<{ ok: true; preset: WarPayoutPreset }>(`${path}/${encodeURIComponent(id)}`);
}
export function createWarPayoutPreset(name: string, config: WarPayoutPresetConfig) {
  return postJson<{ ok: true; preset: WarPayoutPreset }>(path, { name, config });
}
export function updateWarPayoutPreset(id: string, name: string, config: WarPayoutPresetConfig) {
  return putJson<{ ok: true; preset: WarPayoutPreset }>(`${path}/${encodeURIComponent(id)}`, { name, config });
}
export function deleteWarPayoutPreset(id: string) {
  return deleteJson<{ ok: true }>(`${path}/${encodeURIComponent(id)}`);
}
