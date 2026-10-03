// Public, CORS-enabled endpoint. Never send a Torn key or application credentials.
const MARKETPLACE_URL = "https://weav3r.dev/api/marketplace";
const CACHE_MS = 5 * 60 * 1000;
const MAX_SNAPSHOT_AGE_SECONDS = 24 * 60 * 60;
const CAN_ITEMS = [
  { energy: 5, ids: [985] },
  { energy: 10, ids: [986] },
  { energy: 15, ids: [987] },
  { energy: 20, ids: [530, 553] },
  { energy: 25, ids: [532, 554] },
  { energy: 30, ids: [533, 555] },
] as const;

export type HalloweenItemPrice = { itemId: number; itemName: string; price: number; generatedAt: number };
export type HalloweenPriceSnapshot = {
  fhc: HalloweenItemPrice;
  cans: (HalloweenItemPrice & { energy: number })[];
  generatedAt: number;
  fetchedAt: number;
};
let cached: HalloweenPriceSnapshot | null = null;

function parseQuote(value: unknown, itemId: number): HalloweenItemPrice {
  const data = value as Record<string, unknown> | null;
  const now = Date.now() / 1000;
  if (!data || data.item_id !== itemId || typeof data.item_name !== "string" || !data.item_name.trim()
    || typeof data.market_price !== "number" || !Number.isFinite(data.market_price)
    || data.market_price <= 0 || data.market_price > 1e9
    || typeof data.generated_at !== "number" || !Number.isFinite(data.generated_at)
    || data.generated_at < now - MAX_SNAPSHOT_AGE_SECONDS || data.generated_at > now + 300) {
    throw new Error("Weav3r returned missing, invalid or outdated prices. Please try again later.");
  }
  return { itemId, itemName: data.item_name, price: data.market_price, generatedAt: data.generated_at };
}

export async function getHalloweenPrices(signal: AbortSignal): Promise<HalloweenPriceSnapshot> {
  signal.throwIfAborted();
  if (cached && Date.now() - cached.fetchedAt < CACHE_MS
    && cached.generatedAt >= Date.now() / 1000 - MAX_SNAPSHOT_AGE_SECONDS) return cached;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal.addEventListener("abort", cancel, { once: true });
  const timeout = setTimeout(cancel, 20000);
  const ids = [367, ...CAN_ITEMS.flatMap(tier => [...tier.ids])];
  const quotes = new Map<number, HalloweenItemPrice>();
  let cursor = 0;
  const worker = async () => {
    while (cursor < ids.length) {
      controller.signal.throwIfAborted();
      const id = ids[cursor++];
      const response = await fetch(`${MARKETPLACE_URL}/${id}`, {
        headers: { Accept: "application/json" }, credentials: "omit", signal: controller.signal,
      });
      if (!response.ok) throw new Error(response.status === 429
        ? "Weav3r is limiting requests. Please try again in a few minutes."
        : "Weav3r prices are currently unavailable. Please try again later.");
      quotes.set(id, parseQuote(await response.json(), id));
    }
  };
  try {
    // Three workers bound concurrent requests; update the inputs only after every item succeeds.
    await Promise.all([worker(), worker(), worker()]);
    signal.throwIfAborted();
    const cans = CAN_ITEMS.map(tier => ({
      ...tier.ids.map(id => quotes.get(id)!).sort((a, b) => a.price - b.price)[0], energy: tier.energy,
    }));
    const snapshot = { fhc: quotes.get(367)!, cans,
      generatedAt: Math.min(...[...quotes.values()].map(quote => quote.generatedAt)), fetchedAt: Date.now() };
    cached = snapshot;
    return snapshot;
  } catch (error) {
    controller.abort();
    if (signal.aborted) throw error;
    if (error instanceof Error && error.message.startsWith("Weav3r")) throw error;
    throw new Error("Unable to load Weav3r prices. Please try again later.");
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", cancel);
  }
}
