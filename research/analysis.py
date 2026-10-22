"""Exploratory adjusted associations, with explicit data and identifiability gates."""
from __future__ import annotations

import datetime as dt
from collections import Counter

FACTORS = [
    ('attacks', 'Reported attacks', True),
    ('score', 'War score', True),
    ('participation_rate', 'Share of listed members attacking', False),
    ('top20_attack_share', 'Attack share of the top 20% of listed members', False),
    ('duration_hours', 'War duration (hours)', True),
    ('opponent_score', 'Opponent score', True),
]

WAR_FACTORS = [
    ('attacks', 'Combined reported attacks', True),
    ('score', 'Combined war score', True),
    ('participation_rate', 'Share of both listed rosters attacking', False),
    ('top20_attack_share', 'Attack share of each faction\'s top 20%, pooled', False),
    ('duration_hours', 'War duration (hours)', True),
    ('attack_balance', 'Smaller faction share of combined attacks', False),
    ('score_balance', 'Smaller faction share of combined score', False),
]


def whole_war_rows(rows):
    """One complete pair per war. Missing prices on either side invalidate the pot."""
    grouped = {}
    for row in rows:
        grouped.setdefault(row['war_id'], []).append(row)
    wars = []
    for wid, sides in sorted(grouped.items()):
        if len(sides) != 2 or {r['won'] for r in sides} != {0, 1}:
            raise ValueError(f'War {wid} needs exactly one winning and one losing faction.')
        winner, loser = sorted(sides, key=lambda r: r['won'], reverse=True)
        if winner['faction_id'] != loser['opponent_id'] or loser['faction_id'] != winner['opponent_id'] or winner['faction_id'] == loser['faction_id']:
            raise ValueError(f'War {wid} has inconsistent faction identities.')
        if any(winner[field] != loser[field] for field in ('start', 'date', 'month', 'duration_hours')):
            raise ValueError(f'War {wid} has inconsistent timing.')
        totals = {field: sum(r[field] for r in sides) for field in ('attacks', 'score', 'listed_members', 'active_attack_members', 'member_attacks_sum')}
        quantities = Counter()
        for r in sides:
            quantities.update(r['cache_quantities'])
        value = None if any(r['gross_value'] is None for r in sides) else sum(r['gross_value'] for r in sides)
        wars.append({
            'war_id': wid, 'faction_id': winner['faction_id'], 'opponent_id': loser['faction_id'],
            'division': winner['division'], 'opponent_division': loser['division'],
            'start': winner['start'], 'date': winner['date'], 'month': winner['month'],
            'duration_hours': winner['duration_hours'], **totals,
            'participation_rate': totals['active_attack_members'] / totals['listed_members'],
            'top20_attack_share': sum(r['top20_attack_share'] * r['member_attacks_sum'] for r in sides) / totals['member_attacks_sum'] if totals['member_attacks_sum'] else 0,
            'attack_balance': min(r['attacks'] for r in sides) / totals['attacks'] if totals['attacks'] else 0,
            'score_balance': min(r['score'] for r in sides) / totals['score'] if totals['score'] else 0,
            'roster_balance': min(r['listed_members'] for r in sides) / totals['listed_members'],
            'gross_value': value, 'winner_gross_value': winner['gross_value'], 'loser_gross_value': loser['gross_value'],
            'cache_quantities': dict(quantities),
            'unpriced_items': sorted({item for r in sides for item in r['unpriced_items']}),
            'audit_warnings': [f"{r['faction_id']}: {warning}" for r in sides for warning in r['audit_warnings']],
        })
    return wars


def dyadic_meat(score_vectors, pairs):
    """Sum score cross-products for wars sharing either faction, counted once.

    Shared-faction sandwich estimator (Aronow, Samii & Assenova, 2015).
    Subtract the unordered-pair aggregate to correct double counting, including
    repeated meetings and factions switching winner/loser roles.
    """
    import numpy as np
    actors, dyads = {}, {}
    for score, (a, b) in zip(score_vectors, pairs):
        for actor in (a, b):
            actors.setdefault(actor, np.zeros_like(score))
            actors[actor] += score
        pair = tuple(sorted((a, b)))
        dyads.setdefault(pair, np.zeros_like(score))
        dyads[pair] += score
    actor_matrix, pair_matrix = np.stack(list(actors.values())), np.stack(list(dyads.values()))
    return actor_matrix.T @ actor_matrix - pair_matrix.T @ pair_matrix


def fit_model(rows, whole_war=False):
    try:
        import numpy as np
    except ImportError:
        return {'available': False, 'reason': 'Install the NumPy dependency to enable adjusted analysis.'}
    n = len(rows)
    wars = {r['war_id'] for r in rows}
    factions = {f for r in rows for f in ((r['faction_id'], r['opponent_id']) if whole_war else (r['faction_id'],))}
    if whole_war and n != len(wars):
        raise ValueError('Whole-war modelling requires one observation per war.')
    if len(wars) < 100 or len(factions) < 20:
        return {'available': False, 'reason': 'Adjusted analysis needs at least 100 valued wars and 20 distinct factions. This is a minimum screening rule, not a guarantee of sufficient evidence.'}
    dates = [r['date'] for r in rows]
    # August 2026 contains a ranking-system transition; avoid silently pooling eras.
    if any('2026-08-01' <= d < '2026-09-01' for d in dates) or (min(dates) < '2026-09-01' <= max(dates)):
        return {'available': False, 'reason': 'This range crosses the August 2026 ranking transition. Choose a range ending before August, or starting in September 2026, for adjusted analysis.'}
    columns = [np.ones(n)]
    names = ['intercept']
    transforms = {}
    omitted = []
    factors = WAR_FACTORS if whole_war else FACTORS
    controls = [('listed_members', 'Combined listed roster size', True), ('roster_balance', 'Smaller faction share of listed rosters', False)] if whole_war else [('listed_members', 'Listed roster size', True), ('opponent_listed_members', 'Opponent listed roster size', True)]
    for field, label, log in factors + controls:
        raw = np.array([r[field] for r in rows], dtype=float)
        values = np.log1p(raw) if log else raw
        scale = float(np.std(values))
        if scale < 1e-10:
            omitted.append(label)
            continue
        columns.append((values-np.mean(values))/scale)
        names.append(field)
        transforms[field] = (values, scale, raw)
    for field in (('division', 'opponent_division', 'month') if whole_war else ('won', 'division', 'opponent_division', 'month')):
        levels = sorted(set(r[field] for r in rows))
        for level in levels[1:]:
            columns.append(np.array([float(r[field] == level) for r in rows]))
            names.append(f'{field}={level}')
    X = np.column_stack(columns)
    y = np.array([r['gross_value']/1e6 for r in rows])
    p = X.shape[1]
    if n < 15*p:
        return {'available': False, 'reason': f'Too few valued observations for {p} model terms. Narrow the date range or collect more wars.'}
    if np.linalg.matrix_rank(X) < p:
        return {'available': False, 'reason': 'Some factors cannot be separated in this sample (perfect overlap). More varied wars are needed; no adjusted effects are reported.'}
    beta = np.linalg.lstsq(X, y, rcond=None)[0]
    residual = y-X@beta
    bread = np.linalg.inv(X.T@X)
    score_vectors = X*residual[:, None]

    def clustered_meat(groups):
        sums = {}
        for group, score in zip(groups, score_vectors):
            if group not in sums:
                sums[group] = np.zeros(p)
            sums[group] += score
        g = len(sums)
        matrix = np.stack(list(sums.values()))
        return matrix.T@matrix * (g/(g-1))*((n-1)/(n-p))

    if whole_war:
        meat = dyadic_meat(score_vectors, [(r['faction_id'], r['opponent_id']) for r in rows]) * n / (n-p)
    else:
        # Two-way clustered covariance: shared wars + repeated factions - intersections.
        meat = clustered_meat([r['war_id'] for r in rows]) + clustered_meat([r['faction_id'] for r in rows]) - clustered_meat([(r['war_id'], r['faction_id']) for r in rows])
    cov = bread@meat@bread
    starts = {r['war_id']: r['start'] for r in rows}
    time_wars = sorted(wars, key=lambda wid: (starts[wid], wid))
    halves = [set(time_wars[:len(time_wars)//2]), set(time_wars[len(time_wars)//2:])]
    half_betas = []
    for half in halves:
        ix = np.array([r['war_id'] in half for r in rows])
        # Calendar categories can be absent in one half; use a reduced, full-rank matrix.
        keep = [j for j in range(p) if j == 0 or np.std(X[ix, j]) > 1e-10]
        hX = X[ix][:, keep]
        if len(hX) < 5*len(keep) or np.linalg.matrix_rank(hX) < len(keep):
            half_betas.append(None)
        else:
            half_betas.append(dict(zip(keep, np.linalg.lstsq(hX, y[ix], rcond=None)[0])))
    most_common = Counter(f for r in rows for f in ((r['faction_id'], r['opponent_id']) if whole_war else (r['faction_id'],))).most_common(1)[0][0]
    ix = np.array([r['faction_id'] != most_common and r['opponent_id'] != most_common for r in rows])
    sensitivity = None
    if ix.sum() >= 5*p and np.linalg.matrix_rank(X[ix]) == p:
        sensitivity = np.linalg.lstsq(X[ix], y[ix], rcond=None)[0]
    effects = []
    for field, label, log in factors + controls:
        if field not in names:
            effects.append({'field': field, 'label': label, 'available': False, 'reason': 'No variation in this sample.'})
            continue
        j = names.index(field)
        values, scale, raw = transforms[field]
        q25, q75 = np.quantile(values, [.25, .75])
        span = float((q75-q25)/scale)
        qraw = np.quantile(raw, [.25, .75]).tolist()
        if span < 1e-8:
            effects.append({'field': field, 'label': label, 'available': False, 'reason': 'The middle half of observations have the same value.'})
            continue
        xj = X[:, j]
        others = np.delete(X, j, axis=1)
        remaining = xj-others@np.linalg.lstsq(others, xj, rcond=None)[0]
        vif = float(np.sum((xj-xj.mean())**2)/max(np.sum(remaining**2), 1e-12))
        effect = float(beta[j]*span)
        variance = float(cov[j, j])
        interval = None
        if variance >= 0:
            delta = 1.96*variance**.5*span
            interval = [effect-delta, effect+delta]
        stable = None
        if all(b is not None and j in b for b in half_betas):
            stable = all(float(b[j])*float(beta[j]) > 0 for b in half_betas)
        sensitive = float(sensitivity[j])*float(beta[j]) <= 0 if sensitivity is not None else None
        separated = interval is not None and (interval[0] > 0 or interval[1] < 0)
        status = 'Uncertain'
        if separated and stable is True and sensitive is False:
            status = 'Tentative association' if vif < 10 else 'Association with overlapping factors'
        cautions = []
        if vif >= 10:
            cautions.append('Strong overlap with other factors; the separate contribution is hard to isolate even when the estimated direction is consistent.')
        if interval is None:
            cautions.append('The clustered uncertainty estimate was unstable.')
        elif not separated:
            cautions.append('The uncertainty interval includes no association.')
        if stable is not True:
            cautions.append('Direction is not established in both chronological halves.')
        if sensitive:
            cautions.append('Direction changes when the most represented faction and its opponents are removed.')
        if sensitive is None:
            cautions.append('The most represented faction sensitivity check could not be estimated.')
        partial = residual + beta[j]*X[:, j] + y.mean()
        edges = np.unique(np.quantile(raw, [0, .25, .5, .75, 1]))
        bins = []
        for k in range(len(edges)-1):
            take = (raw >= edges[k]) & ((raw <= edges[k+1]) if k == len(edges)-2 else (raw < edges[k+1]))
            if take.sum():
                bins.append({'low': float(edges[k]), 'high': float(edges[k+1]), 'n': int(take.sum()),
                             'adjusted_value_m': float(np.mean(partial[take])), 'raw_value_m': float(np.mean(y[take]))})
        effects.append({'field': field, 'label': label, 'available': True, 'range': qraw,
                        'effect_m': effect, 'interval_m': interval, 'vif': vif, 'status': status,
                        'stable_halves': stable, 'sensitive_to_top_faction': sensitive, 'cautions': cautions, 'bins': bins})
    method = ('Ordinary least squares of combined gross cache value in $m, with one observation per war. Controls: winner and loser starting divisions, combined listed roster size, roster balance, calendar month and the other displayed factors. Approximate 95% intervals allow dependence between wars sharing either faction, including repeated pairings and winner/loser role changes (dyadic sandwich, n/(n-p) correction).'
              if whole_war else 'Ordinary least squares of faction gross cache value in $m. Controls: outcome, both starting divisions, both listed roster sizes, calendar month and the other displayed factors. Approximate 95% intervals use two-way clustering by war and faction.')
    return {'available': True, 'effects': effects, 'observations': n, 'wars': len(wars), 'factions': len(factions),
            'omitted': omitted, 'method': method + ' Attack totals, score, duration and roster counts use log(1+x). Effects compare the 25th and 75th percentiles. These are exploratory associations, not causal estimates; intervals are not adjusted for multiple comparisons.'}


def analyse_whole_wars(rows):
    from statistics import mean, median
    wars = whole_war_rows(rows)
    valued = [r for r in wars if r['gross_value'] is not None]
    model_rows = [r for r in valued if not r['audit_warnings']]
    pairs = sorted({(r['division'], r['opponent_division']) for r in valued})
    summaries = []
    for winner_division, loser_division in pairs:
        group = [r for r in valued if (r['division'], r['opponent_division']) == (winner_division, loser_division)]
        summaries.append({'winner_division': winner_division, 'loser_division': loser_division,
                          'n': len(group), 'median_value': median(r['gross_value'] for r in group), 'mean_value': mean(r['gross_value'] for r in group)})
    return {'eligible_wars': len(wars), 'valued_wars': len(valued), 'model_observations': len(model_rows),
            'mean_value': mean(r['gross_value'] for r in valued) if valued else None,
            'median_value': median(r['gross_value'] for r in valued) if valued else None,
            'summaries': summaries, 'model': fit_model(model_rows, whole_war=True), 'rows': wars}


def analyse(rows, audits, prices, date_range, collection=None):
    from statistics import mean, median
    from evidence import comparisons, coverage
    from graphs import graph_data
    counts = Counter(a['reason'] or 'eligible' for a in audits)
    valued = [r for r in rows if r['gross_value'] is not None]
    model_rows = [r for r in valued if not r['audit_warnings']]
    missing = sorted(set(name for r in rows for name in r['unpriced_items']))
    summaries = []
    for div in sorted(set(r['division'] for r in rows)):
        for won in (0, 1):
            group = [r for r in valued if r['division'] == div and r['won'] == won]
            if group:
                summaries.append({'division': div, 'won': won, 'n': len(group),
                                  'median_value': median(r['gross_value'] for r in group),
                                  'mean_value': mean(r['gross_value'] for r in group)})
    warnings = [
        'Member-list length is a roster proxy. Reports do not establish eligibility or recruit status; participation estimates remain provisional until checked against a known war.',
        'Attack totals are used exactly as reported. War-only hits, outside hits, assists and chain bonuses are not separately available here.',
        'Correlation does not establish that changing a factor changes rewards. There are no automatic hit targets or claimed participation caps.',
        'Both factions are observations from the same war. Opponent networks and changes over time can create dependencies beyond the uncertainty adjustment.',
        'Whole-war analysis counts each war once and sums both factions\' rewards using the same prices. If either side has unpriced rewards, the whole war is excluded from monetary analysis.',
        'Combined value is the gross reward pot before any agreement between factions. The API does not identify actual termed-war agreements or transfers. No expenses are deducted.',
    ]
    if missing:
        warnings.append('Unpriced reward items exclude affected observations from monetary analysis: '+', '.join(missing)+'.')
    mismatch = sum(bool(r['audit_warnings']) for r in rows)
    if mismatch:
        warnings.append(f'{mismatch} observations have inconsistent member totals and are excluded from adjusted analysis.')
    if rows and all(r['zero_attack_members'] == 0 for r in rows):
        warnings.append('Every listed member has attacks in every report. Check whether inactive members are missing before interpreting participation.')
    model = fit_model(model_rows)
    whole = analyse_whole_wars(rows)
    whole['comparisons'] = comparisons(whole['rows'], whole['model'], whole=True)
    whole['graphs'] = graph_data(whole['rows'], whole=True)
    return {'generated_at': dt.datetime.now(dt.timezone.utc).isoformat(), 'range': date_range,
            'scope': 'Both starting ranks Platinum; completed wars; no forfeits; gross cache value; no expense deductions.',
            'counts': dict(counts), 'eligible_wars': len({r['war_id'] for r in rows}),
            'observations': len(rows), 'valued_observations': len(valued), 'model_observations': len(model_rows),
            'distinct_factions': len({r['faction_id'] for r in rows}), 'prices': prices,
            'summaries': summaries, 'missing_prices': missing, 'warnings': warnings,
            'audit': audits, 'model': model, 'rows': rows, 'whole_war': whole,
            'coverage': coverage(rows, whole['rows'], audits, date_range, collection),
            'comparisons': comparisons(rows, model), 'graphs': graph_data(rows)}
