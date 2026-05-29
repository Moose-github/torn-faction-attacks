import { deleteJson, getJson, postJson, putJson } from "./client";
import type { TradeOpportunitiesResponse, TradeScanResponse, TradeWatchlistPayload, TradeWatchlistResponse, TradeWatchlistsResponse } from "./types";

export async function getTradeWatchlists(): Promise<TradeWatchlistsResponse> {
  return getJson<TradeWatchlistsResponse>("/api/trade/watchlists");
}

export async function createTradeWatchlist(payload: TradeWatchlistPayload): Promise<TradeWatchlistResponse> {
  return postJson<TradeWatchlistResponse>("/api/trade/watchlists", payload);
}

export async function updateTradeWatchlist(
  id: number,
  payload: TradeWatchlistPayload,
): Promise<TradeWatchlistResponse> {
  return putJson<TradeWatchlistResponse>(`/api/trade/watchlists/${encodeURIComponent(String(id))}`, payload);
}

export async function deleteTradeWatchlist(id: number): Promise<unknown> {
  return deleteJson(`/api/trade/watchlists/${encodeURIComponent(String(id))}`);
}

export async function scanTradeWatchlist(id: number, tornKey: string): Promise<TradeScanResponse> {
  return postJson<TradeScanResponse>(`/api/trade/watchlists/${encodeURIComponent(String(id))}/scan`, {
    torn_key: tornKey,
  });
}

export async function getTradeSearchOpportunities(payload: TradeWatchlistPayload): Promise<TradeOpportunitiesResponse> {
  return postJson<TradeOpportunitiesResponse>("/api/trade/search/opportunities", payload);
}

export async function scanTradeSearch(
  payload: TradeWatchlistPayload,
  tornKey: string,
  refreshItemId?: number,
): Promise<TradeScanResponse> {
  return postJson<TradeScanResponse>("/api/trade/search/scan", {
    ...payload,
    torn_key: tornKey,
    ...(refreshItemId ? { refresh_item_id: refreshItemId } : {}),
  });
}

export async function getTradeOpportunities(watchlistId: number): Promise<TradeOpportunitiesResponse> {
  return getJson<TradeOpportunitiesResponse>(
    `/api/trade/opportunities?watchlist_id=${encodeURIComponent(String(watchlistId))}`,
  );
}
