#!/usr/bin/env python3
"""Update one pinned registration function from the staged PTN source."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess

PROJECT = 'bxh-arena'
REGION = 'asia-east1'
CODEBASE = 'bxh-registration-v2-closed'
GENERATION = {
    'registrationRosterQueueV2': '1795421743641701',
    'registrationQueueV2': '1795222746068144',
    'registrationQueueV2Worker': '1795222676191962',
    'registrationQueueV2Sweep': '1795222675541485',
    'registrationDrawV2': '1795222815618372',
    'registrationStartV2': '1795222816395885',
}
BASE = 'registration-flow-v2/backend/'
FILES = {
    BASE + 'bindings.cjs': '69d9d0dfb017fd3638bda2c00a32219240c0cc3634810483d29e7a0f19e9126e',
    BASE + 'lifecycle.cjs': '9395d4c598a86852c03bc87a5f8e2d8da7f2b603b048d28f829f64b04934256e',
    BASE + 'ticket-room-create.cjs': '879d65551ac42f9b39f18247abd2cc1ee9cca1055f461f1c2528f341ff26f39d',
    BASE + 'ticket-host.cjs': '17245bd139e61250b2da74ca8474425b10b0988c815c5996737f61ed2f518a1a',
}


def describe(name):
    return json.loads(subprocess.check_output([
        'gcloud', 'functions', 'describe', name, '--gen2', '--region=' + REGION,
        '--project=' + PROJECT, '--format=json'], text=True))


def identity(info):
    build, service = info.get('buildConfig', {}), info.get('serviceConfig', {})
    return (build.get('entryPoint'), build.get('runtime'),
            info.get('labels', {}).get('firebase-functions-codebase'),
            service.get('serviceAccountEmail'), service.get('availableMemory'),
            service.get('timeoutSeconds'), info.get('eventTrigger'),
            service.get('environmentVariables'))


def preflight(root, name, before):
    source = before.get('buildConfig', {}).get('source', {}).get('storageSource', {})
    if (str(source.get('generation')) != GENERATION[name] or
            identity(before)[:3] != (name, 'nodejs22', CODEBASE)):
        raise ValueError(name + ': live binding changed')
    report = json.loads((root / 'report.json').read_text())
    rows = {row['function']: row for row in report.get('functions', [])}
    row = rows.get(name)
    code, archive = root / name / 'functions', root / name / 'live.zip'
    if (report.get('status') != 'STAGED_ONLY' or report.get('productionWrites') != 0 or
            not row or row['generation'] != GENERATION[name] or
            row['codebase'] != CODEBASE or
            row['sourceSha256'] != hashlib.sha256(archive.read_bytes()).hexdigest()):
        raise ValueError(name + ': staging report differs')
    for path, expected in FILES.items():
        if hashlib.sha256((code / path).read_bytes()).hexdigest() != expected:
            raise ValueError(name + ': staged source differs: ' + path)
    package = json.loads((code / 'package.json').read_text())
    if package.get('engines', {}).get('node') != '22':
        raise ValueError(name + ': candidate runtime differs')
    return code


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stage-root', required=True, type=Path)
    parser.add_argument('--name', required=True, choices=tuple(GENERATION))
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    name = args.name
    before = describe(name)
    code = preflight(args.stage_root, name, before)
    if describe(name) != before:
        raise ValueError(name + ': live function changed during preflight')
    print('PTN_REGISTRATION_PREFLIGHT_OK', name, GENERATION[name], flush=True)
    if not args.apply:
        print('PREPARE_ONLY: no production changes')
        return
    release = code.parent
    (release / 'firebase.json').write_text(json.dumps({
        'functions': [{'source': 'functions', 'codebase': CODEBASE, 'runtime': 'nodejs22'}]
    }) + '\n')
    try:
        subprocess.run(['npm', '--prefix', str(code), 'install', '--omit=dev',
                        '--ignore-scripts', '--no-audit', '--no-fund'], check=True)
        if describe(name) != before:
            raise ValueError(name + ': live function changed before deploy')
        env = dict(os.environ, GOOGLE_CLOUD_QUOTA_PROJECT=PROJECT)
        subprocess.run(['firebase', 'deploy', '--config', str(release / 'firebase.json'),
                        '--project', PROJECT, '--only', f'functions:{CODEBASE}:{name}',
                        '--non-interactive'], cwd=release, env=env, check=True)
        after = describe(name)
        if identity(after) != identity(before):
            raise ValueError(name + ': function configuration changed; inspect before continuing')
        new_source = after.get('buildConfig', {}).get('source', {}).get('storageSource', {})
        if str(new_source.get('generation')) == GENERATION[name]:
            raise ValueError(name + ': deploy returned without source change')
        print('PTN_REGISTRATION_DEPLOYED', name, new_source.get('generation'))
    finally:
        shutil.rmtree(code / 'node_modules', ignore_errors=True)


if __name__ == '__main__':
    main()
