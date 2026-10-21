"""Escaped offline presentation of coverage and factor evidence."""
from html import escape


def money(value):
    return f'${value/1e6:,.2f}m'


def table(headers, rows):
    return '<div style="overflow-x:auto"><table><thead><tr>' + ''.join(f'<th>{escape(str(h))}</th>' for h in headers) + '</tr></thead><tbody>' + ''.join('<tr>' + ''.join(f'<td>{escape(str(v))}</td>' for v in row) + '</tr>' for row in rows) + '</tbody></table></div>'


def coverage_html(c):
    if c is None:
        return ''
    m = c['collection']
    status = 'Collection completeness unknown' if m is None else ('Discovery and report collection completed' if m['discovery_done'] and not m['pending_reports'] else 'Partial collection')
    detail = '' if m is None else f"{m['saved_reports']} of {m['discovered_wars']} discovered reports saved; {m['pending_reports']} pending at freeze; discovery {'finished' if m['discovery_done'] else 'unfinished'}."
    weeks = table(['UTC start', 'UTC end', 'Saved', 'Eligible', 'Fully priced', 'Eligible factions'],
                  [[w[k] for k in ('start', 'end', 'saved', 'eligible', 'valued', 'factions')] for w in c['weeks']])
    divisions = table(['Winner division', 'Loser division', 'Eligible wars'],
                      [[p[k] for k in ('winner_division', 'loser_division', 'wars')] for p in c['division_pairs']])
    rosters = table(['Listed faction roster', 'Observations', 'Wars', 'Factions'],
                    [[r[k] for k in ('label', 'observations', 'wars', 'factions')] for r in c['rosters']])
    factions = table(['Faction', 'ID', 'Eligible wars'], [[f['name'], f['id'], f['wars']] for f in c['top_factions']])
    warnings = ''.join(f'<li>{escape(w)}</li>' for w in c['warnings'])
    return f'''<section class="box"><h2>Sample coverage</h2><b>{status}</b><p>{detail}</p>
      <p>{c['saved_reports']} saved reports · {c['eligible_wars']} eligible wars · {c['valued_wars']} fully priced pots · {c['model_wars']} wars passing pricing and total checks · {c['distinct_factions']} distinct eligible factions.</p>
      <p>Saved war start dates: {escape(c['first_saved'] or 'none')} to {escape(c['last_saved'] or 'none')}.</p>
      <ul>{warnings}</ul><details><summary>Weekly coverage</summary>{weeks}</details>
      <details><summary>Starting divisions</summary>{divisions}</details>
      <details><summary>Listed roster sizes</summary><p>Each faction counts once per eligible war; a war can appear in two size groups.</p>{rosters}</details>
      <details><summary>Most represented factions</summary>{factions}</details></section>'''


def comparison_html(cards):
    output = '<p>Factor comparisons use fully priced observations with consistent member totals. Observed groups are descriptive; adjusted estimates account for other model factors. Findings do not establish causal effects, targets or plateaus. Intervals are not adjusted for multiple comparisons.</p>'
    output += '<div class="grid">'
    for c in cards:
        adjusted = ''
        a = c['adjusted']
        if a is not None:
            interval = 'not estimable' if a['interval'] is None else ' to '.join(money(v) for v in a['interval'])
            pct = 'Not defined for a zero mean' if a['percent_of_mean'] is None else f"{a['percent_of_mean']:.1f}% of the sample mean"
            halves = 'not estimable' if a['stable_halves'] is None else ('consistent' if a['stable_halves'] else 'not consistent')
            sensitivity = 'not estimable' if a['sensitive_to_top_faction'] is None else ('direction changes' if a['sensitive_to_top_faction'] else 'direction retained')
            adjusted = f'''<div class="effect">{money(a['difference'])}</div><p>Adjusted difference: {a['range'][0]:.2f} → {a['range'][1]:.2f} {escape(c['unit'])}. {pct}.</p>
              <p>Approximate 95% interval: {interval}.</p><p>Chronological halves: {halves}. Removing the most represented faction: {sensitivity}.</p>'''
        observed = ''
        if c['observed_difference'] is not None:
            pct = 'not defined for a zero baseline' if c['observed_percent'] is None else f"{c['observed_percent']:.1f}% relative to the first group"
            observed = f"<p>Observed last-group minus first-group mean: {money(c['observed_difference'])} ({pct}).</p>"
        groups = table(['Group', 'Observations', 'Wars', 'Factions', 'Mean', 'Median'],
                       [[g['label'], g['n'], g['wars'], g['factions'], money(g['mean_value']), money(g['median_value'])] for g in c['groups']])
        cautions = ''.join(f'<li>{escape(s)}</li>' for s in c['cautions'])
        output += f'''<article class="box"><div class="tag">{escape(c['status'])}</div><h3>{escape(c['question'])}</h3>
          <p>{c['observations']} observations · {c['wars']} wars · {c['factions']} factions</p>{adjusted}<p>{escape(c['explanation'])}</p>{observed}
          <details><summary>Inspect observed groups</summary><p>{escape(c['unit'])}; ties stay together, so group sizes may differ.</p>{groups}</details>
          <details><summary>Evidence limitations</summary><ul>{cautions}</ul></details></article>'''
    return output + '</div>'
