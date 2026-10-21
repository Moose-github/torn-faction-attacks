"""Compact chart data. Summaries use the full priced, audited sample."""
import hashlib
from bisect import bisect_left
from collections import defaultdict
from statistics import median
from evidence import quantile

MAX_DOTS = 1000


def graph_data(rows, whole=False):
    sample = [r for r in rows if r['gross_value'] is not None and not r['audit_warnings']]
    fields = [('attacks', 'Reported attacks', 'attacks'), ('score', 'War score', 'score'),
              ('participation_rate', 'Participation', 'share (0–1)'),
              ('top20_attack_share', 'Attack concentration', 'share (0–1)'),
              ('duration_hours', 'War duration', 'hours'), ('listed_members', 'Listed roster size', 'members')]
    fields += [('attack_balance', 'Attack balance', 'smaller share (0–0.5)'), ('score_balance', 'Score balance', 'smaller share (0–0.5)')] if whole else [('opponent_score', 'Opponent score', 'score')]
    factors = []
    for field, label, unit in fields:
        values = [r[field] for r in sample]
        groups = []
        if values:
            cuts = sorted(set(quantile(values, q) for q in (.25, .5, .75)))
            partitions = defaultdict(list)
            for r in sample:
                partitions[bisect_left(cuts, r[field])].append(r)
            groups = [{'x': median(r[field] for r in g), 'y': median(r['gross_value'] for r in g), 'n': len(g)}
                      for _, g in sorted(partitions.items())]
        factors.append({'field': field, 'label': label, 'unit': unit,
                        'range': [min(values), max(values)] if values else [0, 0], 'medians': groups})
    # Stable hash selection avoids privileging early dates and remains repeatable
    # if the same frozen export is supplied in a different order.
    def order(row):
        identity = f"{row['war_id']}:{row['faction_id']}"
        return hashlib.sha256(identity.encode()).digest(), identity
    selected = sorted(sample, key=order)[:MAX_DOTS]
    points = [{'war_id': r['war_id'], 'faction_id': r['faction_id'], 'value': r['gross_value'],
               'values': [r[field] for field, _, _ in fields]} for r in selected]
    groups = defaultdict(list)
    for r in sample:
        groups[(r['division'], r['opponent_division'], None if whole else r['won'])].append(r)
    distributions = []
    for (a, b, won), group in sorted(groups.items()):
        values = [r['gross_value'] for r in group]
        distributions.append({'label': f'{"P base" if a == 0 else f"P{a}"} / {"P base" if b == 0 else f"P{b}"}' + ('' if whole else (' · Win' if won else ' · Loss')),
                              'n': len(group), 'wars': len({r['war_id'] for r in group}),
                              'five_number': [quantile(values, q) for q in (0, .25, .5, .75, 1)]})
    return {'observations': len(sample), 'wars': len({r['war_id'] for r in sample}),
            'value_range': [min(r['gross_value'] for r in sample), max(r['gross_value'] for r in sample)] if sample else [0, 0],
            'factors': factors, 'points': points, 'distributions': distributions}
