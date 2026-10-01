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
  // Undefined means not loaded; null means Torn reported no bank investment.
  city_bank?: CityBankInvestment | null;
};

export type CityBankInvestment = {
  amount: number;
  profit: number;
  duration: number;
  interest_rate: number;
  until: number;
  invested_at: number;
};

const BANK_MERIT_MIN = 0;
const BANK_MERIT_MAX = 10;
const BANK_INTEREST_MERIT_ID = 7;
const BANK_MERIT_FIELDS = ["level", "levels", "merits", "upgrades", "value", "current", "amount", "count"];

export function parseOwnedStocksResponse(data: unknown, refreshedAt: number): OwnedStockSnapshot {
  if (!isRecord(data)) {
    throw new Error("Torn owned stocks response was not valid.");
  }

  throwTornApiError(data);

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

  const cityBank = data.city_bank === null ? null : parseCityBankInvestment(data.city_bank) ?? undefined;
  return {
    refreshed_at: refreshedAt,
    stocks: data.stocks
      .map(parseOwnedStockPosition)
      .filter((stock): stock is OwnedStockPosition => Boolean(stock)),
    ...(cityBank !== undefined ? { city_bank: cityBank } : {}),
  };
}

/** Discard every other balance returned by the money endpoint. */
export function parseCityBankResponse(data: unknown): CityBankInvestment | null {
  if (!isRecord(data)) throw new Error("Torn bank response was not valid.");
  throwTornApiError(data);
  if (!isRecord(data.money)) throw new Error("Torn response did not include bank details.");
  if (data.money.city_bank === null) return null;
  const investment = parseCityBankInvestment(data.money.city_bank);
  if (!investment) throw new Error("Torn bank investment details were incomplete.");
  return investment;
}

function parseCityBankInvestment(value: unknown): CityBankInvestment | null {
  if (!isRecord(value)) return null;
  const integerFields = ["amount", "profit", "duration", "until", "invested_at"] as const;
  if (integerFields.some((field) => typeof value[field] !== "number" || !Number.isSafeInteger(value[field]) || value[field] < 0)) return null;
  if (Number(value.duration) <= 0 || typeof value.interest_rate !== "number" || !Number.isFinite(value.interest_rate) || value.interest_rate < 0) return null;
  return {
    amount: Number(value.amount), profit: Number(value.profit), duration: Number(value.duration),
    interest_rate: value.interest_rate, until: Number(value.until), invested_at: Number(value.invested_at),
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

export type OwnedStockBenefitProgress =
  | { state: "unavailable" }
  | { state: "next_cycle" }
  | { state: "ready" }
  | { state: "progress"; days: number; frequency: number };

/** Report the imported snapshot, without projecting collections since its refresh. */
export function ownedStockBenefitProgress(input: {
  position: OwnedStockPosition | undefined;
  requiredShares: number;
  increment: number;
  passive: boolean;
}): OwnedStockBenefitProgress {
  const { position, requiredShares, increment, passive } = input;
  const bonus = position?.bonus;
  if (!position || position.shares < requiredShares || !bonus) {
    return { state: "unavailable" };
  }
  if (!passive) {
    if (bonus.increment === null) return { state: "unavailable" };
    // Additional owned blocks can be waiting for the current dividend cycle to finish.
    if (increment > bonus.increment) return { state: "next_cycle" };
  }
  if (bonus.available === true) return { state: "ready" };
  if (bonus.progress === null || bonus.frequency === null || bonus.progress > bonus.frequency) {
    return { state: "unavailable" };
  }
  return { state: "progress", days: bonus.progress, frequency: bonus.frequency };
}

export function parseBankMeritsResponse(data: unknown): number | null {
  if (!isRecord(data)) {
    throw new Error("Torn merits response was not valid.");
  }

  throwTornApiError(data);

  const parsed = findBankMeritCount(data.merits ?? data);
  return parsed === null ? null : clampBankMerits(parsed);
}

function throwTornApiError(data: Record<string, unknown>): void {
  const error = isRecord(data.error) ? data.error : null;
  if (!error) {
    return;
  }

  const message = typeof error.error === "string"
    ? error.error
    : typeof error.message === "string"
      ? error.message
      : "Torn returned an error.";
  throw new Error(message);
}

function findBankMeritCount(value: unknown): number | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const parsed = parseBankMeritRecord(item);
      if (parsed !== null) {
        return parsed;
      }
      const nested = findBankMeritCount(item);
      if (nested !== null) {
        return nested;
      }
    }
    return null;
  }

  if (!isRecord(value)) {
    return null;
  }

  const direct = parseBankMeritRecord(value);
  if (direct !== null) {
    return direct;
  }

  for (const [key, nested] of Object.entries(value)) {
    if (isBankInterestLabel(key)) {
      const parsed = meritCountFromValue(nested);
      if (parsed !== null) {
        return parsed;
      }
    }
    const parsed = findBankMeritCount(nested);
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

function parseBankMeritRecord(value: unknown): number | null {
  if (!isRecord(value)) {
    return null;
  }

  if (Number(value.id) === BANK_INTEREST_MERIT_ID) {
    return meritCountFromRecord(value);
  }

  const label = [
    value.name,
    value.title,
    value.key,
    value.slug,
    value.type,
    value.id,
  ].filter((part) => typeof part === "string").join(" ");
  if (!isBankInterestLabel(label)) {
    return null;
  }

  return meritCountFromRecord(value);
}

function meritCountFromValue(value: unknown): number | null {
  if (typeof value === "number" || typeof value === "string") {
    return nonNegativeInteger(value);
  }

  return meritCountFromRecord(value);
}

function meritCountFromRecord(value: unknown): number | null {
  if (!isRecord(value)) {
    return null;
  }

  for (const field of BANK_MERIT_FIELDS) {
    const parsed = nonNegativeInteger(value[field]);
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

function isBankInterestLabel(value: string): boolean {
  const normalized = value.toLowerCase().replace(/[_-]+/g, " ");
  return normalized.includes("bank") && normalized.includes("interest");
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
    progress: value.progress === null || value.progress === undefined ? null : nonNegativeInteger(value.progress),
    frequency: nullablePositiveInteger(value.frequency),
  };
}

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function nonNegativeInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function clampBankMerits(value: number): number {
  return Math.min(BANK_MERIT_MAX, Math.max(BANK_MERIT_MIN, value));
}

function nullablePositiveInteger(value: unknown): number | null {
  return value === null || value === undefined ? null : positiveInteger(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
