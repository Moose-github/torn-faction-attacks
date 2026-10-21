import copy
import json
import unittest

from analysis import whole_war_rows
from extraction import extract
from graphs import graph_data
from graphs_report import graphs_html
from test_analysis import report, synthetic_wars


class GraphTests(unittest.TestCase):
    def test_combined_and_faction_samples_preserve_their_units(self):
        rows, _ = extract(report(), {'Melee Cache': 100e6})
        faction = graph_data(rows)
        whole = graph_data(whole_war_rows(rows), whole=True)
        self.assertEqual((faction['observations'], faction['wars']), (2, 1))
        self.assertEqual((whole['observations'], whole['wars']), (1, 1))
        self.assertEqual(whole['points'][0]['value'], 300e6)
        self.assertEqual({d['label'] for d in faction['distributions']}, {'P2 / P2 · Win', 'P2 / P2 · Loss'})
        self.assertEqual(whole['distributions'][0]['label'], 'P2 / P2')
        rows[0]['gross_value'] = None
        self.assertEqual(graph_data(rows)['observations'], 1)
        self.assertEqual(graph_data(whole_war_rows(rows), True)['observations'], 0)
        rows[0]['gross_value'] = 200e6
        rows[0]['audit_warnings'] = ['Member totals disagree']
        self.assertEqual(graph_data(rows)['observations'], 1)
        self.assertEqual(graph_data(whole_war_rows(rows), True)['observations'], 0)

    def test_large_samples_are_repeatable_and_summaries_use_every_row(self):
        rows = synthetic_wars(5000)
        for r in rows:
            r.update(audit_warnings=[], won=1, opponent_score=100)
        result = graph_data(rows, True)
        self.assertEqual(result['points'], graph_data(list(reversed(rows)), True)['points'])
        self.assertEqual(len(result['points']), 1000)
        selected = {p['war_id'] for p in result['points']}
        omitted = next(r for r in rows if r['war_id'] not in selected)
        omitted['gross_value'] = 1e12
        result = graph_data(rows, True)
        self.assertEqual(result['value_range'][1], 1e12)
        self.assertLess(max(p['value'] for p in result['points']), 1e12)
        self.assertEqual(max(d['five_number'][4] for d in result['distributions']), 1e12)
        self.assertEqual(sum(d['n'] for d in result['distributions']), 5000)
        for f in result['factors']:
            self.assertEqual(sum(m['n'] for m in f['medians']), 5000)
        payload = json.dumps({'graphs': graph_data(rows), 'whole_war': {'graphs': result}}, indent=2, allow_nan=False)
        self.assertLess(len(payload.encode()), 1300000)  # Leaves room below the 1.5 MB upload limit.

    def test_quantiles_and_ties_have_known_values(self):
        rows = synthetic_wars(5)
        for i, r in enumerate(rows):
            r.update(audit_warnings=[], division=1, opponent_division=3, gross_value=i*100, attacks=0 if i < 3 else 10)
        result = graph_data(rows, True)
        self.assertEqual(result['distributions'], [{'label': 'P1 / P3', 'n': 5, 'wars': 5, 'five_number': [0, 100, 200, 300, 400]}])
        self.assertEqual(result['factors'][0]['medians'], [{'x': 0, 'y': 100, 'n': 3}, {'x': 10, 'y': 350, 'n': 2}])

    def test_empty_and_constant_samples_are_finite(self):
        empty = graph_data([], True)
        self.assertEqual(empty['points'], [])
        self.assertIn('No fully priced', graphs_html(empty, [], True))
        rows = synthetic_wars(4)
        for r in rows: r.update(audit_warnings=[], gross_value=0, attacks=0)
        result = graph_data(rows, True)
        self.assertEqual(result['value_range'], [0, 0])
        self.assertEqual(result['factors'][0]['medians'], [{'x': 0, 'y': 0, 'n': 4}])
        json.dumps(result, allow_nan=False)

    def test_offline_figures_are_embedded_accessible_and_escape_labels(self):
        try:
            from matplotlib import pyplot
        except ImportError:
            self.skipTest('Install research/requirements.txt for offline plot rendering')
        rows, _ = extract(report(), {'Melee Cache': 0})
        data = graph_data(rows)
        data['factors'] = [copy.deepcopy(data['factors'][0])]
        data['factors'][0]['label'] = '<script>bad()</script>'
        html = graphs_html(data, [])
        self.assertEqual(html.count('<svg '), 2)
        self.assertIn('role="img"', html)
        self.assertIn('&lt;script&gt;', html)
        self.assertNotIn('<script>bad()', html)
        self.assertIn('No adjusted estimates', html)
        self.assertEqual(pyplot.get_fignums(), [])


if __name__ == '__main__':
    unittest.main()
