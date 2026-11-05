#!/usr/bin/env python3
"""Read-only follow-up to the 2026-11-05 BXH writer discovery capture."""
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
import urllib.parse
import urllib.request
import zipfile

PROJECT = 'bxh-arena'
PARENT_REPORT_SHA = '88f19f67186a2e68244bcf260c082116d3e8d8473781421c61da397a0c73df5d'
FUNCTIONS = ('manageRefereeSeats', 'familyRegistration', 'trackTournamentRegistrationActivity', 'observeNumberAccount')
SOURCE_TARGETS = frozenset(('manageRefereeSeats', 'familyRegistration'))
FUNCTION_ROOT = f'https://cloudfunctions.googleapis.com/v2/projects/{PROJECT}/locations/asia-east1/functions/'
RUN_ROOT = f'https://run.googleapis.com/v2/projects/{PROJECT}/locations/me-central2/'
ALLOWED = {FUNCTION_ROOT + name for name in FUNCTIONS} | {RUN_ROOT + kind for kind in ('services', 'jobs')}


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def digest(value):
    return sha(json.dumps(value, sort_keys=True, separators=(',', ':')).encode())


def cli(args):
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=240, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise RuntimeError('Read-only gcloud command unavailable or timed out') from None
    if result.returncode:
        raise RuntimeError('Read-only gcloud command failed')
    return result.stdout.strip()


class ReadError(RuntimeError):
    def __init__(self, details):
        super().__init__('Read API failed')
        self.details = details


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ReadError({'kind': 'redirect-refused'})


def safe_http_error(code, raw):
    result = {'kind': 'http', 'httpStatus': code, 'payloadSha256': sha(raw)}
    try:
        error = json.loads(raw).get('error', {})
        status = error.get('status')
        if isinstance(status, str) and re.fullmatch(r'[A-Z_]{1,80}', status):
            result['googleStatus'] = status
        reasons = {x.get('reason') for x in error.get('details', []) + error.get('errors', []) if isinstance(x, dict)}
        result['reasons'] = sorted(x for x in reasons if isinstance(x, str) and re.fullmatch(r'[A-Z_]{1,80}', x))
    except (ValueError, TypeError, AttributeError):
        pass
    return result


def get(url, token):
    parts = urllib.parse.urlsplit(url)
    base = urllib.parse.urlunsplit((parts.scheme, parts.netloc, parts.path, '', ''))
    if base not in ALLOWED or parts.fragment or set(urllib.parse.parse_qs(parts.query)) - {'pageSize', 'pageToken'}:
        raise ReadError({'kind': 'unexpected-endpoint'})
    request = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + token}, method='GET')
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=60) as response:
            raw = response.read(32 * 1024 * 1024 + 1)
        if len(raw) > 32 * 1024 * 1024:
            raise ReadError({'kind': 'response-too-large'})
        data = json.loads(raw)
        if not isinstance(data, dict):
            raise ReadError({'kind': 'invalid-response'})
        return data
    except urllib.error.HTTPError as exc:
        raise ReadError(safe_http_error(exc.code, exc.read(1024 * 1024))) from None
    except (urllib.error.URLError, TimeoutError, ValueError):
        raise ReadError({'kind': 'transport-or-invalid-response'}) from None


def retry_region(kind, token, read=get, project_number=None):
    rows, seen, names = [], set(), set()
    page = ''
    for _ in range(100):
        query = urllib.parse.urlencode({'pageSize': 100, **({'pageToken': page} if page else {})})
        data = read(RUN_ROOT + kind + '?' + query, token)
        if not isinstance(data.get(kind, []), list) or data.get('unreachable'):
            raise ReadError({'kind': 'incomplete-listing'})
        for item in data.get(kind, []):
            name = item.get('name', '')
            match = re.fullmatch(r'projects/([^/]+)/locations/me-central2/' + kind + r'/[A-Za-z0-9_-]+', name)
            if not match or match[1] not in {PROJECT, project_number} or name in names:
                raise ReadError({'kind': 'invalid-or-duplicate-resource'})
            names.add(name)
            rows.append({'name': name, 'metadataSha256': digest(item), 'writerClassification': 'unreviewed'})
        next_page = data.get('nextPageToken', '')
        if not next_page:
            return {'scope': 'run-' + kind + ':me-central2', 'complete': True, 'resources': rows}
        if not isinstance(next_page, str) or next_page in seen:
            raise ReadError({'kind': 'repeated-listing-page'})
        seen.add(next_page)
        page = next_page
    raise ReadError({'kind': 'listing-page-budget'})


def capture_function(name, token, destination, read=get, command=cli):
    info = read(FUNCTION_ROOT + name, token)
    if info.get('name') != f'projects/{PROJECT}/locations/asia-east1/functions/{name}' or info.get('state') != 'ACTIVE':
        raise ReadError({'kind': 'function-identity-or-state'})
    build, service = info.get('buildConfig', {}), info.get('serviceConfig', {})
    if name in SOURCE_TARGETS and build.get('entryPoint') != name:
        raise ReadError({'kind': 'unexpected-function-entrypoint'})
    source = build.get('source', {}).get('storageSource', {})
    row = {'name': name, 'environment': info.get('environment'), 'updateTime': info.get('updateTime'),
           'revision': service.get('revision'), 'runtime': build.get('runtime'), 'entryPoint': build.get('entryPoint'),
           'metadataSha256': digest(info), 'buildConfigSha256': digest(build),
           'serviceConfigSha256': digest(service), 'eventTriggerSha256': digest(info.get('eventTrigger')),
           'sourceStorageSha256': digest(source)}
    if name in SOURCE_TARGETS:
        bucket, obj, generation = source.get('bucket', ''), source.get('object', ''), str(source.get('generation', ''))
        if not re.fullmatch(r'[a-z0-9][a-z0-9._-]+', bucket) or not obj or '#' in obj or not generation.isdecimal():
            raise ReadError({'kind': 'immutable-source-unavailable'})
        path = destination / (name + '.source.zip')
        command(['gcloud', 'storage', 'cp', f'gs://{bucket}/{obj}#{generation}', str(path), '--quiet'])
        path.chmod(0o600)
        if not zipfile.is_zipfile(path):
            raise ReadError({'kind': 'invalid-source-archive'})
        row.update({'source': source, 'sourceArchiveFile': path.name, 'sourceArchiveSha256': sha(path.read_bytes())})
        # Detect a deployment/config change while the immutable archive is downloading.
        after = read(FUNCTION_ROOT + name, token)
        row['stableDuringCapture'] = digest(after) == row['metadataSha256']
        if not row['stableDuringCapture']:
            raise ReadError({'kind': 'function-changed-during-capture'})
    return row


def main():
    argparse.ArgumentParser(description=__doc__).parse_args()
    os.umask(0o077)
    destination = Path(tempfile.mkdtemp(prefix='bxh-writer-followup-', dir=Path.home()))
    report = {'stage': 'BUCKET_WRITER_TARGETED_READONLY_FOLLOWUP', 'project': PROJECT,
              'startedAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'parentReportSha256': PARENT_REPORT_SHA,
              'productionWrites': 0, 'deploymentPerformed': False, 'roomActivationPerformed': False,
              'regionRetries': [], 'targetFunctions': [], 'errors': [],
              'writerInventoryComplete': False, 'acceptanceCompleted': False}
    try:
        if cli(['gcloud', 'config', 'get-value', 'project', '--quiet']) != PROJECT:
            raise RuntimeError('Wrong active project')
        token = cli(['gcloud', 'auth', 'print-access-token', '--quiet'])
        if not token:
            raise RuntimeError('No gcloud identity')
        project_number = cli(['gcloud', 'projects', 'describe', PROJECT, '--format=value(projectNumber)', '--quiet'])
        if not re.fullmatch(r'[0-9]{6,20}', project_number):
            raise RuntimeError('Project number unavailable')
        for kind in ('services', 'jobs'):
            try:
                report['regionRetries'].append(retry_region(kind, token, project_number=project_number))
            except ReadError as exc:
                report['errors'].append({'scope': 'run-' + kind + ':me-central2', **exc.details})
        for name in FUNCTIONS:
            try:
                report['targetFunctions'].append(capture_function(name, token, destination))
            except ReadError as exc:
                report['errors'].append({'scope': name, **exc.details})
            except (RuntimeError, OSError, ValueError, TypeError, AttributeError):
                report['errors'].append({'scope': name, 'kind': 'source-read-incomplete'})
    except (RuntimeError, OSError, ValueError, TypeError, AttributeError):
        report['errors'].append({'scope': 'setup', 'kind': 'read-only-setup-incomplete'})
    report['completedAt'] = dt.datetime.now(dt.timezone.utc).isoformat()
    report['followupComplete'] = not report['errors']
    report['toolSha256'] = sha(Path(__file__).read_bytes())
    path = destination / 'report.json'
    path.write_text(json.dumps(report, indent=2) + '\n')
    path.chmod(0o600)
    archive = destination.with_suffix('.zip')
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as output:
        for item in sorted(destination.iterdir()):
            output.write(item, item.name)
    archive.chmod(0o600)
    print(json.dumps({'reviewZip': str(archive), 'followupComplete': report['followupComplete'],
                      'functionsCaptured': len(report['targetFunctions']), 'errors': report['errors'], 'productionWrites': 0}))
    if not report['followupComplete']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
