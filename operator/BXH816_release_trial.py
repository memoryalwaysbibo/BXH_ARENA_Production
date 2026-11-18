#!/usr/bin/env python3
"""One-function source-only release or rollback. Default is read-only; never changes Rules, IAM, flags or rooms."""
import argparse
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import time
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('trial_prepare816', ROOT / 'operator/BXH816_prepare_trial.py')
PREP = importlib.util.module_from_spec(spec); spec.loader.exec_module(PREP)
CAP = PREP.CAP
BASE = 'https://cloudfunctions.googleapis.com/v2/'
PARENT = 'projects/bxh-arena/locations/asia-east1'
CANDIDATES = {
    'commitBucketRefereeCommand': '0523788c99bb3e2818865408ba2986eb6ef6f1eb9247c97d5a4f883c23b4cd5f',
    'manageBucketRefereeSeats': '4c8fd748bb6ff74480e78d4640258154d879d7c33a948da37b528ed3f12a0dce',
    'projectBucketPublicScore': '31c224bfdf6d18a51131598c3af90f6284b130a975683df2d621e9fa4c7a64cf'}


def digest(value):
    if not isinstance(value, bytes): value = json.dumps(value, sort_keys=True, separators=(',', ':')).encode()
    return hashlib.sha256(value).hexdigest()


def token(): return CAP.command(['gcloud', 'auth', 'print-access-token', '--quiet']).strip()


def api(resource, method='GET', body=None):
    request = urllib.request.Request(BASE + resource, method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={'Authorization': 'Bearer ' + token(), 'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=60) as response: return json.load(response)


def upload(url, raw):
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != 'https' or not (parsed.hostname or '').endswith('.googleapis.com'):
        raise ValueError('Unexpected signed upload host')
    # Signed PUT must not contain OAuth credentials. Never log its URL.
    request = urllib.request.Request(url, method='PUT', data=raw, headers={'Content-Type': 'application/zip'})
    with urllib.request.urlopen(request, timeout=120) as response:
        if response.status not in (200, 201): raise ValueError('Source upload failed')


def protected(info):
    service = {k: v for k, v in info.get('serviceConfig', {}).items() if k not in ('uri', 'service', 'revision')}
    build = info.get('buildConfig', {})
    return {'serviceConfig': service, 'buildConfig': {k: build[k] for k in
        ('runtime', 'entryPoint', 'environmentVariables', 'serviceAccount', 'workerPool', 'dockerRegistry', 'dockerRepository') if k in build},
        'eventTrigger': info.get('eventTrigger'), 'environment': info.get('environment'), 'kmsKeyName': info.get('kmsKeyName')}


def protected_fields(value, path=''):
    # Hash environment maps as a whole: no names or secret values in the journal.
    if isinstance(value, dict) and value and not path.endswith('environmentVariables'):
        result = {}
        for key, child in value.items():
            result.update(protected_fields(child, path + '.' + key if path else key))
        return result
    return {path: digest(value)}


def validate_live(info, name):
    if info.get('name') != PARENT + '/functions/' + name or info.get('state') != 'ACTIVE': raise ValueError('Function not active')
    if info.get('buildConfig', {}).get('entryPoint') != name or info.get('buildConfig', {}).get('runtime') != 'nodejs22':
        raise ValueError('Entrypoint or runtime changed')
    if info.get('serviceConfig', {}).get('environmentVariables', {}).get('BXH_BUCKET_RUNTIME_ENABLED') != 'true':
        raise ValueError('Bucket runtime gate changed')


def load_review(directory):
    directory = Path(directory).resolve()
    if not (directory / 'READY_FOR_REVIEW').is_file(): raise ValueError('Missing preparation marker')
    review = json.loads((directory / 'review.json').read_text())
    files, rules, plan = PREP.BUILD.build(PREP.BUNDLE)
    if (review.get('project') != 'bxh-arena' or review.get('candidateCommit') != 'f660febcdad99809d63d1b10b6908ff46fef355b'
            or review.get('productionWrites') != 0 or review.get('plan') != plan): raise ValueError('Unreviewed preparation')
    import zipfile
    with zipfile.ZipFile(PREP.BUNDLE) as z: baseline = json.loads(z.read('manifest.json'))
    for name, expected in CANDIDATES.items():
        observed = baseline['functions'][name]
        if review['functions'][name] != {key: observed[key] for key in ('name', 'revision', 'updateTime', 'source')}:
            raise ValueError('Unreviewed original deployment identity')
        if review['archives'][name]['backupSha256'] != observed['archiveSha256']:
            raise ValueError('Unreviewed original archive hash')
        original = review['archives'][name]['backupSha256']
        if review['archives'][name]['candidateSha256'] != expected: raise ValueError('Unreviewed candidate hash')
        if digest((directory / 'candidate' / (name + '.zip')).read_bytes()) != expected: raise ValueError('Candidate bytes changed')
        if digest((directory / 'backup' / (name + '.zip')).read_bytes()) != original: raise ValueError('Backup bytes changed')
    if digest((directory / 'backup/firestore.rules').read_bytes()) != plan['rules']['before']: raise ValueError('Backup Rules changed')
    if digest((directory / 'candidate/firestore.rules').read_bytes()) != plan['rules']['after']: raise ValueError('Candidate Rules changed')
    return directory, review


def save(path, state):
    temporary = path.with_suffix('.tmp'); temporary.write_text(json.dumps(state, indent=2) + '\n'); os.replace(temporary, path)


def wait_operation(operation):
    name = operation.get('name', '')
    if not name.startswith(PARENT + '/operations/'): raise ValueError('Unexpected operation scope')
    started = time.monotonic()
    while True:
        value = api(name)
        if value.get('done'):
            if value.get('error'): raise ValueError('Cloud build/deployment failed; check operation in Console')
            return value
        if time.monotonic() - started > 1800: raise ValueError('Operation still pending; rerun to resume polling')
        print('Deployment operation pending; no additional mutation issued.', flush=True); time.sleep(15)


def run(directory, name, apply=False, rollback=False):
    os.umask(0o077)
    directory, review = load_review(directory)
    import zipfile
    with zipfile.ZipFile(PREP.BUNDLE) as z: baseline = json.loads(z.read('manifest.json'))
    PREP.policy_snapshot(token(), baseline)
    resource = PARENT + '/functions/' + name
    info = api(resource)
    journal = directory / ('release-' + name + '.json')
    state = json.loads(journal.read_text()) if journal.exists() else None
    action = 'rollback' if rollback else 'release'
    source = info['buildConfig']['source']['storageSource']
    if state and state.get('action') == action and state.get('status') == 'complete':
        validate_live(info, name)
        if info['serviceConfig']['revision'] != state['resultRevision']: raise ValueError('Live revision drifted after completed operation')
        return {'function': name, 'alreadyComplete': True, 'action': action, 'revision': state['resultRevision']}
    resuming = bool(state and state.get('action') == action and state.get('status') == 'pending')
    if resuming:
        if apply: wait_operation({'name': state['operation']})
        else: return {'function': name, 'readOnly': True, 'operationPending': True, 'action': action}
    else:
        validate_live(info, name)
        if state and state.get('status') in ('patching', 'pending', 'uploading'):
            raise ValueError('Ambiguous/incomplete prior operation; inspect journal and cloud operation before any new mutation')
        if rollback:
            if not state or state.get('status') != 'complete' or state.get('action') != 'release': raise ValueError('No completed release available to rollback')
            if info['serviceConfig']['revision'] != state['resultRevision']: raise ValueError('Rollback refused: live revision drifted')
        else:
            original = review['functions'][name]
            if source != original['source'] or info['serviceConfig']['revision'] != original['revision']:
                raise ValueError('Deployment baseline changed')
        if not apply:
            return {'readOnly': True, 'productionWrites': 0, 'function': name, 'action': action,
                    'sourceOnly': True, 'rulesChanged': False, 'roomsMigrated': False,
                    'candidateSha256': CANDIDATES[name], 'currentRevision': info['serviceConfig']['revision']}
        state = {'action': action, 'status': 'uploading', 'beforeRevision': info['serviceConfig']['revision'],
                 'protectedSha256': digest(protected(info)),
                 'protectedFields': protected_fields(protected(info))}
        save(journal, state)
        if rollback:
            target = review['functions'][name]['source']
        else:
            generated = api(PARENT + '/functions:generateUploadUrl', 'POST', {'environment': 'GEN_2'})
            target = generated['storageSource']
            upload(generated['uploadUrl'], (directory / 'candidate' / (name + '.zip')).read_bytes())
        # Recheck immediately before the source-only PATCH. No server-side CAS is offered.
        current = api(resource)
        if current.get('updateTime') != info.get('updateTime'): raise ValueError('Concurrent deployment detected')
        PREP.policy_snapshot(token(), baseline)
        state.update(status='patching', targetSource=target); save(journal, state)
        operation = api(resource + '?updateMask=buildConfig.source', 'PATCH',
                        {'name': resource, 'buildConfig': {'source': {'storageSource': target}}})
        state.update(status='pending', operation=operation['name']); save(journal, state)
        wait_operation(operation)
    result = api(resource); validate_live(result, name)
    if digest(protected(result)) != state['protectedSha256']:
        observed = protected_fields(protected(result))
        before = state.get('protectedFields')
        state.update(verification='settings-mismatch', observedRevision=result['serviceConfig']['revision'],
                     observedProtectedFields=observed,
                     protectedDifferencePaths=None if before is None else sorted(
                         key for key in set(before) | set(observed) if before.get(key) != observed.get(key)))
        save(journal, state)
        raise ValueError('Protected cloud settings differ; inspect before proceeding')
    deployed = result['buildConfig']['source']['storageSource']
    if not str(deployed.get('generation', '')).isdigit() or int(deployed['generation']) < 1:
        raise ValueError('Missing immutable deployed source generation')
    verified = directory / ('verified-' + name + '.zip')
    uri = f"gs://{deployed['bucket']}/{deployed['object']}#{deployed['generation']}"
    CAP.command(['gcloud', 'storage', 'cp', uri, str(verified), '--project=bxh-arena', '--quiet'])
    expected = review['archives'][name]['backupSha256'] if rollback else CANDIDATES[name]
    if digest(verified.read_bytes()) != expected: raise ValueError('Deployed source archive hash mismatch')
    state.update(status='complete', resultRevision=result['serviceConfig']['revision'], resultSource=deployed)
    save(journal, state)
    return {'function': name, 'action': action, 'status': 'complete', 'revision': state['resultRevision'],
            'protectedSettingsPreserved': True, 'rulesChanged': False, 'roomsMigrated': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', required=True, type=Path)
    parser.add_argument('--function', required=True, choices=sorted(CANDIDATES))
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--rollback', action='store_true')
    args = parser.parse_args()
    try:
        # One local process owns the preparation at a time; default remains cloud-read-only.
        with (args.directory / '.release.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            print(json.dumps(run(args.directory, args.function, args.apply, args.rollback), indent=2))
    except Exception as error:
        # Do not print network error bodies, signed URLs or credentials.
        message = str(error) if isinstance(error, ValueError) else 'Cloud request or local file check failed'
        raise SystemExit('Stopped: ' + message + '. Inspect release journal before retrying any apply.') from None
