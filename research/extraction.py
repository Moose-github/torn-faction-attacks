"""Auditable report extraction for offline research. No network access."""
from __future__ import annotations

import datetime as dt
import math
import re
from collections import Counter

UTC = dt.timezone.utc
CACHES = ('Melee Cache', 'Small Arms Cache', 'Medium Arms Cache', 'Heavy Arms Cache', 'Armor Cache')


def now():
    return dt.datetime.now(UTC).isoformat()


def date_bounds(start, end):
    a = dt.datetime.combine(dt.date.fromisoformat(start), dt.time(), UTC)
    b = dt.datetime.combine(dt.date.fromisoformat(end) + dt.timedelta(days=1), dt.time(), UTC)
    if a >= b or a.date() < dt.date(2025, 5, 21):
        raise ValueError('Choose an ordered date range starting on or after 21 May 2025.')
    return int(a.timestamp()), int(b.timestamp()) - 1


def number(value, label, integer=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
        raise ValueError(f'Invalid or missing {label}.')
    if integer and int(value) != value:
        raise ValueError(f'{label} must be an integer.')
    return int(value) if integer else float(value)


def platinum_division(rank):
    match = re.fullmatch(r'Platinum\s+(IV|III|II|I|[1-4])', str(rank).strip(), re.I)
    if not match:
        return None
    return {'I': 1, 'II': 2, 'III': 3, 'IV': 4}.get(match[1].upper(), int(match[1]) if match[1].isdigit() else None)


def extract(payload, prices=None):
    """Never replace absent observations/prices with zero. Returns rows + audit."""
    prices = prices or {}
    report = payload.get('rankedwarreport')
    if not isinstance(report, dict):
        raise ValueError('Expected the API v2 rankedwarreport object.')
    war_id = number(report.get('id'), 'war id', True)
    start = number(report.get('start'), 'start', True)
    end = number(report.get('end'), 'end', True)
    if type(report.get('forfeit')) is not bool:
        raise ValueError('Missing or invalid forfeit flag.')
    audit = {'war_id': war_id, 'date': dt.datetime.fromtimestamp(start, UTC).date().isoformat(), 'reason': None, 'warnings': []}
    if not end or end <= start:
        audit['reason'] = 'unfinished'
        return [], audit
    if report['forfeit']:
        audit['reason'] = 'forfeit'
        return [], audit
    factions = report.get('factions')
    if not isinstance(factions, list) or len(factions) != 2:
        raise ValueError('Expected exactly two factions.')
    ids = [number(f.get('id'), 'faction id', True) for f in factions]
    if len(set(ids)) != 2 or report.get('winner') not in ids:
        raise ValueError('Invalid faction IDs or winner.')
    ranks = [f.get('rank', {}).get('before') for f in factions]
    if any(not isinstance(r, str) for r in ranks):
        raise ValueError('Missing starting rank.')
    if any(not r.strip().lower().startswith('platinum') for r in ranks):
        audit['reason'] = 'not_platinum_vs_platinum'
        return [], audit
    divisions = [platinum_division(r) for r in ranks]
    if any(d is None for d in divisions):
        raise ValueError('Unrecognized Platinum division; inspect the raw report.')
    rows = []
    for i, f in enumerate(factions):
        attacks = number(f.get('attacks'), 'faction attacks', True)
        score = number(f.get('score'), 'faction score')
        members = f.get('members')
        if not isinstance(members, list) or not members:
            raise ValueError('Missing member list.')
        member_ids = [number(m.get('id'), 'member id', True) for m in members]
        if len(set(member_ids)) != len(member_ids):
            raise ValueError('Duplicate member IDs.')
        hits = [number(m.get('attacks'), 'member attacks', True) for m in members]
        scores = [number(m.get('score'), 'member score') for m in members]
        rewards = f.get('rewards')
        if not isinstance(rewards, dict) or not isinstance(rewards.get('items'), list):
            raise ValueError('Missing reward items.')
        if number(rewards.get('points'), 'reward points', True) > 0:
            audit['reason'] = 'legacy_points_rewards'
            return [], audit
        quantities = Counter()
        reward_ids = {}
        for item in rewards['items']:
            name = item.get('name')
            if not isinstance(name, str) or not name:
                raise ValueError('Missing reward item name.')
            quantities[name] += number(item.get('quantity'), 'reward quantity', True)
            reward_ids[name] = number(item.get('id'), 'reward item id', True)
        missing = [name for name, count in quantities.items() if count and (name not in prices or prices[name] is None)]
        value = None if missing else sum(count * number(prices[name], 'cache price') for name, count in quantities.items() if count)
        warnings = []
        if sum(hits) != attacks:
            warnings.append('Member attack sum differs from faction attack total.')
        if abs(sum(scores) - score) > max(2, len(members) * 0.02):
            warnings.append('Member score sum differs from faction score total.')
        n = len(members)
        active = sum(h > 0 for h in hits)
        rows.append({
            'war_id': war_id, 'faction_id': ids[i], 'faction_name': str(f.get('name', ids[i])),
            'opponent_id': ids[1-i], 'start': start, 'end': end,
            'month': dt.datetime.fromtimestamp(start, UTC).strftime('%Y-%m'),
            'date': dt.datetime.fromtimestamp(start, UTC).date().isoformat(),
            'division': divisions[i], 'rank_before': ranks[i], 'rank_after': f.get('rank', {}).get('after'),
            'opponent_division': divisions[1-i],
            'won': int(ids[i] == report['winner']), 'attacks': attacks, 'score': score,
            'listed_members': n, 'active_attack_members': active,
            'scoring_members': sum(s > 0 for s in scores), 'zero_attack_members': n-active,
            'participation_rate': active/n,
            'top20_attack_share': sum(sorted(hits, reverse=True)[:max(1, math.ceil(n*.2))])/sum(hits) if sum(hits) else 0,
            'duration_hours': (end-start)/3600,
            'opponent_score': number(factions[1-i].get('score'), 'opponent score'),
            'opponent_attacks': number(factions[1-i].get('attacks'), 'opponent attacks', True),
            'opponent_listed_members': len(factions[1-i].get('members', [])),
            'cache_quantities': dict(quantities), 'reward_item_ids': reward_ids,
            'gross_value': value, 'unpriced_items': missing, 'audit_warnings': warnings,
            'member_attacks_sum': sum(hits), 'member_scores_sum': sum(scores),
        })
        audit['warnings'].extend(f'{ids[i]}: {w}' for w in warnings)
    return rows, audit
