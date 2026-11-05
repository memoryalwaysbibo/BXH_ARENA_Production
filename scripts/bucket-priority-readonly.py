#!/usr/bin/env python3
"""Capture four immutable live sources for bucket writer review; no cloud writes."""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import urllib.error
import urllib.request
import zipfile

PROJECT = 'bxh-arena'
REGION = 'asia-east1'
TARGETS = ('syncMyHostingProgress', 'manageRegistrationSelection',
           'lotteryRegistration', 'settleLadderTournament')
ROOT = f'https://cloudfunctions.googleapis.com/v2/projects/{PROJECT}/locations/{REGION}/functions/'


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def digest(obj):
    return sha(json.dumps(obj, sort_keys=True, separators=(',', ':')).encode())


def cli(argv):
    try:
        result = subprocess.run(argv, capture_output=True, text=True, timeout=240, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise RuntimeError('gcloud-unavailable') from None
    if result.returncode:
        raise RuntimeError('gcloud-command-failed')
    return result.stdout.strip()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise RuntimeError('redirect-refused')


def read_function(name, token, opener=None):
    if name not in TARGETS:
        raise ValueError('unexpected-function')
    req = urllib.request.Request(ROOT + name, headers={'Authorization': 'Bearer ' + token}, method='GET')
    open_request = opener or urllib.request.build_opener(NoRedirect()).open
    try:
        with open_request(req, timeout=60) as response:
            raw = response.read(1024 * 1024 + 1)
    except urllib.error.HTTPError as exc:
        raise RuntimeError('function-http-' + str(exc.code)) from None
    except (urllib.error.URLError, TimeoutError):
        raise RuntimeError('function-transport-error') from None
    if len(raw) > 1024 * 1024:
        raise ValueError('function-metadata-too-large')
    info = json.loads(raw)
    if not isinstance(info, dict) or info.get('name') != f'projects/{PROJECT}/locations/{REGION}/functions/{name}' or info.get('state') != 'ACTIVE':
        raise ValueError('function-identity-or-state')
    return info


def source_identity(info, name):
    build = info.get('buildConfig', {})
    if build.get('entryPoint') != name:
        raise ValueError('entrypoint-mismatch')
    source = build.get('source', {}).get('storageSource', {})
    bucket, obj, generation = source.get('bucket'), source.get('object'), str(source.get('generation', ''))
    if not isinstance(bucket, str) or not re.fullmatch(r'[a-z0-9][a-z0-9._-]{2,222}', bucket) or not isinstance(obj, str) or not obj or obj.startswith('/') or any(x in obj for x in ('#', '\n', '\r')) or not re.fullmatch(r'[0-9]{1,30}', generation):
        raise ValueError('immutable-source-unavailable')
    return source, f'gs://{bucket}/{obj}#{generation}'


def capture(name, token, out, read=read_function, command=cli):
    before = read(name, token)
    source, uri = source_identity(before, name)
    archive = out / (name + '.source.zip')
    command(['gcloud', 'storage', 'cp', uri, str(archive), '--quiet'])
    archive.chmod(0o600)
    if archive.stat().st_size > 16 * 1024 * 1024 or not zipfile.is_zipfile(archive):
        raise ValueError('source-archive-invalid-or-too-large')
    with zipfile.ZipFile(archive) as z:
        if len(z.infolist()) > 4096 or any(i.file_size > 16 * 1024 * 1024 for i in z.infolist()):
            raise ValueError('source-archive-unexpected-shape')
    after = read(name, token)
    if digest(before) != digest(after):
        raise ValueError('function-changed-during-capture')
    return {'name': name, 'updateTime': before.get('updateTime'),
            'revision': before.get('serviceConfig', {}).get('revision'),
            'entryPoint': before['buildConfig']['entryPoint'],
            'source': source, 'sourceArchiveFile': archive.name,
            'sourceArchiveSha256': sha(archive.read_bytes()),
            'metadataSha256': digest(before),
            'buildConfigSha256': digest(before['buildConfig']),
            'serviceConfigSha256': digest(before.get('serviceConfig', {})),
            'stableDuringCapture': True, 'writerClassification': 'unreviewed'}


def main():
    argparse.ArgumentParser(description=__doc__).parse_args()
    os.umask(0o077)
    report = {'stage': 'BUCKET_PRIORITY_WRITERS_READONLY', 'project': PROJECT,
              'startedAt': dt.datetime.now(dt.timezone.utc).isoformat(),
              'targets': list(TARGETS), 'sources': [], 'errors': [],
              'productionWrites': 0, 'deploymentPerformed': False,
              'writerInventoryComplete': False, 'acceptanceCompleted': False}
    out = Path(tempfile.mkdtemp(prefix='bxh-priority-writers-', dir=Path.home()))
    try:
        if cli(['gcloud', 'config', 'get-value', 'project', '--quiet']) != PROJECT:
            raise RuntimeError('wrong-active-project')
        token = cli(['gcloud', 'auth', 'print-access-token', '--quiet'])
        if not token:
            raise RuntimeError('identity-unavailable')
        for name in TARGETS:
            try:
                report['sources'].append(capture(name, token, out))
            except (RuntimeError, ValueError, TypeError, OSError, KeyError, json.JSONDecodeError) as exc:
                report['errors'].append({'scope': name, 'kind': str(exc) if type(exc) in (RuntimeError, ValueError) else type(exc).__name__})
    except (RuntimeError, OSError) as exc:
        report['errors'].append({'scope': 'setup', 'kind': str(exc) if type(exc) is RuntimeError else type(exc).__name__})
    report['completedAt'] = dt.datetime.now(dt.timezone.utc).isoformat()
    report['captureComplete'] = len(report['sources']) == len(TARGETS) and not report['errors']
    report['toolSha256'] = sha(Path(__file__).read_bytes())
    (out / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    target = out.with_suffix('.zip')
    with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as z:
        for file in sorted(out.iterdir()):
            z.write(file, file.name)
    target.chmod(0o600)
    print(json.dumps({'reviewZip': str(target), 'sourcesCaptured': len(report['sources']),
                      'captureComplete': report['captureComplete'], 'errors': report['errors'],
                      'productionWrites': 0}))
    if not report['captureComplete']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
