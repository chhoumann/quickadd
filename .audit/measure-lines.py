#!/usr/bin/env python3
"""Count all tracked UTF-8 text, including moved files and new helpers."""
import argparse
import io
import json
import re
import subprocess
import tarfile


def measure(revision):
    data = subprocess.check_output(['git', 'archive', revision])
    totals = {name: {'files': 0, 'lines': 0, 'nonblank': 0, 'bytes': 0}
              for name in ('production', 'tests', 'other', 'tracked_text')}
    largest = []
    with tarfile.open(fileobj=io.BytesIO(data)) as archive:
        for member in archive:
            if not member.isfile():
                continue
            content = archive.extractfile(member).read()
            if b'\0' in content:
                continue
            try:
                text = content.decode('utf-8')
            except UnicodeDecodeError:
                continue
            lines = text.splitlines()
            test = member.name.startswith('tests/') or re.search(r'\.(test|spec)\.', member.name)
            category = 'tests' if test else 'production' if member.name.startswith('src/') else 'other'
            values = {'files': 1, 'lines': len(lines), 'nonblank': sum(bool(line.strip()) for line in lines), 'bytes': len(content)}
            for name in (category, 'tracked_text'):
                for key, value in values.items():
                    totals[name][key] += value
            if category == 'production':
                largest.append((len(lines), member.name))
    return {'revision': revision, 'totals': totals, 'largest_production': sorted(largest, reverse=True)[:20]}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('base')
    parser.add_argument('head', nargs='?', default='HEAD')
    args = parser.parse_args()
    before, after = measure(args.base), measure(args.head)
    reduction = {}
    for category, values in before['totals'].items():
        reduction[category] = {
            key: {'removed': value - after['totals'][category][key],
                  'percent': round(100 * (value - after['totals'][category][key]) / value, 2)}
            for key, value in values.items() if key != 'files'
        }
    print(json.dumps({'before': before, 'after': after, 'reduction': reduction}, indent=2))
