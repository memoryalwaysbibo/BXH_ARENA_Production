#!/usr/bin/env python3
"""Deploy only the existing commerceService from pinned PTN staged source."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess

PROJECT = 'bxh-arena'
REGION = 'asia-east1'
NAME = 'commerceService'
CODEBASE = 'commerce'
GENERATION = '1795109285115418'
FILES = {
    'domain.cjs': '91b11c26901c33bd9f45e7a9dbbc267f64838197f17fe26415b3d3de990b5b02',
    'service.cjs': '20c05d56971d6dd76a4cd38beb47d6eb7a64963bc7a9ebf9d3921425e747a432',
    'ticket-purchase.cjs': 'c58930c1e0bd8bec1652cbcf700eaff5f1b9e5afb4e22b2e0c29bdef1363a553',
}


def describe():
    return json.loads(subprocess.check_output([
        'gcloud', 'functions', 'describe', NAME, '--gen2', '--region=' + REGION,
        '--project=' + PROJECT, '--format=json'], text=True))


def identity(info):
    build, service = info.get('buildConfig', {}), info.get('serviceConfig', {})
    return (build.get('entryPoint'), build.get('runtime'),
            info.get('labels', {}).get('firebase-functions-codebase'),
            service.get('serviceAccountEmail'), service.get('availableMemory'),
            service.get('timeoutSeconds'), info.get('eventTrigger'),
            service.get('environmentVariables'))


def preflight(root, before):
    source = before.get('buildConfig', {}).get('source', {}).get('storageSource', {})
    if (str(source.get('generation')) != GENERATION or
            identity(before)[:3] != (NAME, 'nodejs22', CODEBASE)):
        raise ValueError('live commerce function binding changed')
    report = json.loads((root / 'report.json').read_text())
    rows = {row['function']: row for row in report.get('functions', [])}
    row = rows.get(NAME)
    code = root / NAME / 'functions'
    archive = root / NAME / 'live.zip'
    if (report.get('status') != 'STAGED_ONLY' or report.get('productionWrites') != 0 or
            not row or row['generation'] != GENERATION or row['codebase'] != CODEBASE or
            row['sourceSha256'] != hashlib.sha256(archive.read_bytes()).hexdigest()):
        raise ValueError('staging report differs')
    for path, expected in FILES.items():
        if hashlib.sha256((code / path).read_bytes()).hexdigest() != expected:
            raise ValueError('staged commerce source differs: ' + path)
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
    source = preflight(args.stage_root, before)
    if describe() != before:
        raise ValueError('commerce function changed during preflight')
    print('PTN_COMMERCE_PREFLIGHT_OK', GENERATION, flush=True)
    if not args.apply:
        print('PREPARE_ONLY: no production changes')
        return
    release = source.parent
    (release / 'firebase.json').write_text(json.dumps({
        'functions': [{'source': 'functions', 'codebase': CODEBASE, 'runtime': 'nodejs22'}]
    }) + '\n')
    subprocess.run(['npm', '--prefix', str(source), 'install', '--omit=dev',
                    '--ignore-scripts', '--no-audit', '--no-fund'], check=True)
    if describe() != before:
        raise ValueError('commerce function changed before deploy')
    env = dict(os.environ, GOOGLE_CLOUD_QUOTA_PROJECT=PROJECT)
    subprocess.run(['firebase', 'deploy', '--config', str(release / 'firebase.json'),
                    '--project', PROJECT, '--only', f'functions:{CODEBASE}:{NAME}',
                    '--non-interactive'], cwd=release, env=env, check=True)
    after = describe()
    if identity(after) != identity(before):
        raise ValueError('commerce function configuration changed; inspect before continuing')
    new_source = after.get('buildConfig', {}).get('source', {}).get('storageSource', {})
    if str(new_source.get('generation')) == GENERATION:
        raise ValueError('commerce deploy returned without source change')
    print('PTN_COMMERCE_DEPLOYED', new_source.get('generation'))


if __name__ == '__main__':
    main()
