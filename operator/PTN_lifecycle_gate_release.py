#!/usr/bin/env python3
"""Prepare or deploy the independent PTN gate fix to draw and start.

Run in authenticated bxh-arena Cloud Shell. No production writes without --apply.
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
CODEBASE = 'bxh-registration-v2-closed'
REF = 'c1132b7d75e7c7bc494d5acabe0cc3a2d85755e5'
SOURCE_PATH = 'registration-flow-v2/backend/lifecycle.cjs'
RAW = f'https://raw.githubusercontent.com/memoryalwaysbibo/BXH_ARENA_Production/{REF}/{SOURCE_PATH}'
NEW_HASH = '9c28fd870a1ca452b650924eabfb710717cb2436166c772c8a10836db38cf81c'
FUNCTIONS = {
    'registrationStartV2': {
        'generation': '1795453694543142',
        'lifecycle': '9395d4c598a86852c03bc87a5f8e2d8da7f2b603b048d28f829f64b04934256e',
        'bindings': '69d9d0dfb017fd3638bda2c00a32219240c0cc3634810483d29e7a0f19e9126e',
        'ticket-host': '17245bd139e61250b2da74ca8474425b10b0988c815c5996737f61ed2f518a1a',
    },
    'registrationDrawV2': {
        'generation': '1795584236651983',
        'lifecycle': '3d5ba4c40b3f3d8326cc9ff5718efbba262ae7953b7118a269b755bcf822e5ee',
        'bindings': '8a7009bc5e1d2d2b5c9e7c011f7769748dd5b965abc5ee2f1fa1df973c8ad8c7',
        'ticket-host': 'f10d17cd0e414e9e9324c0802fa2a181995c25d15c029ca2e09ea34a623dfae8',
    },
}


def run(*args, cwd=None, capture=False, env=None):
    result = subprocess.run(args, cwd=cwd, env=env, check=True, text=True,
                            stdout=subprocess.PIPE if capture else None)
    return result.stdout


def digest(data):
    return hashlib.sha256(data).hexdigest()


def describe(name):
    info = json.loads(run('gcloud', 'functions', 'describe', name, '--gen2',
                          '--region=' + REGION, '--project=' + PROJECT,
                          '--format=json', capture=True))
    source = info.get('buildConfig', {}).get('source', {}).get('storageSource', {})
    if (info.get('buildConfig', {}).get('entryPoint') != name or
            info.get('buildConfig', {}).get('runtime') != 'nodejs22' or
            info.get('labels', {}).get('firebase-functions-codebase') != CODEBASE or
            not all(source.get(key) for key in ('bucket', 'object', 'generation'))):
        raise ValueError(name + ': unexpected function identity')
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


def download_candidate():
    request = urllib.request.Request(RAW, headers={'User-Agent': 'BXH-PTN-lifecycle-release'})
    with urllib.request.urlopen(request, timeout=30) as response:
        content = response.read()
    if digest(content) != NEW_HASH:
        raise ValueError('reviewed lifecycle source differs')
    return content


def prepare(root, name, info, candidate):
    expected = FUNCTIONS[name]
    storage = info['buildConfig']['source']['storageSource']
    if str(storage['generation']) != expected['generation']:
        raise ValueError(name + ': production source generation changed')
    archive_path = root / name / 'live.zip'
    archive_path.parent.mkdir(parents=True)
    run('gcloud', 'storage', 'cp',
        'gs://' + storage['bucket'] + '/' + storage['object'] + '#' + expected['generation'],
        str(archive_path))
    source = root / name / 'release' / 'functions'
    source.mkdir(parents=True)
    with zipfile.ZipFile(archive_path) as archive:
        infos = archive.infolist()
        names = [entry.filename for entry in infos]
        required = (SOURCE_PATH, 'registration-flow-v2/backend/bindings.cjs',
                    'registration-flow-v2/backend/ticket-host.cjs')
        if len(names) != len(set(names)) or any(path not in names for path in required):
            raise ValueError(name + ': incomplete or duplicated source archive')
        for entry in infos:
            path = PurePosixPath(entry.filename)
            if (path.is_absolute() or '..' in path.parts or
                    (entry.external_attr >> 16) & 0o170000 == 0o120000):
                raise ValueError(name + ': unsafe source archive entry')
        for path, key in zip(required, ('lifecycle', 'bindings', 'ticket-host')):
            if digest(archive.read(path)) != expected[key]:
                raise ValueError(name + ': live dependency changed: ' + path)
        archive.extractall(source)
    (source / SOURCE_PATH).write_bytes(candidate)
    run('node', '--check', str(source / SOURCE_PATH))
    package = json.loads((source / 'package.json').read_text())
    if package.get('main') != 'index.cjs' or package.get('engines', {}).get('node') != '22':
        raise ValueError(name + ': unexpected runtime package')
    release = source.parent
    (release / 'firebase.json').write_text(json.dumps({
        'functions': [{'source': 'functions', 'codebase': CODEBASE, 'runtime': 'nodejs22'}]
    }) + '\n')
    return release


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    try:
        candidate = download_candidate()
        before = {name: describe(name) for name in FUNCTIONS}
        with tempfile.TemporaryDirectory(prefix='bxh-ptn-gate-') as temp:
            root = Path(temp)
            releases = {name: prepare(root, name, before[name], candidate) for name in FUNCTIONS}
            if any(fingerprint(describe(name)) != fingerprint(before[name]) for name in FUNCTIONS):
                raise ValueError('production function changed during preparation')
            print('PTN_GATE_PREFLIGHT_OK', REF,
                  {name: config['generation'] for name, config in FUNCTIONS.items()}, flush=True)
            if not args.apply:
                print('PREPARE_ONLY: no production changes')
                return 0
            for name in FUNCTIONS:
                run('npm', '--prefix', str(releases[name] / 'functions'), 'install', '--omit=dev',
                    '--ignore-scripts', '--no-audit', '--no-fund')
            if any(fingerprint(describe(name)) != fingerprint(before[name]) for name in FUNCTIONS):
                raise ValueError('production function changed before deployment')
            env = dict(os.environ, GOOGLE_CLOUD_QUOTA_PROJECT=PROJECT)
            for name in FUNCTIONS:
                release = releases[name]
                run('firebase', 'deploy', '--project', PROJECT,
                    '--config', str(release / 'firebase.json'), '--only',
                    f'functions:{CODEBASE}:{name}', '--non-interactive', cwd=release, env=env)
                after = describe(name)
                if (str(after['buildConfig']['source']['storageSource']['generation']) == FUNCTIONS[name]['generation'] or
                        fingerprint(after)[1:] != fingerprint(before[name])[1:]):
                    raise ValueError(name + ': deployment source/configuration must be inspected')
                storage = after['buildConfig']['source']['storageSource']
                deployed = root / name / 'deployed.zip'
                run('gcloud', 'storage', 'cp',
                    'gs://' + storage['bucket'] + '/' + storage['object'] + '#' + str(storage['generation']),
                    str(deployed))
                with zipfile.ZipFile(deployed) as archive:
                    if digest(archive.read(SOURCE_PATH)) != NEW_HASH:
                        raise ValueError(name + ': deployed lifecycle source differs')
                print('PTN_GATE_DEPLOYED', name, storage['generation'], flush=True)
            return 0
    except (OSError, subprocess.SubprocessError, ValueError, zipfile.BadZipFile, KeyError) as error:
        print('PTN_GATE_STOP:', str(error), file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
