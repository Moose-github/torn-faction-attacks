import {
  parseBankMeritsResponse, parseCityBankResponse, parseOwnedStocksResponse,
  type CityBankInvestment, type OwnedStockSnapshot,
} from "./ownedStocks";

export const OWNED_STOCK_REQUEST_TIMEOUT_MS = 15_000;
type ImportResult<T> = { status: "loading" } | { status: "success"; value: T } | { status: "error"; error: string };
export type OwnedStockImportProgress = {
  stocks: ImportResult<OwnedStockSnapshot>;
  bank: ImportResult<CityBankInvestment | null>;
  merits: ImportResult<number>;
};

/** Each selection reports independently; optional requests never delay the holdings. */
export async function importOwnedStockPortfolio(
  apiKey: string,
  signal: AbortSignal,
  onUpdate: (progress: OwnedStockImportProgress) => void,
): Promise<void> {
  if (signal.aborted) return;
  let progress: OwnedStockImportProgress = { stocks: { status: "loading" }, bank: { status: "loading" }, merits: { status: "loading" } };
  onUpdate(progress);
  async function load<K extends keyof OwnedStockImportProgress>(
    selection: K,
    run: () => Promise<Extract<OwnedStockImportProgress[K], { status: "success" }>["value"]>,
  ): Promise<void> {
    let result;
    try {
      result = { status: "success" as const, value: await run() };
    } catch (error) {
      result = { status: "error" as const, error: error instanceof Error ? error.message : "Could not load this information from Torn. Try refreshing." };
    }
    if (signal.aborted) return;
    progress = { ...progress, [selection]: result };
    onUpdate(progress);
  }
  await Promise.all([
    load("stocks", async () => parseOwnedStocksResponse(await fetchSelection("stocks", apiKey, signal), Math.floor(Date.now() / 1000))),
    load("bank", async () => parseCityBankResponse(await fetchSelection("money", apiKey, signal))),
    load("merits", async () => {
      const merits = parseBankMeritsResponse(await fetchSelection("merits", apiKey, signal));
      if (merits === null) throw new Error("Bank interest merits were not included in Torn's response. Enter them manually or refresh to try again.");
      return merits;
    }),
  ]);
}

async function fetchSelection(selection: "stocks" | "money" | "merits", apiKey: string, signal: AbortSignal): Promise<unknown> {
  const label = selection === "stocks" ? "stock holdings" : selection === "money" ? "City Bank details" : "bank merits";
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) controller.abort();
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, OWNED_STOCK_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`https://api.torn.com/v2/user/${selection}?key=${encodeURIComponent(apiKey)}`, {
      headers: { Accept: "application/json" }, signal: controller.signal,
    });
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new Error(`Torn returned an unreadable response for ${label}. Try refreshing.`);
    }
    const apiError = data && typeof data === "object" && "error" in data ? data.error : null;
    if (apiError && typeof apiError === "object") {
      const code = "code" in apiError ? Number(apiError.code) : null;
      if (code === 16) {
        throw new Error(`Your key cannot access ${label}. Use a Limited or Full access Torn key, or a custom key with user → ${selection} permission. Public keys are sufficient for sign-in only.`);
      }
      // The selection parser preserves Torn's other errors, including invalid keys and rate limits.
      return data;
    }
    if (!response.ok) throw new Error(`Torn could not load ${label} (HTTP ${response.status}). Try refreshing.`);
    return data;
  } catch (error) {
    if (signal.aborted) throw new DOMException("Portfolio refresh cancelled", "AbortError");
    if (timedOut) throw new Error(`Loading ${label} from Torn timed out after 15 seconds. Try refreshing.`);
    if (error instanceof TypeError) throw new Error(`Could not connect directly to Torn to load ${label}. Check your connection and browser extensions, then try refreshing.`);
    throw error;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}
