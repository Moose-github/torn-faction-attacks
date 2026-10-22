import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getJson, postJson } from '../api/client';
import { analyseSavedResearch, parseResearchPrices } from './researchAnalysis';
import type { ResearchRun } from '../../../shared/rankedResearch';

vi.mock('../api/client', () => ({ getJson: vi.fn(), postJson: vi.fn() }));
const run = { id: 'run', status: 'frozen', snapshot_token: 'snapshot', start_date: '2026-09-01', end_date: '2026-09-30', reports: 2 } as ResearchRun;
const meta = { id: run.id, snapshot_token: run.snapshot_token, start: run.start_date, end: run.end_date };
const result = { eligible_wars: 2, whole_war: { valued_wars: 2 } };
class TestWorker extends EventTarget {
  static current: TestWorker;
  static stalled = false;
  terminate = vi.fn();
  commands: { action: string; json?: string }[] = [];
  constructor() { super(); TestWorker.current = this; }
  postMessage(message: { id: number; action: string; json?: string }) {
    this.commands.push(message);
    if (TestWorker.stalled) return;
    queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: { id: message.id, result: message.action === 'finish' ? JSON.stringify(result) : '' } })));
  }
}
beforeEach(() => {
  vi.clearAllMocks();
  TestWorker.stalled = false;
  vi.stubGlobal('Worker', TestWorker);
  vi.stubGlobal('window', { location: { href: 'https://fixture.example/research' } });
  vi.stubEnv('BASE_URL', '/');
  vi.mocked(postJson).mockResolvedValue({ ok: true });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('saved research analysis', () => {
  it('streams all pages into one worker and saves compact results against the snapshot', async () => {
    vi.mocked(getJson).mockResolvedValueOnce({ dataset: meta, reports: [{ id: 1 }], next: 1 })
      .mockResolvedValueOnce({ dataset: meta, reports: [{ id: 2 }], next: null });
    const signal = new AbortController().signal;
    expect(await analyseSavedResearch(run, {}, signal, vi.fn())).toEqual(result);
    expect(getJson).toHaveBeenNthCalledWith(2, '/api/admin/ranked-research/run/export?after=1', true, signal);
    expect(TestWorker.current.commands.map(c => c.action)).toEqual(['init', 'page', 'page', 'finish']);
    expect(postJson).toHaveBeenCalledWith('/api/admin/ranked-research/run/analysis', { snapshot_token: 'snapshot', result }, true, signal);
    expect(TestWorker.current.terminate).toHaveBeenCalled();
  });

  it('rejects a changed snapshot without saving', async () => {
    vi.mocked(getJson).mockResolvedValue({ dataset: { ...meta, snapshot_token: 'different' }, reports: [], next: null });
    await expect(analyseSavedResearch(run, {}, new AbortController().signal, vi.fn())).rejects.toThrow('snapshot changed');
    expect(postJson).not.toHaveBeenCalled();
    expect(TestWorker.current.terminate).toHaveBeenCalled();
  });

  it('rejects repeated pagination without saving', async () => {
    vi.mocked(getJson).mockResolvedValue({ dataset: meta, reports: [{ id: 1 }], next: 1 });
    await expect(analyseSavedResearch(run, {}, new AbortController().signal, vi.fn())).rejects.toThrow('did not advance');
    expect(postJson).not.toHaveBeenCalled();
  });

  it('cancels a stalled runtime without saving findings', async () => {
    TestWorker.stalled = true;
    vi.mocked(getJson).mockResolvedValue({ dataset: meta, reports: [], next: null });
    const controller = new AbortController();
    const work = analyseSavedResearch(run, {}, controller.signal, vi.fn());
    await Promise.resolve();
    controller.abort();
    await expect(work).rejects.toMatchObject({ name: 'AbortError' });
    expect(TestWorker.current.terminate).toHaveBeenCalled();
    expect(postJson).not.toHaveBeenCalled();
  });

  it('requires a frozen collection before accessing any reports', async () => {
    await expect(analyseSavedResearch({ ...run, status: 'complete' }, {}, new AbortController().signal, vi.fn())).rejects.toThrow('Freeze');
    expect(getJson).not.toHaveBeenCalled();
  });

  it('keeps unknown prices distinct from known zero values', () => {
    expect(parseResearchPrices({ 'Melee Cache': '100,000,000', 'Armor Cache': '0' })).toMatchObject({ 'Melee Cache': 100000000, 'Armor Cache': 0, 'Heavy Arms Cache': null });
    for (const value of ['-1', 'NaN', 'Infinity', '100m', '1000000000000000']) {
      expect(() => parseResearchPrices({ 'Melee Cache': value })).toThrow('valid full-dollar price');
    }
  });
});
