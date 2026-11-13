#!/usr/bin/env python3
"""Capture production V2 sources and gates for a source-preserving rollout release.

Cloud reads only. Source ZIPs and full function metadata stay in Cloud Shell.
Prints a report containing hashes, revisions, bootstrap wiring and gate booleans.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import tempfile
import urllib.error
import urllib.request
import zipfile

PROJECT = 'bxh-arena'
REGION = 'asia-east1'
NAMES = ('registrationQueueV2', 'registrationRosterQueueV2',
         'registrationQueueV2Worker', 'registrationQueueV2Sweep',
         'registrationDrawV2', 'registrationStartV2')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def gcloud(*args):
    if args[:2] not in (('functions', 'describe'), ('storage', 'cp'),
                        ('auth', 'print-access-token')):
        raise ValueError('read-only-command-guard')
    result = subprocess.run(['gcloud', *args, '--project=' + PROJECT, '--quiet'],
                            capture_output=True, timeout=120)
    if result.returncode:
        raise ValueError('cloud-read-failed-check-login-and-permission')
    return result.stdout


def describe(name):
    info = json.loads(gcloud('functions', 'describe', name, '--gen2',
                            '--region=' + REGION, '--format=json'))
    if (info.get('name') != f'projects/{PROJECT}/locations/{REGION}/functions/{name}'
            or info.get('state') != 'ACTIVE'
            or info.get('buildConfig', {}).get('entryPoint') != name):
        raise ValueError('function-identity-or-state-mismatch')
    source = info['buildConfig'].get('sourceProvenance', {}).get('resolvedStorageSource', {})
    bucket, obj, generation = (str(source.get(key, '')) for key in ('bucket', 'object', 'generation'))
    if (not re.fullmatch(r'[a-z0-9][a-z0-9._-]+', bucket) or not obj
            or '#' in obj or not re.fullmatch(r'[0-9]+', generation)):
        raise ValueError('generation-pinned-source-required')
    return info, f'gs://{bucket}/{obj}#{generation}'


def capture(name, root):
    folder = root / name
    folder.mkdir(mode=0o700)
    before, uri = describe(name)
    archive = folder / 'source.zip'
    gcloud('storage', 'cp', uri, str(archive))
    os.chmod(archive, 0o600)
    hashes = {}
    with zipfile.ZipFile(archive) as source:
        total = 0
        for entry in source.infolist():
            if entry.is_dir():
                continue
            path = PurePosixPath(entry.filename)
            total += entry.file_size
            if (path.is_absolute() or '..' in path.parts or '\\' in entry.filename
                    or str(path) in hashes or stat.S_ISLNK(entry.external_attr >> 16)
                    or total > 200 * 1024 * 1024 or entry.file_size > 20 * 1024 * 1024):
                raise ValueError('unsafe-source-archive')
            hashes[str(path)] = sha(source.read(entry))
        package = json.loads(source.read('package.json'))
        entrypoint = package.get('main', 'index.js')
        if entrypoint not in hashes:
            raise ValueError('bootstrap-not-found')
        lines = source.read(entrypoint).decode().splitlines()
        wiring = [line for line in lines if any(word in line for word in
                  ('createPilotBindings', 'createRolloutBindings', 'pilotRoom:', 'retiredRoom:', 'retiredRooms:', 'stagedOnly:'))]
    after, next_uri = describe(name)
    if before != after or uri != next_uri:
        raise ValueError('function-changed-during-capture')
    (folder / 'function.json').write_text(json.dumps(before, indent=2))
    os.chmod(folder / 'function.json', 0o600)
    (folder / 'source-file-hashes.json').write_text(json.dumps(hashes, indent=2))
    return {'revision': before['serviceConfig']['revision'],
            'sourceArchiveSha256': sha(archive.read_bytes()),
            'sourceGeneration': uri.rsplit('#', 1)[1], 'sourceFileCount': len(hashes),
            'bootstrap': entrypoint, 'bootstrapSha256': hashes[entrypoint],
            'bootstrapWiring': wiring,
            'backendHashes': {p: value for p, value in hashes.items()
                              if p.startswith('registration-flow-v2/backend/')},
            'configurationSha256': sha(json.dumps(before, sort_keys=True).encode())}


def gates():
    token = gcloud('auth', 'print-access-token').decode().strip()
    result = {}
    for name in ('registrationFlowV2Pilot', 'registrationFlowV2Rollout'):
        url = f'https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents/systemSettings/{name}'
        request = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + token})
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                data = json.load(response)
        except urllib.error.HTTPError as error:
            if error.code == 404:
                result[name] = {'exists': False}
                continue
            raise ValueError('gate-read-failed') from None
        fields = data.get('fields', {})
        selected = {key: fields[key] for key in ('roomCode', 'roomCodes', 'workersEnabled',
                    'intakeEnabled', 'lifecycleEnabled') if key in fields}
        result[name] = {'exists': True, 'updateTime': data.get('updateTime'), 'fields': selected}
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    os.umask(0o077)
    if args.output:
        root = args.output.expanduser().resolve()
        root.mkdir(mode=0o700)
    else:
        root = Path(tempfile.mkdtemp(prefix='BXH-v2-rollout-', dir=Path.home()))
    report = {'project': PROJECT, 'productionWrites': 0, 'checkpoint': str(root),
              'functions': {}, 'status': 'CAPTURE_IN_PROGRESS'}
    for name in NAMES:
        print('Reading ' + name + ' ...', flush=True)
        report['functions'][name] = capture(name, root)
    report['gates'] = gates()
    report['status'] = 'ROLLOUT_BASELINE_CAPTURED_NOT_DEPLOYED'
    (root / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps(report, ensure_ascii=False, indent=2))
    print('Share report.json only; keep source.zip and function.json in Cloud Shell.')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError, zipfile.BadZipFile, subprocess.TimeoutExpired) as error:
        raise SystemExit('STOP: ' + (str(error) if isinstance(error, ValueError) else type(error).__name__)) from None
