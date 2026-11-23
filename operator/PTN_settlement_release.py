#!/usr/bin/env python3
"""Update the existing PTN settlement function from a pinned staged source."""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path

PROJECT = 'bxh-arena'
REGION = 'asia-east1'
NAME = 'ladderAutoSettlement'
GENERATION = '1794722353569072'
SOURCE = {
    'ladder-auto-settlement.js': '37c104e3ff7ce29ed37a1748fa6b70904d71c69e95fa78b24ae085039375386d',
    'ladder-settlement-core.js': 'f32ec50f5444812c8ec7658eeba2129b971d26ef0db0604b9cdee2c5f625cd1d',
    'ptn-settlement-proof.cjs': 'd8356b409d40f9e8e176345d05aa9994ad8dea7d74e5bfd00ab291e525914870',
}


def describe():
    return json.loads(subprocess.check_output([
        'gcloud', 'functions', 'describe', NAME, '--gen2', '--region=' + REGION,
        '--project=' + PROJECT, '--format=json'], text=True))


def identity(info):
    build = info.get('buildConfig', {})
    service = info.get('serviceConfig', {})
    event = info.get('eventTrigger', {})
    filters = {(f.get('attribute'), f.get('operator', '')): f.get('value')
               for f in event.get('eventFilters', [])}
    return (build.get('entryPoint'), build.get('runtime'),
            service.get('availableMemory'), service.get('timeoutSeconds'),
            event.get('eventType'), filters,
            event.get('serviceAccountEmail'), service.get('serviceAccountEmail'))


def preflight(root, info):
    source = info.get('buildConfig', {}).get('source', {}).get('storageSource', {})
    if str(source.get('generation')) != GENERATION:
        raise ValueError('live generation changed')
    expected = (NAME, 'nodejs22', '256Mi', 60,
                'google.cloud.firestore.document.v1.written',
                {('database', ''): '(default)', ('namespace', ''): '(default)',
                 ('document', 'match-path-pattern'): 'tournaments/{code}'})
    if identity(info)[:6] != expected:
        raise ValueError('runtime or trigger differs')
    report = json.loads((root / 'report.json').read_text())
    rows = {r['function']: r for r in report.get('functions', [])}
    row = rows.get(NAME)
    if (report.get('status') != 'STAGED_ONLY' or report.get('productionWrites') != 0 or
            not row or row['generation'] != GENERATION or
            row['sourceSha256'] != hashlib.sha256((root / NAME / 'live.zip').read_bytes()).hexdigest()):
        raise ValueError('staging report differs')
    code = root / NAME / 'functions'
    for path, expected_hash in SOURCE.items():
        if hashlib.sha256((code / path).read_bytes()).hexdigest() != expected_hash:
            raise ValueError('candidate source differs: ' + path)
    package = json.loads((code / 'package.json').read_text())
    if package.get('engines', {}).get('node') != '22':
        raise ValueError('candidate runtime differs')
    return code


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stage-root', required=True, type=Path)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    before = describe()
    code = preflight(args.stage_root, before)
    if describe() != before:
        raise ValueError('live function changed during preflight')
    print('PTN_SETTLEMENT_PREFLIGHT_OK', GENERATION, flush=True)
    if not args.apply:
        print('PREPARE_ONLY: no production changes')
        return
    subprocess.run(['gcloud', 'functions', 'deploy', NAME, '--gen2',
                    '--region=' + REGION, '--project=' + PROJECT,
                    '--source=' + str(code), '--entry-point=' + NAME,
                    '--runtime=nodejs22', '--quiet'], check=True)
    after = describe()
    if identity(after) != identity(before):
        raise ValueError('deployed function settings changed; inspect before continuing')
    if (after.get('buildConfig', {}).get('source', {}).get('storageSource', {}).get('generation')
            == before['buildConfig']['source']['storageSource']['generation']):
        raise ValueError('deploy returned without source generation change')
    print('PTN_SETTLEMENT_DEPLOYED', after['buildConfig']['source']['storageSource']['generation'])


if __name__ == '__main__':
    main()
