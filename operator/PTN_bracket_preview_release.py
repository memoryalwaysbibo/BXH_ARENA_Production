#!/usr/bin/env python3
"""Stage or deploy PTN pre-start bracket preview to registrationRosterQueueV2.

Run from an authenticated bxh-arena Cloud Shell. Default is read-only preflight.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import subprocess
import tempfile
import urllib.request
import zipfile

PROJECT = 'bxh-arena'
REGION = 'asia-east1'
FUNCTION = 'registrationRosterQueueV2'
CODEBASE = 'bxh-registration-v2-closed'
GENERATION = '1795538187707946'
REF = 'db2c4e784403f4ada4f6daf4372d45e579152b35'
SOURCE = 'registration-flow-v2/backend/ticket-room-create.cjs'
OLD_HASH = 'c8c4fe299d65c4cdf8b6328a4dbffed671cbb597d96d7d693823ef79c56e5af5'
NEW_HASH = '0b6f023dc7c068243702b7b086d3ccedf49d6bd0fef7f9533240490b4c54259c'
RAW = f'https://raw.githubusercontent.com/memoryalwaysbibo/BXH_ARENA_Production/{REF}/{SOURCE}'


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
            not all(source.get(k) for k in ('bucket', 'object', 'generation'))):
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


def candidate():
    request = urllib.request.Request(RAW, headers={'User-Agent': 'BXH-PTN-bracket-preview'})
    with urllib.request.urlopen(request, timeout=30) as response:
        content = response.read()
    if digest(content) != NEW_HASH:
        raise ValueError('candidate source differs from reviewed commit')
    return content


def stage(root, archive, new_source):
    release = root / 'release'
    functions = release / 'functions'
    functions.mkdir(parents=True)
    with zipfile.ZipFile(archive) as source_zip:
        infos = source_zip.infolist()
        names = [entry.filename for entry in infos]
        if len(names) != len(set(names)) or SOURCE not in names:
            raise ValueError('incomplete or duplicate function source')
        for entry in infos:
            path = PurePosixPath(entry.filename)
            if (path.is_absolute() or '..' in path.parts or
                    (entry.external_attr >> 16) & 0o170000 == 0o120000):
                raise ValueError('unsafe source archive')
        if digest(source_zip.read(SOURCE)) != OLD_HASH:
            raise ValueError('live ticket-room source changed')
        source_zip.extractall(functions)
    (functions / SOURCE).write_bytes(new_source)
    run('node', '--check', str(functions / SOURCE))
    package = json.loads((functions / 'package.json').read_text())
    if package.get('main') != 'index.cjs' or package.get('engines', {}).get('node') != '22':
        raise ValueError('unexpected function package')
    (release / 'firebase.json').write_text(json.dumps({
        'functions': [{'source': 'functions', 'codebase': CODEBASE, 'runtime': 'nodejs22'}]
    }) + '\n')
    return release, functions


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    before = describe()
    storage = before['buildConfig']['source']['storageSource']
    if str(storage['generation']) != GENERATION:
        raise ValueError('production generation changed; stop and review')
    with tempfile.TemporaryDirectory(prefix='bxh-ptn-bracket-preview-') as temp:
        root = Path(temp)
        new_source = candidate()
        archive = root / 'live.zip'
        run('gcloud', 'storage', 'cp',
            'gs://' + storage['bucket'] + '/' + storage['object'] + '#' + GENERATION,
            str(archive))
        release, functions = stage(root, archive, new_source)
        if fingerprint(describe()) != fingerprint(before):
            raise ValueError('production changed during preflight')
        print('PTN_BRACKET_PREVIEW_PREFLIGHT_OK', REF, GENERATION, flush=True)
        if not args.apply:
            print('PREPARE_ONLY: no production changes')
            return
        run('npm', '--prefix', str(functions), 'install', '--omit=dev',
            '--ignore-scripts', '--no-audit', '--no-fund')
        if fingerprint(describe()) != fingerprint(before):
            raise ValueError('production changed before deployment')
        env = dict(os.environ, GOOGLE_CLOUD_QUOTA_PROJECT=PROJECT)
        run('firebase', 'deploy', '--project', PROJECT,
            '--config', str(release / 'firebase.json'), '--only',
            f'functions:{CODEBASE}:{FUNCTION}', '--non-interactive', cwd=release, env=env)
        after = describe()
        if (str(after['buildConfig']['source']['storageSource']['generation']) == GENERATION or
                fingerprint(after)[1:] != fingerprint(before)[1:]):
            raise ValueError('deployed function identity or configuration differs')
        print('PTN_BRACKET_PREVIEW_DEPLOYED',
              after['buildConfig']['source']['storageSource']['generation'])


if __name__ == '__main__':
    main()
