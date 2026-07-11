export type OwnedStockPosition = {
  stock_id: number;
  shares: number;
  bonus: {
    available: boolean | null;
    increment: number | null;
    progress: number | null;
    frequency: number | null;
  } | null;
};

export type OwnedStockSnapshot = {
  refreshed_at: number;
  stocks: OwnedStockPosition[];
};

export function parseOwnedStocksResponse(data: unknown, refreshedAt: number): OwnedStockSnapshot {
  if (!isRecord(data)) {
    throw new Error("Torn owned stocks response was not valid.");
  }

  const error = isRecord(data.error) ? data.error : null;
  if (error) {
    const message = typeof error.error === "string"
      ? error.error
      : typeof error.message === "string"
        ? error.message
        : "Torn returned an error while fetching owned stocks.";
    throw new Error(message);
  }

  if (!Array.isArray(data.stocks)) {
    throw new Error("Torn owned stocks response did not include stocks.");
  }

  return {
    refreshed_at: refreshedAt,
    stocks: data.stocks
      .map(parseOwnedStockPosition)
      .filter((stock): stock is OwnedStockPosition => Boolean(stock)),
  };
}

export function parseStoredOwnedStockSnapshot(data: unknown): OwnedStockSnapshot | null {
  if (!isRecord(data)) {
    return null;
  }

  const refreshedAt = positiveInteger(data.refreshed_at);
  if (refreshedAt === null || !Array.isArray(data.stocks)) {
    return null;
  }

  return {
    refreshed_at: refreshedAt,
    stocks: data.stocks
      .map(parseOwnedStockPosition)
      .filter((stock): stock is OwnedStockPosition => Boolean(stock)),
  };
}

export function ownedSharesMap(snapshot: OwnedStockSnapshot | null): Map<number, number> {
  const shares = new Map<number, number>();
  for (const stock of snapshot?.stocks ?? []) {
    if (stock.shares > 0) {
      shares.set(stock.stock_id, stock.shares);
    }
  }
  return shares;
}

export function ownsStockIncrement(ownedShares: number, totalSharesRequired: number): boolean {
  return ownedShares > 0 && ownedShares >= totalSharesRequired;
}

function parseOwnedStockPosition(value: unknown): OwnedStockPosition | null {
  if (!isRecord(value)) {
    return null;
  }

  const stockId = positiveInteger(value.id) ?? positiveInteger(value.stock_id);
  const shares = positiveInteger(value.shares);
  if (stockId === null || shares === null) {
    return null;
  }

  return {
    stock_id: stockId,
    shares,
    bonus: parseOwnedStockBonus(value.bonus),
  };
}

function parseOwnedStockBonus(value: unknown): OwnedStockPosition["bonus"] {
  if (!isRecord(value)) {
    return null;
  }

  return {
    available: typeof value.available === "boolean" ? value.available : null,
    increment: nullablePositiveInteger(value.increment),
    progress: nullablePositiveInteger(value.progress),
    frequency: nullablePositiveInteger(value.frequency),
  };
}

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function nullablePositiveInteger(value: unknown): number | null {
  return value === null || value === undefined ? null : positiveInteger(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
