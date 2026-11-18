#!/usr/bin/env python3
"""Capture three observed bucket sources and current Rules for review. Never deploy or execute source."""
import datetime
import hashlib
import json
from pathlib import Path
import os
import shutil
import subprocess
import tempfile
import urllib.request
import urllib.error
import zipfile

PROJECT = 'bxh-arena'
GENERATIONS = {'commitBucketRefereeCommand': '1794722128839589',
               'manageBucketRefereeSeats': '1794722195891401',
               'projectBucketPublicScore': '1794722273213484'}


def command(args):
    result = subprocess.run(args, capture_output=True, text=True, timeout=180, check=False)
    if result.returncode: raise RuntimeError('Cloud read failed; no production changes')
    return result.stdout


def describe(name):
    info = json.loads(command(['gcloud', 'functions', 'describe', name, '--gen2', '--region=asia-east1',
                               '--project=' + PROJECT, '--format=json', '--quiet']))
    source = info.get('buildConfig', {}).get('source', {}).get('storageSource', {})
    if (info.get('name') != f'projects/{PROJECT}/locations/asia-east1/functions/{name}'
            or info.get('state') != 'ACTIVE' or str(source.get('generation')) != GENERATIONS[name]
            or source.get('bucket') != 'gcf-v2-sources-87261141693-asia-east1'
            or source.get('object') != name + '/function-source.zip'):
        raise RuntimeError('Observed deployment changed; recapture inventory before source review')
    return {'name': name, 'revision': info.get('serviceConfig', {}).get('revision'),
            'updateTime': info.get('updateTime'), 'source': source}


def select_source(archive):
    if Path(archive).stat().st_size > 50 * 1024 * 1024: raise ValueError('Archive size limit')
    with zipfile.ZipFile(archive) as source:
        members = source.infolist(); names = [m.filename for m in members]
        if len(names) > 2048 or len(names) != len(set(names)) or sum(m.file_size for m in members) > 100 * 1024 * 1024:
            raise ValueError('Archive limits')
        if any(n.startswith('/') or '..' in n.split('/') or '\\' in n for n in names): raise ValueError('Unsafe archive path')
        wanted = [n for n in names if n in ('index.js', 'package.json', 'package-lock.json') or
                  (n.endswith('.cjs') and (len(n.split('/')) == 1 or len(n.split('/')) == 2 and n.startswith('engine/')))]
        if not {'index.js', 'package.json'} <= set(wanted): raise ValueError('Source package incomplete')
        return {n: source.read(n) for n in wanted}


def api(url, token):
    request = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + token})
    with urllib.request.urlopen(request, timeout=30) as response: return json.load(response)


def capture():
    os.umask(0o077)
    before = {n: describe(n) for n in GENERATIONS}
    with tempfile.TemporaryDirectory(prefix='bxh816-source-download-') as temporary:
        payload = Path(temporary) / 'review'; payload.mkdir()
        manifest = {'project': PROJECT, 'readOnly': True, 'productionWrites': 0,
                    'capturedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'functions': {}}
        for name, observed in before.items():
            src = observed['source']; archive = Path(temporary) / (name + '.zip')
            uri = f"gs://{src['bucket']}/{src['object']}#{src['generation']}"
            command(['gcloud', 'storage', 'cp', uri, str(archive), '--project=' + PROJECT, '--quiet'])
            selected = select_source(archive); hashes = {}
            for member, data in selected.items():
                target = payload / name / member; target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(data)
                hashes[member] = hashlib.sha256(data).hexdigest()
            manifest['functions'][name] = {**observed, 'archiveSha256': hashlib.sha256(archive.read_bytes()).hexdigest(), 'selectedFiles': hashes}
        token = command(['gcloud', 'auth', 'print-access-token', '--quiet']).strip()
        if not token: raise RuntimeError('Missing authenticated identity')
        release = api(f'https://firebaserules.googleapis.com/v1/projects/{PROJECT}/releases/cloud.firestore', token)
        ruleset = release.get('rulesetName', '')
        if not ruleset.startswith(f'projects/{PROJECT}/rulesets/'): raise ValueError('Unexpected Rules project')
        rules = api('https://firebaserules.googleapis.com/v1/' + ruleset, token).get('source', {}).get('files', [])
        if len(rules) != 1 or not isinstance(rules[0].get('content'), str): raise ValueError('Expected one Rules source')
        data = rules[0]['content'].encode(); (payload / 'firestore.live.rules').write_bytes(data)
        manifest['rules'] = {'rulesetName': ruleset, 'sha256': hashlib.sha256(data).hexdigest()}
        # Capture only explicit release flags and room manifests; never room.data, participants or profiles.
        base = f'https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents/'
        config = api(base + 'systemConfig/fourCourtScoreBuckets', token); fields = config.get('fields', {})
        allowlist = fields.get('productionRooms', {}).get('mapValue', {}).get('fields', {})
        if len(allowlist) > 32: raise ValueError('Review room count limit')
        manifest['release'] = {'updateTime': config.get('updateTime'), 'flags': {k: fields.get(k, {}).get('booleanValue') for k in ('enabled', 'productionEnabled', 'privateReadsEnabled', 'automaticPublicProjectionEnabled', 'perCourtStorageEnabled', 'skipPublicProjectionAsyncEnabled', 'migrationEnabled')}}
        manifest['rooms'] = []
        import re
        for code, value in allowlist.items():
            if not re.fullmatch(r'BXH-[A-Z0-9]{4,16}', code): raise ValueError('Unexpected allowlist room')
            try:
                room = api(base + 'tournaments/' + code + '?mask.fieldPaths=scoreStorage', token)
            except urllib.error.HTTPError as error:
                if error.code != 404: raise
                manifest['rooms'].append({'code': code, 'exists': False}); continue
            manifest['rooms'].append({'code': code, 'exists': True, 'allowlistEpoch': value.get('stringValue'), 'updateTime': room.get('updateTime'), 'scoreStorage': room.get('fields', {}).get('scoreStorage')})
        after = {n: describe(n) for n in GENERATIONS}
        if before != after: raise RuntimeError('Deployment changed during capture; do not use mixed review')
        (payload / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
        directory = Path(tempfile.mkdtemp(prefix='BXH816_source_review_', dir=Path.home()))
        bundle = Path(shutil.make_archive(str(directory / 'BXH816_sources'), 'zip', payload)); bundle.chmod(0o600)
        return {'readOnly': True, 'productionWrites': 0, 'bundle': str(bundle),
                'sha256': hashlib.sha256(bundle.read_bytes()).hexdigest(), 'functionsCaptured': len(before),
                'roomManifestsCaptured': len(allowlist), 'rulesSha256': manifest['rules']['sha256']}


if __name__ == '__main__':
    try: print(json.dumps(capture(), indent=2))
    except Exception: raise SystemExit('Source capture stopped; no production changes. Recheck inventory/access; no credentials were printed.') from None
