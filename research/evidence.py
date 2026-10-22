"""Coverage and transparent, descriptive comparisons of the saved sample."""
import datetime as dt
from extraction import platinum_label
from collections import Counter
from statistics import mean, median


def identities(rows, whole=False):
    return {f for r in rows for f in ((r['faction_id'], r['opponent_id']) if whole else (r['faction_id'],))}


def coverage(rows, wars, audits, date_range, collection=None):
    first, last = (dt.date.fromisoformat(date_range[k]) for k in ('start', 'end'))
    weeks = []
    day = first
    while day <= last:
        end = min(last, day + dt.timedelta(days=6-day.weekday()))
        lo, hi = day.isoformat(), end.isoformat()
        saved = [a for a in audits if a.get('date') and lo <= a['date'] <= hi]
        eligible = [w for w in wars if lo <= w['date'] <= hi]
        weeks.append({'start': lo, 'end': hi, 'saved': len(saved), 'eligible': len(eligible),
                      'valued': sum(w['gross_value'] is not None for w in eligible),
                      'factions': len(identities(eligible, True))})
        day = end + dt.timedelta(days=1)
    pairs = Counter((w['division'], w['opponent_division']) for w in wars)
    rosters = []
    for low, high, label in [(0, 25, '1–25 listed members'), (26, 50, '26–50 listed members'),
                             (51, 75, '51–75 listed members'), (76, float('inf'), '76+ listed members')]:
        group = [r for r in rows if low <= r['listed_members'] <= high]
        rosters.append({'label': label, 'observations': len(group), 'wars': len({r['war_id'] for r in group}),
                        'factions': len(identities(group))})
    counts = Counter(r['faction_id'] for r in rows)
    names = {r['faction_id']: r['faction_name'] for r in rows}
    dates = sorted(a['date'] for a in audits if a.get('date'))
    warnings = ['Weekly counts describe saved reports, not the number of wars that existed. Empty weeks do not prove there were no eligible wars.',
                'Roster sizes are report member-list counts; eligibility and inactive-member completeness are not established.']
    if collection is None:
        warnings.append('Collection completeness is unknown for this older export. Reanalysis cannot reconstruct discarded pending reports.')
    else:
        if not collection['discovery_done']:
            warnings.append('Discovery did not finish. Later dates may be underrepresented; the total available population is unknown.')
        if collection['pending_reports']:
            warnings.append(f"{collection['pending_reports']} discovered reports were still pending when this sample was frozen.")
        if collection.get('deferred_reports', 0) or collection.get('failed_reports', 0):
            warnings.append(f"At freeze, {collection.get('deferred_reports', 0)} reports were awaiting retry and {collection.get('failed_reports', 0)} had reached the retry limit. These unresolved wars are excluded; download their details from Collection health.")
    unknown_dates = sum(not a.get('date') for a in audits)
    if unknown_dates:
        warnings.append(f'{unknown_dates} saved reports have no usable start date and are absent from weekly counts.')
    return {'saved_reports': len(audits), 'eligible_wars': len(wars),
            'valued_wars': sum(w['gross_value'] is not None for w in wars),
            'model_wars': sum(w['gross_value'] is not None and not w['audit_warnings'] for w in wars),
            'distinct_factions': len(counts), 'first_saved': dates[0] if dates else None,
            'last_saved': dates[-1] if dates else None, 'collection': collection, 'weeks': weeks,
            'division_pairs': [{'winner_division': a, 'loser_division': b, 'wars': n} for (a, b), n in sorted(pairs.items())],
            'rosters': rosters, 'top_factions': [{'id': f, 'name': names[f], 'wars': n} for f, n in counts.most_common(10)],
            'warnings': warnings}


def quantile(values, fraction):
    values = sorted(values)
    index = (len(values)-1)*fraction
    low = int(index)
    return values[low] + (values[min(low+1, len(values)-1)]-values[low])*(index-low)


def observed_trend(groups, categorical=False):
    """A transparent description of grouped values, not a significance test."""
    rule = ('This describes the saved sample, without adjustment or a significance test. '
            'Directional labels require at least three groups, at least 20 distinct wars in every group, '
            'and both means and medians moving consistently in the same direction with a different first and last value.')
    if categorical:
        return {'status': 'Category comparison', 'explanation': 'Compare the displayed categories; no numerical trend is assigned. ' + rule}
    if len(groups) < 3 or any(g['wars'] < 20 for g in groups):
        return {'status': 'Limited observations', 'explanation': 'There are too few populated groups or distinct wars per group to summarise a consistent observed direction. ' + rule}
    series = [[g[key] for g in groups] for key in ('mean_value', 'median_value')]
    rising = all(v[-1] > v[0] and all(a <= b for a, b in zip(v, v[1:])) for v in series)
    falling = all(v[-1] < v[0] and all(a >= b for a, b in zip(v, v[1:])) for v in series)
    status = 'Positive observed trend' if rising else 'Negative observed trend' if falling else 'No consistent observed trend'
    description = ('Mean and median rewards rise across the displayed groups.' if rising else
                   'Mean and median rewards fall across the displayed groups.' if falling else
                   'Group means and medians do not show one consistent direction. Local patterns may still exist.')
    return {'status': status, 'explanation': description + ' ' + rule}


def score_bands(sample):
    # Fixed round boundaries across datasets and reward views, not a fitted cutoff.
    edges = [0, 5000, 10000, 15000, 20000, 25000, 30000, 40000, 50000, None]
    groups = []
    for low, high in zip(edges, edges[1:]):
        group = [r for r in sample if r['score'] >= low and (high is None or r['score'] < high)]
        values = [r['gross_value'] for r in group]
        groups.append({'low': low, 'high': high, 'n': len(group), 'wars': len({r['war_id'] for r in group}),
                       'mean_value': mean(values) if values else None, 'median_value': median(values) if values else None,
                       'middle_half': [quantile(values, .25), quantile(values, .75)] if values else None})
    return groups


def comparisons(rows, model, whole=False):
    # Use exactly the priced, audited sample used by the adjusted model.
    sample = [r for r in rows if r['gross_value'] is not None and not r['audit_warnings']]
    questions = [
        ('attacks', 'Are more reported attacks associated with greater rewards?', 'attacks'),
        ('score', 'Is a higher war score associated with greater rewards?', 'score'),
        ('participation_rate', 'Is broader participation associated with greater rewards?', 'share (0–1)'),
        ('top20_attack_share', 'Does concentrating attacks among fewer members relate to rewards?', 'share (0–1)'),
        ('duration_hours', 'Are longer wars associated with greater rewards?', 'hours'),
        ('listed_members', 'How does listed roster size relate to rewards?', 'combined members' if whole else 'members'),
    ]
    if whole:
        questions += [('attack_balance', 'Do more evenly shared attacks relate to a larger combined pot?', 'smaller share (0–0.5)'),
                      ('score_balance', 'Does a more evenly shared score relate to a larger combined pot?', 'smaller share (0–0.5)'),
                      ('division', 'How do rewards vary by the winner’s starting division?', 'division'),
                      ('opponent_division', 'How do rewards vary by the loser’s starting division?', 'division')]
    else:
        questions += [('opponent_score', 'Does the opponent’s score relate to this faction’s rewards?', 'score'),
                      ('division', 'How do rewards vary by starting division?', 'division'),
                      ('opponent_division', 'How do rewards vary by the opponent’s starting division?', 'division'),
                      ('won', 'How do winning and losing factions’ rewards compare?', 'outcome')]
    effects = {e['field']: e for e in model.get('effects', [])}
    cards = []
    for field, question, unit in questions:
        categorical = field in ('division', 'opponent_division', 'won')
        groups = []
        if sample:
            values = [r[field] for r in sample]
            if categorical:
                partitions = [(('Win' if v else 'Loss') if field == 'won' else platinum_label(v), [r for r in sample if r[field] == v]) for v in sorted(set(values))]
            else:
                edges = sorted(set(quantile(values, q) for q in (0, .25, .5, .75, 1)))
                partitions = [(f'{edges[0]:.2f}', sample)] if len(edges) == 1 else [
                    (f'{a:.2f} to {"" if i == len(edges)-2 else "< "}{b:.2f}',
                     [r for r in sample if a <= r[field] and (r[field] <= b if i == len(edges)-2 else r[field] < b)])
                    for i, (a, b) in enumerate(zip(edges, edges[1:]))]
            for label, group in partitions:
                if group:
                    groups.append({'label': label, 'n': len(group), 'wars': len({r['war_id'] for r in group}),
                                   'factions': len(identities(group, whole)), 'mean_value': mean(r['gross_value'] for r in group),
                                   'median_value': median(r['gross_value'] for r in group)})
        # A multi-level division comparison has no single natural contrast.
        difference = groups[-1]['mean_value']-groups[0]['mean_value'] if len(groups) > 1 and field not in ('division', 'opponent_division') else None
        percent = 100*difference/groups[0]['mean_value'] if difference is not None and groups[0]['mean_value'] else None
        effect = effects.get(field)
        status, adjusted = 'Insufficient data', None
        explanation = model.get('reason', 'This factor has no estimable adjusted comparison in this sample.')
        cautions = ['Observed groups can differ in divisions, roster sizes and other factors. Group differences are descriptive, not isolated effects.',
                    'Comparisons use fully priced observations with consistent member totals. Both sides of a war are not independent evidence.']
        if categorical and len(groups) > 1:
            status, explanation = 'Descriptive comparison', 'Starting divisions and outcome are adjustment variables. These group summaries do not isolate their separate effects.'
        elif effect and effect['available']:
            average = mean(r['gross_value'] for r in sample)
            adjusted = {'range': effect['range'], 'difference': effect['effect_m']*1e6,
                        'percent_of_mean': effect['effect_m']*1e6/average*100 if average else None,
                        'interval': [v*1e6 for v in effect['interval_m']] if effect['interval_m'] is not None else None,
                        'stable_halves': effect['stable_halves'], 'sensitive_to_top_faction': effect['sensitive_to_top_faction'],
                        'overlap_vif': effect['vif']}
            status = 'Promising association' if effect['status'] == 'Tentative association' else 'Uncertain'
            if effect['status'] == 'Association with overlapping factors':
                status = ('Positive' if effect['effect_m'] > 0 else 'Negative') + ' association; overlapping factors'
            if effect['stable_halves'] is False or effect['sensitive_to_top_faction'] is True:
                status = 'Mixed evidence'
            if status == 'Promising association':
                reason = 'The interval excludes zero, the direction is consistent across chronological halves, and it survives removing the most represented faction without strong factor overlap.'
            elif status.endswith('; overlapping factors'):
                direction = 'positive' if effect['effect_m'] > 0 else 'negative'
                reason = f'The adjusted association is {direction}, its interval excludes zero, and both direction checks pass. Strong overlap with other inputs makes the separate contribution hard to isolate (VIF {effect["vif"]:.2f}; overlap flag starts at 10).'
            elif status == 'Mixed evidence':
                reason = 'The direction is not consistent across chronological halves or changes when the most represented faction is removed.'
            else:
                reason = ' '.join(effect['cautions']) or 'The available checks do not establish a consistent separate association.'
            explanation = reason + ' Adjusted comparison runs from the 25th to the 75th percentile, accounting for the other model factors. This differs from comparing the lowest and highest observed groups.'
            cautions += effect['cautions']
        elif effect:
            explanation = effect['reason']
        if field in ('participation_rate', 'top20_attack_share', 'listed_members'):
            cautions.append('Member lists are roster proxies; participation and concentration depend on who appears in the report.')
        cards.append({'field': field, 'question': question, 'unit': unit, 'status': status, 'explanation': explanation,
                      'observations': len(sample), 'wars': len({r['war_id'] for r in sample}), 'factions': len(identities(sample, whole)),
                      'groups': groups, 'observed_difference': difference, 'observed_percent': percent,
                      'observed': observed_trend(groups, categorical),
                      'adjusted': adjusted, 'cautions': cautions,
                      **({'score_bands': score_bands(sample)} if field == 'score' else {})})
    return cards
