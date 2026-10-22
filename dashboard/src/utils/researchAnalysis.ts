import { getJson, postJson } from '../api/client';
import type { ResearchAnalysis, ResearchRun } from '../../../shared/rankedResearch';
export { RESEARCH_CACHES } from '../../../shared/rankedResearch';
import { RESEARCH_CACHES } from '../../../shared/rankedResearch';

export type ResearchPrices = Record<string, number | null>;
type Page = { dataset: { id: string; snapshot_token: string; start: string; end: string; collection?: unknown }; reports: unknown[]; next: number | null };
export function parseResearchPrices(values: Record<string, string>): ResearchPrices {
  return Object.fromEntries(RESEARCH_CACHES.map(name => {
    const input = (values[name] ?? '').replace(/,/g, '').trim();
    const value = input === '' ? null : Number(input);
    if (value !== null && (!Number.isFinite(value) || value < 0 || value >= 1e15)) throw new Error(`Enter a valid full-dollar price for ${name}, or leave it blank.`);
    return [name, value];
  }));
}
function cancelled() { return new DOMException('Analysis cancelled.', 'AbortError'); }

export async function analyseSavedResearch(run: ResearchRun, prices: ResearchPrices, signal: AbortSignal, progress: (message: string) => void) {
  if (run.status !== 'frozen' || !run.snapshot_token) throw new Error('Freeze the saved dataset before analysing it.');
  if (signal.aborted) throw cancelled();
  const worker = new Worker(new URL('../workers/researchAnalysisWorker.ts', import.meta.url), { type: 'module' });
  let requestId = 0;
  const abort = () => worker.terminate();
  signal.addEventListener('abort', abort, { once: true });
  function command(action: 'init' | 'page' | 'finish', data?: unknown): Promise<string> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) { reject(cancelled()); return; }
      const id = ++requestId;
      const cleanup = () => { clearTimeout(timer); worker.removeEventListener('message', message); worker.removeEventListener('error', error); signal.removeEventListener('abort', stop); };
      const stop = () => { cleanup(); reject(cancelled()); };
      const error = () => { cleanup(); reject(new Error('The analysis engine stopped. Try again in an up-to-date browser.')); };
      const message = (event: MessageEvent<{ id: number; result: string; error?: string }>) => {
        if (event.data.id !== id) return;
        cleanup();
        if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data.result);
      };
      const timer = setTimeout(() => { cleanup(); reject(new Error('Analysis took too long. Try again; your saved collection is unchanged.')); }, action === 'finish' ? 600000 : 120000);
      worker.addEventListener('message', message);
      worker.addEventListener('error', error);
      signal.addEventListener('abort', stop, { once: true });
      worker.postMessage({ id, action, json: data === undefined ? undefined : JSON.stringify(data), runtimeBase: new URL(import.meta.env.BASE_URL, window.location.href).href });
    });
  }
  try {
    const base = `/api/admin/ranked-research/${run.id}`;
    progress('Loading saved collection…');
    let after = 0, count = 0;
    let manifest = '';
    do {
      const page = await getJson<Page>(`${base}/export?after=${after}`, true, signal);
      if (page.dataset.id !== run.id || page.dataset.snapshot_token !== run.snapshot_token || page.dataset.start !== run.start_date || page.dataset.end !== run.end_date) {
        throw new Error('The saved snapshot changed. Refresh the collection before analysing it.');
      }
      if (after === 0) {
        manifest = JSON.stringify(page.dataset);
        progress('Preparing analysis engine…');
        await command('init', { meta: page.dataset, prices });
      } else if (JSON.stringify(page.dataset) !== manifest) throw new Error('Collection metadata changed while loading. Please try again.');
      await command('page', page.reports);
      count += page.reports.length;
      progress(`Reading saved reports: ${count.toLocaleString()}${run.reports == null ? '' : ` / ${run.reports.toLocaleString()}`}…`);
      if (page.next === null) break;
      if (!Number.isSafeInteger(page.next) || page.next <= after) throw new Error('The saved report pages did not advance. Please try again.');
      after = page.next;
    } while (!signal.aborted);
    if (signal.aborted) throw cancelled();
    progress('Calculating factor comparisons, evidence and graphs…');
    const result: ResearchAnalysis = JSON.parse(await command('finish'));
    if (signal.aborted) throw cancelled();
    const body = { snapshot_token: run.snapshot_token, result };
    if (new TextEncoder().encode(JSON.stringify(body)).length > 1500000) throw new Error('The generated findings exceed the current save limit. Your collection is safe; use the optional offline workflow for this sample.');
    progress('Saving findings…');
    await postJson(`${base}/analysis`, body, true, signal);
    return result;
  } finally {
    worker.terminate();
    signal.removeEventListener('abort', abort);
  }
}
