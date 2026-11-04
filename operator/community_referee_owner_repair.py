#!/usr/bin/env python3
"""Repair only the two live referee function sources; default is read-only.

Requires the original pinned candidate ZIP in Cloud Shell and an authenticated
gcloud identity. No Rules, Firestore documents, flags, or IAM are written.
"""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

PROJECT = 'bxh-arena'
PARENT = 'projects/bxh-arena/locations/asia-east1'
ROOT = 'https://cloudfunctions.googleapis.com/v2/'
RULES = 'https://firebaserules.googleapis.com/v1/'
FLAGS = 'https://firestore.googleapis.com/v1/projects/bxh-arena/databases/(default)/documents/systemConfig/refereeSeatsV1'
NAMES = ('manageRefereeSeats', 'commitRefereeCommand')
ZIP_SHA = 'b814609e46528660c9017598870bcbf1cbd2d98b343ec50c6cc2def242754e91'
LIVE_RULES_SHA = 'dbdb8dc9ba46a110d6f8786cdc7ee4b9badc6bd3120769f4393bf51f31cbc9c3'
EXPECTED = {
    'core.cjs': ('fd0011e096c31594322e164a1864fe08c3e96486a737cbba8511956fe4126635',
                 '49b60f3b40a1c5dffad71850a14d7207b636cc748ae8654ece346c9a014ec237'),
    'service.cjs': ('a562e06c05b71594d732fa28545e04dba8c52bf63941c19e085276a782a1270a',
                    '85ee42439caf548ea15209c696bc8e653a086aae1a70b5960768941637ae7e49'),
}
PATCHES = {
    'core.cjs': [
        ("return communityRoom(room,authority)&&EventStaff.activeAccount(user)&&user.role==='player'\n  &&!!uid&&room.ownerUid===uid&&room.createdBy===uid;",
         "return communityRoom(room,authority)&&EventStaff.activeAccount(user)\n  &&['player','staff','admin','super_admin'].includes(user.role)\n  &&!!uid&&room.ownerUid===uid&&room.createdBy===uid;"),
        ("&&EventStaff.activeAccount(user)&&user.role==='player'&&room.createdBy===uid&&room.ownerUid===uid;",
         "&&communityOwner(room,user,uid,authority);"),
        ("!EventStaff.activeAccount(requesterUser)||requesterUser.role!=='player')fail('request-stale');",
         "!communityOwner(room,requesterUser,req.fromUid,authority))fail('request-stale');"),
    ],
    'service.cjs': [
        ("const communityReceipt=room.eventAuthority==='community'&&authority.communitySeatsEnabled\n   &&activeAccount(user)&&user.role==='player'&&(\n    (['invite','revoke'].includes(d.action)&&room.ownerUid===uid&&room.createdBy===uid)\n    ||(d.action==='accept-invite'&&room.refereeSeatsV1?.requests?.[d.requestId]?.toUid===uid));",
         "const communityReceipt=(['invite','revoke'].includes(d.action)&&C.communityOwner(room,user,uid,authority))\n   ||(d.action==='accept-invite'&&C.communityRoom(room,authority)&&activeAccount(user)\n    &&user.role==='player'&&room.refereeSeatsV1?.requests?.[d.requestId]?.toUid===uid);"),
    ],
}


class Stop(RuntimeError):
    pass


def need(condition, reason):
    if not condition:
        raise Stop(reason)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def canonical(data):
    return json.dumps(data, sort_keys=True, separators=(',', ':')).encode()


def build(path):
    raw = path.read_bytes()
    need(digest(raw) == ZIP_SHA, 'original candidate ZIP checksum mismatch')
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        manifest = json.loads(archive.read('backend-manifest.json'))
        original = {name: archive.read('functions/' + name) for name in manifest['files']}
    need(manifest['project'] == PROJECT and tuple(manifest['functions']) == NAMES, 'candidate scope changed')
    for name, data in original.items():
        need(digest(data) == manifest['files'][name]['candidateSha256'], 'candidate file mismatch: ' + name)
    patched = dict(original)
    for name, patches in PATCHES.items():
        need(digest(patched[name]) == EXPECTED[name][0], 'source baseline mismatch: ' + name)
        content = patched[name].decode()
        for before, after in patches:
            need(content.count(before) == 1, 'patch context mismatch: ' + name)
            content = content.replace(before, after)
        patched[name] = content.encode()
        need(digest(patched[name]) == EXPECTED[name][1], 'patch result mismatch: ' + name)
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name, data in sorted(patched.items()):
            entry = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(entry, data)
    return original, patched, output.getvalue()


class Cloud:
    def __init__(self):
        self.token = ''
        self.token_at = 0
        self.reads = 0
        self.writes = 0

    def bearer(self):
        if not self.token or time.monotonic() - self.token_at > 2400:
            result = subprocess.run(['gcloud', 'auth', 'print-access-token', '--quiet'],
                                    capture_output=True, text=True, timeout=60)
            need(result.returncode == 0 and result.stdout.strip(), 'gcloud identity unavailable')
            self.token = result.stdout.strip()
            self.token_at = time.monotonic()
        return self.token

    def request(self, method, url, data=None):
        need(urllib.parse.urlsplit(url).hostname in
             ('cloudfunctions.googleapis.com', 'firebaserules.googleapis.com', 'firestore.googleapis.com'),
             'unexpected API host')
        body = None if data is None else json.dumps(data).encode()
        request = urllib.request.Request(url, data=body, method=method,
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
            raise Stop('API response uncertain; inspect the deployment before retrying') from None

    def upload(self, url, data):
        host = urllib.parse.urlsplit(url).hostname or ''
        need(urllib.parse.urlsplit(url).scheme == 'https' and
             (host == 'storage.googleapis.com' or host.endswith('.storage.googleapis.com')),
             'unexpected upload host')
        request = urllib.request.Request(url, data=data, method='PUT',
                                         headers={'Content-Type': 'application/zip'})
        self.writes += 1
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                response.read()
        except (urllib.error.URLError, TimeoutError):
            raise Stop('upload response uncertain; inspect before retrying') from None


def source_files(source):
    need(str(source.get('generation', '')).isdigit() and source.get('bucket') and source.get('object'),
         'source is not generation pinned')
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / 'source.zip'
        url = 'gs://' + source['bucket'] + '/' + source['object'] + '#' + str(source['generation'])
        result = subprocess.run(['gcloud', 'storage', 'cp', url, str(path), '--quiet'],
                                capture_output=True, text=True, timeout=180)
        need(result.returncode == 0, 'deployed source unavailable')
        with zipfile.ZipFile(path) as archive:
            names = [item.filename for item in archive.infolist() if not item.is_dir()]
            need(len(names) == len(set(names)) and all(
                name and not name.startswith('/') and '\\' not in name
                and '..' not in PurePosixPath(name).parts
                and PurePosixPath(name).as_posix() == name for name in names),
                 'deployed source scope mismatch')
            return {name: archive.read(name) for name in names}


def fingerprint(info):
    return digest(canonical({key: value for key, value in info['serviceConfig'].items() if key != 'revision'}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', type=Path, default=Path.home() / 'BXH-community-referee-candidate-dbafbd9.zip')
    parser.add_argument('--build-only', action='store_true')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    os.umask(0o077)
    try:
        original, patched, payload = build(args.bundle)
        if args.build_only:
            print(json.dumps({'status': 'PATCH_VERIFIED', 'sourceSha256': digest(payload)}))
            return
        cloud = Cloud()

        def fence(expected_sources=None, initial=None):
            release = cloud.request('GET', RULES + 'projects/bxh-arena/releases/cloud.firestore')
            ruleset = release.get('rulesetName', '')
            need(ruleset.startswith('projects/bxh-arena/rulesets/'), 'Rules project mismatch')
            files = cloud.request('GET', RULES + ruleset).get('source', {}).get('files', [])
            need(len(files) == 1 and digest(files[0]['content'].encode()) == LIVE_RULES_SHA,
                 'live Rules changed')
            fields = cloud.request('GET', FLAGS).get('fields', {})
            need(fields.get('enabled', {}).get('booleanValue') is True and
                 fields.get('perCourtScoringVerified', {}).get('booleanValue') is True and
                 fields.get('communitySeatsEnabled', {}).get('booleanValue') is True,
                 'community rollout is not enabled')
            flag_hash = digest(canonical(fields))
            infos = {}
            for name in NAMES:
                full = PARENT + '/functions/' + name
                info = cloud.request('GET', ROOT + full)
                need(info.get('name') == full and info.get('state') == 'ACTIVE' and
                     info.get('buildConfig', {}).get('runtime') == 'nodejs22' and
                     info.get('buildConfig', {}).get('entryPoint') == name,
                     'function identity changed: ' + name)
                source = info['buildConfig']['source']['storageSource']
                if expected_sources is not None:
                    need(source == expected_sources[name], 'function source changed: ' + name)
                if initial is not None:
                    need(fingerprint(info) == fingerprint(initial[name]), 'function config changed: ' + name)
                infos[name] = info
            return ruleset, flag_hash, infos

        baseline_rules, baseline_flags, initial = fence()
        sources = {name: initial[name]['buildConfig']['source']['storageSource'] for name in NAMES}
        for name in NAMES:
            deployed = source_files(sources[name])
            need(set(deployed) == set(original) and
                 all(deployed[file] == data for file, data in original.items()),
                 'live source is not the pinned candidate: ' + name)
        print(json.dumps({'status': 'LIVE_BASELINE_MATCHED', 'cloudWrites': cloud.writes,
                          'communityEnabled': True, 'sourceSha256': digest(payload)}), flush=True)
        if not args.apply:
            return
        journal = Path(tempfile.mkdtemp(prefix='bxh-referee-owner-repair-', dir=Path.home()))
        record = {'status': 'STARTED', 'sourceBefore': sources, 'rulesetBefore': baseline_rules,
                  'flagHashBefore': baseline_flags, 'sourceSha256': digest(payload), 'verified': []}

        def mark(status):
            record['status'] = status
            (journal / 'state.json.tmp').write_text(json.dumps(record, indent=2) + '\n')
            (journal / 'state.json.tmp').replace(journal / 'state.json')
            print(json.dumps({'status': status, 'journal': str(journal)}), flush=True)

        mark('PREPARING_UPLOAD')
        upload = cloud.request('POST', ROOT + PARENT + '/functions:generateUploadUrl', {'environment': 'GEN_2'})
        storage = upload.get('storageSource', {})
        need(storage.get('bucket') and storage.get('object'), 'upload source missing')
        cloud.upload(upload['uploadUrl'], payload)
        for name in NAMES:
            ruleset, flag_hash, infos = fence(sources, initial)
            need(ruleset == baseline_rules and flag_hash == baseline_flags, 'Rules/flags changed during repair')
            full = PARENT + '/functions/' + name
            record['currentFunction'] = name
            mark('FUNCTION_SUBMITTING')
            operation = cloud.request('PATCH', ROOT + full + '?updateMask=buildConfig.source',
                {'name': full, 'buildConfig': {'source': {'storageSource': storage}}})
            op_name = operation.get('name', '')
            need(op_name.startswith(PARENT + '/operations/'), 'operation name unexpected')
            record['operation'] = op_name
            mark('FUNCTION_OPERATION_PENDING')
            deadline = time.monotonic() + 1800
            while not operation.get('done'):
                need(time.monotonic() < deadline, 'operation timed out; inspect journal')
                time.sleep(10)
                operation = cloud.request('GET', ROOT + op_name)
            need(not operation.get('error'), 'function operation failed; inspect journal')
            info = cloud.request('GET', ROOT + full)
            source = info['buildConfig']['source']['storageSource']
            need(fingerprint(info) == fingerprint(initial[name]), 'service configuration changed')
            deployed = source_files(source)
            need(set(deployed) == set(patched) and
                 all(deployed[file] == data for file, data in patched.items()),
                 'deployed source differs from patch: ' + name)
            sources[name] = source
            record['verified'].append(name)
            mark('FUNCTION_SOURCE_VERIFIED')
        ruleset, flag_hash, infos = fence(sources, initial)
        need(ruleset == baseline_rules and flag_hash == baseline_flags, 'final Rules/flags changed')
        mark('DEPLOYED')
        print(json.dumps({'cloudReads': cloud.reads, 'cloudDeploymentRequests': cloud.writes,
                          'communityEnabled': True, 'functionsVerified': len(record['verified'])}), flush=True)
    except (Stop, OSError, ValueError, KeyError, zipfile.BadZipFile, subprocess.TimeoutExpired) as error:
        print(json.dumps({'status': 'STOPPED', 'reason': str(error) if isinstance(error, Stop)
                          else type(error).__name__}), flush=True)
        raise SystemExit(1)


if __name__ == '__main__':
    main()
