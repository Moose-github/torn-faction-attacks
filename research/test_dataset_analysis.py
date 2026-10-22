import copy
import json
import unittest

from dataset_analysis import DatasetAnalysis, build, compact_analysis
from test_analysis import report


class DatasetAnalysisTests(unittest.TestCase):
    def setUp(self):
        reports = [report(), report(), report()]
        for index, payload in enumerate(reports):
            payload['rankedwarreport']['id'] = index + 1
        reports[1]['rankedwarreport']['forfeit'] = True
        for faction in reports[2]['rankedwarreport']['factions']:
            faction['rank']['before'] = 'Gold III'
        self.dataset = {'format': 'ranked-research-dataset-v1', 'dataset': {
            'snapshot_token': 'snapshot', 'start': '2026-09-01', 'end': '2026-09-30',
            'collection': {'discovery_done': True, 'discovered_wars': 3, 'saved_reports': 3, 'pending_reports': 0},
        }, 'reports': reports}
        self.prices = {'Melee Cache': 100000000, 'Armor Cache': None}

    def test_paged_analysis_matches_offline_and_keeps_filtering(self):
        expected = build(self.dataset, self.prices)
        job = DatasetAnalysis(self.dataset['dataset'], self.prices)
        for payload in self.dataset['reports']:
            job.add([payload])
        actual = job.finish()
        actual['generated_at'] = expected['generated_at']
        self.assertEqual(actual, expected)
        self.assertEqual(actual['eligible_wars'], 1)
        self.assertEqual(actual['whole_war']['mean_value'], 300000000)
        compact = compact_analysis(actual)
        self.assertNotIn('rows', compact)
        self.assertNotIn('audit', compact)
        self.assertNotIn('rows', compact['whole_war'])
        self.assertIn('comparisons', compact)
        self.assertIn('graphs', compact['whole_war'])
        json.dumps(compact, allow_nan=False)

    def test_missing_page_cannot_produce_findings(self):
        job = DatasetAnalysis(self.dataset['dataset'], self.prices)
        job.add(self.dataset['reports'][:1])
        with self.assertRaisesRegex(ValueError, 'manifest does not match'):
            job.finish()

    def test_duplicates_across_pages_are_rejected(self):
        job = DatasetAnalysis(self.dataset['dataset'], self.prices)
        job.add(self.dataset['reports'][:1])
        with self.assertRaisesRegex(ValueError, 'Duplicate war'):
            job.add(self.dataset['reports'][:1])

    def test_invalid_prices_are_rejected_but_zero_and_unknown_are_allowed(self):
        for price in [-1, float('nan'), float('inf'), True, '100', 1e15]:
            with self.subTest(price=price), self.assertRaises(ValueError):
                DatasetAnalysis(self.dataset['dataset'], {'Melee Cache': price})
        result = build(self.dataset, {'Melee Cache': 0, 'Armor Cache': None})
        self.assertEqual(result['whole_war']['mean_value'], 0)

    def test_legacy_snapshot_without_manifest_still_works(self):
        dataset = copy.deepcopy(self.dataset)
        del dataset['dataset']['collection']
        self.assertEqual(build(dataset, self.prices)['eligible_wars'], 1)
