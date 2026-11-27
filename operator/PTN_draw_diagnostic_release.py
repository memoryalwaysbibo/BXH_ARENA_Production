#!/usr/bin/env python3
"""Prepare or deploy sanitized PTN draw denial diagnostics to registrationDrawV2.

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
import urllib.request
import zipfile

PROJECT = 'bxh-arena'
REGION = 'asia-east1'
FUNCTION = 'registrationDrawV2'
CODEBASE = 'bxh-registration-v2-closed'
REF = 'dafb953264721775ab938553cb0e8338c1b95068'
RAW = 'https://raw.githubusercontent.com/memoryalwaysbibo/BXH_ARENA_Production/' + REF + '/'
GENERATION = '1795453463375594'
TARGETS = {
    'registration-flow-v2/backend/bindings.cjs': (
        '69d9d0dfb017fd3638bda2c00a32219240c0cc3634810483d29e7a0f19e9126e',
        '8a7009bc5e1d2d2b5c9e7c011f7769748dd5b965abc5ee2f1fa1df973c8ad8c7'),
    'registration-flow-v2/backend/lifecycle.cjs': (
        '9395d4c598a86852c03bc87a5f8e2d8da7f2b603b048d28f829f64b04934256e',
        '3d5ba4c40b3f3d8326cc9ff5718efbba262ae7953b7118a269b755bcf822e5ee'),
    'registration-flow-v2/backend/ticket-host.cjs': (
        '17245bd139e61250b2da74ca8474425b10b0988c815c5996737f61ed2f518a1a',
        'f10d17cd0e414e9e9324c0802fa2a181995c25d15c029ca2e09ea34a623dfae8'),
}
GUARDS = {
    'registration-flow-v2/backend/ticket-room-create.cjs':
        '879d65551ac42f9b39f18247abd2cc1ee9cca1055f461f1c2528f341ff26f39d',
}


def run(*args, cwd=None, capture=False, env=None):
    result = subprocess.run(args, cwd=cwd, env=env, check=True, text=True,
                            stdout=subprocess.PIPE if capture else None)
    return result.stdout


def digest(data):
    return hashlib.sha256(data).hexdigest()


def download_candidate(root):
    for path, (_, expected_hash) in TARGETS.items():
        request = urllib.request.Request(RAW + path, headers={'User-Agent': 'BXH-PTN-draw-release'})
        with urllib.request.urlopen(request, timeout=30) as response:
            content = response.read()
        if digest(content) != expected_hash:
            raise ValueError('candidate source differs from reviewed commit: ' + path)
        target = root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)


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
        if len(names) != len(set(names)) or any(path not in names for path in (*TARGETS, *GUARDS)):
            raise ValueError('incomplete or duplicated source archive')
        for item in infos:
            path = PurePosixPath(item.filename)
            if (path.is_absolute() or '..' in path.parts or
                    (item.external_attr >> 16) & 0o170000 == 0o120000):
                raise ValueError('unsafe archive entry')
        for path, (old_hash, _) in TARGETS.items():
            if digest(archive.read(path)) != old_hash:
                raise ValueError('live draw dependency changed: ' + path)
        for path, expected in GUARDS.items():
            if digest(archive.read(path)) != expected:
                raise ValueError('live dependency changed: ' + path)
        archive.extractall(source)
    for path, (_, new_hash) in TARGETS.items():
        candidate = checkout / path
        if digest(candidate.read_bytes()) != new_hash:
            raise ValueError('candidate source differs from reviewed commit: ' + path)
        (source / path).write_bytes(candidate.read_bytes())
        run('node', '--check', str(source / path))
    package = json.loads((source / 'package.json').read_text())
    if package.get('main') != 'index.cjs' or package.get('engines', {}).get('node') != '22':
        raise ValueError('unexpected runtime package')
    (release / 'firebase.json').write_text(json.dumps({
        'functions': [{'source': 'functions', 'codebase': CODEBASE, 'runtime': 'nodejs22'}]
    }) + '\n')
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
            download_candidate(checkout)
            archive = root / 'live.zip'
            run('gcloud', 'storage', 'cp',
                'gs://' + storage['bucket'] + '/' + storage['object'] + '#' + GENERATION,
                str(archive))
            release = root / 'release'
            source = stage(archive, checkout, release)
            if fingerprint(describe()) != fingerprint(before):
                raise ValueError('production function changed during preparation')
            print('PTN_DRAW_DIAGNOSTIC_PREFLIGHT_OK', REF, 'generation', GENERATION, flush=True)
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
                for path, (_, new_hash) in TARGETS.items():
                    if digest(archive.read(path)) != new_hash:
                        raise ValueError('deployed draw dependency differs: ' + path)
            print('PTN_DRAW_DIAGNOSTIC_DEPLOYED',
                  after['buildConfig']['source']['storageSource']['generation'])
            return 0
    except (OSError, subprocess.SubprocessError, ValueError, zipfile.BadZipFile, KeyError) as error:
        print('PTN_DRAW_DIAGNOSTIC_STOP:', str(error), file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
