#!/usr/bin/env python3
"""Read BXH scoring deployment fingerprints and explicit flags; never deploy/write cloud data."""
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import urllib.request
import zipfile

PROJECT = 'bxh-arena'
REGION = 'asia-east1'
FUNCTIONS = ('commitRefereeCommand', 'manageRefereeSeats', 'commitBucketRefereeCommand',
             'manageBucketRefereeSeats', 'projectBucketPublicScore')
CAPTURED = {
    'engine/index.cjs': '3e40412b390fac6115c9e93771fd1a15961b3a053956bf013497740fa811eb0b',
    'dispatch-core.cjs': '4be700ad894bf35b95e1da39585544ad14d596df5c12d00362d0ec93a90efe3b',
    'scoring-core.cjs': '093b6d4e1cec11c3b3bd6a45d3ed2c51f72ff9818893f33992d35ce955c806a5',
}
FILES = ('index.js', 'core.cjs', 'engine/index.cjs', 'dispatch-core.cjs',
         'scoring-core.cjs', 'score-diagnostics.cjs')
FLAGS = ('enabled', 'productionEnabled', 'privateReadsEnabled', 'automaticPublicProjectionEnabled',
         'perCourtStorageEnabled', 'skipPublicProjectionAsyncEnabled', 'migrationEnabled',
         'perCourtScoringVerified', 'communitySeatsEnabled', 'partnerSeatsEnabled')


def command(args):
    result = subprocess.run(args, capture_output=True, text=True, timeout=120, check=False)
    if result.returncode:
        raise RuntimeError('read-failed')
    return result.stdout


def api(url, token):
    request = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + token})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def source_uri(info):
    if info.get('name') != f'projects/{PROJECT}/locations/{REGION}/functions/commitRefereeCommand':
        raise ValueError('unexpected-function')
    source = info.get('buildConfig', {}).get('source', {}).get('storageSource', {})
    bucket, obj, generation = source.get('bucket'), source.get('object'), str(source.get('generation', ''))
    if bucket != 'gcf-v2-sources-87261141693-asia-east1' or obj != 'commitRefereeCommand/function-source.zip' or not generation.isdigit():
        raise ValueError('unexpected-source')
    return f'gs://{bucket}/{obj}#{generation}'


def fingerprints(archive):
    if Path(archive).stat().st_size > 50 * 1024 * 1024:
        raise ValueError('archive-too-large')
    with zipfile.ZipFile(archive) as source:
        entries = source.infolist()
        names = [x.filename for x in entries]
        if len(entries) > 2048 or len(set(names)) != len(names) or sum(x.file_size for x in entries) > 100 * 1024 * 1024:
            raise ValueError('archive-limit')
        if any(x.filename.startswith('/') or '..' in x.filename.split('/') or '\\' in x.filename for x in entries):
            raise ValueError('unsafe-archive')
        return {name: hashlib.sha256(source.read(name)).hexdigest() if name in names else None for name in FILES}


def summarize_function(info):
    service, build = info.get('serviceConfig', {}), info.get('buildConfig', {})
    return {'state': info.get('state'), 'updateTime': info.get('updateTime'),
            'revision': service.get('revision'), 'runtime': build.get('runtime'),
            'entryPoint': build.get('entryPoint'),
            'storageSource': build.get('source', {}).get('storageSource'),
            'limits': {k: service.get(k) for k in ('timeoutSeconds', 'maxInstanceCount', 'minInstanceCount', 'availableMemory', 'availableCpu')},
            'bucketRuntimeEnabled': service.get('environmentVariables', {}).get('BXH_BUCKET_RUNTIME_ENABLED') == 'true'}


def summarize_flags(document):
    fields = document.get('fields', {})
    return {'updateTime': document.get('updateTime'),
            'flags': {k: fields.get(k, {}).get('booleanValue') for k in FLAGS},
            'productionRoomCount': len(fields.get('productionRooms', {}).get('mapValue', {}).get('fields', {}))}


def capture():
    report = {'project': PROJECT, 'readOnly': True, 'productionWrites': 0,
              'functions': {}, 'errors': [], 'trialAuthorized': False}
    main_info = None
    for name in FUNCTIONS:
        try:
            info = json.loads(command(['gcloud', 'functions', 'describe', name, '--gen2', '--region=' + REGION,
                                       '--project=' + PROJECT, '--format=json', '--quiet']))
            report['functions'][name] = summarize_function(info)
            if name == 'commitRefereeCommand':
                main_info = info
        except Exception:
            # Missing deployment and lack of permission are deliberately not conflated.
            report['functions'][name] = {'readStatus': 'unavailable'}
            report['errors'].append(name + ':read-unavailable')
    if main_info:
        try:
            with tempfile.TemporaryDirectory(prefix='bxh816-readonly-') as directory:
                archive = Path(directory) / 'source.zip'
                command(['gcloud', 'storage', 'cp', source_uri(main_info), str(archive), '--project=' + PROJECT, '--quiet'])
                hashes = fingerprints(archive)
            report['sourceSha256'] = hashes
            report['matchesProvidedCapture'] = {name: hashes[name] == expected for name, expected in CAPTURED.items()}
        except Exception:
            report['errors'].append('source-fingerprints:read-unavailable')
    try:
        token = command(['gcloud', 'auth', 'print-access-token', '--quiet']).strip()
        if not token:
            raise ValueError('missing-identity')
        for key in ('fourCourtScoreBuckets', 'refereeSeatsV1'):
            try:
                document = api(f'https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents/systemConfig/{key}', token)
                report[key] = summarize_flags(document)
            except Exception:
                report['errors'].append(key + ':read-unavailable')
        release = api(f'https://firebaserules.googleapis.com/v1/projects/{PROJECT}/releases/cloud.firestore', token)
        name = release.get('rulesetName', '')
        if not name.startswith(f'projects/{PROJECT}/rulesets/'):
            raise ValueError('unexpected-ruleset')
        rules = api('https://firebaserules.googleapis.com/v1/' + name, token)
        files = rules.get('source', {}).get('files', [])
        report['rules'] = {'name': name, 'files': [{'name': f.get('name'), 'sha256': hashlib.sha256(f['content'].encode()).hexdigest()} for f in files]}
    except Exception:
        report['errors'].append('rules-or-identity:read-unavailable')
    return report


if __name__ == '__main__':
    print(json.dumps(capture(), ensure_ascii=False, indent=2))
