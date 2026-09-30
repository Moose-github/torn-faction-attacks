import { getJson, postJson } from "./client";
import type { ChainWatchScheduleResponse, ChainWatchHistoryResponse } from "../../../shared/chainWatchSchedule";
import type { ChainWatchLiveResponse } from "../../../shared/chainWatchLive";

export function getChainWatchLive(signal?: AbortSignal): Promise<ChainWatchLiveResponse> {
  return getJson("/api/chain-watch/live", true, signal);
}

export function getChainWatchSchedule(id?: string | null, signal?: AbortSignal): Promise<ChainWatchScheduleResponse> {
  return getJson(`/api/chain-watch${id ? `?watch=${encodeURIComponent(id)}` : ""}`, true, signal);
}

export function getChainWatchHistory(signal?: AbortSignal): Promise<ChainWatchHistoryResponse> {
  return getJson("/api/chain-watch/history", true, signal);
}

export function changeChainWatchSlot(watchId: string, starts: number[], action: "claim" | "leave"): Promise<ChainWatchScheduleResponse> {
  return postJson("/api/chain-watch/slots", { watch_id: watchId, starts, action });
}

export function overrideChainWatchSlot(watchId: string, start: number, targetId: number | null): Promise<ChainWatchScheduleResponse> {
  return postJson("/api/admin/chain-watch/slots", { watch_id: watchId, starts: [start], target_id: targetId });
}

export function finishChainWatch(watchId: string, finish: string): Promise<ChainWatchScheduleResponse> {
  return postJson("/api/admin/chain-watch/finish", { watch_id: watchId, finish });
}
