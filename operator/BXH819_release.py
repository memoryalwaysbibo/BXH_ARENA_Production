#!/usr/bin/env python3
"""Source-only manual PASS release. Default prepares with cloud reads only."""
import argparse
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import time
import urllib.parse
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
PARENT = 'projects/bxh-arena/locations/asia-east1'
BASE = 'https://cloudfunctions.googleapis.com/v2/'
REVISIONS = {'commitRefereeCommand': 'commitrefereecommand-00010-pid',
             'commitBucketRefereeCommand': 'commitbucketrefereecommand-00007-hab'}
PASS_SHA = '9e4b291a3951a7399e4732fe0841989afeb7e47b0529e314588369177d5d6db2'
DISPATCH_SHA = {'commitRefereeCommand': 'bafe5bc97546c50795b727a7c05d4e6d40c9f9995ad8adc1985c2f1f09fe0764',
                'commitBucketRefereeCommand': '8a10f7dbb759559b965ea39a1cfb02addbc288f5957c7798b51ebe96b5b8a91b'}
OLD = "PassReturn.readiness(state,m).ok))fail('pass-protected');"
NEW = "PassReturn.readiness(state,m,{manual:true}).ok))fail('pass-protected');"


def digest(value):
    if not isinstance(value, bytes): value = json.dumps(value, sort_keys=True, separators=(',', ':')).encode()
    return hashlib.sha256(value).hexdigest()


def command(args):
    result = subprocess.run(args, capture_output=True, text=True, timeout=180)
    if result.returncode: raise ValueError('Cloud CLI command failed; command output withheld')
    return result.stdout


def api(resource, method='GET', body=None):
    # Credentials and signed URLs are never printed or saved.
    token = command(['gcloud', 'auth', 'print-access-token', '--quiet']).strip()
    request = urllib.request.Request(BASE + resource, method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=60) as response: return json.load(response)


def save(path, value):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, indent=2) + '\n')
    temporary.replace(path)


def protected(info):
    build = info['buildConfig']
    return {'serviceConfig': {k: v for k, v in info['serviceConfig'].items() if k not in ('uri', 'service', 'revision')},
            'buildConfig': {k: build[k] for k in ('runtime', 'entryPoint', 'environmentVariables', 'serviceAccount',
                'workerPool', 'dockerRegistry', 'dockerRepository') if k in build},
            'eventTrigger': info.get('eventTrigger'), 'environment': info.get('environment'), 'kmsKeyName': info.get('kmsKeyName')}


def validate(info, name, active=True):
    if (info.get('name') != PARENT + '/functions/' + name
            or info.get('buildConfig', {}).get('entryPoint') != name
            or info['buildConfig'].get('runtime') != 'nodejs22'
            or (active and info.get('state') != 'ACTIVE')):
        raise ValueError('Unexpected function identity, runtime or state')


def source(info):
    value = info['buildConfig']['source']['storageSource']
    if (value.get('bucket') != 'gcf-v2-sources-87261141693-asia-east1'
            or not str(value.get('generation', '')).isdigit()):
        raise ValueError('Missing immutable source generation')
    return value


def download(value, path):
    uri = f"gs://{value['bucket']}/{value['object']}#{value['generation']}"
    command(['gcloud', 'storage', 'cp', uri, str(path), '--project=bxh-arena', '--quiet'])


def patch_archive(raw, name, pass_source):
    if len(raw) > 50 * 1024 * 1024: raise ValueError('Source archive too large')
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        members = z.infolist(); names = [m.filename for m in members]
        if (len(names) != len(set(names)) or len(names) > 4096
                or sum(m.file_size for m in members) > 100 * 1024 * 1024
                or any(n.startswith('/') or '..' in n.split('/') or '\\' in n for n in names)):
            raise ValueError('Unsafe or oversized source archive')
        original = {m.filename: z.read(m) for m in members}
        if not {'index.js', 'package.json', 'engine/index.cjs', 'engine/pass-return.cjs', 'dispatch-core.cjs'} <= set(names):
            raise ValueError('Incomplete source archive')
        if digest(original['engine/pass-return.cjs']) != PASS_SHA or digest(original['dispatch-core.cjs']) != DISPATCH_SHA[name]:
            raise ValueError('Reviewed PASS or dispatch source has changed')
        dispatch = original['dispatch-core.cjs'].decode()
        if dispatch.count(OLD) != 1: raise ValueError('Dispatch source anchor changed')
        replacements = {'engine/pass-return.cjs': pass_source, 'dispatch-core.cjs': dispatch.replace(OLD, NEW, 1).encode()}
        output = io.BytesIO()
        with zipfile.ZipFile(output, 'w') as target:
            target.comment = z.comment
            for member in members: target.writestr(member, replacements.get(member.filename, original[member.filename]))
        result = output.getvalue()
    with zipfile.ZipFile(io.BytesIO(result)) as z:
        if set(z.namelist()) != set(original): raise ValueError('Source entry set changed')
        changed = sorted(n for n in original if z.read(n) != original[n])
        if changed != sorted(replacements): raise ValueError('Unexpected source overlay scope')
    return result


def prepare(directory):
    plan_path = directory / 'plan.json'
    pass_source = (ROOT / 'referee-seats/functions/engine/pass-return.cjs').read_bytes()
    if b'readiness(st,m,{manual:true})' not in pass_source: raise ValueError('Wrong candidate checkout')
    if plan_path.exists():
        plan = json.loads(plan_path.read_text())
        if plan.get('tool') != 'BXH819' or plan.get('passSourceSha256') != digest(pass_source):
            raise ValueError('Preparation belongs to another candidate')
        if set(plan['functions']) != set(REVISIONS): raise ValueError('Unexpected deployment scope')
        for name, item in plan['functions'].items():
            raw = (directory / (name + '.backup.zip')).read_bytes()
            candidate = (directory / (name + '.candidate.zip')).read_bytes()
            if (digest(raw) != item['backupSha256'] or digest(candidate) != item['candidateSha256']
                    or candidate != patch_archive(raw, name, pass_source)):
                raise ValueError('Prepared archive verification failed')
        return plan
    plan = {'tool': 'BXH819', 'project': 'bxh-arena', 'passSourceSha256': digest(pass_source), 'functions': {}}
    # Verify and prepare both functions before issuing any cloud mutations.
    for name, revision in REVISIONS.items():
        info = api(PARENT + '/functions/' + name); validate(info, name)
        if info['serviceConfig']['revision'] != revision: raise ValueError('Live baseline revision changed: ' + name)
        path = directory / (name + '.backup.zip'); download(source(info), path)
        raw = path.read_bytes(); candidate = patch_archive(raw, name, pass_source)
        (directory / (name + '.candidate.zip')).write_bytes(candidate)
        plan['functions'][name] = {'beforeRevision': revision, 'beforeUpdateTime': info['updateTime'],
            'beforeSource': source(info), 'protectedSha256': digest(protected(info)),
            'backupSha256': digest(raw), 'candidateSha256': digest(candidate)}
    save(plan_path, plan)
    return plan


def poll(operation):
    started = time.monotonic()
    while True:
        value = api(operation)
        if value.get('done'):
            if value.get('error'): raise ValueError('Cloud deployment operation failed; inspect journal before retrying')
            return
        if time.monotonic() - started > 1800: raise ValueError('Deployment still pending; rerun the same command to resume polling')
        print('Deployment pending; no additional mutation issued.', flush=True)
        time.sleep(15)


def verify(directory, name, item, journal, state, expected_hash, rollback=False):
    info = api(PARENT + '/functions/' + name); validate(info, name)
    if digest(protected(info)) != item['protectedSha256']: raise ValueError('Protected cloud settings changed')
    if state.get('resultRevision') and info['serviceConfig']['revision'] != state['resultRevision']:
        raise ValueError('Live revision changed after release')
    path = directory / (name + '.verified.zip'); download(source(info), path)
    if digest(path.read_bytes()) != expected_hash: raise ValueError('Deployed source hash differs from candidate')
    state.update(status='complete', resultRevision=info['serviceConfig']['revision'], resultSource=source(info))
    save(journal, state)
    return {'function': name, 'status': 'complete', 'revision': state['resultRevision'],
            'action': 'rollback' if rollback else 'release', 'protectedSettingsPreserved': True,
            'rulesChanged': False, 'roomsMigrated': False}


def release(directory, name, item, apply=False, verify_only=False, rollback=False):
    journal = directory / (name + '.release.json')
    state = json.loads(journal.read_text()) if journal.exists() else None
    resource = PARENT + '/functions/' + name
    if rollback:
        if not state or not state.get('resultRevision'): raise ValueError('Rollback requires a verified release')
        rollback_journal = directory / (name + '.rollback.json')
        previous = state
        state = json.loads(rollback_journal.read_text()) if rollback_journal.exists() else None
        journal = rollback_journal
    expected = item['backupSha256'] if rollback else item['candidateSha256']
    if state and state.get('status') == 'pending':
        if apply or verify_only: poll(state['operation'])
        else: return {'function': name, 'operationPending': True, 'productionWrites': 0}
        return verify(directory, name, item, journal, state, expected, rollback)
    if state and state.get('status') == 'complete':
        return verify(directory, name, item, journal, state, expected, rollback)
    if verify_only: raise ValueError('No pending or completed deployment to verify')
    if state: raise ValueError('Ambiguous prior request; inspect cloud operation and journal before any mutation')
    info = api(resource); validate(info, name)
    baseline_revision = previous['resultRevision'] if rollback else item['beforeRevision']
    baseline_source = previous['resultSource'] if rollback else item['beforeSource']
    if (info['serviceConfig']['revision'] != baseline_revision or source(info) != baseline_source
            or digest(protected(info)) != item['protectedSha256']): raise ValueError('Live baseline changed')
    if not apply: return {'function': name, 'readOnly': True, 'productionWrites': 0, 'candidateSha256': expected}
    state = {'status': 'uploading', 'beforeRevision': baseline_revision}; save(journal, state)
    if rollback:
        target = item['beforeSource']
    else:
        generated = api(PARENT + '/functions:generateUploadUrl', 'POST', {'environment': 'GEN_2'})
        parsed = urllib.parse.urlsplit(generated['uploadUrl'])
        if parsed.scheme != 'https' or not (parsed.hostname or '').endswith('.googleapis.com'):
            raise ValueError('Unexpected signed upload host')
        raw = (directory / (name + '.candidate.zip')).read_bytes()
        request = urllib.request.Request(generated['uploadUrl'], method='PUT', data=raw, headers={'Content-Type': 'application/zip'})
        with urllib.request.urlopen(request, timeout=120) as response:
            if response.status not in (200, 201): raise ValueError('Source upload failed')
        target = generated['storageSource']
    current = api(resource)
    if current.get('updateTime') != info.get('updateTime'): raise ValueError('Concurrent deployment detected')
    state.update(status='patching', targetSource=target); save(journal, state)
    # Only the source is patched; existing runtime, flags, permissions and limits remain intact.
    operation = api(resource + '?updateMask=buildConfig.source', 'PATCH',
        {'name': resource, 'buildConfig': {'source': {'storageSource': target}}})
    state.update(status='pending', operation=operation['name']); save(journal, state)
    poll(operation['name'])
    return verify(directory, name, item, journal, state, expected, rollback)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, default=Path.home() / 'BXH819_release')
    parser.add_argument('--function', choices=list(REVISIONS))
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--apply', action='store_true')
    mode.add_argument('--verify', action='store_true')
    parser.add_argument('--rollback', action='store_true')
    args = parser.parse_args(); os.umask(0o077)
    directory = args.directory.resolve(); directory.mkdir(parents=True, exist_ok=True)
    with (directory / '.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.verify and not (directory / 'plan.json').exists(): raise ValueError('No existing preparation to verify')
        if args.rollback and not args.function: raise ValueError('Rollback requires one explicit function')
        plan = prepare(directory)
        print('Release directory: ' + str(directory), flush=True)
        for name in ([args.function] if args.function else REVISIONS):
            print(json.dumps(release(directory, name, plan['functions'][name], args.apply, args.verify, args.rollback)), flush=True)


if __name__ == '__main__':
    try: main()
    except Exception as error:
        message = str(error) if isinstance(error, ValueError) else 'Cloud request or local file operation failed'
        raise SystemExit('Stopped: ' + message + '. No additional mutation issued.') from None
