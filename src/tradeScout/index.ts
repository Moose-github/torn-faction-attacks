import { Env } from "../types";
import { trackedTornFetch } from "../tornApiUsage";
import { fetchWithTimeout, json, nowSeconds } from "../utils";

import {
  MAX_SAVED_OPPORTUNITIES,
  MAX_WATCHLIST_ITEMS,
  REQUEST_TIMEOUT_MS,
  TORN_API_BASE,
  WEAV3R_API_BASE,
} from "./model";
import type {
  NormalizedOffer,
  StoredTradeOffer,
  TradeItemOfferRow,
  TradeItemSnapshotRow,
  TradeItemSnapshotSummary,
  TradeItemSource,
  TradeOpportunity,
  TradeOpportunityRow,
  TradeSearchPayload,
  TradeSnapshotSummary,
  TradeWatchlist,
  TradeWatchlistListRow,
  TradeWatchlistRow,
} from "./model";

export async function listTradeWatchlists(env: Env): Promise<Response> {
  const rows = await env.DB.prepare(
    `
    SELECT
      w.*,
      s.id AS latest_snapshot_id,
      s.scanned_at AS latest_scanned_at,
      s.scanned_by_torn_user_id AS latest_scanned_by_torn_user_id,
      s.status AS latest_status,
      s.error AS latest_error,
      (
        SELECT COUNT(*)
        FROM trade_opportunities o
        WHERE o.snapshot_id = s.id
      ) AS latest_opportunity_count
    FROM trade_watchlists w
    LEFT JOIN trade_watchlist_snapshots s
      ON s.id = (
        SELECT id
        FROM trade_watchlist_snapshots
        WHERE watchlist_id = w.id
        ORDER BY scanned_at DESC
        LIMIT 1
      )
    ORDER BY w.updated_at DESC, w.name ASC
    `,
  ).all<TradeWatchlistListRow>();

  return json({
    ok: true,
    watchlists: (rows.results ?? []).map(mapTradeWatchlistRow),
  });
}

export async function createTradeWatchlist(
  request: Request,
  env: Env,
  createdByTornUserId: number | null,
): Promise<Response> {
  const validated = await readWatchlistPayload(request);
  if ("response" in validated) {
    return validated.response;
  }

  const now = nowSeconds();
  const createdByName = createdByTornUserId ? await readHomeMemberName(env, createdByTornUserId) : null;
  try {
    const result = await env.DB.prepare(
      `
      INSERT INTO trade_watchlists (
        name,
        item_ids_json,
        item_source,
        min_profit,
        min_roi_percent,
        min_quantity,
        market_fee_percent,
        created_by_torn_user_id,
        created_by_name,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
      .bind(
        validated.payload.name,
        JSON.stringify(validated.payload.item_ids),
        validated.payload.item_source,
        validated.payload.min_profit,
        validated.payload.min_roi_percent,
        validated.payload.min_quantity,
        validated.payload.market_fee_percent,
        createdByTornUserId,
        createdByName,
        now,
        now,
      )
      .run();

    const id = Number((result.meta as { last_row_id?: unknown } | undefined)?.last_row_id);
    return json({
      ok: true,
      watchlist: await readTradeWatchlist(env, id),
    });
  } catch (err: any) {
    const message = String(err?.message ?? err);
    if (message.toLowerCase().includes("unique")) {
      return json({ ok: false, error: "A watchlist with that name already exists", code: "DUPLICATE_WATCHLIST" }, 409);
    }
    throw err;
  }
}

export async function updateTradeWatchlist(request: Request, env: Env, id: number): Promise<Response> {
  if (!validId(id)) {
    return json({ ok: false, error: "Invalid watchlist ID", code: "INVALID_WATCHLIST_ID" }, 400);
  }

  const validated = await readWatchlistPayload(request);
  if ("response" in validated) {
    return validated.response;
  }

  const now = nowSeconds();
  try {
    const result = await env.DB.prepare(
      `
      UPDATE trade_watchlists
      SET
        name = ?,
        item_ids_json = ?,
        item_source = ?,
        min_profit = ?,
        min_roi_percent = ?,
        min_quantity = ?,
        market_fee_percent = ?,
        updated_at = ?
      WHERE id = ?
      `,
    )
      .bind(
        validated.payload.name,
        JSON.stringify(validated.payload.item_ids),
        validated.payload.item_source,
        validated.payload.min_profit,
        validated.payload.min_roi_percent,
        validated.payload.min_quantity,
        validated.payload.market_fee_percent,
        now,
        id,
      )
      .run();

    if (Number(result.meta?.changes ?? 0) === 0) {
      return json({ ok: false, error: "Watchlist not found", code: "WATCHLIST_NOT_FOUND" }, 404);
    }

    return json({
      ok: true,
      watchlist: await readTradeWatchlist(env, id),
    });
  } catch (err: any) {
    const message = String(err?.message ?? err);
    if (message.toLowerCase().includes("unique")) {
      return json({ ok: false, error: "A watchlist with that name already exists", code: "DUPLICATE_WATCHLIST" }, 409);
    }
    throw err;
  }
}

export async function deleteTradeWatchlist(env: Env, id: number): Promise<Response> {
  if (!validId(id)) {
    return json({ ok: false, error: "Invalid watchlist ID", code: "INVALID_WATCHLIST_ID" }, 400);
  }

  const result = await env.DB.prepare(`DELETE FROM trade_watchlists WHERE id = ?`)
    .bind(id)
    .run();

  if (Number(result.meta?.changes ?? 0) === 0) {
    return json({ ok: false, error: "Watchlist not found", code: "WATCHLIST_NOT_FOUND" }, 404);
  }

  return json({ ok: true, deleted: { id } });
}

export async function getTradeOpportunities(url: URL, env: Env): Promise<Response> {
  const watchlistId = Number(url.searchParams.get("watchlist_id"));
  if (!validId(watchlistId)) {
    return json({ ok: false, error: "watchlist_id is required", code: "INVALID_WATCHLIST_ID" }, 400);
  }

  const snapshot = await latestSnapshotForWatchlist(env, watchlistId);
  if (!snapshot) {
    return json({
      ok: true,
      snapshot: null,
      opportunities: [],
    });
  }

  const rows = await env.DB.prepare(
    `
    SELECT *
    FROM trade_opportunities
    WHERE snapshot_id = ?
    ORDER BY profit DESC, bulk_profit DESC, listing_price ASC
    LIMIT ?
    `,
  )
    .bind(snapshot.id, MAX_SAVED_OPPORTUNITIES)
    .all<TradeOpportunityRow>();

  return json({
    ok: true,
    snapshot,
    opportunities: rows.results ?? [],
  });
}

export async function getTradeSearchOpportunities(request: Request, env: Env): Promise<Response> {
  const validated = await readSearchPayload(request, { requireName: false });
  if ("response" in validated) {
    return validated.response;
  }

  const result = await readDerivedTradeSearch(env, validated.payload);
  return json({
    ok: true,
    ...result,
  });
}

export async function scanTradeSearch(
  request: Request,
  env: Env,
  scannedByTornUserId: number | null,
): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const tornKey = typeof body.torn_key === "string"
    ? body.torn_key.trim()
    : typeof body.tornKey === "string"
      ? body.tornKey.trim()
      : "";
  if (!tornKey) {
    return json({ ok: false, error: "Torn API key is required for a scan", code: "MISSING_TORN_KEY" }, 400);
  }

  const validated = validateTradeSearchPayload(body, { requireName: false });
  if ("response" in validated) {
    return validated.response;
  }

  const requestedItemId = Number(body.refresh_item_id ?? body.refreshItemId);
  const itemIds = validId(requestedItemId)
    ? validated.payload.item_ids.filter((itemId) => itemId === requestedItemId)
    : validated.payload.item_ids;
  if (itemIds.length === 0) {
    return json({ ok: false, error: "Refresh item is not in the current search", code: "INVALID_REFRESH_ITEM" }, 400);
  }

  await scanAndSaveItems(env, {
    itemIds,
    itemSource: validated.payload.item_source,
    scannedByTornUserId,
    tornKey,
  });

  const result = await readDerivedTradeSearch(env, validated.payload);
  return json({
    ok: true,
    ...result,
  });
}

export async function scanTradeWatchlist(
  request: Request,
  env: Env,
  id: number,
  scannedByTornUserId: number | null,
): Promise<Response> {
  if (!validId(id)) {
    return json({ ok: false, error: "Invalid watchlist ID", code: "INVALID_WATCHLIST_ID" }, 400);
  }

  const body = (await request.json().catch(() => ({}))) as { torn_key?: unknown; tornKey?: unknown };
  const tornKey = typeof body.torn_key === "string"
    ? body.torn_key.trim()
    : typeof body.tornKey === "string"
      ? body.tornKey.trim()
      : "";

  if (!tornKey) {
    return json({ ok: false, error: "Torn API key is required for a scan", code: "MISSING_TORN_KEY" }, 400);
  }

  const watchlist = await readTradeWatchlist(env, id);
  if (!watchlist) {
    return json({ ok: false, error: "Watchlist not found", code: "WATCHLIST_NOT_FOUND" }, 404);
  }

  const snapshotId = crypto.randomUUID();
  const scannedAt = nowSeconds();

  try {
    const opportunities = await scanWatchlistItems(env, watchlist, tornKey);
    await saveScanSnapshot(env, {
      snapshotId,
      watchlist,
      scannedByTornUserId,
      scannedAt,
      status: "ok",
      error: null,
      opportunities,
    });

    const snapshot = await latestSnapshotForWatchlist(env, id);
    return json({
      ok: true,
      snapshot,
      opportunities: await readOpportunitiesForSnapshot(env, snapshotId),
    });
  } catch (err: any) {
    const error = String(err?.message ?? err);
    await saveScanSnapshot(env, {
      snapshotId,
      watchlist,
      scannedByTornUserId,
      scannedAt,
      status: "error",
      error,
      opportunities: [],
    });

    return json({
      ok: false,
      error,
      code: "TRADE_SCAN_FAILED",
      snapshot: await latestSnapshotForWatchlist(env, id),
    }, 502);
  }
}

async function scanWatchlistItems(env: Env, watchlist: TradeWatchlist, tornKey: string): Promise<TradeOpportunity[]> {
  const rows: TradeOpportunity[] = [];

  for (const itemId of watchlist.item_ids) {
    if (watchlist.item_source === "weav3r_verified") {
      const [weav3rData, tornData] = await Promise.all([
        fetchWeav3rJson(`/marketplace/${itemId}`),
        fetchTornJson(env, `/market/${itemId}/itemmarket`, tornKey, { limit: "20", offset: "0" }),
      ]);
      rows.push(...buildWeav3rRows(watchlist, itemId, weav3rData, itemMarketReference(tornData)));
    } else {
      const data = await fetchTornJson(env, `/market/${itemId}`, tornKey, { selections: "itemmarket,bazaar" });
      rows.push(...buildTornRows(watchlist, itemId, data));
    }
  }

  return rows
    .filter((row) => {
      const passesUnit = row.profit >= watchlist.min_profit;
      const passesBulk = row.profit > 0 && row.quantity > 1 && row.bulk_profit >= watchlist.min_profit;
      return (
        row.quantity >= watchlist.min_quantity &&
        row.roi_percent >= watchlist.min_roi_percent &&
        (passesUnit || passesBulk)
      );
    })
    .sort((a, b) => b.profit - a.profit || b.bulk_profit - a.bulk_profit || a.listing_price - b.listing_price)
    .slice(0, MAX_SAVED_OPPORTUNITIES);
}

async function readDerivedTradeSearch(
  env: Env,
  payload: TradeSearchPayload,
): Promise<{ snapshots: TradeItemSnapshotSummary[]; opportunities: TradeOpportunity[] }> {
  const snapshots = await latestItemSnapshotsForSearch(env, payload.item_ids, payload.item_source);
  const snapshotIds = snapshots.map((snapshot) => snapshot.id);
  if (snapshotIds.length === 0) {
    return { snapshots: [], opportunities: [] };
  }

  const placeholders = snapshotIds.map(() => "?").join(", ");
  const rows = await env.DB.prepare(
    `
    SELECT *
    FROM trade_item_offers
    WHERE item_snapshot_id IN (${placeholders})
    ORDER BY item_id ASC, listing_price ASC
    `,
  )
    .bind(...snapshotIds)
    .all<TradeItemOfferRow>();

  const opportunities = (rows.results ?? [])
    .map((offer) => opportunityFromStoredOffer(offer, payload))
    .filter((row) => {
      const passesUnit = row.profit >= payload.min_profit;
      const passesBulk = row.profit > 0 && row.quantity > 1 && row.bulk_profit >= payload.min_profit;
      return (
        row.quantity >= payload.min_quantity &&
        row.roi_percent >= payload.min_roi_percent &&
        (passesUnit || passesBulk)
      );
    })
    .sort((a, b) => b.profit - a.profit || b.bulk_profit - a.bulk_profit || a.listing_price - b.listing_price)
    .slice(0, MAX_SAVED_OPPORTUNITIES);

  return { snapshots, opportunities };
}

async function latestItemSnapshotsForSearch(
  env: Env,
  itemIds: number[],
  itemSource: TradeItemSource,
): Promise<TradeItemSnapshotSummary[]> {
  const rows = await Promise.all(
    itemIds.map((itemId) =>
      env.DB.prepare(
        `
        SELECT
          s.*,
          (
            SELECT COUNT(*)
            FROM trade_item_offers o
            WHERE o.item_snapshot_id = s.id
          ) AS offer_count
        FROM trade_item_snapshots s
        WHERE s.item_id = ?
          AND s.item_source = ?
        ORDER BY s.scanned_at DESC
        LIMIT 1
        `,
      )
        .bind(itemId, itemSource)
        .first<TradeItemSnapshotRow>(),
    ),
  );

  return rows
    .filter((row): row is TradeItemSnapshotRow => Boolean(row))
    .map(mapTradeItemSnapshotRow);
}

async function scanAndSaveItems(
  env: Env,
  input: {
    itemIds: number[];
    itemSource: TradeItemSource;
    scannedByTornUserId: number | null;
    tornKey: string;
  },
): Promise<void> {
  for (const itemId of input.itemIds) {
    const snapshotId = crypto.randomUUID();
    const scannedAt = nowSeconds();
    try {
      const result = await scanItemOffers(env, itemId, input.itemSource, input.tornKey);
      await saveItemSnapshot(env, {
        snapshotId,
        itemId,
        itemSource: input.itemSource,
        itemName: result.itemName,
        scannedByTornUserId: input.scannedByTornUserId,
        scannedAt,
        status: "ok",
        error: null,
        rawJson: result.rawJson,
        offers: result.offers,
      });
    } catch (err: any) {
      await saveItemSnapshot(env, {
        snapshotId,
        itemId,
        itemSource: input.itemSource,
        itemName: null,
        scannedByTornUserId: input.scannedByTornUserId,
        scannedAt,
        status: "error",
        error: String(err?.message ?? err),
        rawJson: null,
        offers: [],
      });
    }
  }
}

async function scanItemOffers(
  env: Env,
  itemId: number,
  itemSource: TradeItemSource,
  tornKey: string,
): Promise<{ itemName: string | null; rawJson: string | null; offers: StoredTradeOffer[] }> {
  if (itemSource === "weav3r_verified") {
    const [weav3rData, tornData] = await Promise.all([
      fetchWeav3rJson(`/marketplace/${itemId}`),
      fetchTornJson(env, `/market/${itemId}/itemmarket`, tornKey, { limit: "20", offset: "0" }),
    ]);
    const itemName = cleanString(weav3rData?.item_name);
    return {
      itemName,
      rawJson: JSON.stringify({ weav3r: weav3rData, torn_itemmarket: tornData }),
      offers: buildWeav3rStoredOffers(itemId, weav3rData, itemMarketReference(tornData)),
    };
  }

  const tornData = await fetchTornJson(env, `/market/${itemId}`, tornKey, { selections: "itemmarket,bazaar" });
  return {
    itemName: cleanString(tornData?.item?.name ?? tornData?.name),
    rawJson: JSON.stringify(tornData),
    offers: buildTornStoredOffers(itemId, tornData),
  };
}

function buildWeav3rStoredOffers(
  itemId: number,
  data: any,
  verifiedReference: number | null,
): StoredTradeOffer[] {
  const listings: any[] = Array.isArray(data?.listings) ? data.listings : [];
  const weav3rMarketPrice = finitePositiveNumber(data?.market_price);
  const bazaarAverage = finitePositiveNumber(data?.bazaar_average);
  const reference = verifiedReference && verifiedReference > 0 ? verifiedReference : weav3rMarketPrice;
  if (!reference) {
    return [];
  }

  const referenceLabel = verifiedReference && verifiedReference > 0
    ? `Verified Torn 5-item Market price${bazaarAverage ? `; Bazaar avg ${bazaarAverage}` : ""}`
    : "Weav3r market price";

  return listings
    .map((listing: any): NormalizedOffer => ({
      price: Number(listing?.price ?? 0),
      quantity: positiveInteger(listing?.quantity, 1),
      playerId: positiveIntegerOrNull(listing?.player_id),
      playerName: cleanString(listing?.player_name),
      raw: listing,
    }))
    .filter((listing) => listing.price > 0)
    .sort((a, b) => a.price - b.price)
    .slice(0, 10)
    .map((listing) => storedOfferFromListing({
      itemId,
      itemSource: "weav3r_verified",
      itemName: cleanString(data?.item_name),
      source: "Weav3r Bazaar",
      listing,
      reference,
      feeApplies: true,
      referenceLabel,
    }));
}

function buildTornStoredOffers(itemId: number, data: any): StoredTradeOffer[] {
  const marketOffers = normalizeOffers(data, "itemmarket");
  const bazaarOffers = normalizeOffers(data, "bazaar");
  const lowestMarket = priceAtCumulativeQuantity(marketOffers, 5);
  const lowestBazaar = bazaarOffers[0]?.price ?? null;
  const rows: StoredTradeOffer[] = [];

  if (bazaarOffers[0] && lowestMarket) {
    rows.push(storedOfferFromListing({
      itemId,
      itemSource: "torn",
      itemName: cleanString(data?.item?.name ?? data?.name),
      source: "Torn Bazaar",
      listing: bazaarOffers[0],
      reference: lowestMarket,
      feeApplies: true,
      referenceLabel: "Torn 5-item Market price",
    }));
  }

  if (marketOffers[0] && lowestBazaar) {
    rows.push(storedOfferFromListing({
      itemId,
      itemSource: "torn",
      itemName: cleanString(data?.item?.name ?? data?.name),
      source: "Torn Item Market",
      listing: marketOffers[0],
      reference: lowestBazaar,
      feeApplies: false,
      referenceLabel: "Lowest Torn Bazaar price",
    }));
  }

  return rows;
}

function storedOfferFromListing({
  itemId,
  itemSource,
  itemName,
  source,
  listing,
  reference,
  feeApplies,
  referenceLabel,
}: {
  itemId: number;
  itemSource: TradeItemSource;
  itemName: string | null;
  source: string;
  listing: NormalizedOffer;
  reference: number;
  feeApplies: boolean;
  referenceLabel: string;
}): StoredTradeOffer {
  return {
    item_id: itemId,
    item_name: itemName,
    item_source: itemSource,
    source,
    listing_price: Math.round(listing.price),
    reference_price: Math.round(reference),
    quantity: Math.max(1, Math.floor(listing.quantity)),
    fee_applies: feeApplies,
    seller_id: listing.playerId,
    seller_name: listing.playerName,
    reference_label: referenceLabel,
    raw_json: JSON.stringify(listing.raw ?? null),
  };
}

function opportunityFromStoredOffer(offer: TradeItemOfferRow, search: TradeSearchPayload): TradeOpportunity {
  const listingPrice = Math.round(Number(offer.listing_price));
  const referencePrice = Math.round(Number(offer.reference_price));
  const resale = resalePrice(referencePrice);
  const feeRate = offer.fee_applies ? search.market_fee_percent / 100 : 0;
  const profit = Math.round(resale * Math.max(0, 1 - feeRate) - listingPrice);
  const quantity = Math.max(1, Math.floor(Number(offer.quantity)));
  const bulkProfit = Math.round(profit * quantity);
  const neededQuantity = profit > 0 ? Math.ceil(search.min_profit / profit) : null;

  return {
    id: offer.id,
    snapshot_id: offer.item_snapshot_id,
    watchlist_id: null,
    item_id: Number(offer.item_id),
    item_name: offer.item_name,
    item_source: normalizeItemSource(offer.item_source) ?? search.item_source,
    source: offer.source,
    listing_price: listingPrice,
    resale_price: resale,
    profit,
    roi_percent: listingPrice > 0 ? (profit / listingPrice) * 100 : 0,
    quantity,
    bulk_profit: bulkProfit,
    needed_quantity: neededQuantity,
    seller_id: offer.seller_id === null ? null : Number(offer.seller_id),
    seller_name: offer.seller_name,
    reference_label: resaleLabel(offer.reference_label ?? "Reference price", referencePrice, resale),
    raw_json: offer.raw_json,
    created_at: Number(offer.created_at),
  };
}

function buildWeav3rRows(
  watchlist: TradeWatchlist,
  itemId: number,
  data: any,
  verifiedReference: number | null,
): TradeOpportunity[] {
  const listings: any[] = Array.isArray(data?.listings) ? data.listings : [];
  const weav3rMarketPrice = finitePositiveNumber(data?.market_price);
  const bazaarAverage = finitePositiveNumber(data?.bazaar_average);
  const reference = verifiedReference && verifiedReference > 0 ? verifiedReference : weav3rMarketPrice;
  if (!reference) {
    return [];
  }

  const adjustedReference = resalePrice(reference);
  const referenceLabel = verifiedReference && verifiedReference > 0
    ? `Verified Torn 5-item Market price${bazaarAverage ? `; Bazaar avg ${bazaarAverage}` : ""}`
    : "Weav3r market price";

  return listings
    .map((listing: any): NormalizedOffer => ({
      price: Number(listing?.price ?? 0),
      quantity: positiveInteger(listing?.quantity, 1),
      playerId: positiveIntegerOrNull(listing?.player_id),
      playerName: cleanString(listing?.player_name),
      raw: listing,
    }))
    .filter((listing) => listing.price > 0)
    .sort((a, b) => a.price - b.price)
    .slice(0, 10)
    .map((listing) =>
      opportunityFromListing({
        watchlist,
        itemId,
        itemName: cleanString(data?.item_name),
        source: "Weav3r Bazaar",
        listing,
        reference: adjustedReference,
        sellFeeRate: watchlist.market_fee_percent / 100,
        referenceLabel: resaleLabel(referenceLabel, reference, adjustedReference),
      }),
    );
}

function buildTornRows(watchlist: TradeWatchlist, itemId: number, data: any): TradeOpportunity[] {
  const marketOffers = normalizeOffers(data, "itemmarket");
  const bazaarOffers = normalizeOffers(data, "bazaar");
  const lowestMarket = priceAtCumulativeQuantity(marketOffers, 5);
  const lowestBazaar = bazaarOffers[0]?.price ?? null;
  const rows: TradeOpportunity[] = [];

  if (bazaarOffers[0] && lowestMarket) {
    const adjustedReference = resalePrice(lowestMarket);
    rows.push(opportunityFromListing({
      watchlist,
      itemId,
      itemName: null,
      source: "Torn Bazaar",
      listing: bazaarOffers[0],
      reference: adjustedReference,
      sellFeeRate: watchlist.market_fee_percent / 100,
      referenceLabel: resaleLabel("Torn 5-item Market price less fee", lowestMarket, adjustedReference),
    }));
  }

  if (marketOffers[0] && lowestBazaar) {
    const adjustedReference = resalePrice(lowestBazaar);
    rows.push(opportunityFromListing({
      watchlist,
      itemId,
      itemName: null,
      source: "Torn Item Market",
      listing: marketOffers[0],
      reference: adjustedReference,
      sellFeeRate: 0,
      referenceLabel: resaleLabel("Lowest Torn Bazaar price, no fee", lowestBazaar, adjustedReference),
    }));
  }

  return rows;
}

function opportunityFromListing({
  watchlist,
  itemId,
  itemName,
  source,
  listing,
  reference,
  sellFeeRate,
  referenceLabel,
}: {
  watchlist: TradeWatchlist;
  itemId: number;
  itemName: string | null;
  source: string;
  listing: NormalizedOffer;
  reference: number;
  sellFeeRate: number;
  referenceLabel: string;
}): TradeOpportunity {
  const listingPrice = Math.round(listing.price);
  const resale = Math.round(reference);
  const profit = Math.round(resale * Math.max(0, 1 - sellFeeRate) - listingPrice);
  const quantity = Math.max(1, Math.floor(listing.quantity));
  const bulkProfit = Math.round(profit * quantity);
  const neededQuantity = profit > 0 ? Math.ceil(watchlist.min_profit / profit) : null;

  return {
    item_id: itemId,
    item_name: itemName,
    source,
    listing_price: listingPrice,
    resale_price: resale,
    profit,
    roi_percent: listingPrice > 0 ? (profit / listingPrice) * 100 : 0,
    quantity,
    bulk_profit: bulkProfit,
    needed_quantity: neededQuantity,
    seller_id: listing.playerId,
    seller_name: listing.playerName,
    reference_label: referenceLabel,
    raw_json: JSON.stringify(listing.raw ?? null),
  };
}

function normalizeOffers(data: any, key: "itemmarket" | "bazaar"): NormalizedOffer[] {
  const container = data?.[key];
  const raw = container?.listings ?? container ?? (key === "itemmarket" ? data?.listings : null);
  const offers = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? Object.values(raw) : [];
  return offers
    .map((offer: any): NormalizedOffer => ({
      price: Number(offer?.cost ?? offer?.price ?? offer?.market_price ?? 0),
      quantity: positiveInteger(offer?.quantity ?? offer?.qty ?? offer?.amount, 1),
      playerId: positiveIntegerOrNull(offer?.player_id ?? offer?.playerId ?? offer?.user_id ?? offer?.userId ?? offer?.seller_id),
      playerName: cleanString(offer?.player_name ?? offer?.playerName ?? offer?.seller_name ?? offer?.sellerName),
      raw: offer,
    }))
    .filter((offer) => offer.price > 0)
    .sort((a, b) => a.price - b.price);
}

function itemMarketReference(data: any): number | null {
  return priceAtCumulativeQuantity(normalizeOffers(data, "itemmarket"), 5);
}

function priceAtCumulativeQuantity(offers: NormalizedOffer[], targetQuantity: number): number | null {
  let seen = 0;
  let lastPrice: number | null = null;

  for (const offer of offers) {
    lastPrice = offer.price;
    seen += Math.max(1, offer.quantity);
    if (seen >= targetQuantity) {
      return offer.price;
    }
  }

  return lastPrice;
}

function resalePrice(value: number): number {
  if (!Number.isFinite(value) || value <= 1_000_000) {
    return value;
  }
  return Math.floor(value / 10_000) * 10_000;
}

function resaleLabel(label: string, rawValue: number, adjustedValue: number): string {
  return Number.isFinite(rawValue) && rawValue !== adjustedValue
    ? `${label}; rounded from ${Math.round(rawValue)}`
    : label;
}

async function fetchTornJson(env: Env, endpoint: string, tornKey: string, params: Record<string, string> = {}): Promise<any> {
  const url = new URL(`${TORN_API_BASE}${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await trackedTornFetch(env, url, {
    headers: {
      Accept: "application/json",
      Authorization: `ApiKey ${tornKey}`,
      "User-Agent": "buttgrass-trade-scout/1.0",
    },
  }, {
    feature: "trade-scout",
    keySource: "member_supplied:trade_scout",
    timeoutMs: REQUEST_TIMEOUT_MS,
  });

  const data = await readUpstreamJson(response);
  if (!response.ok) {
    throw new Error(`Torn request failed with HTTP ${response.status}`);
  }
  if (data?.error) {
    throw new Error(`Torn API error: ${data.error.error ?? data.error.message ?? data.error}`);
  }
  return data;
}

async function fetchWeav3rJson(endpoint: string): Promise<any> {
  if (!endpoint.startsWith("/") || endpoint.includes("..") || endpoint.includes("//")) {
    throw new Error("Invalid Weav3r endpoint");
  }

  const response = await fetchWithTimeout(`${WEAV3R_API_BASE}${endpoint}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "buttgrass-trade-scout/1.0",
    },
  }, REQUEST_TIMEOUT_MS);

  const data = await readUpstreamJson(response);
  if (!response.ok) {
    throw new Error(`Weav3r request failed with HTTP ${response.status}`);
  }
  if (data?.error) {
    throw new Error(`Weav3r API error: ${data.message ?? data.error}`);
  }
  return data;
}

async function readUpstreamJson(response: Response): Promise<any> {
  try {
    return await response.json();
  } catch {
    return { raw: await response.text().catch(() => "") };
  }
}

async function readWatchlistPayload(request: Request): Promise<
  | {
    payload: Omit<
      TradeWatchlist,
      "id" | "created_by_torn_user_id" | "created_by_name" | "created_at" | "updated_at" | "latest_snapshot"
    >;
  }
  | { response: Response }
> {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  return validateTradeSearchPayload(body, { requireName: true }) as
    | {
      payload: Omit<
        TradeWatchlist,
        "id" | "created_by_torn_user_id" | "created_by_name" | "created_at" | "updated_at" | "latest_snapshot"
      >;
    }
    | { response: Response };
}

async function readSearchPayload(
  request: Request,
  options: { requireName: boolean },
): Promise<{ payload: TradeSearchPayload } | { response: Response }> {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  return validateTradeSearchPayload(body, options);
}

function validateTradeSearchPayload(
  body: Record<string, unknown>,
  options: { requireName: boolean },
): { payload: TradeSearchPayload } | { response: Response } {
  const name = cleanString(body.name);
  if (options.requireName && (!name || name.length > 80)) {
    return { response: json({ ok: false, error: "Search template name is required", code: "INVALID_NAME" }, 400) };
  }
  if (name && name.length > 80) {
    return { response: json({ ok: false, error: "Search template name must be 80 characters or fewer", code: "INVALID_NAME" }, 400) };
  }

  const itemIds = parseItemIds(body.item_ids ?? body.itemIds);
  if (itemIds.length === 0) {
    return { response: json({ ok: false, error: "At least one item ID is required", code: "INVALID_ITEM_IDS" }, 400) };
  }
  if (itemIds.length > MAX_WATCHLIST_ITEMS) {
    return {
      response: json({
        ok: false,
        error: `Watchlists can include up to ${MAX_WATCHLIST_ITEMS} item IDs`,
        code: "TOO_MANY_ITEM_IDS",
      }, 400),
    };
  }

  const itemSource = normalizeItemSource(body.item_source ?? body.itemSource);
  if (!itemSource) {
    return { response: json({ ok: false, error: "Invalid item source", code: "INVALID_ITEM_SOURCE" }, 400) };
  }

  return {
    payload: {
      ...(name ? { name } : {}),
      item_ids: itemIds,
      item_source: itemSource,
      min_profit: boundedInteger(body.min_profit ?? body.minProfit, 0, 1_000_000_000, 25_000),
      min_roi_percent: boundedNumber(body.min_roi_percent ?? body.minRoiPercent, 0, 10_000, 0),
      min_quantity: boundedInteger(body.min_quantity ?? body.minQuantity, 1, 1_000_000, 1),
      market_fee_percent: boundedNumber(body.market_fee_percent ?? body.marketFeePercent, 0, 100, 5),
    },
  };
}

async function readTradeWatchlist(env: Env, id: number): Promise<TradeWatchlist | null> {
  if (!validId(id)) {
    return null;
  }

  const row = await env.DB.prepare(`SELECT * FROM trade_watchlists WHERE id = ? LIMIT 1`)
    .bind(id)
    .first<TradeWatchlistRow>();
  if (!row) {
    return null;
  }

  const snapshot = await latestSnapshotForWatchlist(env, id);
  return mapTradeWatchlistRow({
    ...row,
    latest_snapshot_id: snapshot?.id ?? null,
    latest_scanned_at: snapshot?.scanned_at ?? null,
    latest_scanned_by_torn_user_id: snapshot?.scanned_by_torn_user_id ?? null,
    latest_status: snapshot?.status ?? null,
    latest_error: snapshot?.error ?? null,
    latest_opportunity_count: snapshot?.opportunity_count ?? null,
  });
}

async function readHomeMemberName(env: Env, tornUserId: number): Promise<string | null> {
  const row = await env.DB.prepare(
    `
    SELECT name
    FROM home_faction_members
    WHERE member_id = ?
    LIMIT 1
    `,
  )
    .bind(tornUserId)
    .first<{ name: string | null }>();

  return row?.name ?? null;
}

async function latestSnapshotForWatchlist(env: Env, watchlistId: number): Promise<TradeSnapshotSummary | null> {
  const row = await env.DB.prepare(
    `
    SELECT
      s.id,
      s.scanned_at,
      s.scanned_by_torn_user_id,
      s.status,
      s.error,
      (
        SELECT COUNT(*)
        FROM trade_opportunities o
        WHERE o.snapshot_id = s.id
      ) AS opportunity_count
    FROM trade_watchlist_snapshots s
    WHERE s.watchlist_id = ?
    ORDER BY s.scanned_at DESC
    LIMIT 1
    `,
  )
    .bind(watchlistId)
    .first<TradeSnapshotSummary>();

  return row ?? null;
}

async function readOpportunitiesForSnapshot(env: Env, snapshotId: string): Promise<TradeOpportunityRow[]> {
  const rows = await env.DB.prepare(
    `
    SELECT *
    FROM trade_opportunities
    WHERE snapshot_id = ?
    ORDER BY profit DESC, bulk_profit DESC, listing_price ASC
    LIMIT ?
    `,
  )
    .bind(snapshotId, MAX_SAVED_OPPORTUNITIES)
    .all<TradeOpportunityRow>();
  return rows.results ?? [];
}

async function saveScanSnapshot(
  env: Env,
  input: {
    snapshotId: string;
    watchlist: TradeWatchlist;
    scannedByTornUserId: number | null;
    scannedAt: number;
    status: "ok" | "error";
    error: string | null;
    opportunities: TradeOpportunity[];
  },
): Promise<void> {
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `
      INSERT INTO trade_watchlist_snapshots (
        id,
        watchlist_id,
        scanned_by_torn_user_id,
        scanned_at,
        status,
        error,
        settings_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
    ).bind(
      input.snapshotId,
      input.watchlist.id,
      input.scannedByTornUserId,
      input.scannedAt,
      input.status,
      input.error,
      JSON.stringify({
        item_ids: input.watchlist.item_ids,
        item_source: input.watchlist.item_source,
        min_profit: input.watchlist.min_profit,
        min_roi_percent: input.watchlist.min_roi_percent,
        min_quantity: input.watchlist.min_quantity,
        market_fee_percent: input.watchlist.market_fee_percent,
      }),
    ),
  ];

  input.opportunities.forEach((opportunity, index) => {
    statements.push(
      env.DB.prepare(
        `
        INSERT INTO trade_opportunities (
          id,
          snapshot_id,
          watchlist_id,
          item_id,
          item_name,
          source,
          listing_price,
          resale_price,
          profit,
          roi_percent,
          quantity,
          bulk_profit,
          needed_quantity,
          seller_id,
          seller_name,
          reference_label,
          raw_json,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      ).bind(
        `${input.snapshotId}:${index}`,
        input.snapshotId,
        input.watchlist.id,
        opportunity.item_id,
        opportunity.item_name,
        opportunity.source,
        opportunity.listing_price,
        opportunity.resale_price,
        opportunity.profit,
        opportunity.roi_percent,
        opportunity.quantity,
        opportunity.bulk_profit,
        opportunity.needed_quantity,
        opportunity.seller_id,
        opportunity.seller_name,
        opportunity.reference_label,
        opportunity.raw_json,
        input.scannedAt,
      ),
    );
  });

  for (let index = 0; index < statements.length; index += 50) {
    await env.DB.batch(statements.slice(index, index + 50));
  }
}

async function saveItemSnapshot(
  env: Env,
  input: {
    snapshotId: string;
    itemId: number;
    itemSource: TradeItemSource;
    itemName: string | null;
    scannedByTornUserId: number | null;
    scannedAt: number;
    status: "ok" | "error";
    error: string | null;
    rawJson: string | null;
    offers: StoredTradeOffer[];
  },
): Promise<void> {
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `
      INSERT INTO trade_item_snapshots (
        id,
        item_id,
        item_source,
        item_name,
        scanned_by_torn_user_id,
        scanned_at,
        status,
        error,
        raw_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).bind(
      input.snapshotId,
      input.itemId,
      input.itemSource,
      input.itemName,
      input.scannedByTornUserId,
      input.scannedAt,
      input.status,
      input.error,
      input.rawJson,
    ),
  ];

  input.offers.forEach((offer, index) => {
    statements.push(
      env.DB.prepare(
        `
        INSERT INTO trade_item_offers (
          id,
          item_snapshot_id,
          item_id,
          item_name,
          item_source,
          source,
          listing_price,
          reference_price,
          quantity,
          fee_applies,
          seller_id,
          seller_name,
          reference_label,
          raw_json,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      ).bind(
        `${input.snapshotId}:${index}`,
        input.snapshotId,
        offer.item_id,
        offer.item_name,
        offer.item_source,
        offer.source,
        offer.listing_price,
        offer.reference_price,
        offer.quantity,
        offer.fee_applies ? 1 : 0,
        offer.seller_id,
        offer.seller_name,
        offer.reference_label,
        offer.raw_json,
        input.scannedAt,
      ),
    );
  });

  for (let index = 0; index < statements.length; index += 50) {
    await env.DB.batch(statements.slice(index, index + 50));
  }
}

function mapTradeItemSnapshotRow(row: TradeItemSnapshotRow): TradeItemSnapshotSummary {
  return {
    id: row.id,
    item_id: Number(row.item_id),
    item_name: row.item_name,
    item_source: normalizeItemSource(row.item_source) ?? "weav3r_verified",
    scanned_at: Number(row.scanned_at),
    scanned_by_torn_user_id: row.scanned_by_torn_user_id === null ? null : Number(row.scanned_by_torn_user_id),
    status: row.status,
    error: row.error,
    offer_count: Number(row.offer_count ?? 0),
  };
}

function mapTradeWatchlistRow(row: TradeWatchlistListRow): TradeWatchlist {
  return {
    id: Number(row.id),
    name: row.name,
    item_ids: parseStoredItemIds(row.item_ids_json),
    item_source: normalizeItemSource(row.item_source) ?? "weav3r_verified",
    min_profit: Number(row.min_profit),
    min_roi_percent: Number(row.min_roi_percent),
    min_quantity: Number(row.min_quantity),
    market_fee_percent: Number(row.market_fee_percent),
    created_by_torn_user_id: row.created_by_torn_user_id === null || row.created_by_torn_user_id === undefined
      ? null
      : Number(row.created_by_torn_user_id),
    created_by_name: row.created_by_name ?? null,
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at),
    latest_snapshot: row.latest_snapshot_id
      ? {
        id: row.latest_snapshot_id,
        scanned_at: Number(row.latest_scanned_at ?? 0),
        scanned_by_torn_user_id: row.latest_scanned_by_torn_user_id === null
          ? null
          : Number(row.latest_scanned_by_torn_user_id),
        status: row.latest_status ?? "ok",
        error: row.latest_error ?? null,
        opportunity_count: Number(row.latest_opportunity_count ?? 0),
      }
      : null,
  };
}

function parseItemIds(value: unknown): number[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\s,]+/)
      : [];
  return Array.from(new Set(
    raw
      .map((item) => Number(item))
      .filter((item) => Number.isInteger(item) && item > 0),
  ));
}

function parseStoredItemIds(value: string): number[] {
  try {
    return parseItemIds(JSON.parse(value));
  } catch {
    return [];
  }
}

function normalizeItemSource(value: unknown): TradeItemSource | null {
  if (value === "weav3r") {
    return "weav3r_verified";
  }
  if (value === "weav3r_verified" || value === "torn") {
    return value;
  }
  return null;
}

function boundedInteger(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function boundedNumber(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Math.floor(Number(value));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function positiveIntegerOrNull(value: unknown): number | null {
  const parsed = Math.floor(Number(value));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function finitePositiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function validId(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}
