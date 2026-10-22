"""Shared incremental dataset analysis for the browser and offline CLI."""
from analysis import analyse
from extraction import extract, date_bounds


class DatasetAnalysis:
    def __init__(self, meta, prices):
        if not meta.get('snapshot_token'):
            raise ValueError('Freeze this dataset before analysing it.')
        self.meta = meta
        self.lower, self.upper = date_bounds(meta['start'], meta['end'])
        self.collection = meta.get('collection')
        c = self.collection
        if c is not None:
            if (not isinstance(c, dict) or type(c.get('discovery_done')) is not bool
                    or any(type(c.get(k)) is not int or c[k] < 0 for k in ('discovered_wars', 'saved_reports', 'pending_reports'))
                    or c['saved_reports'] + c['pending_reports'] != c['discovered_wars']):
                raise ValueError('Invalid frozen collection manifest.')
            if (any(type(c.get(k, 0)) is not int or c.get(k, 0) < 0 for k in ('deferred_reports', 'failed_reports'))
                    or c.get('deferred_reports', 0) + c.get('failed_reports', 0) > c['pending_reports']):
                raise ValueError('Invalid unresolved report counts in collection manifest.')
        for name, price in prices.items():
            if price is not None and (isinstance(price, bool) or not isinstance(price, (int, float)) or not 0 <= price < 1e15):
                raise ValueError(f'Invalid full-dollar cache price for {name}.')
        self.prices, self.rows, self.audits, self.seen = prices, [], [], set()

    def add(self, reports):
        for payload in reports:
            war_id = payload.get('rankedwarreport', {}).get('id')
            if war_id in self.seen:
                raise ValueError(f'Duplicate war {war_id} in frozen dataset.')
            self.seen.add(war_id)
            try:
                if not self.lower <= payload['rankedwarreport']['start'] <= self.upper:
                    raise ValueError('Report is outside the selected date range.')
                rows, audit = extract(payload, self.prices)
                self.rows.extend(rows)
                self.audits.append(audit)
            except (ValueError, TypeError, KeyError, AttributeError) as error:
                self.audits.append({'war_id': war_id, 'reason': 'invalid_report', 'warnings': [str(error)]})

    def finish(self):
        if self.collection is not None and self.collection['saved_reports'] != len(self.seen):
            raise ValueError('Collection manifest does not match the loaded reports. Load all export pages again.')
        result = analyse(self.rows, self.audits, self.prices, {'start': self.meta['start'], 'end': self.meta['end']}, self.collection)
        result['warnings'].append('This is a finite historical sample. A budget-limited collection can overrepresent the beginning of its date range; check coverage before generalising.')
        return result


def compact_analysis(result):
    compact = {key: value for key, value in result.items() if key not in ('rows', 'audit')}
    compact['whole_war'] = {key: value for key, value in result['whole_war'].items() if key != 'rows'}
    return compact


def build(dataset, prices):
    if dataset.get('format') != 'ranked-research-dataset-v1':
        raise ValueError('Choose a frozen dataset exported from Admin > War research.')
    job = DatasetAnalysis(dataset['dataset'], prices)
    job.add(dataset['reports'])
    return job.finish()
