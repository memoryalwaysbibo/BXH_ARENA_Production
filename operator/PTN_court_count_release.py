#!/usr/bin/env python3
"""Stage or deploy PTN pre-start court count to registrationRosterQueueV2.

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
GENERATION = '1795621630984551'
REF = 'fd80f49bd90f36d550ca3ff1c7dfa9de0d896c1d'
SOURCES = {
    'registration-flow-v2/backend/bindings.cjs': (
        '69d9d0dfb017fd3638bda2c00a32219240c0cc3634810483d29e7a0f19e9126e',
        'b419e3bee47b0c2dfab95c39920c72923c777c7e5720b927a213eb0b1dd3f908'),
    'registration-flow-v2/backend/ticket-room-create.cjs': (
        '37c1e510011dae90261760cbeac8a333fd3b8e7282f6f7317dcb517147ee2b68',
        '17ef25eab37804885e0f186d7331e89e2cb9bf66198101266beb2d54fb056223'),
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


BINDINGS = 'registration-flow-v2/backend/bindings.cjs'
BINDINGS_REF = '035f5c4d979d1e9ec8202c0081d9a2dc48feab5c'


def patch_bindings(content):
    if digest(content) != SOURCES[BINDINGS][0]:
        raise ValueError('unexpected bindings base')
    changes = (
        (b'createTicketScheduleHandler,createTicketRemoveHandler',
         b'createTicketScheduleHandler,createTicketStationsHandler,createTicketRemoveHandler'),
        (b"  'ticket-room-schedule':createTicketScheduleHandler({db}),",
         b"  'ticket-room-schedule':createTicketScheduleHandler({db}),\n  'ticket-room-stations':createTicketStationsHandler({db}),"),
        (b"'room-code-conflict','room-receipt-inconsistent','ticket-ptn-slot-occupied','bracket-room-changed',",
         b"'room-code-conflict','room-receipt-inconsistent','ticket-ptn-slot-occupied','bracket-room-changed','bracket-version-conflict',"),
    )
    for old, new in changes:
        if content.count(old) != 1:
            raise ValueError('unexpected bindings patch context')
        content = content.replace(old, new)
    return content


def candidate():
    replacements = {}
    for source, (_, expected) in SOURCES.items():
        source_ref = BINDINGS_REF if source == BINDINGS else REF
        raw = f'https://raw.githubusercontent.com/memoryalwaysbibo/BXH_ARENA_Production/{source_ref}/{source}'
        request = urllib.request.Request(raw, headers={'User-Agent': 'BXH-PTN-court-count'})
        with urllib.request.urlopen(request, timeout=30) as response:
            content = response.read()
        if source == BINDINGS:
            content = patch_bindings(content)
        if digest(content) != expected:
            raise ValueError('candidate source differs from reviewed commit: ' + source)
        replacements[source] = content
    return replacements


def stage(root, archive, replacements):
    release = root / 'release'
    functions = release / 'functions'
    functions.mkdir(parents=True)
    with zipfile.ZipFile(archive) as source_zip:
        infos = source_zip.infolist()
        names = [entry.filename for entry in infos]
        if len(names) != len(set(names)) or not all(source in names for source in SOURCES):
            raise ValueError('incomplete or duplicate function source')
        for entry in infos:
            path = PurePosixPath(entry.filename)
            if (path.is_absolute() or '..' in path.parts or
                    (entry.external_attr >> 16) & 0o170000 == 0o120000):
                raise ValueError('unsafe source archive')
        for source, (old_hash, new_hash) in SOURCES.items():
            if digest(source_zip.read(source)) != old_hash:
                raise ValueError('live source changed: ' + source)
            if digest(replacements[source]) != new_hash:
                raise ValueError('candidate source differs: ' + source)
        source_zip.extractall(functions)
    for source, content in replacements.items():
        (functions / source).write_bytes(content)
        run('node', '--check', str(functions / source))
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
    with tempfile.TemporaryDirectory(prefix='bxh-ptn-court-count-') as temp:
        root = Path(temp)
        new_source = candidate()
        archive = root / 'live.zip'
        run('gcloud', 'storage', 'cp',
            'gs://' + storage['bucket'] + '/' + storage['object'] + '#' + GENERATION,
            str(archive))
        release, functions = stage(root, archive, new_source)
        if fingerprint(describe()) != fingerprint(before):
            raise ValueError('production changed during preflight')
        print('PTN_COURT_COUNT_PREFLIGHT_OK', REF, GENERATION, flush=True)
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
        deployed = after['buildConfig']['source']['storageSource']
        uploaded = root / 'deployed.zip'
        run('gcloud', 'storage', 'cp', 'gs://' + deployed['bucket'] + '/' + deployed['object'] + '#' + str(deployed['generation']), str(uploaded))
        with zipfile.ZipFile(uploaded) as uploaded_zip:
            for source, (_, expected) in SOURCES.items():
                if digest(uploaded_zip.read(source)) != expected:
                    raise ValueError('deployed source readback mismatch: ' + source)
        print('PTN_COURT_COUNT_DEPLOYED',
              after['buildConfig']['source']['storageSource']['generation'])


if __name__ == '__main__':
    main()
