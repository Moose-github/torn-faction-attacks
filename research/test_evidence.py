import copy
import json
import math
import random
import unittest

from analyse_dataset import build
from analysis import analyse, fit_model
from evidence import comparisons, observed_trend
from extraction import extract
from report import render
from test_analysis import report, synthetic_wars


def dataset(reports, collection=None):
    return {'format': 'ranked-research-dataset-v1', 'dataset': {'snapshot_token': 'sample', 'start': '2026-09-01',
            'end': '2026-09-30', 'collection': collection}, 'reports': reports}


class EvidenceTests(unittest.TestCase):
    def test_overlap_alone_preserves_a_stable_positive_or_negative_adjusted_association(self):
        for direction in (1, -1):
            rng = random.Random(171)
            rows = synthetic_wars()
            for r in rows:
                r['score'] = r['attacks'] * rng.uniform(.95, 1.05)
                r['gross_value'] = (2000 + direction * 60 * math.log1p(r['score']) + 200*r['participation_rate'] + rng.gauss(0, .1))*1e6
                r['audit_warnings'] = []
            model = fit_model(rows, whole_war=True)
            effect = next(e for e in model['effects'] if e['field'] == 'score')
            self.assertGreater(effect['vif'], 10)
            self.assertEqual(effect['status'], 'Association with overlapping factors')
            card = next(c for c in comparisons(rows, model, True) if c['field'] == 'score')
            self.assertEqual(card['status'], ('Positive' if direction == 1 else 'Negative')+' association; overlapping factors')
            self.assertEqual(card['adjusted']['overlap_vif'], effect['vif'])
            self.assertGreater(effect['interval_m'][0]*direction if direction == 1 else effect['interval_m'][1]*direction, 0)

    def test_observed_trend_remains_separate_when_adjusted_results_are_unavailable(self):
        rows = synthetic_wars(80)
        for i, r in enumerate(rows):
            r.update(score=i, gross_value=i*1e6, audit_warnings=[])
        card = next(c for c in comparisons(rows, {'available': False, 'reason': 'Too few wars'}, True) if c['field'] == 'score')
        self.assertEqual(card['observed']['status'], 'Positive observed trend')
        self.assertEqual(card['status'], 'Insufficient data')
        self.assertIsNone(card['adjusted'])
        for r in rows: r['war_id'] //= 4
        card = next(c for c in comparisons(rows, {'available': False}, True) if c['field'] == 'score')
        self.assertEqual(card['observed']['status'], 'Limited observations')

    def test_observed_labels_distinguish_negative_flat_and_conflicting_summaries(self):
        groups = [{'wars': 20, 'mean_value': v, 'median_value': v} for v in (4, 3, 2, 1)]
        self.assertEqual(observed_trend(groups)['status'], 'Negative observed trend')
        for g in groups: g.update(mean_value=1, median_value=1)
        self.assertEqual(observed_trend(groups)['status'], 'No consistent observed trend')
        for i, g in enumerate(groups): g.update(mean_value=i, median_value=4-i)
        self.assertEqual(observed_trend(groups)['status'], 'No consistent observed trend')
        self.assertEqual(observed_trend(groups, True)['status'], 'Category comparison')

    def test_fixed_score_bands_keep_boundaries_empty_ranges_and_sparse_tails(self):
        rows = synthetic_wars(6)
        for r, score in zip(rows, [0, 5000, 19999, 20000, 50000, 71075]):
            r.update(score=score, gross_value=score*1e6, audit_warnings=[])
        card = next(c for c in comparisons(rows, {'available': False}, True) if c['field'] == 'score')
        bands = card['score_bands']
        self.assertEqual([b['n'] for b in bands], [1, 1, 0, 1, 1, 0, 0, 0, 2])
        self.assertIsNone(bands[2]['median_value'])
        self.assertIsNone(bands[2]['middle_half'])
        self.assertEqual(bands[4]['median_value'], 20000e6)
        self.assertIsNone(bands[-1]['high'])
        self.assertEqual(bands[-1]['wars'], 2)
        self.assertEqual(bands[-1]['median_value'], (50000+71075)*.5e6)

    def test_coverage_counts_excluded_wars_and_empty_weeks_without_double_counting(self):
        eligible = report()
        forfeit = copy.deepcopy(eligible); forfeit['rankedwarreport'].update(id=2, forfeit=True)
        gold = copy.deepcopy(eligible); gold['rankedwarreport']['id'] = 3
        gold['rankedwarreport']['factions'][0]['rank']['before'] = 'Gold I'
        collection = {'discovery_done': False, 'discovered_wars': 5, 'saved_reports': 3, 'pending_reports': 2}
        result = build(dataset([eligible, forfeit, gold], collection), {'Melee Cache': 100e6})
        c = result['coverage']
        self.assertEqual((c['saved_reports'], c['eligible_wars'], c['distinct_factions']), (3, 1, 2))
        self.assertEqual(len(c['weeks']), 5)
        self.assertEqual(c['weeks'][0], {'start': '2026-09-01', 'end': '2026-09-06', 'saved': 3, 'eligible': 1, 'valued': 1, 'factions': 2})
        self.assertEqual(c['weeks'][-1]['saved'], 0)
        self.assertEqual(c['division_pairs'], [{'winner_division': 2, 'loser_division': 2, 'wars': 1}])
        self.assertEqual(c['rosters'][0]['observations'], 2)
        self.assertEqual(c['rosters'][0]['wars'], 1)
        self.assertIn('Discovery did not finish', ' '.join(c['warnings']))
        self.assertEqual(c['collection'], collection)

    def test_old_exports_and_empty_samples_do_not_claim_complete_coverage(self):
        result = build(dataset([]), {})
        self.assertIsNone(result['coverage']['collection'])
        self.assertIsNone(result['coverage']['first_saved'])
        self.assertTrue(all(w['eligible'] == 0 for w in result['coverage']['weeks']))
        self.assertTrue(all(c['status'] == 'Insufficient data' for c in result['comparisons']))
        self.assertIn('completeness is unknown', ' '.join(result['coverage']['warnings']))
        json.dumps(result, allow_nan=False)

    def test_incomplete_download_is_rejected_against_freeze_manifest(self):
        with self.assertRaisesRegex(ValueError, 'manifest'):
            build(dataset([report()], {'discovery_done': True, 'discovered_wars': 2, 'saved_reports': 2, 'pending_reports': 0}), {})

    def test_unresolved_reports_remain_visible_in_frozen_coverage(self):
        manifest = {'discovery_done': True, 'discovered_wars': 4, 'saved_reports': 1, 'pending_reports': 3,
                    'deferred_reports': 1, 'failed_reports': 2}
        result = build(dataset([report()], manifest), {'Melee Cache': 100e6})
        self.assertIn('1 reports were awaiting retry and 2 had reached', ' '.join(result['coverage']['warnings']))
        self.assertEqual(result['coverage']['collection'], manifest)
        manifest['failed_reports'] = 3
        with self.assertRaisesRegex(ValueError, 'unresolved'):
            build(dataset([report()], manifest), {})

    def test_missing_prices_and_bad_totals_are_excluded_from_comparisons(self):
        p = report(); p['rankedwarreport']['factions'][1]['rewards']['items'][0]['name'] = 'Armor Cache'
        result = build(dataset([p]), {'Melee Cache': 100e6})
        self.assertEqual(result['comparisons'][0]['observations'], 1)
        self.assertEqual(result['whole_war']['comparisons'][0]['observations'], 0)
        self.assertEqual(result['coverage']['valued_wars'], 0)
        p = report(); p['rankedwarreport']['factions'][0]['attacks'] += 1
        result = build(dataset([p]), {'Melee Cache': 100e6})
        self.assertEqual(result['coverage']['valued_wars'], 1)
        self.assertEqual(result['coverage']['model_wars'], 0)
        self.assertEqual(result['comparisons'][0]['observations'], 1)

    def test_ties_are_not_split_or_duplicated_and_zero_baseline_has_no_percentage(self):
        rows = synthetic_wars(8)
        for i, row in enumerate(rows):
            row.update(attacks=0 if i < 6 else 10, gross_value=0 if i < 6 else 100e6, audit_warnings=[])
        cards = comparisons(rows, {'available': False, 'reason': 'Small sample'}, whole=True)
        attack = cards[0]
        self.assertEqual([g['n'] for g in attack['groups']], [6, 2])
        self.assertEqual(attack['observed_difference'], 100e6)
        self.assertIsNone(attack['observed_percent'])
        self.assertEqual(attack['status'], 'Insufficient data')
        for card in cards:
            self.assertEqual(sum(g['n'] for g in card['groups']), 8)

    def test_evidence_exposes_roster_effects_and_adjusted_percent_denominator(self):
        rows = synthetic_wars()
        for row in rows: row['audit_warnings'] = []
        model = fit_model(rows, whole_war=True)
        self.assertIn('listed_members', [e['field'] for e in model['effects']])
        cards = {c['field']: c for c in comparisons(rows, model, whole=True)}
        card = cards['participation_rate']
        self.assertEqual((card['observations'], card['wars'], card['factions']), (600, 600, 50))
        average = sum(r['gross_value'] for r in rows) / len(rows)
        self.assertAlmostEqual(card['adjusted']['percent_of_mean'], 100*card['adjusted']['difference']/average)
        self.assertEqual(cards['division']['status'], 'Descriptive comparison')
        self.assertIsNone(cards['division']['adjusted'])
        json.dumps(cards, allow_nan=False)

    def test_mixed_evidence_is_distinct_from_unavailable_checks(self):
        rows = synthetic_wars()
        for row in rows: row['audit_warnings'] = []
        model = fit_model(rows, whole_war=True)
        effect = model['effects'][0]
        effect.update(status='Uncertain', stable_halves=False)
        self.assertEqual(comparisons(rows, model, True)[0]['status'], 'Mixed evidence')
        effect.update(stable_halves=None, sensitive_to_top_faction=None)
        card = comparisons(rows, model, True)[0]
        self.assertEqual(card['status'], 'Uncertain')
        self.assertIsNone(card['adjusted']['sensitive_to_top_faction'])

    def test_html_includes_new_sections_and_escapes_names(self):
        p = report(); p['rankedwarreport']['factions'][0]['name'] = '<script>bad()</script>'
        result = build(dataset([p]), {'Melee Cache': 100e6})
        output = render(result)
        for expected in ('Sample coverage', 'Weekly coverage', 'Are more reported attacks', 'Insufficient data', '&lt;script&gt;'):
            self.assertIn(expected, output)
        self.assertNotIn('<script>bad()', output)

    def test_out_of_range_report_is_not_used_in_evidence(self):
        p = report(); p['rankedwarreport']['start'] -= 86400
        result = build(dataset([p]), {'Melee Cache': 100e6})
        self.assertEqual(result['coverage']['eligible_wars'], 0)
        self.assertEqual(result['counts']['invalid_report'], 1)


if __name__ == '__main__':
    unittest.main()
