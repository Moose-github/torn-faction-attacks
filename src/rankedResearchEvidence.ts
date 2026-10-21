import { isRecord } from './backend/request';

export function validateResearchEvidence(value: Record<string, unknown>, assert: (value: unknown, message: string) => void) {
  function check(condition: unknown, message: string): asserts condition { assert(condition, message); }
  const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
  const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const optionalNumber = (v: unknown) => v === null || finite(v);
  const pair = (v: unknown) => Array.isArray(v) && v.length === 2 && v.every(finite) && v[0] <= v[1];
  const strings = (v: unknown) => Array.isArray(v) && v.every(s => typeof s === 'string');
  const date = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
  const tri = (v: unknown) => v === null || typeof v === 'boolean';
  function graphs(g: unknown, expected: unknown) {
    const nonnegative = (v: unknown): v is number => finite(v) && v >= 0;
    const range = (v: unknown): v is number[] => pair(v) && (v as number[]).every(nonnegative);
    check(isRecord(g) && count(g.observations) && g.observations === expected && count(g.wars) && g.wars <= g.observations
      && range(g.value_range), 'Invalid graph sample.');
    check(Array.isArray(g.factors) && g.factors.length > 0 && g.factors.length <= 10, 'Invalid graph factors.');
    const factors = g.factors;
    for (const f of factors) {
      check(isRecord(f) && ['field', 'label', 'unit'].every(k => typeof f[k] === 'string') && range(f.range)
        && Array.isArray(f.medians) && f.medians.length <= 4, 'Invalid factor graph.');
      for (const m of f.medians) check(isRecord(m) && nonnegative(m.x) && nonnegative(m.y) && count(m.n) && m.n > 0
        && m.x >= f.range[0] && m.x <= f.range[1] && m.y >= g.value_range[0] && m.y <= g.value_range[1], 'Invalid grouped median.');
      check(f.medians.reduce((n, m) => n + Number((m as Record<string, unknown>).n), 0) === g.observations, 'Graph median counts do not match.');
    }
    check(new Set(factors.map(f => (f as Record<string, unknown>).field)).size === factors.length, 'Duplicate graph factors.');
    check(Array.isArray(g.points) && g.points.length === Math.min(1000, g.observations), 'Invalid scatter sample size.');
    for (const p of g.points) check(isRecord(p) && count(p.war_id) && count(p.faction_id) && nonnegative(p.value)
      && p.value >= g.value_range[0] && p.value <= g.value_range[1] && Array.isArray(p.values) && p.values.length === factors.length
      && p.values.every((v, i) => nonnegative(v) && v >= (factors[i] as { range: number[] }).range[0] && v <= (factors[i] as { range: number[] }).range[1]), 'Invalid scatter point.');
    check(new Set(g.points.map(p => `${(p as Record<string, unknown>).war_id}:${(p as Record<string, unknown>).faction_id}`)).size === g.points.length, 'Duplicate scatter observations.');
    check(Array.isArray(g.distributions) && g.distributions.length <= 50, 'Invalid division distributions.');
    for (const d of g.distributions) check(isRecord(d) && typeof d.label === 'string' && count(d.n) && d.n > 0 && count(d.wars) && d.wars <= d.n
      && Array.isArray(d.five_number) && d.five_number.length === 5 && d.five_number.every((v, i, values) => nonnegative(v) && (i === 0 || v >= values[i-1]))
      && d.five_number[0] >= g.value_range[0] && d.five_number[4] <= g.value_range[1], 'Invalid reward distribution.');
    check(g.distributions.reduce((n, d) => n + Number((d as Record<string, unknown>).n), 0) === g.observations, 'Distribution counts do not match.');
  }
  function comparisons(cards: unknown) {
    check(Array.isArray(cards) && cards.length <= 20, 'Invalid factor comparisons.');
    for (const c of cards) {
      check(isRecord(c) && ['field', 'question', 'unit', 'explanation'].every(k => typeof c[k] === 'string'), 'Invalid comparison labels.');
      check(['Promising association', 'Uncertain', 'Mixed evidence', 'Insufficient data', 'Descriptive comparison'].includes(String(c.status)), 'Invalid evidence status.');
      check(['observations', 'wars', 'factions'].every(k => count(c[k])) && strings(c.cautions), 'Invalid evidence sample.');
      check(optionalNumber(c.observed_difference) && optionalNumber(c.observed_percent), 'Invalid observed comparison.');
      check(Array.isArray(c.groups) && c.groups.length <= 10, 'Invalid comparison groups.');
      for (const g of c.groups) {
        check(isRecord(g) && typeof g.label === 'string' && ['n', 'wars', 'factions'].every(k => count(g[k]))
          && finite(g.mean_value) && g.mean_value >= 0 && finite(g.median_value) && g.median_value >= 0, 'Invalid group summary.');
      }
      check(c.groups.reduce((n, g) => n + Number((g as Record<string, unknown>).n), 0) === c.observations, 'Comparison group counts do not match.');
      if (c.adjusted !== null) {
        const a = c.adjusted;
        check(isRecord(a) && pair(a.range) && finite(a.difference) && optionalNumber(a.percent_of_mean)
          && (a.interval === null || pair(a.interval)) && tri(a.stable_halves) && tri(a.sensitive_to_top_faction), 'Invalid adjusted evidence.');
      }
    }
  }
  if (value.comparisons !== undefined) comparisons(value.comparisons);
  if (value.graphs !== undefined) graphs(value.graphs, value.model_observations);
  if (isRecord(value.whole_war) && value.whole_war.graphs !== undefined) graphs(value.whole_war.graphs, value.whole_war.model_observations);
  if (isRecord(value.whole_war) && value.whole_war.comparisons !== undefined) comparisons(value.whole_war.comparisons);
  if (value.coverage === undefined) return;
  const c = value.coverage;
  check(isRecord(c) && ['saved_reports', 'eligible_wars', 'valued_wars', 'model_wars', 'distinct_factions'].every(k => count(c[k])), 'Invalid coverage counts.');
  check(c.eligible_wars === value.eligible_wars && Number(c.model_wars) <= Number(c.valued_wars)
    && Number(c.valued_wars) <= Number(c.eligible_wars) && Number(c.eligible_wars) <= Number(c.saved_reports), 'Inconsistent coverage counts.');
  check((c.first_saved === null || date(c.first_saved)) && (c.last_saved === null || date(c.last_saved)) && strings(c.warnings), 'Invalid coverage dates or warnings.');
  if (c.collection !== null) {
    const m = c.collection;
    check(isRecord(m) && typeof m.discovery_done === 'boolean' && ['discovered_wars', 'saved_reports', 'pending_reports'].every(k => count(m[k]))
      && Number(m.saved_reports) + Number(m.pending_reports) === m.discovered_wars && m.saved_reports === c.saved_reports, 'Invalid collection completeness.');
    check(['deferred_reports', 'failed_reports'].every(k => m[k] === undefined || count(m[k]))
      && Number(m.deferred_reports ?? 0) + Number(m.failed_reports ?? 0) <= Number(m.pending_reports), 'Invalid unresolved report counts.');
  }
  check(Array.isArray(c.weeks) && c.weeks.length <= 10000, 'Invalid weekly coverage.');
  for (const w of c.weeks) check(isRecord(w) && date(w.start) && date(w.end) && w.start <= w.end
    && ['saved', 'eligible', 'valued', 'factions'].every(k => count(w[k])) && Number(w.valued) <= Number(w.eligible)
    && Number(w.eligible) <= Number(w.saved), 'Invalid coverage week.');
  check(Array.isArray(c.division_pairs) && c.division_pairs.length <= 25 && c.division_pairs.every(p => isRecord(p)
    && [p.winner_division, p.loser_division].every(d => count(d) && d <= 4) && count(p.wars)), 'Invalid division coverage.');
  check(Array.isArray(c.rosters) && c.rosters.length <= 10 && c.rosters.every(r => isRecord(r) && typeof r.label === 'string'
    && ['observations', 'wars', 'factions'].every(k => count(r[k]))), 'Invalid roster coverage.');
  check(Array.isArray(c.top_factions) && c.top_factions.length <= 10 && c.top_factions.every(f => isRecord(f)
    && count(f.id) && typeof f.name === 'string' && count(f.wars)), 'Invalid faction coverage.');
}
