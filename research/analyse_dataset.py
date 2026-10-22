"""Analyse a frozen Cloudflare export offline. Never calls Torn."""
import argparse
import json
from pathlib import Path

from dataset_analysis import build, compact_analysis
from extraction import CACHES
from report import render


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
    compact = compact_analysis(result)
    upload = {'snapshot_token': dataset['dataset']['snapshot_token'], 'result': compact}
    (output / 'upload-analysis.json').write_text(json.dumps(upload, indent=2, allow_nan=False), encoding='utf-8')
    print(f"Saved {output / 'report.html'}")
    print(f"Upload {output / 'upload-analysis.json'} in Admin > War research.")


if __name__ == '__main__':
    main()
