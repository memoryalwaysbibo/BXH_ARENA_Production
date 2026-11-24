#!/usr/bin/env python3
"""Prepare or deploy the PTN completed-room read projection to the roster callable.

Run from authenticated bxh-arena Cloud Shell. Prepare-only unless --apply is passed.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import subprocess
import sys
import tempfile
import zipfile

PROJECT = 'bxh-arena'
REGION = 'asia-east1'
FUNCTION = 'registrationRosterQueueV2'
CODEBASE = 'bxh-registration-v2-closed'
REF = 'c906894346b78484c14e244c120b12082d5e5836'
GENERATION = '1795446793775383'
TARGET = 'registration-flow-v2/backend/ticket-room-create.cjs'
LIVE_SHA256 = '879d65551ac42f9b39f18247abd2cc1ee9cca1055f461f1c2528f341ff26f39d'
NEW_SHA256 = 'c8c4fe299d65c4cdf8b6328a4dbffed671cbb597d96d7d693823ef79c56e5af5'
GUARDS = {
    'registration-flow-v2/backend/bindings.cjs':
        '69d9d0dfb017fd3638bda2c00a32219240c0cc3634810483d29e7a0f19e9126e',
    'registration-flow-v2/backend/lifecycle.cjs':
        '9395d4c598a86852c03bc87a5f8e2d8da7f2b603b048d28f829f64b04934256e',
}


def run(*args, cwd=None, capture=False, env=None):
    result = subprocess.run(args, cwd=cwd, env=env, check=True, text=True,
                            stdout=subprocess.PIPE if capture else None)
    return result.stdout


def digest(data):
    return hashlib.sha256(data).hexdigest()


def describe():
    info = json.loads(run('gcloud', 'functions', 'describe', FUNCTION, '--gen2',
                          '--region=' + REGION, '--project=' + PROJECT,
                          '--format=json', capture=True))
    source = info.get('buildConfig', {}).get('source', {}).get('storageSource', {})
    if (info.get('buildConfig', {}).get('entryPoint') != FUNCTION or
            info.get('buildConfig', {}).get('runtime') != 'nodejs22' or
            info.get('labels', {}).get('firebase-functions-codebase') != CODEBASE or
            not all(source.get(key) for key in ('bucket', 'object', 'generation'))):
        raise ValueError('unexpected production function')
    return info


def fingerprint(info):
    build, service = info['buildConfig'], info.get('serviceConfig', {})
    return (build.get('source', {}).get('storageSource'), build.get('environmentVariables'),
            build.get('entryPoint'), build.get('runtime'),
            info.get('labels', {}).get('firebase-functions-codebase'),
            service.get('serviceAccountEmail'), service.get('availableMemory'),
            service.get('availableCpu'), service.get('timeoutSeconds'),
            service.get('maxInstanceCount'), service.get('maxInstanceRequestConcurrency'),
            service.get('ingressSettings'), service.get('environmentVariables'),
            info.get('eventTrigger'))


def stage(archive_path, checkout, release):
    source = release / 'functions'
    source.mkdir(parents=True)
    with zipfile.ZipFile(archive_path) as archive:
        infos = archive.infolist()
        names = [item.filename for item in infos]
        if len(names) != len(set(names)) or any(path not in names for path in (TARGET, *GUARDS)):
            raise ValueError('incomplete or duplicated source archive')
        for item in infos:
            path = PurePosixPath(item.filename)
            if (path.is_absolute() or '..' in path.parts or
                    (item.external_attr >> 16) & 0o170000 == 0o120000):
                raise ValueError('unsafe archive entry')
        if digest(archive.read(TARGET)) != LIVE_SHA256:
            raise ValueError('live ticket-room projection changed')
        for path, expected in GUARDS.items():
            if digest(archive.read(path)) != expected:
                raise ValueError('live dependency changed: ' + path)
        archive.extractall(source)
    candidate = checkout / TARGET
    if digest(candidate.read_bytes()) != NEW_SHA256:
        raise ValueError('candidate source differs from reviewed commit')
    (source / TARGET).write_bytes(candidate.read_bytes())
    package = json.loads((source / 'package.json').read_text())
    if package.get('main') != 'index.cjs' or package.get('engines', {}).get('node') != '22':
        raise ValueError('unexpected runtime package')
    (release / 'firebase.json').write_text(json.dumps({
        'functions': [{'source': 'functions', 'codebase': CODEBASE, 'runtime': 'nodejs22'}]
    }) + '\n')
    run('node', '--check', str(source / TARGET))
    return source


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    try:
        before = describe()
        storage = before['buildConfig']['source']['storageSource']
        if str(storage['generation']) != GENERATION:
            raise ValueError('production source generation changed')
        with tempfile.TemporaryDirectory(prefix='bxh-ptn-ui-') as temp:
            root = Path(temp)
            checkout = root / 'candidate'
            run('git', 'init', '-q', str(checkout))
            run('git', '-C', str(checkout), 'fetch', '-q', '--depth=1',
                'https://github.com/memoryalwaysbibo/BXH_ARENA_Production.git', REF)
            run('git', '-C', str(checkout), 'checkout', '-q', '--detach', 'FETCH_HEAD')
            if run('git', '-C', str(checkout), 'rev-parse', 'HEAD', capture=True).strip() != REF:
                raise ValueError('candidate commit changed')
            archive = root / 'live.zip'
            run('gcloud', 'storage', 'cp',
                'gs://' + storage['bucket'] + '/' + storage['object'] + '#' + GENERATION,
                str(archive))
            release = root / 'release'
            source = stage(archive, checkout, release)
            if fingerprint(describe()) != fingerprint(before):
                raise ValueError('production function changed during preparation')
            print('PTN_UI_BACKEND_PREFLIGHT_OK', REF, 'generation', GENERATION, flush=True)
            if not args.apply:
                print('PREPARE_ONLY: no production changes')
                return 0
            run('npm', '--prefix', str(source), 'install', '--omit=dev',
                '--ignore-scripts', '--no-audit', '--no-fund')
            if fingerprint(describe()) != fingerprint(before):
                raise ValueError('production function changed before deployment')
            env = dict(os.environ, GOOGLE_CLOUD_QUOTA_PROJECT=PROJECT)
            run('firebase', 'deploy', '--project', PROJECT,
                '--config', str(release / 'firebase.json'), '--only',
                f'functions:{CODEBASE}:{FUNCTION}', '--non-interactive',
                cwd=release, env=env)
            after = describe()
            if (after['buildConfig']['source']['storageSource'].get('generation') == GENERATION or
                    fingerprint(after)[1:] != fingerprint(before)[1:]):
                raise ValueError('deployment source/configuration must be inspected')
            deployed = after['buildConfig']['source']['storageSource']
            deployed_archive = root / 'deployed.zip'
            run('gcloud', 'storage', 'cp',
                'gs://' + deployed['bucket'] + '/' + deployed['object'] + '#' + str(deployed['generation']),
                str(deployed_archive))
            with zipfile.ZipFile(deployed_archive) as archive:
                if digest(archive.read(TARGET)) != NEW_SHA256:
                    raise ValueError('deployed ticket-room projection differs')
            print('PTN_UI_BACKEND_DEPLOYED',
                  after['buildConfig']['source']['storageSource']['generation'])
            return 0
    except (OSError, subprocess.SubprocessError, ValueError, zipfile.BadZipFile, KeyError) as error:
        print('PTN_UI_BACKEND_STOP:', str(error), file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
