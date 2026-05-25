import type {
  TradeItemSnapshotSummary,
  TradeItemSource,
  TradeOpportunity,
  TradeWatchlist,
  TradeWatchlistPayload,
} from "../api";
import { formatNumber, formatRelativeTime } from "./format";

export const STALE_SCAN_SECONDS = 30 * 60;

export type TradeSortKey = "profit" | "bulk_profit" | "roi" | "quantity" | "listing_price" | "item";

export type TradeScoutFilters = {
  search: string;
  minProfit: string;
  minRoi: string;
  minQuantity: string;
  sortBy: TradeSortKey;
  onlyProfitable: boolean;
  hideStale: boolean;
};

export type WatchlistPreset = {
  name: string;
  itemIds: number[];
  minProfit: number;
  minRoiPercent: number;
  minQuantity: number;
};

export type WatchlistFormState = {
  name: string;
  itemIds: string;
  itemSource: TradeItemSource;
  minProfit: string;
  minRoiPercent: string;
  minQuantity: string;
  marketFeePercent: string;
};

export const EMPTY_FILTERS: TradeScoutFilters = {
  search: "",
  minProfit: "",
  minRoi: "",
  minQuantity: "",
  sortBy: "profit",
  onlyProfitable: true,
  hideStale: false,
};

export const EMPTY_FORM: WatchlistFormState = {
  name: "",
  itemIds: "",
  itemSource: "weav3r_verified",
  minProfit: "25000",
  minRoiPercent: "0",
  minQuantity: "1",
  marketFeePercent: "5",
};

export const WATCHLIST_PRESETS: WatchlistPreset[] = [
  {
    name: "Plushies - quick flips",
    itemIds: [258, 260, 261, 263, 264, 266, 268, 269, 273, 274],
    minProfit: 25000,
    minRoiPercent: 0,
    minQuantity: 1,
  },
  {
    name: "Plushies - bulk flips",
    itemIds: [258, 260, 261, 263, 264, 266, 268, 269, 273, 274],
    minProfit: 100000,
    minRoiPercent: 0,
    minQuantity: 3,
  },
  {
    name: "Energy cans - market flips",
    itemIds: [530, 532, 533, 553, 554, 555, 985, 986, 987],
    minProfit: 50000,
    minRoiPercent: 1,
    minQuantity: 1,
  },
  {
    name: "Alcohol - nerve bottles",
    itemIds: [180, 181, 426, 531, 541, 542, 550, 551, 552, 816, 873, 984],
    minProfit: 5000,
    minRoiPercent: 0,
    minQuantity: 1,
  },
];

export function groupOpportunitiesByItem(opportunities: TradeOpportunity[]): Array<{
  itemId: number;
  itemName: string;
  opportunities: TradeOpportunity[];
}> {
  const groups = new Map<number, TradeOpportunity[]>();
  opportunities.forEach((opportunity) => {
    const current = groups.get(opportunity.item_id) ?? [];
    current.push(opportunity);
    groups.set(opportunity.item_id, current);
  });

  return Array.from(groups.entries()).map(([itemId, rows]) => ({
    itemId,
    itemName: rows.find((row) => row.item_name)?.item_name ?? `Item ${itemId}`,
    opportunities: rows,
  }));
}

export function itemsWithoutVisibleOpportunities(
  itemIds: number[],
  allOpportunities: TradeOpportunity[],
  visibleGroups: Array<{ itemId: number }>,
): Array<{ id: number; name: string }> {
  if (itemIds.length === 0) {
    return [];
  }

  const visibleItemIds = new Set(visibleGroups.map((group) => group.itemId));
  return itemIds
    .filter((itemId) => !visibleItemIds.has(itemId))
    .map((itemId) => ({
      id: itemId,
      name: allOpportunities.find((opportunity) => opportunity.item_id === itemId && opportunity.item_name)?.item_name ?? `Item ${itemId}`,
    }));
}

export function filterAndSortOpportunities(
  opportunities: TradeOpportunity[],
  filters: TradeScoutFilters,
  snapshotByItem: Map<number, TradeItemSnapshotSummary>,
): TradeOpportunity[] {
  const search = filters.search.trim().toLowerCase();
  const minProfit = optionalNumber(filters.minProfit);
  const minRoi = optionalNumber(filters.minRoi);
  const minQuantity = optionalNumber(filters.minQuantity);
  return opportunities
    .filter((opportunity) => {
      const snapshot = snapshotByItem.get(opportunity.item_id) ?? null;
      if (filters.hideStale && (!snapshot || nowSeconds() - snapshot.scanned_at > STALE_SCAN_SECONDS)) return false;
      if (filters.onlyProfitable && opportunity.profit <= 0) return false;
      if (minProfit !== null && opportunity.profit < minProfit) return false;
      if (minRoi !== null && opportunity.roi_percent < minRoi) return false;
      if (minQuantity !== null && opportunity.quantity < minQuantity) return false;
      if (!search) return true;
      const haystack = [
        opportunity.item_name,
        opportunity.item_id,
        opportunity.seller_name,
        opportunity.seller_id,
        opportunity.source,
        opportunity.reference_label,
      ].join(" ").toLowerCase();
      return haystack.includes(search);
    })
    .sort((left, right) => compareOpportunities(left, right, filters.sortBy));
}

export function snapshotFreshness(scannedAt: number): { label: string; tone: "fresh" | "warm" | "stale" } {
  const ageSeconds = nowSeconds() - scannedAt;
  if (ageSeconds > STALE_SCAN_SECONDS) {
    return { label: `Stale - ${formatRelativeTime(scannedAt)}`, tone: "stale" };
  }
  if (ageSeconds > 10 * 60) {
    return { label: `Aging - ${formatRelativeTime(scannedAt)}`, tone: "warm" };
  }
  return { label: `Fresh - ${formatRelativeTime(scannedAt)}`, tone: "fresh" };
}

export function searchFreshness(
  itemIds: number[],
  snapshotByItem: Map<number, TradeItemSnapshotSummary>,
): { label: string; tone: "fresh" | "warm" | "stale" } {
  const snapshots = itemIds.map((itemId) => snapshotByItem.get(itemId)).filter(Boolean) as TradeItemSnapshotSummary[];
  if (snapshots.length === 0) {
    return { label: "No item snapshots", tone: "stale" };
  }
  if (snapshots.length < itemIds.length) {
    return { label: `${itemIds.length - snapshots.length} items unscanned`, tone: "stale" };
  }
  const oldest = Math.min(...snapshots.map((snapshot) => snapshot.scanned_at));
  return snapshotFreshness(oldest);
}

export function itemSnapshotLabel(snapshot: TradeItemSnapshotSummary | null | undefined): string {
  if (!snapshot) {
    return "Not scanned";
  }
  if (snapshot.status !== "ok") {
    return `Scan failed ${formatRelativeTime(snapshot.scanned_at)}`;
  }
  return `Scanned ${formatRelativeTime(snapshot.scanned_at)}`;
}

export function opportunityQuality(
  opportunity: TradeOpportunity,
  search: TradeWatchlistPayload | null,
  snapshot: TradeItemSnapshotSummary | null,
): { label: string; detail: string; tone: "good" | "warn" | "muted" | "danger" } {
  if (snapshot && nowSeconds() - snapshot.scanned_at > STALE_SCAN_SECONDS) {
    return { label: "Needs price check", detail: "Scan is over 30m old", tone: "warn" };
  }

  if (opportunity.profit <= 0) {
    return { label: "No margin", detail: "Profit is currently negative", tone: "danger" };
  }

  if (search && opportunity.profit < search.min_profit && opportunity.bulk_profit >= search.min_profit) {
    return { label: "Bulk only", detail: `${opportunity.needed_quantity ?? 1}+ needed`, tone: "muted" };
  }

  if (opportunity.roi_percent < 2) {
    return { label: "Low margin", detail: `${formatPercent(opportunity.roi_percent)} ROI`, tone: "warn" };
  }

  return { label: "Good flip", detail: `${money(opportunity.profit)} unit profit`, tone: "good" };
}

export function createdByLabel(watchlist: TradeWatchlist): string {
  if (watchlist.created_by_name) {
    return `Created by ${watchlist.created_by_name}`;
  }
  if (watchlist.created_by_torn_user_id) {
    return `Created by #${watchlist.created_by_torn_user_id}`;
  }
  return "Default shared list";
}

export function bazaarUrl(sellerId: number): string {
  return `https://www.torn.com/bazaar.php?userId=${encodeURIComponent(String(sellerId))}#/`;
}

export function formFromTemplate(watchlist: TradeWatchlist): WatchlistFormState {
  return {
    name: watchlist.name,
    itemIds: watchlist.item_ids.join(", "),
    itemSource: watchlist.item_source,
    minProfit: String(watchlist.min_profit),
    minRoiPercent: String(watchlist.min_roi_percent),
    minQuantity: String(watchlist.min_quantity),
    marketFeePercent: String(watchlist.market_fee_percent),
  };
}

export function formToPayload(form: WatchlistFormState): TradeWatchlistPayload | null {
  const payload = formToSearchPayload(form);
  if (!payload) {
    return null;
  }
  const name = form.name.trim();
  if (!name) {
    return null;
  }
  return { ...payload, name };
}

export function formToSearchPayload(form: WatchlistFormState): TradeWatchlistPayload | null {
  const itemIds = parseItemIds(form.itemIds);
  const name = form.name.trim();
  if (itemIds.length === 0) {
    return null;
  }

  return {
    name,
    item_ids: itemIds,
    item_source: form.itemSource,
    min_profit: numericInput(form.minProfit, 25000),
    min_roi_percent: numericInput(form.minRoiPercent, 0),
    min_quantity: Math.max(1, Math.floor(numericInput(form.minQuantity, 1))),
    market_fee_percent: numericInput(form.marketFeePercent, 5),
  };
}

export function parseItemIds(value: string): number[] {
  return Array.from(new Set(
    value
      .split(/[\s,]+/)
      .map((item) => Number(item.trim()))
      .filter((item) => Number.isInteger(item) && item > 0),
  ));
}

export function sourceLabel(source: TradeItemSource): string {
  switch (source) {
    case "weav3r_verified":
      return "Weav3r + Torn";
    case "torn":
      return "Torn market";
    default:
      return source;
  }
}

export function money(value: number): string {
  return `$${formatNumber(Math.round(value))}`;
}

export function formatPercent(value: number): string {
  return `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
}

function compareOpportunities(left: TradeOpportunity, right: TradeOpportunity, sortBy: TradeSortKey): number {
  switch (sortBy) {
    case "bulk_profit":
      return right.bulk_profit - left.bulk_profit || right.profit - left.profit || left.listing_price - right.listing_price;
    case "roi":
      return right.roi_percent - left.roi_percent || right.profit - left.profit;
    case "quantity":
      return right.quantity - left.quantity || right.bulk_profit - left.bulk_profit;
    case "listing_price":
      return left.listing_price - right.listing_price || right.profit - left.profit;
    case "item":
      return (left.item_name ?? `Item ${left.item_id}`).localeCompare(right.item_name ?? `Item ${right.item_id}`);
    case "profit":
    default:
      return right.profit - left.profit || right.bulk_profit - left.bulk_profit || left.listing_price - right.listing_price;
  }
}

function numericInput(value: string, fallback: number): number {
  const parsed = Number(value.replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalNumber(value: string): number | null {
  const trimmed = value.replace(/,/g, "").trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
