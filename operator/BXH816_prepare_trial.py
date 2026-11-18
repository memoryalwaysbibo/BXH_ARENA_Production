#!/usr/bin/env python3
"""Read-only cloud checks and local full-archive overlay. No deploy, room writes or source execution."""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


CAP = module('capture816', ROOT / 'operator/BXH816_capture_bucket_sources.py')
BUILD = module('build816', ROOT / 'scripts/build-score-stability-release.py')
BUNDLE = ROOT / 'referee-seats/reference/BXH816_bucket_sources-20261118.zip'


def digest(data): return hashlib.sha256(data).hexdigest()


def overlay_archive(raw, selected, files, expected_sha):
    if digest(raw) != expected_sha: raise ValueError('Immutable source archive hash changed')
    if len(raw) > 50 * 1024 * 1024: raise ValueError('Archive size limit')
    output = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(raw)) as source, zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as dest:
        members = source.infolist(); names = [m.filename for m in members]
        if len(names) > 2048 or len(names) != len(set(names)) or sum(m.file_size for m in members) > 100 * 1024 * 1024:
            raise ValueError('Archive limits')
        for item in members:
            if (item.filename.startswith('/') or '..' in item.filename.split('/') or '\\' in item.filename
                    or stat.S_ISLNK(item.external_attr >> 16) or item.flag_bits & 1):
                raise ValueError('Unsafe archive member')
        for name, expected in selected.items():
            if name not in names or digest(source.read(name)) != expected: raise ValueError('Selected source differs')
        # Keep all uncaptured files and ZIP metadata, including package locks.
        for item in members: dest.writestr(item, files.get(item.filename, source.read(item)))
        for name, data in sorted(files.items()):
            if name not in names: dest.writestr(name, data)
        dest.comment = source.comment
    return output.getvalue()


def policy_snapshot(token, baseline):
    base = f'https://firestore.googleapis.com/v1/projects/{CAP.PROJECT}/databases/(default)/documents/'
    release = CAP.api(f'https://firebaserules.googleapis.com/v1/projects/{CAP.PROJECT}/releases/cloud.firestore', token)
    ruleset = release.get('rulesetName', '')
    if not ruleset.startswith(f'projects/{CAP.PROJECT}/rulesets/'): raise ValueError('Rules project changed')
    rules = CAP.api('https://firebaserules.googleapis.com/v1/' + ruleset, token).get('source', {}).get('files', [])
    if len(rules) != 1 or digest(rules[0]['content'].encode()) != baseline['rules']['sha256']:
        raise ValueError('Live Rules changed; a new review is required')
    config = CAP.api(base + 'systemConfig/fourCourtScoreBuckets', token)
    fields = config.get('fields', {})
    flags = {key: fields.get(key, {}).get('booleanValue') for key in baseline['release']['flags']}
    if flags != baseline['release']['flags']: raise ValueError('Live release flags changed')
    actual = fields.get('productionRooms', {}).get('mapValue', {}).get('fields', {})
    expected = {r['code']: {'stringValue': r['allowlistEpoch']} for r in baseline['rooms'] if r['exists']}
    if actual != expected: raise ValueError('Trial allowlist changed')
    rooms = {}
    for room in baseline['rooms']:
        if not room['exists']: raise ValueError('Captured trial room missing')
        current = CAP.api(base + 'tournaments/' + room['code'] + '?mask.fieldPaths=scoreStorage', token)
        storage = current.get('fields', {}).get('scoreStorage')
        if storage != room['scoreStorage']: raise ValueError('Trial storage or epoch changed')
        rooms[room['code']] = storage
    return {'rulesetName': ruleset, 'rulesSha256': baseline['rules']['sha256'],
            'configUpdateTime': config.get('updateTime'), 'flags': flags, 'rooms': rooms}


def prepare():
    os.umask(0o077)
    files, rules, plan = BUILD.build(BUNDLE)
    if plan != json.loads((ROOT / 'release/score-stability/release-plan.json').read_text()):
        raise ValueError('Local overlay differs from reviewed plan')
    with zipfile.ZipFile(BUNDLE) as z: baseline = json.loads(z.read('manifest.json'))
    before = {name: CAP.describe(name) for name in CAP.GENERATIONS}
    token = CAP.command(['gcloud', 'auth', 'print-access-token', '--quiet']).strip()
    if not token: raise ValueError('Missing authenticated identity')
    policy = policy_snapshot(token, baseline)
    directory = Path(tempfile.mkdtemp(prefix='BXH816_trial_prepare_', dir=Path.home()))
    backup = directory / 'backup'; backup.mkdir()
    candidate = directory / 'candidate'; candidate.mkdir()
    # READY is created only after all independent checks pass. Failed local output is not deployable.
    for name, info in before.items():
        src = info['source']; original = backup / (name + '.zip')
        CAP.command(['gcloud', 'storage', 'cp', f"gs://{src['bucket']}/{src['object']}#{src['generation']}", str(original), '--project=' + CAP.PROJECT, '--quiet'])
        original.chmod(0o600)
        captured = baseline['functions'][name]
        data = overlay_archive(original.read_bytes(), captured['selectedFiles'], files[name], captured['archiveSha256'])
        (candidate / (name + '.zip')).write_bytes(data)
    with zipfile.ZipFile(BUNDLE) as z: (backup / 'firestore.rules').write_bytes(z.read('firestore.live.rules'))
    (candidate / 'firestore.rules').write_text(rules)
    after = {name: CAP.describe(name) for name in CAP.GENERATIONS}
    if before != after or policy != policy_snapshot(token, baseline): raise ValueError('Live baseline changed during preparation')
    report = {'project': CAP.PROJECT, 'readOnly': True, 'productionWrites': 0,
              'deployed': False, 'roomsMigrated': False, 'candidateCommit': 'f660febcdad99809d63d1b10b6908ff46fef355b',
              'functions': before, 'policy': policy, 'plan': plan,
              'archives': {name: {'backupSha256': digest((backup / (name + '.zip')).read_bytes()),
                                 'candidateSha256': digest((candidate / (name + '.zip')).read_bytes())} for name in before}}
    (directory / 'review.json').write_text(json.dumps(report, indent=2) + '\n')
    (directory / 'READY_FOR_REVIEW').write_text('Local preparation only. No deployment or migration authorized by this marker.\n')
    return {'readOnly': True, 'productionWrites': 0, 'directory': str(directory),
            'fullArchivesPrepared': len(before), 'rulesPreserved': True, 'deployed': False, 'next': 'Review full archive hashes before any separate trial deployment'}


if __name__ == '__main__':
    try: print(json.dumps(prepare(), indent=2))
    except Exception: raise SystemExit('Preparation stopped. No production changes. Recheck current inventory and access; no credentials were printed.') from None
