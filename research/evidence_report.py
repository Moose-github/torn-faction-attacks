"""Escaped offline presentation of coverage and factor evidence."""
from html import escape
from extraction import platinum_label


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
                      [[platinum_label(p['winner_division']), platinum_label(p['loser_division']), p['wars']] for p in c['division_pairs']])
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
        trend = c.get('observed')
        trend_html = (f'<p><b>Observed: {escape(trend["status"])}</b></p><details><summary>How the observed trend is described</summary><p>{escape(trend["explanation"])}</p></details>'
                      if trend else '<p>Rerun the analysis to add the observed-trend assessment.</p>')
        bands_html = ''
        if c.get('score_bands'):
            bands = table(['War score', 'Observations', 'Distinct wars', 'Median reward', 'Mean reward', 'Middle 50% of rewards', 'Coverage'],
                          [[f'{b["low"]:,}'+('+' if b['high'] is None else f' to < {b["high"]:,}'), b['n'], b['wars'],
                            '—' if b['median_value'] is None else money(b['median_value']),
                            '—' if b['mean_value'] is None else money(b['mean_value']),
                            '—' if b['middle_half'] is None else ' – '.join(money(v) for v in b['middle_half']),
                            'No observations' if b['wars'] == 0 else 'Sparse' if b['wars'] < 20 else '20+ wars'] for b in c['score_bands']])
            bands_html = '<details><summary>Rewards by score range</summary><p>Fixed ranges use all usable observations. Fewer than 20 distinct wars is marked sparse. The middle 50% describes reward spread, not uncertainty about the median. These unadjusted summaries do not establish a plateau or score target.</p>'+bands+'</details>'
        overlap = '' if a is None or 'overlap_vif' not in a else f'<p>Factor overlap (VIF): {a["overlap_vif"]:.2f}; flagged at 10. This concerns how well the model separates this factor’s contribution.</p>'
        cautions = ''.join(f'<li>{escape(s)}</li>' for s in c['cautions'])
        output += f'''<article class="box"><h3>{escape(c['question'])}</h3>
          <p>{c['observations']} observations · {c['wars']} wars · {c['factions']} factions</p>{trend_html}{observed}
          <details><summary>Inspect observed groups</summary><p>{escape(c['unit'])}; ties stay together, so group sizes may differ.</p>{groups}</details>{bands_html}
          <p><b>Adjusted: {escape(c['status'])}</b></p>{adjusted}{overlap}<p>{escape(c['explanation'])}</p>
          <details><summary>Evidence limitations</summary><ul>{cautions}</ul></details></article>'''
    return output + '</div>'
