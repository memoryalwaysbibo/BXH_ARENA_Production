#!/usr/bin/env python3
"""Single-entrypoint source release. Default is read-only; --apply changes code."""
import argparse
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

NAME = 'projects/bxh-arena/locations/asia-east1/functions/familyRegistration'
API = 'https://cloudfunctions.googleapis.com/v2/'
SOURCE_MASK = 'buildConfig.source'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def file_map(data):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        names = [item.filename for item in archive.infolist() if not item.is_dir()]
        if len(names) != len(set(names)):
            raise RuntimeError('duplicate-source-paths')
        return {name: digest(archive.read(name)) for name in names}


def stable_config(metadata):
    value = copy.deepcopy(metadata)
    value['serviceConfig'].pop('revision', None)
    for field in ('source', 'sourceProvenance', 'build'):
        value['buildConfig'].pop(field, None)
    return {key: value.get(key) for key in (
        'environment', 'labels', 'description', 'kmsKeyName', 'eventTrigger',
        'buildConfig', 'serviceConfig')}


def save(path, value):
    tmp = path.with_suffix('.tmp')
    with tmp.open('w', encoding='utf-8') as stream:
        os.chmod(tmp, 0o600)
        json.dump(value, stream, indent=2)
    os.replace(tmp, path)


class Cloud:
    def __init__(self):
        self.token = None
        self.token_at = 0

    def request(self, method, url, body=None, authenticated=True, raw=False):
        headers = {}
        if authenticated:
            if not self.token or time.monotonic() - self.token_at > 300:
                self.token = subprocess.run(['gcloud', 'auth', 'print-access-token'],
                                            check=True, capture_output=True, text=True).stdout.strip()
                self.token_at = time.monotonic()
            headers.update({'Authorization': 'Bearer ' + self.token, 'x-goog-user-project': 'bxh-arena'})
        if body is not None:
            headers['Content-Type'] = 'application/zip' if raw else 'application/json'
        payload = body if raw else (canonical(body) if body is not None else None)
        request = urllib.request.Request(url, data=payload, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                data = response.read()
        except urllib.error.HTTPError as error:
            # Never include token, signed upload URL, or environment data in errors.
            raise RuntimeError('HTTP-' + str(error.code) + '-' + method) from None
        return data if raw else (json.loads(data) if data else {})

    def get(self):
        return self.request('GET', API + NAME)

    def source(self, metadata):
        source = metadata['buildConfig']['source']['storageSource']
        if not source.get('generation'):
            raise RuntimeError('source-generation-required')
        url = ('https://storage.googleapis.com/storage/v1/b/' + urllib.parse.quote(source['bucket'], safe='')
               + '/o/' + urllib.parse.quote(source['object'], safe='') + '?'
               + urllib.parse.urlencode({'alt': 'media', 'generation': source['generation']}))
        return self.request('GET', url, raw=True)

    def upload(self, data, before):
        body = {'environment': 'GEN_2'}
        if before.get('kmsKeyName'):
            body['kmsKeyName'] = before['kmsKeyName']
        result = self.request('POST', API + NAME.rsplit('/functions/', 1)[0] + '/functions:generateUploadUrl', body)
        # Signed URLs must be used WITHOUT Authorization.
        self.request('PUT', result['uploadUrl'], data, authenticated=False, raw=True)
        return result['storageSource']

    def patch(self, source):
        return self.request('PATCH', API + NAME + '?updateMask=' + SOURCE_MASK,
                            {'name': NAME, 'buildConfig': {'source': {'storageSource': source}}})

    def operation(self, name):
        parts = name.split('/')
        if len(parts) != 6 or parts[0] != 'projects' or parts[2:5] != ['locations', 'asia-east1', 'operations']:
            raise RuntimeError('unexpected-operation-name')
        if parts[1] != 'bxh-arena':
            project = self.request('GET', 'https://cloudresourcemanager.googleapis.com/v1/projects/bxh-arena')
            if parts[1] != str(project.get('projectNumber')):
                raise RuntimeError('unexpected-operation-project')
        return self.request('GET', API + name)


class Release:
    def __init__(self, directory, cloud=None, sleep=time.sleep, now=time.monotonic, emit=print):
        self.directory = Path(directory)
        self.cloud = cloud or Cloud()
        self.sleep, self.now, self.emit = sleep, now, emit
        self.manifest = json.loads((self.directory / 'manifest.json').read_text())
        self.before = json.loads((self.directory / 'baseline-description.json').read_text())
        self.original = (self.directory / 'original-source.zip').read_bytes()
        self.candidate = (self.directory / 'candidate-source.zip').read_bytes()
        if self.before.get('name') != NAME or self.before.get('environment') != 'GEN_2':
            raise RuntimeError('package-identity-mismatch')
        if digest(self.original) != self.manifest['originalSourceArchiveSha256']:
            raise RuntimeError('original-package-hash-mismatch')
        if digest(self.candidate) != self.manifest['candidateSourceArchiveSha256']:
            raise RuntimeError('candidate-package-hash-mismatch')
        if digest(canonical(self.before['serviceConfig'])) != self.manifest['serviceConfigSha256']:
            raise RuntimeError('baseline-config-package-mismatch')
        old, new = file_map(self.original), file_map(self.candidate)
        differences = {key for key in set(old) | set(new) if old.get(key) != new.get(key)}
        if differences != {'family-registration.js', 'registration-admission.cjs'} or set(old) - set(new):
            raise RuntimeError('unexpected-source-differences')
        if set(self.manifest['changedOrAdded']) != differences:
            raise RuntimeError('reviewed-source-list-mismatch')
        if any(new.get(key) != value for key, value in self.manifest['changedOrAdded'].items()):
            raise RuntimeError('reviewed-handler-hash-mismatch')

    def status(self, value, journal=None):
        result = {'status': value}
        if journal is not None:
            result['journal'] = str(journal)
        self.emit(json.dumps(result))

    def check(self):
        current = self.cloud.get()
        if current.get('name') != NAME or current.get('state') != 'ACTIVE':
            raise RuntimeError('function-not-active-or-wrong-identity')
        if current['buildConfig'] != self.before['buildConfig'] or stable_config(current) != stable_config(self.before):
            raise RuntimeError('live-source-or-config-drift')
        if digest(canonical(current['serviceConfig'])) != self.manifest['serviceConfigSha256']:
            raise RuntimeError('live-revision-or-config-drift')
        if digest(self.cloud.source(current)) != self.manifest['originalSourceArchiveSha256']:
            raise RuntimeError('live-source-archive-drift')
        self.status('LIVE_BASELINE_MATCHED')
        return current

    def verify(self, target):
        current = self.cloud.get()
        if current.get('state') != 'ACTIVE' or current.get('name') != NAME:
            raise RuntimeError('function-not-active-after-operation')
        if stable_config(current) != stable_config(self.before):
            raise RuntimeError('post-deploy-config-mismatch')
        if file_map(self.cloud.source(current)) != file_map(target):
            raise RuntimeError('post-deploy-source-mismatch')
        return current

    def submit(self, journal, state, before, target):
        uploaded = self.cloud.upload(target, before)
        # Re-read after uploading: never submit over a change observed here.
        current = self.cloud.get()
        if current != before:
            raise RuntimeError('live-changed-during-upload')
        state['phase'] = 'SUBMITTING'
        save(journal / 'journal.json', state)
        self.status('FUNCTION_SUBMITTING', journal)
        try:
            operation = self.cloud.patch(uploaded)
        except Exception:
            state['phase'] = 'SUBMISSION_UNCONFIRMED'
            save(journal / 'journal.json', state)
            self.status('SUBMISSION_UNCONFIRMED_USE_RESUME', journal)
            raise
        state['operation'] = operation['name']
        state['phase'] = 'OPERATION_PENDING'
        save(journal / 'journal.json', state)
        return self.resume(journal)

    def apply(self, journal_parent=None):
        before = self.check()
        journal = Path(tempfile.mkdtemp(prefix='bxh-registration-release-', dir=journal_parent or Path.home()))
        save(journal / 'before.json', before)
        state = {'name': NAME, 'phase': 'PREPARING', 'direction': 'apply',
                 'packageSha256': digest(self.candidate), 'operation': None}
        save(journal / 'journal.json', state)
        self.status('PREPARING_UPLOAD', journal)
        return self.submit(journal, state, before, self.candidate)

    def resume(self, journal):
        journal = Path(journal)
        state = json.loads((journal / 'journal.json').read_text())
        if state.get('name') != NAME or state.get('packageSha256') != digest(self.candidate):
            raise RuntimeError('journal-package-mismatch')
        target = self.original if state['direction'] == 'rollback' else self.candidate
        deadline = self.now() + 1200
        if state.get('phase') in ('DEPLOYED', 'ROLLED_BACK'):
            current = self.verify(target)
            if current != json.loads((journal / 'after.json').read_text()):
                raise RuntimeError('live-changed-after-completed-journal')
            self.status(state['phase'], journal)
            return True
        if not state.get('operation'):
            # A lost PATCH response must never cause an automatic second PATCH.
            current = self.cloud.get()
            if current.get('state') == 'ACTIVE':
                current = self.verify(target)
            else:
                self.status('SUBMISSION_UNCONFIRMED_RETRY_RESUME_LATER', journal)
                return False
        else:
            last_status = -30
            while True:
                operation = self.cloud.operation(state['operation'])
                if operation.get('done'):
                    if operation.get('error'):
                        state['phase'] = 'OPERATION_FAILED'
                        state['errorCode'] = operation['error'].get('code')
                        save(journal / 'operation-error.json', operation['error'])
                        save(journal / 'journal.json', state)
                        raise RuntimeError('function-operation-failed-see-journal')
                    break
                if self.now() >= deadline:
                    self.status('OPERATION_PENDING_USE_RESUME', journal)
                    return False
                if self.now() - last_status >= 30:
                    self.status('FUNCTION_OPERATION_PENDING', journal)
                    last_status = self.now()
                self.sleep(5)
            current = self.verify(target)
        state['phase'] = 'ROLLED_BACK' if state['direction'] == 'rollback' else 'DEPLOYED'
        save(journal / 'after.json', current)
        save(journal / 'journal.json', state)
        self.status(state['phase'], journal)
        return True

    def rollback(self, journal):
        journal = Path(journal)
        state = json.loads((journal / 'journal.json').read_text())
        if state.get('name') != NAME or state.get('packageSha256') != digest(self.candidate):
            raise RuntimeError('journal-package-mismatch')
        if state.get('phase') != 'DEPLOYED' or state.get('direction') != 'apply':
            raise RuntimeError('rollback-requires-verified-deployment')
        before = self.cloud.get()
        if before != json.loads((journal / 'after.json').read_text()):
            raise RuntimeError('live-changed-after-deploy-refusing-rollback')
        self.verify(self.candidate)
        state.update(direction='rollback', phase='PREPARING', operation=None)
        save(journal / 'journal.json', state)
        return self.submit(journal, state, before, self.original)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--package', type=Path, default=Path(__file__).resolve().parent)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--check', action='store_true')
    mode.add_argument('--apply', action='store_true')
    mode.add_argument('--resume', type=Path)
    mode.add_argument('--rollback', type=Path)
    args = parser.parse_args()
    release = Release(args.package)
    if args.apply:
        success = release.apply()
    elif args.resume:
        success = release.resume(args.resume)
    elif args.rollback:
        success = release.rollback(args.rollback)
    else:
        release.check()
        success = True
    if success is False:
        raise SystemExit(2)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print(json.dumps({'status': 'INTERRUPTED_USE_EXISTING_JOURNAL_TO_RESUME'}))
        raise SystemExit(130)
    except (RuntimeError, subprocess.CalledProcessError, urllib.error.URLError, OSError, ValueError, KeyError) as error:
        print(json.dumps({'status': 'STOPPED', 'reason': str(error) if isinstance(error, RuntimeError) else type(error).__name__}))
        raise SystemExit(1)
