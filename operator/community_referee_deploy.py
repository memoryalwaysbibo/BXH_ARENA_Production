#!/usr/bin/env python3
"""Deploy the pinned referee candidate with the community flag kept closed.

Default is read-only. --apply updates only the two existing function sources
and the Firestore Rules release. No Firestore data, flags or IAM are written.
Uses an already authenticated gcloud identity; no interactive login.
"""
import argparse
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

PROJECT = 'bxh-arena'
PARENT = 'projects/bxh-arena/locations/asia-east1'
NAMES = ('manageRefereeSeats', 'commitRefereeCommand')
ZIP_SHA = 'b814609e46528660c9017598870bcbf1cbd2d98b343ec50c6cc2def242754e91'
COMMIT = 'dbafbd9653e7f1944c6f3c3aec5ad4d68dde65e2'
CF = 'https://cloudfunctions.googleapis.com/v2/'
RULES = 'https://firebaserules.googleapis.com/v1/'
RELEASE = 'projects/bxh-arena/releases/cloud.firestore'
FLAGS = 'https://firestore.googleapis.com/v1/projects/bxh-arena/databases/(default)/documents/systemConfig/refereeSeatsV1'


class Stop(RuntimeError):
    pass


def digest(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def need(condition, reason):
    if not condition:
        raise Stop(reason)


def bundle(path):
    raw = path.read_bytes()
    need(digest(raw) == ZIP_SHA, 'candidate ZIP checksum mismatch')
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        ref = json.loads(archive.read('captured-live.json'))
        manifest = json.loads(archive.read('backend-manifest.json'))
        validation = json.loads(archive.read('validation.json'))
        need(validation['candidateCommit'] == COMMIT and manifest['project'] == PROJECT,
             'candidate identity mismatch')
        need(tuple(manifest['functions']) == NAMES, 'unexpected function scope')
        expected = {'functions/' + name for name in manifest['files']}
        need({name for name in archive.namelist() if name.startswith('functions/')} == expected,
             'unexpected source file scope')
        files = {name: archive.read('functions/' + name) for name in manifest['files']}
        for name, data in files.items():
            need(digest(data) == manifest['files'][name]['candidateSha256'], 'source checksum mismatch: ' + name)
        rules = archive.read('firestore.rules')
        need(digest(rules) == manifest['rulesCandidateSha256'], 'candidate Rules checksum mismatch')
    need(ref['rulesSha256'] == manifest['rulesBaselineSha256'], 'baseline Rules mismatch')
    return ref, manifest, files, rules


class Cloud:
    """No write retries; signed upload requests never carry an OAuth header."""
    def __init__(self):
        self.token, self.token_at, self.reads, self.writes = '', 0, 0, 0

    def bearer(self):
        if time.monotonic() - self.token_at > 2400 or not self.token:
            result = subprocess.run(['gcloud', 'auth', 'print-access-token', '--quiet'],
                                    capture_output=True, text=True, timeout=60)
            need(result.returncode == 0 and result.stdout.strip(), 'gcloud identity unavailable')
            self.token, self.token_at = result.stdout.strip(), time.monotonic()
        return self.token

    def request(self, method, url, data=None):
        need(urllib.parse.urlsplit(url).hostname in
             ('cloudfunctions.googleapis.com', 'firebaserules.googleapis.com', 'firestore.googleapis.com'),
             'unexpected API host')
        payload = None if data is None else json.dumps(data).encode()
        request = urllib.request.Request(url, data=payload, method=method,
                  headers={'Authorization': 'Bearer ' + self.bearer(), 'Content-Type': 'application/json'})
        if method == 'GET':
            self.reads += 1
        else:
            self.writes += 1
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            raise Stop(method + ' API returned HTTP ' + str(error.code)) from None
        except (urllib.error.URLError, TimeoutError):
            raise Stop(method + ' API reply unavailable; inspect the journal before retrying') from None

    def upload(self, url, data):
        parsed = urllib.parse.urlsplit(url)
        host = parsed.hostname or ''
        need(parsed.scheme == 'https' and (host == 'storage.googleapis.com'
             or host.endswith('.storage.googleapis.com')), 'unexpected upload host')
        request = urllib.request.Request(url, data=data, method='PUT',
                                        headers={'Content-Type': 'application/zip'})
        self.writes += 1
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                response.read()
        except (urllib.error.URLError, TimeoutError):
            raise Stop('source upload not confirmed; no automatic retry') from None


class Deployment:
    def __init__(self, cloud, ref, manifest, files, rules, journal=None, wait=time.sleep):
        self.cloud, self.ref, self.manifest = cloud, ref, manifest
        self.files, self.rules, self.journal, self.wait = files, rules, journal, wait
        self.state = {'candidateCommit': COMMIT, 'project': PROJECT, 'status': 'STARTED',
                      'functions': {}, 'firestoreDataWrites': 0, 'iamWrites': 0, 'flagWrites': 0}
        self.initial, self.expected_sources = {}, {}

    def mark(self, status, **fields):
        self.state.update(status=status, **fields)
        if self.journal:
            target = self.journal / 'state.json'
            temporary = self.journal / 'state.json.tmp'
            temporary.write_text(json.dumps(self.state, indent=2) + '\n')
            temporary.replace(target)
        print(json.dumps({'status': status, **fields}, ensure_ascii=False), flush=True)

    def live_rules(self):
        release = self.cloud.request('GET', RULES + RELEASE)
        name = release.get('rulesetName', '')
        need(name.startswith('projects/bxh-arena/rulesets/'), 'Rules project mismatch')
        files = self.cloud.request('GET', RULES + name).get('source', {}).get('files', [])
        need(len(files) == 1 and isinstance(files[0].get('content'), str), 'unexpected Rules source')
        return release, files[0]

    def check_flags(self, expected_hash=None):
        fields = self.cloud.request('GET', FLAGS).get('fields', {})
        for name in ('enabled', 'perCourtScoringVerified', 'partnerSeatsEnabled'):
            need(fields.get(name) == self.ref['runtimeFlags']['flags'][name], 'runtime flag changed: ' + name)
        need(fields.get('communitySeatsEnabled', {}).get('booleanValue') is not True,
             'community flag already enabled; inspect current rollout')
        actual = digest(canonical(fields))
        need(expected_hash is None or actual == expected_hash, 'runtime config changed during deployment')
        return actual

    @staticmethod
    def service_fingerprint(info):
        return digest(canonical({key: value for key, value in info.get('serviceConfig', {}).items()
                                 if key != 'revision'}))

    def check_function(self, old, expected_source, original=None):
        name = PARENT + '/functions/' + old['entryPoint']
        need(old['name'] == name and old['entryPoint'] in NAMES, 'unexpected function identity')
        info = self.cloud.request('GET', CF + name)
        build, service = info.get('buildConfig', {}), info.get('serviceConfig', {})
        need(info.get('name') == name and info.get('state') == 'ACTIVE', 'function not active: ' + old['entryPoint'])
        need(build.get('runtime') == old['runtime'] and build.get('entryPoint') == old['entryPoint'], 'function runtime/entry point changed')
        need(build.get('source', {}).get('storageSource') == expected_source, 'function source changed: ' + old['entryPoint'])
        if original is None:
            need(all(service.get(key) == value for key, value in old['service'].items()), 'function configuration changed')
        else:
            need(self.service_fingerprint(info) == self.service_fingerprint(original), 'function configuration did not remain unchanged')
        return info

    def preflight(self):
        release, source = self.live_rules()
        need(digest(source['content'].encode()) == self.manifest['rulesBaselineSha256'], 'live Rules changed')
        self.release_before, self.rule_file_before = release, source
        self.flag_hash = self.check_flags()
        for old in self.ref['functions']:
            name = old['entryPoint']
            self.initial[name] = self.check_function(old, old['storageSource'])
            self.expected_sources[name] = old['storageSource']
        self.mark('BASELINE_MATCHED', cloudWrites=self.cloud.writes, communityEnabled=False)

    def fence(self):
        release, source = self.live_rules()
        need(release['rulesetName'] == self.release_before['rulesetName'] and
             digest(source['content'].encode()) == self.manifest['rulesBaselineSha256'], 'live Rules changed during deployment')
        self.check_flags(self.flag_hash)
        for old in self.ref['functions']:
            self.check_function(old, self.expected_sources[old['entryPoint']], self.initial[old['entryPoint']])

    def poll(self, operation):
        name = operation.get('name', '')
        need(name.startswith(PARENT + '/operations/'), 'unexpected deployment operation')
        self.state['operation'] = name
        self.mark('FUNCTION_OPERATION_PENDING')
        deadline, last_progress = time.monotonic() + 1800, time.monotonic()
        while not operation.get('done'):
            need(time.monotonic() < deadline, 'deployment polling timeout; inspect recorded operation')
            self.wait(10)
            operation = self.cloud.request('GET', CF + name)
            if time.monotonic() - last_progress >= 30:
                print('Waiting for ' + name, flush=True)
                last_progress = time.monotonic()
        need(not operation.get('error'), 'function deployment operation failed; code ' + str(operation.get('error', {}).get('code')))

    def verify_source(self, name, info):
        source = info['buildConfig']['source']['storageSource']
        generation = str(source.get('generation', ''))
        need(generation.isdigit() and int(generation) > 0 and '#' not in source['object'], 'source generation not pinned')
        path = self.journal / (name + '.deployed-source.zip')
        result = subprocess.run(['gcloud', 'storage', 'cp', 'gs://' + source['bucket'] + '/' + source['object'] + '#' + generation,
                                 str(path), '--quiet'], capture_output=True, text=True, timeout=180)
        need(result.returncode == 0, 'deployed source download failed')
        with zipfile.ZipFile(path) as archive:
            names = [item.filename for item in archive.infolist() if not item.is_dir()]
            need(set(names) == set(self.files) and len(names) == len(self.files), 'deployed source scope mismatch')
            for filename in names:
                need(digest(archive.read(filename)) == self.manifest['files'][filename]['candidateSha256'], 'deployed source checksum mismatch: ' + filename)
        return source

    def apply(self):
        need(self.journal is not None and len(self.initial) == 2, 'preflight/journal required')
        (self.journal / 'firestore.before.rules').write_text(self.rule_file_before['content'])
        self.state['rulesReleaseBefore'] = self.release_before
        self.state['sourceBefore'] = {old['entryPoint']: old['storageSource'] for old in self.ref['functions']}
        self.mark('PREPARING_SOURCE_UPLOAD')
        output = io.BytesIO()
        with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
            for name in sorted(self.files):
                entry = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
                entry.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(entry, self.files[name])
        upload = self.cloud.request('POST', CF + PARENT + '/functions:generateUploadUrl', {'environment': 'GEN_2'})
        storage = upload.get('storageSource', {})
        need(storage.get('bucket') and storage.get('object'), 'upload storage source unavailable')
        self.cloud.upload(upload['uploadUrl'], output.getvalue())
        for old in self.ref['functions']:
            name = old['entryPoint']
            self.fence()
            self.mark('FUNCTION_SUBMITTING', currentFunction=name)
            operation = self.cloud.request('PATCH', CF + old['name'] + '?updateMask=buildConfig.source',
                        {'name': old['name'], 'buildConfig': {'source': {'storageSource': storage}}})
            self.poll(operation)
            info = self.cloud.request('GET', CF + old['name'])
            source = self.verify_source(name, info)
            self.expected_sources[name] = source
            self.check_function(old, source, self.initial[name])
            self.state['functions'][name] = {'verified': True, 'source': source, 'revision': info.get('serviceConfig', {}).get('revision')}
            self.mark('FUNCTION_SOURCE_VERIFIED', currentFunction=name)
        self.fence()
        self.mark('RULESET_CREATING')
        ruleset = self.cloud.request('POST', RULES + 'projects/bxh-arena/rulesets',
                                    {'source': {'files': [{'name': self.rule_file_before['name'], 'content': self.rules.decode()}]}})
        target = ruleset.get('name', '')
        need(target.startswith('projects/bxh-arena/rulesets/'), 'unexpected candidate ruleset')
        self.state['candidateRuleset'] = target
        self.fence()
        self.mark('RULES_RELEASE_SUBMITTING')
        self.cloud.request('PATCH', RULES + RELEASE,
                           {'release': {'name': RELEASE, 'rulesetName': target}, 'updateMask': 'rulesetName'})
        release, source = self.live_rules()
        need(release['rulesetName'] == target and digest(source['content'].encode()) == self.manifest['rulesCandidateSha256'], 'Rules release readback mismatch')
        self.check_flags(self.flag_hash)
        for old in self.ref['functions']:
            self.check_function(old, self.expected_sources[old['entryPoint']], self.initial[old['entryPoint']])
        self.mark('DEPLOYED_WITH_COMMUNITY_CLOSED', cloudReads=self.cloud.reads,
                  cloudDeploymentRequests=self.cloud.writes, communityEnabled=False,
                  rulesSha256=self.manifest['rulesCandidateSha256'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', type=Path, default=Path.home() / 'BXH-community-referee-candidate-dbafbd9.zip')
    parser.add_argument('--apply', action='store_true', help='Actually deploy two existing sources and Rules; leave rollout closed')
    args = parser.parse_args()
    os.umask(0o077)
    deployment = None
    try:
        ref, manifest, files, rules = bundle(args.bundle)
        cloud = Cloud()
        deployment = Deployment(cloud, ref, manifest, files, rules)
        deployment.preflight()
        if args.apply:
            deployment.journal = Path(tempfile.mkdtemp(prefix='bxh-community-deploy-', dir=Path.home()))
            print('Deployment journal: ' + str(deployment.journal), flush=True)
            deployment.apply()
    except (Stop, OSError, ValueError, KeyError, zipfile.BadZipFile, subprocess.TimeoutExpired) as error:
        reason = str(error) if isinstance(error, Stop) else type(error).__name__
        if deployment:
            deployment.mark('STOPPED', reason=reason)
        else:
            print(json.dumps({'status': 'STOPPED', 'reason': reason}))
        raise SystemExit(1)


if __name__ == '__main__':
    main()
