import { parseMeritImport, type MeritSnapshot } from "../utils/meritsSimulator";

export const MERIT_IMPORT_TIMEOUT_MS = 15000;

/** One-shot, browser-to-Torn import. The key is never persisted or sent to our backend. */
export async function importMerits(apiKey: string, signal: AbortSignal): Promise<MeritSnapshot> {
  if (signal.aborted) throw new DOMException("Import cancelled", "AbortError");
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, MERIT_IMPORT_TIMEOUT_MS);
  async function fetchMerits(path: "user/merits" | "torn/merits"): Promise<unknown> {
    const response = await fetch(`https://api.torn.com/v2/${path}`, {
      headers: { Accept: "application/json", Authorization: `ApiKey ${apiKey}` },
      credentials: "omit", cache: "no-store", signal: controller.signal,
    });
    let data: unknown;
    try { data = await response.json(); } catch { throw new Error("Torn returned an unreadable response. Please try again."); }
    if (data && typeof data === "object" && "error" in data) {
      const error = data.error;
      const code = error && typeof error === "object" && "code" in error ? Number(error.code) : 0;
      if (code === 2) throw new Error("This API key is not valid. Check the key and try again.");
      if (code === 16) throw new Error("Use a Minimal, Limited or Full key, or a custom key with user → merits and torn → merits access.");
      if (code === 5 || code === 8 || code === 9) throw new Error("Torn is rate-limiting requests. Wait a little before trying again.");
      throw new Error(`Torn could not fetch merits${Number.isSafeInteger(code) && code > 0 ? ` (error ${code})` : ""}. Please try again.`);
    }
    if (!response.ok) throw new Error(`Torn could not fetch merits (HTTP ${response.status}). Please try again.`);
    return data;
  }
  try {
    const [user, catalog] = await Promise.all([fetchMerits("user/merits"), fetchMerits("torn/merits")]);
    if (signal.aborted) throw new DOMException("Import cancelled", "AbortError");
    return parseMeritImport(user, catalog);
  } catch (error) {
    if (signal.aborted) throw new DOMException("Import cancelled", "AbortError");
    if (timedOut) throw new Error("The merit import timed out after 15 seconds. Please try again.");
    if (error instanceof TypeError) throw new Error("Could not connect to Torn. Check your connection and try again.");
    throw error;
  } finally {
    clearTimeout(timer);
    controller.abort();
    signal.removeEventListener("abort", abort);
  }
}
