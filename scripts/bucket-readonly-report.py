"""Export only validated provenance hashes, never source ZIPs or credentials."""
import hashlib
import json
from pathlib import Path
import re
import sys

TARGETS = ('previewTournamentRaffle', 'drawTournamentRaffle', 'updateTournamentRaffleWinner')


def export(home, destination):
    reports = list(Path(home).glob('bxh-raffle-sources-*/report.json'))
    if len(reports) != 1:
        raise ValueError('expected-one-capture-report')
    path = reports[0]
    report = json.loads(path.read_text())
    if report.get('project') != 'bxh-arena' or report.get('stage') != 'BUCKET_RAFFLE_SOURCES_READONLY' or report.get('targets') != list(TARGETS):
        raise ValueError('unexpected-capture-identity')
    for key, expected in [('productionWrites', 0), ('deploymentPerformed', False), ('writerInventoryComplete', False), ('acceptanceCompleted', False)]:
        if type(report.get(key)) is not type(expected) or report[key] != expected:
            raise ValueError('unexpected-capture-boundary')
    rows = []
    seen = set()
    for source in report['sources']:
        name = source['name']
        if name not in TARGETS or name in seen or source.get('stableDuringCapture') is not True or source.get('entryPoint') != name:
            raise ValueError('unexpected-source-identity')
        seen.add(name)
        if source.get('sourceArchiveFile') != name + '.source.zip':
            raise ValueError('unexpected-archive-path')
        row = {'name': name, 'stableDuringCapture': True}
        for key in ['sourceArchiveSha256', 'metadataSha256', 'buildConfigSha256', 'serviceConfigSha256']:
            value = source.get(key)
            if not isinstance(value, str) or not re.fullmatch('[0-9a-f]{64}', value):
                raise ValueError('invalid-provenance-hash')
            row[key] = value
        archive = path.parent / source['sourceArchiveFile']
        if archive.is_symlink() or archive.stat().st_size > 16 * 1024 * 1024 or hashlib.sha256(archive.read_bytes()).hexdigest() != row['sourceArchiveSha256']:
            raise ValueError('archive-hash-mismatch')
        rows.append(row)
    complete = report.get('captureComplete')
    if type(complete) is not bool or complete != (len(seen) == len(TARGETS) and report.get('errors') == []):
        raise ValueError('inconsistent-capture-result')
    output = {'stage': report['stage'], 'project': 'bxh-arena', 'targets': list(TARGETS),
              'sources': rows, 'captureComplete': complete, 'errorCount': len(report['errors']),
              'productionWrites': 0, 'deploymentPerformed': False,
              'writerInventoryComplete': False, 'acceptanceCompleted': False}
    Path(destination).write_text(json.dumps(output, indent=2) + '\n')
    return output


if __name__ == '__main__':
    result = export(sys.argv[1], sys.argv[2])
    print(json.dumps({'sourcesCaptured': len(result['sources']), 'captureComplete': result['captureComplete'], 'productionWrites': 0}))
