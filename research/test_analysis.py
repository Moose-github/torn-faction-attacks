import copy
import json
import math
import random
import unittest

from analysis import analyse, dyadic_meat, fit_model, whole_war_rows
from extraction import extract, platinum_division, platinum_label
from report import render


def report():
    factions = []
    for i, hits in enumerate(([10, 0], [3, 3, 4, 0])):
        factions.append({'id': i + 1, 'name': f'Faction {i}', 'rank': {'before': 'Platinum II', 'after': 'Platinum II'},
                         'attacks': sum(hits), 'score': sum(hits),
                         'members': [{'id': i * 10 + j, 'name': 'Member', 'attacks': h, 'score': h} for j, h in enumerate(hits)],
                         'rewards': {'points': 0, 'respect': 10, 'items': [{'id': 1, 'name': 'Melee Cache', 'quantity': 2-i}]}})
    return {'rankedwarreport': {'id': 1, 'start': 1788220800, 'end': 1788224400, 'winner': 1, 'forfeit': False, 'factions': factions}}


def synthetic_wars(n=600):
    rng = random.Random(2026)
    rows = []
    for wid in range(n):
        a, b = rng.sample(range(50), 2)
        attacks, breadth = rng.uniform(50, 2000), rng.uniform(.1, 1)
        rows.append({'war_id': wid, 'faction_id': a, 'opponent_id': b, 'start': wid,
                     'date': '2026-09-05' if wid < n//2 else '2026-10-05',
                     'month': '2026-09' if wid < n//2 else '2026-10',
                     'attacks': attacks, 'score': rng.uniform(100, 8000), 'participation_rate': breadth,
                     'top20_attack_share': rng.uniform(.25, .95), 'duration_hours': rng.uniform(2, 80),
                     'attack_balance': rng.uniform(0, .5), 'score_balance': rng.uniform(0, .5),
                     'listed_members': rng.randint(20, 150), 'roster_balance': rng.uniform(.1, .5),
                     'division': rng.randint(1, 4), 'opponent_division': rng.randint(1, 4),
                     'gross_value': (100 + 40*math.log1p(attacks) + 200*breadth + rng.gauss(0, 3))*1e6})
    return rows


class WholeWarTests(unittest.TestCase):
    def test_unsuffixed_platinum_is_a_distinct_base_division_through_analysis(self):
        payload = report()
        payload['rankedwarreport']['factions'][0]['rank']['before'] = 'Platinum'
        payload['rankedwarreport']['factions'][1]['rank']['before'] = 'Platinum I'
        rows, audit = extract(payload, {'Melee Cache': 100})
        self.assertIsNone(audit['reason'])
        self.assertEqual([r['division'] for r in rows], [0, 1])
        self.assertEqual(rows[0]['rank_before'], 'Platinum')
        self.assertEqual(platinum_division(' Platinum '), 0)
        self.assertIsNone(platinum_division('Platinum V'))
        self.assertEqual(platinum_label(0), 'Platinum')
        result = analyse(rows, [audit], {}, {'start': '2026-09-01', 'end': '2026-09-30'})
        self.assertEqual(result['eligible_wars'], 1)
        self.assertEqual(result['coverage']['division_pairs'], [{'winner_division': 0, 'loser_division': 1, 'wars': 1}])
        divisions = next(c for c in result['comparisons'] if c['field'] == 'division')
        self.assertEqual([g['label'] for g in divisions['groups']], ['Platinum', 'Platinum 1'])
        self.assertEqual(result['whole_war']['graphs']['distributions'][0]['label'], 'P base / P1')
        rendered = render(result)
        self.assertIn('<td>Platinum</td>', rendered)
        self.assertNotIn('Platinum 0', rendered)

    def test_combined_value_is_counted_once_and_participation_is_weighted(self):
        rows, _ = extract(report(), {'Melee Cache': 100e6})
        wars = whole_war_rows(rows)
        self.assertEqual(len(wars), 1)
        self.assertEqual(wars[0]['gross_value'], 300e6)
        self.assertEqual(wars[0]['cache_quantities'], {'Melee Cache': 3})
        self.assertAlmostEqual(wars[0]['participation_rate'], 4/6)
        self.assertEqual(wars[0]['attacks'], 20)
        self.assertEqual(wars[0]['attack_balance'], .5)
        self.assertEqual(wars[0]['top20_attack_share'], .7)
        self.assertEqual(wars, whole_war_rows(list(reversed(rows))))

    def test_partial_pricing_never_becomes_a_partial_pot(self):
        payload = report()
        payload['rankedwarreport']['factions'][1]['rewards']['items'][0]['name'] = 'Armor Cache'
        rows, audit = extract(payload, {'Melee Cache': 100e6})
        result = analyse(rows, [audit], {}, {'start': '2026-09-01', 'end': '2026-10-20'})
        self.assertEqual(result['valued_observations'], 1)
        self.assertEqual(result['whole_war']['valued_wars'], 0)
        self.assertIsNone(result['whole_war']['median_value'])
        self.assertIsNone(result['whole_war']['rows'][0]['gross_value'])

    def test_zero_rewards_are_zero_and_a_bad_side_excludes_whole_model_observation(self):
        payload = report()
        for faction in payload['rankedwarreport']['factions']:
            faction['rewards']['items'] = []
        payload['rankedwarreport']['factions'][1]['attacks'] += 1
        rows, audit = extract(payload)
        result = analyse(rows, [audit], {}, {'start': '2026-09-01', 'end': '2026-10-20'})
        self.assertEqual(result['whole_war']['median_value'], 0)
        self.assertEqual(result['whole_war']['valued_wars'], 1)
        self.assertEqual(result['whole_war']['model_observations'], 0)

    def test_incomplete_duplicate_and_inconsistent_pairs_are_rejected(self):
        rows, _ = extract(report(), {'Melee Cache': 100e6})
        for broken in (rows[:1], rows + rows, [rows[0], rows[0]]):
            with self.assertRaises(ValueError): whole_war_rows(broken)
        changed = copy.deepcopy(rows); changed[0]['opponent_id'] = 99
        with self.assertRaises(ValueError): whole_war_rows(changed)

    def test_shared_faction_covariance_counts_repeated_and_reversed_pairs_once(self):
        import numpy as np
        pairs = [(1, 2), (2, 3), (2, 1), (4, 5), (1, 4)]
        scores = np.array([[1, 2], [3, -1], [2, 4], [0, 2], [1, -3]], dtype=float)
        direct = sum((np.outer(scores[i], scores[j]) for i in range(5) for j in range(5) if set(pairs[i]) & set(pairs[j])), np.zeros((2, 2)))
        np.testing.assert_allclose(dyadic_meat(scores, pairs), direct)

    def test_whole_model_detects_invented_signal_and_preserves_one_row_per_war(self):
        result = fit_model(synthetic_wars(), whole_war=True)
        self.assertTrue(result['available'], result)
        self.assertEqual(result['observations'], 600)
        effects = {e['field']: e for e in result['effects']}
        self.assertGreater(effects['participation_rate']['effect_m'], 70)
        self.assertTrue(effects['participation_rate']['stable_halves'])
        self.assertLess(abs(effects['score']['effect_m']), 5)
        self.assertIn('either faction', result['method'])
        with self.assertRaises(ValueError): fit_model(synthetic_wars() * 2, whole_war=True)

    def test_whole_model_keeps_sample_and_era_gates(self):
        self.assertFalse(fit_model(synthetic_wars(20), whole_war=True)['available'])
        rows = synthetic_wars(); rows[0]['date'] = '2026-08-17'
        self.assertFalse(fit_model(rows, whole_war=True)['available'])

    def test_faction_model_is_still_available(self):
        rows = synthetic_wars()
        for r in rows:
            r.update(won=r['war_id'] % 2, opponent_score=r['score_balance']*100, opponent_listed_members=round(r['roster_balance']*200))
        result = fit_model(rows)
        self.assertTrue(result['available'], result)
        self.assertIn('faction gross cache value', result['method'])

    def test_report_shows_combined_value_without_split_calculator(self):
        rows, audit = extract(report(), {'Melee Cache': 100e6})
        result = analyse(rows, [audit], {'Melee Cache': 100e6}, {'start': '2026-09-01', 'end': '2026-10-20'})
        output = render(result)
        self.assertIn('Median combined pot: $300.00m', output)
        self.assertIn('Each war is counted once', output)
        self.assertIn('Individual faction rewards', output)
        self.assertNotIn('50/50', output)
        json.dumps(result, allow_nan=False)


if __name__ == '__main__':
    unittest.main()
