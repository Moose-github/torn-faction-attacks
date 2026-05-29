export type TradeItemSource = "weav3r_verified" | "torn";

export type TradeWatchlist = {
  id: number;
  name: string;
  item_ids: number[];
  item_source: TradeItemSource;
  min_profit: number;
  min_roi_percent: number;
  min_quantity: number;
  market_fee_percent: number;
  created_by_torn_user_id: number | null;
  created_by_name: string | null;
  created_at: number;
  updated_at: number;
  latest_snapshot: TradeSnapshotSummary | null;
};

export type TradeSnapshotSummary = {
  id: string;
  scanned_at: number;
  scanned_by_torn_user_id: number | null;
  status: string;
  error: string | null;
  opportunity_count: number;
};

export type TradeItemSnapshotSummary = {
  id: string;
  item_id: number;
  item_name: string | null;
  item_source: TradeItemSource;
  scanned_at: number;
  scanned_by_torn_user_id: number | null;
  status: string;
  error: string | null;
  offer_count: number;
};

export type TradeWatchlistRow = {
  id: number;
  name: string;
  item_ids_json: string;
  item_source: string;
  min_profit: number;
  min_roi_percent: number;
  min_quantity: number;
  market_fee_percent: number;
  created_by_torn_user_id: number | null;
  created_by_name: string | null;
  created_at: number;
  updated_at: number;
};

export type TradeWatchlistListRow = TradeWatchlistRow & {
  latest_snapshot_id: string | null;
  latest_scanned_at: number | null;
  latest_scanned_by_torn_user_id: number | null;
  latest_status: string | null;
  latest_error: string | null;
  latest_opportunity_count: number | null;
};

export type TradeOpportunity = {
  id?: string;
  snapshot_id?: string;
  watchlist_id?: number | null;
  item_id: number;
  item_name: string | null;
  item_source?: TradeItemSource;
  source: string;
  listing_price: number;
  resale_price: number;
  profit: number;
  roi_percent: number;
  quantity: number;
  bulk_profit: number;
  needed_quantity: number | null;
  seller_id: number | null;
  seller_name: string | null;
  reference_label: string | null;
  raw_json: string | null;
  created_at?: number;
};

export type TradeOpportunityRow = TradeOpportunity & {
  id: string;
  snapshot_id: string;
  watchlist_id: number;
  created_at: number;
};

export type TradeItemSnapshotRow = {
  id: string;
  item_id: number;
  item_source: string;
  item_name: string | null;
  scanned_by_torn_user_id: number | null;
  scanned_at: number;
  status: string;
  error: string | null;
  raw_json: string | null;
  offer_count?: number | null;
};

export type TradeItemOfferRow = {
  id: string;
  item_snapshot_id: string;
  item_id: number;
  item_name: string | null;
  item_source: string;
  source: string;
  listing_price: number;
  reference_price: number;
  quantity: number;
  fee_applies: number;
  seller_id: number | null;
  seller_name: string | null;
  reference_label: string | null;
  raw_json: string | null;
  created_at: number;
};

export type TradeSearchPayload = {
  name?: string;
  item_ids: number[];
  item_source: TradeItemSource;
  min_profit: number;
  min_roi_percent: number;
  min_quantity: number;
  market_fee_percent: number;
};

export type StoredTradeOffer = {
  item_id: number;
  item_name: string | null;
  item_source: TradeItemSource;
  source: string;
  listing_price: number;
  reference_price: number;
  quantity: number;
  fee_applies: boolean;
  seller_id: number | null;
  seller_name: string | null;
  reference_label: string | null;
  raw_json: string | null;
};

export type NormalizedOffer = {
  price: number;
  quantity: number;
  playerId: number | null;
  playerName: string | null;
  raw: unknown;
};

export const MAX_WATCHLIST_ITEMS = 50;
export const MAX_SAVED_OPPORTUNITIES = 250;
export const REQUEST_TIMEOUT_MS = 12_000;
export const TORN_API_BASE = "https://api.torn.com/v2";
export const WEAV3R_API_BASE = "https://weav3r.dev/api";
