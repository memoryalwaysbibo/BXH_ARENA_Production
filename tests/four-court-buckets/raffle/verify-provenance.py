"""Verify the pinned raffle baseline and optionally compare a new hash-only capture."""
import argparse
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[3]
HASH_FIELDS = ('sourceArchiveSha256', 'metadataSha256', 'buildConfigSha256', 'serviceConfigSha256')
report = json.loads((ROOT / 'release/buckets/raffle/live-provenance-20261107.json').read_text())
patches = json.loads((ROOT / 'release/buckets/operations/patch-manifest.json').read_text())['patches']
source = next(p for p in patches if p['sourceSet'] == 5)
assert report['project'] == 'bxh-arena' and report['stage'] == 'BUCKET_RAFFLE_SOURCES_READONLY'
assert report['captureComplete'] is True and report['errorCount'] == 0
assert report['productionWrites'] == 0 and report['deploymentPerformed'] is False
assert report['writerInventoryComplete'] is False and report['acceptanceCompleted'] is False
assert len(report['sources']) == 3
assert {s['name'] for s in report['sources']} == {'previewTournamentRaffle', 'drawTournamentRaffle', 'updateTournamentRaffleWinner'}
for row in report['sources']:
    assert row['stableDuringCapture'] is True
    assert row['sourceArchiveSha256'] == source['archiveSha256']
    for field in HASH_FIELDS:
        assert re.fullmatch('[0-9a-f]{64}', row[field]), field
evidence = report['evidence']
assert evidence['repository'] == 'memoryalwaysbibo/BXH_ARENA_Functions_Production'
assert evidence['runId'] == 42274492327 and evidence['artifactId'] == 13531248795
assert evidence['artifactSha256'] == '46c26965d4f861e545d98468e1822db84dc742c9aeb9bd5b2d5434a85f44961a'
assert evidence['baselineOperationsSha256'] == source['baselineFileSha256']
fixture = ROOT / 'tests/four-court-buckets/operations'
pins = json.loads((fixture / 'fixture-sha256.json').read_text())
for relative in ['fixtures/5/operations.js', 'fixtures/5/operations-core.js', 'fixtures/5/release-controls.js']:
    assert hashlib.sha256((fixture / relative).read_bytes()).hexdigest() == pins[relative]
assert hashlib.sha256((fixture / 'fixtures/5/operations.js').read_bytes()).hexdigest() == source['baselineFileSha256']
assert 'exports.previewTournamentRaffle=onCall' in (fixture / 'fixtures/5/operations.js').read_text()


def compare_capture(path):
    try:
        with path.open('rb') as file:
            data = file.read(65537)
        if len(data) > 65536:
            raise ValueError
        capture = json.loads(data)
    except (OSError, ValueError):
        return {'status': 'CAPTURE_INVALID', 'reason': 'invalid-report-file'}

    boundary = {key: value for key, value in report.items() if key not in ('sources', 'evidence')}
    if (not isinstance(capture, dict) or set(capture) != {*boundary, 'sources'} or
            any(type(capture[key]) is not type(value) or capture[key] != value
                for key, value in boundary.items())):
        return {'status': 'CAPTURE_INVALID', 'reason': 'unexpected-or-incomplete-capture'}

    rows = capture['sources']
    if not isinstance(rows, list) or len(rows) != len(report['sources']):
        return {'status': 'CAPTURE_INVALID', 'reason': 'unexpected-source-count'}
    expected = {row['name']: row for row in report['sources']}
    changes = {}
    seen = set()
    for row in rows:
        if (not isinstance(row, dict) or set(row) != {'name', 'stableDuringCapture', *HASH_FIELDS} or
                not isinstance(row['name'], str) or row['name'] not in expected or row['name'] in seen or
                row['stableDuringCapture'] is not True or
                any(not isinstance(row[field], str) or not re.fullmatch('[0-9a-f]{64}', row[field])
                    for field in HASH_FIELDS)):
            return {'status': 'CAPTURE_INVALID', 'reason': 'invalid-source-row'}
        name = row['name']
        seen.add(name)
        changed = [field for field in HASH_FIELDS if row[field] != expected[name][field]]
        if changed:
            changes[name] = changed
    return {'status': 'BASELINE_DRIFT' if changes else 'BASELINE_MATCHED',
            'functionsCompared': len(seen), 'changes': changes}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--capture-report', type=Path, help='filtered bucket-readonly-report.json')
    args = parser.parse_args()
    if args.capture_report is None:
        print('PASS three independently captured live archives match sourceSet5; pinned fixture closure; no deployment or acceptance claim')
    else:
        result = compare_capture(args.capture_report)
        print(json.dumps(result))
        raise SystemExit(result['status'] != 'BASELINE_MATCHED')
