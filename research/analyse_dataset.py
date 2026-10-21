"""Analyse a frozen Cloudflare export offline. Never calls Torn."""
import argparse
import json
from pathlib import Path

from analysis import analyse
from extraction import CACHES, extract, date_bounds
from report import render


def build(dataset, prices):
    if dataset.get('format') != 'ranked-research-dataset-v1':
        raise ValueError('Choose a frozen dataset exported from Admin > War research.')
    meta = dataset['dataset']
    if not meta.get('snapshot_token'):
        raise ValueError('Dataset has no frozen snapshot identifier.')
    lower, upper = date_bounds(meta['start'], meta['end'])
    collection = meta.get('collection')
    if collection is not None:
        if (not isinstance(collection, dict) or type(collection.get('discovery_done')) is not bool
                or any(type(collection.get(k)) is not int or collection[k] < 0 for k in ('discovered_wars', 'saved_reports', 'pending_reports'))
                or collection['saved_reports'] + collection['pending_reports'] != collection['discovered_wars']
                or collection['saved_reports'] != len(dataset['reports'])):
            raise ValueError('Collection manifest does not match the frozen export. Download all export pages again.')
        if (any(type(collection.get(k, 0)) is not int or collection.get(k, 0) < 0 for k in ('deferred_reports', 'failed_reports'))
                or collection.get('deferred_reports', 0) + collection.get('failed_reports', 0) > collection['pending_reports']):
            raise ValueError('Invalid unresolved report counts in collection manifest.')
    for name, price in prices.items():
        if price is not None and (isinstance(price, bool) or not isinstance(price, (int, float)) or not 0 <= price < 1e15):
            raise ValueError(f'Invalid full-dollar cache price for {name}.')
    rows, audits, seen = [], [], set()
    for payload in dataset['reports']:
        war_id = payload.get('rankedwarreport', {}).get('id')
        if war_id in seen:
            raise ValueError(f'Duplicate war {war_id} in frozen dataset.')
        seen.add(war_id)
        try:
            if not lower <= payload['rankedwarreport']['start'] <= upper:
                raise ValueError('Report is outside the selected date range.')
            extracted, audit = extract(payload, prices)
            rows.extend(extracted)
            audits.append(audit)
        except (ValueError, TypeError, KeyError, AttributeError) as error:
            audits.append({'war_id': war_id, 'reason': 'invalid_report', 'warnings': [str(error)]})
    result = analyse(rows, audits, prices, {'start': meta['start'], 'end': meta['end']}, collection)
    result['warnings'].append('This is a finite historical sample. A budget-limited collection can overrepresent the beginning of its date range; check coverage before generalising.')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('dataset', nargs='?')
    parser.add_argument('--prices', help='JSON object mapping cache names to full-dollar values')
    args = parser.parse_args()
    path = Path((args.dataset or input('Frozen dataset file (you can drag it here): ')).strip().strip('"'))
    dataset = json.loads(path.read_text(encoding='utf-8-sig'))
    if args.prices:
        prices = json.loads(Path(args.prices).read_text(encoding='utf-8-sig'))
    else:
        print('Enter full dollar values, e.g. 144000000 for $144m. Leave blank if unknown.')
        prices = {}
        for cache in CACHES:
            value = input(f'{cache}: ').replace(',', '').strip()
            prices[cache] = float(value) if value else None
    result = build(dataset, prices)
    output = path.parent / (path.stem + '-analysis')
    output.mkdir(exist_ok=True)
    (output / 'report.html').write_text(render(result), encoding='utf-8')
    (output / 'full-analysis.json').write_text(json.dumps(result, indent=2, allow_nan=False), encoding='utf-8')
    compact = {key: value for key, value in result.items() if key not in ('rows', 'audit')}
    compact['whole_war'] = {key: value for key, value in result['whole_war'].items() if key != 'rows'}
    upload = {'snapshot_token': dataset['dataset']['snapshot_token'], 'result': compact}
    (output / 'upload-analysis.json').write_text(json.dumps(upload, indent=2, allow_nan=False), encoding='utf-8')
    print(f"Saved {output / 'report.html'}")
    print(f"Upload {output / 'upload-analysis.json'} in Admin > War research.")


if __name__ == '__main__':
    main()
